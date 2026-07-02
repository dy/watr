/**
 * WAT AST optimizer — size/runtime passes over watr's s-expression IR.
 *
 * jz owns its optimizer; watr is used *only* as the WAT→binary encoder.
 * Pairs with src/optimize/ (jz-IR-level) — folder context disambiguates.
 *
 * @module wat/optimize
 */

import { size } from './compile.js'
import { IMM, OPCODE, resultType } from './const.js'
import parse from './parse.js'
import { clone, walk, walkPost } from './util.js'

// Fixpoint round caps — empirical convergence bounds, not correctness limits.
// Each pass only makes monotonic progress, so hitting a cap merely leaves a few
// residual simplifications for the next compile rather than producing wrong output.
const MAX_PROP_ROUNDS = 6     // forward-prop / set-get / tee fixpoint per scope
const MAX_INLINE_ROUNDS = 16  // single-caller inline-chain depth (deep generated stdlib)

// === WAT optimizer passes ===

/**
 * Recursively count AST nodes — fast size heuristic without compiling.
 * @param {any} node
 * @returns {number}
 */
const count = (node) => {
  if (!Array.isArray(node)) return 1
  let n = 1
  for (let i = 0; i < node.length; i++) n += count(node[i])
  return n
}

/**
 * Compile AST and measure binary size in bytes.
 * @param {Array} ast
 * @returns {number}
 */
const binarySize = (ast) => {
  // `size` = byte length without materializing the binary — the size-revert guard only needs
  // the count, and re-encoding the whole module each round is the optimizer's dominant cost on
  // large modules. Exactly compile(ast).length (invariant-tested).
  try { return size(ast) } catch { return Infinity }
}

/**
 * Fast structural equality of two AST nodes.
 * Stops at first difference. Handles BigInt without stringification.
 */
const equal = (a, b) => {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a === 'bigint') return a === b
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false
  return true
}

/**
 * Locate the parts of an `(if ...)` node:
 *   condIdx → index of the condition expression
 *   cond    → the condition expression itself
 *   thenBranch / elseBranch → the (then ...) / (else ...) sub-arrays, or null
 * The condition sits after any leading `param`/`result` annotations and before
 * the `then`/`else` arms.
 */
const parseIf = (node) => {
  let condIdx = 1
  while (condIdx < node.length) {
    const c = node[condIdx]
    if (Array.isArray(c) && (c[0] === 'then' || c[0] === 'else' || c[0] === 'result' || c[0] === 'param')) {
      condIdx++
      continue
    }
    break
  }
  let thenBranch = null, elseBranch = null
  for (let i = condIdx + 1; i < node.length; i++) {
    const c = node[i]
    if (!Array.isArray(c)) continue
    if (c[0] === 'then') thenBranch = c
    else if (c[0] === 'else') elseBranch = c
  }
  return { condIdx, cond: node[condIdx], thenBranch, elseBranch }
}

// ==================== TREESHAKE ====================

/**
 * Remove unused functions, globals, types, tables.
 * Keeps exports and their transitive dependencies.
 * @param {Array} ast
 * @returns {Array}
 */
const treeshake = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  // Index spaces. Each entry is shared between its $name key and its numeric idx
  // key, so name/index lookups hit the same record. nodeMap covers reverse lookup
  // (used during the filtering pass for unnamed definitions).
  const funcs = new Map(), globals = new Map(), types = new Map()
  const tables = new Map(), memories = new Map()
  const nodeMap = new Map() // node → entry

  const register = (map, node, idx, isImport = false) => {
    const named = typeof node[1] === 'string' && node[1][0] === '$'
    const name = named ? node[1] : idx
    const inlineExported = !isImport && node.some(s => Array.isArray(s) && s[0] === 'export')
    const entry = { node, idx, used: inlineExported, isImport }
    map.set(name, entry)
    if (named) map.set(idx, entry)
    nodeMap.set(node, entry)
    return entry
  }

  let funcIdx = 0, globalIdx = 0, typeIdx = 0, tableIdx = 0, memIdx = 0
  const elems = [], data = [], exports = [], starts = []
  // Highest index referenced by a bare NUMERAL per space, from surviving sites only.
  // Removing entry i shifts every later index down, so numeric refs cap removal:
  // only entries above the cap may be dropped (named refs re-resolve; numerals don't).
  const numRef = { func: -1, global: -1, type: -1, table: -1, memory: -1 }
  // Inline-import defs ((global $g (import …) …)) occupy the import-first region of the
  // binary index space, so declaration-order idx diverges from binary idx — numeric
  // comparisons are unreliable there. Numeric refs + inline imports → freeze the space.
  const inlineImport = { func: false, global: false, type: false }

  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) continue
    const kind = node[0]
    const inlImp = node.some(s => Array.isArray(s) && s[0] === 'import')
    if (kind === 'type')   register(types,   node, typeIdx++)
    else if (kind === 'func')   register(funcs,   node, funcIdx++), inlImp && (inlineImport.func = true)
    else if (kind === 'global') register(globals, node, globalIdx++), inlImp && (inlineImport.global = true)
    else if (kind === 'table')  register(tables,  node, tableIdx++)
    else if (kind === 'memory') register(memories, node, memIdx++)
    else if (kind === 'import') {
      // Each import sub-item occupies its own slot in the relevant index space.
      for (const sub of node) {
        if (!Array.isArray(sub)) continue
        if (sub[0] === 'func')        register(funcs,    sub, funcIdx++,   true)
        else if (sub[0] === 'global') register(globals,  sub, globalIdx++, true)
        else if (sub[0] === 'table')  register(tables,   sub, tableIdx++,  true)
        else if (sub[0] === 'memory') register(memories, sub, memIdx++,    true)
      }
    }
    else if (kind === 'export') exports.push(node)
    else if (kind === 'start') starts.push(node)
    else if (kind === 'elem') elems.push(node)
    else if (kind === 'data') data.push(node)
  }

  // Worklist: entries (funcs, globals, tables, types) whose node awaits a ref scan.
  const work = []
  const enqueue = (entry) => { if (entry && !entry.scanned) work.push(entry) }
  // Resolve a ref, coercing bare numerals ('3' → 3) onto the shared idx key and
  // recording the numeric-removal cap for the space.
  const deref = (map, space, ref) => {
    if (typeof ref === 'string' && ref[0] !== '$' && ref !== '' && !isNaN(ref)) ref = +ref
    if (typeof ref === 'number') numRef[space] = Math.max(numRef[space], ref)
    return map.get(ref)
  }
  const markFunc   = (ref) => { const e = deref(funcs, 'func', ref); if (e) e.used = true, enqueue(e) }
  const markGlobal = (ref) => { const e = deref(globals, 'global', ref); if (e) e.used = true, enqueue(e) }
  const markTable  = (ref) => { const e = deref(tables, 'table', ref); if (e) e.used = true, enqueue(e) }
  const markMemory = (ref) => { const e = deref(memories, 'memory', ref); if (e) e.used = true }
  const markType   = (ref) => { const e = deref(types, 'type', ref); if (e) e.used = true, enqueue(e) }

  // Roots: explicit exports, start funcs, elem/data segments, inline-exported items.
  for (const exp of exports) {
    for (const sub of exp) {
      if (!Array.isArray(sub)) continue
      const [kind, ref] = sub
      if (kind === 'func') markFunc(ref)
      else if (kind === 'global') markGlobal(ref)
      else if (kind === 'table') markTable(ref)
      else if (kind === 'memory') markMemory(ref)
    }
  }
  // A start func with an empty body is a no-op: drop the (start) root itself and
  // let ordinary liveness collect the func (renumbering absorbs the index shift).
  const START_HEAD = new Set(['export', 'type', 'param', 'result', 'local'])
  const emptyBody = (fn) => {
    let b = typeof fn[1] === 'string' && fn[1][0] === '$' ? 2 : 1
    while (b < fn.length && Array.isArray(fn[b]) && START_HEAD.has(fn[b][0])) b++
    return b >= fn.length
  }
  const deadStarts = new Set()
  for (const st of starts) {
    const e = deref(funcs, 'func', st[1])
    if (e && !e.isImport && emptyBody(e.node)) deadStarts.add(st)
    else markFunc(st[1])
  }
  const elemTarget = new Map() // active elem node → target table entry (write-only edge, not liveness)
  const elemKind = new Map()   // elem node → 'active' | 'passive' | 'declare'
  for (const elem of elems) {
    // (elem declare? (table t)? offset-expr? reftype? item*) — items are bare
    // $names/numerals or (item …)/(ref.func …) exprs; offsets may read globals.
    let target, active = false
    if (elem.includes('declare')) elemKind.set(elem, 'declare')
    for (const part of elem.slice(1)) {
      if (Array.isArray(part)) {
        // the TARGET ref is a write edge — it caps the index space (deref) but does
        // not make the table live; only reads (code/exports) do
        if (part[0] === 'table') target = deref(tables, 'table', part[1])
        else {
          if (part[0] === 'offset' || (part[0] !== 'item' && typeof part[0] === 'string' && !part[0].startsWith('ref'))) active = true
          walk(part, n => {
            if (Array.isArray(n) && n[0] === 'ref.func') markFunc(n[1])
            else if (Array.isArray(n) && n[0] === 'global.get') markGlobal(n[1])
            else if (typeof n === 'string' && n[0] === '$') markFunc(n)
          })
        }
      }
      else if (typeof part === 'string' && part !== 'func' && part !== 'declare' && (part[0] === '$' || !isNaN(part))) markFunc(part)
    }
    if (active) elemTarget.set(elem, target ?? tables.get(0))
    if (!elemKind.has(elem)) elemKind.set(elem, active ? 'active' : 'passive')
  }
  for (const d of data) {
    const first = d[1]
    if (Array.isArray(first) && first[0] === 'memory') markMemory(first[1])
    else if (typeof first === 'string' && first[0] === '$') markMemory(first)
    else if (Array.isArray(first)) markMemory(0)
    walk(d, n => { if (Array.isArray(n) && n[0] === 'global.get') markGlobal(n[1]) })
  }
  for (const m of [funcs, globals, tables, memories]) for (const e of m.values()) if (e.used) enqueue(e)

  // Drain worklist: each live node (func body, global/table init, type def) is
  // walked exactly once. IMM (the instruction registry's immediate types) says
  // which index space an op's first immediate addresses — one source of truth
  // for call/ref.func/global.get/struct.new/call_ref/…, named or numeric.
  let elemIdxUsed = false // table.init/elem.drop consume element indices — forbids elem removal
  let flatForm = false     // bare instruction tokens in bodies — operands unattributable
  const refFunced = new Set() // funcs referenced by ref.func in live code — they must STAY declared
  while (work.length) {
    const entry = work.pop()
    if (entry.scanned) continue
    entry.scanned = true
    if (entry.isImport) continue
    walk(entry.node, (n, parent, idx) => {
      if (Array.isArray(n)) {
        const op = n[0]
        if (op === 'table.init' || op === 'elem.drop' || op === 'array.new_elem' || op === 'array.init_elem') elemIdxUsed = true
        else if (op === 'ref.func') refFunced.add(deref(funcs, 'func', n[1]))
      }
      // a bare token OUTSIDE op position is flat-form usage whose operands we can't
      // attribute — freeze segment removal and index renumbering
      else if (typeof n === 'string' && idx !== 0 && OPCODE[n] !== undefined) {
        flatForm = true
        if (n === 'table.init' || n === 'elem.drop' || n === 'array.new_elem' || n === 'array.init_elem' || n === 'ref.func') elemIdxUsed = true
      }
      if (!Array.isArray(n)) {
        // Bare $name (flat-form immediate, label, any position): the flat style
        // gives no structure to say which space it addresses — mark them all.
        // A named global.set target is exempt: a write alone doesn't keep a
        // global alive (its decl + sets are dropped together below).
        if (typeof n === 'string' && n[0] === '$' && !(parent?.[0] === 'global.set' && idx === 1))
          markFunc(n), markGlobal(n), markTable(n), markMemory(n), markType(n)
        return
      }
      const [op, ref] = n
      if (op === 'type') return markType(ref)
      if (op === 'call_indirect' || op === 'return_call_indirect') {
        for (const sub of n) if (typeof sub === 'string' && sub[0] === '$') return markTable(sub)
        return markTable(0) // implicit table 0
      }
      if (op === 'global.set') { if (!(typeof ref === 'string' && ref[0] === '$')) markGlobal(ref); return }
      const imm = typeof op === 'string' ? IMM[op] : null
      if (imm) {
        if (imm.startsWith('funcidx')) markFunc(ref)
        else if (imm.startsWith('globalidx')) markGlobal(ref)
        else if (imm.startsWith('typeidx')) markType(ref)
        else if (imm.startsWith('tableidx')) markTable(ref)
      }
      if (typeof op === 'string' && (op.startsWith('memory.') || op.includes('.load') || op.includes('.store'))) {
        markMemory(0)
      }
    })
  }

  // Removal gate. func/global/table indices are RENUMBERED after filtering, so their
  // numeric refs don't gate removal — unless bodies use flat tokens (operands
  // unattributable) or inline imports skew declaration order vs binary order. Types
  // keep the cap: type refs embed in type definitions, ref annotations and field
  // types, far beyond what the renumberer rewrites.
  const renumberable = (space) => (space === 'func' || space === 'global' || space === 'table') && !flatForm && !inlineImport[space]
  const cap = (space) => inlineImport[space] && numRef[space] >= 0 ? Infinity : numRef[space]
  const droppable = (sub, space) => {
    const e = nodeMap.get(sub)
    return e && !e.used && (renumberable(space) || e.idx > cap(space))
  }

  // Dead tables: never read by code or exports — their active elem segments only fill
  // unobservable slots, so table + segments go together (funcs those segments pinned
  // are re-judged next round). Element-index consumers forbid segment removal.
  const dropNodes = new Set()
  if (!elemIdxUsed) {
    for (const e of new Set(tables.values())) {
      if (e.used || e.isImport || e.idx <= cap('table')) continue
      dropNodes.add(e.node)
      for (const [elem, t] of elemTarget) if (t === e) dropNodes.add(elem)
    }
    // With no element-index consumers, a passive segment is unreachable outright and a
    // declare segment carries no runtime data — BUT both also serve as the declaration
    // that validates in-code ref.func. Droppable only when every ref.func'd function in
    // the segment stays anchored elsewhere (export or surviving active segment).
    const elemFuncs = (elem) => {
      const out = []
      walk(elem, n => { const e = typeof n === 'string' && n !== 'declare' && n !== 'func' && (n[0] === '$' || !isNaN(n)) ? deref(funcs, 'func', n) : Array.isArray(n) && n[0] === 'ref.func' ? deref(funcs, 'func', n[1]) : null; if (e) out.push(e) })
      return out
    }
    const anchored = new Set()
    for (const [elem, kind] of elemKind) if (kind === 'active' && !dropNodes.has(elem)) for (const e of elemFuncs(elem)) anchored.add(e)
    for (const exp of exports) for (const sub of exp) if (Array.isArray(sub) && sub[0] === 'func') { const e = deref(funcs, 'func', sub[1]); if (e) anchored.add(e) }
    for (const [elem, kind] of elemKind) {
      if (kind !== 'passive' && kind !== 'declare') continue
      if (elemFuncs(elem).every(e => !refFunced.has(e) || anchored.has(e))) dropNodes.add(elem)
    }
  }

  // Filter: keep used definitions. nodeMap handles unnamed entries directly.
  const result = ['module']
  const deadGlobals = new Set() // named write-only globals whose decl is dropped
  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) { result.push(node); continue }
    if (dropNodes.has(node) || deadStarts.has(node)) continue
    const kind = node[0]
    if (kind === 'func' || kind === 'global' || kind === 'type') {
      if (!droppable(node, kind)) result.push(node)
      else if (kind === 'global' && typeof node[1] === 'string' && node[1][0] === '$') deadGlobals.add(node[1])
    } else if (kind === 'import') {
      // Keep import unless every tracked sub-item is droppable (untracked kinds — tag — stay).
      const subs = node.filter(sub => Array.isArray(sub) && nodeMap.has(sub))
      if (!subs.length || subs.some(sub => !droppable(sub, sub[0]))) result.push(node)
    } else {
      result.push(node)
    }
  }
  // Neuter writes to dropped write-only globals: (global.set $dead V) → (drop V)
  // (vacuum erases the drop when V is pure).
  if (deadGlobals.size) walkPost(result, n => {
    if (Array.isArray(n) && n[0] === 'global.set' && deadGlobals.has(n[1])) return ['drop', n[2]]
  })

  // Renumber surviving bare-numeric refs for the shifted spaces. New indices come
  // from the RESULT's declaration order (imports interleave in watr's index model);
  // named refs re-resolve on their own.
  const remap = { func: new Map(), global: new Map(), table: new Map() }
  const counters = { func: 0, global: 0, table: 0 }
  const note = (node, space) => { const e = nodeMap.get(node); e ? remap[space].set(e.idx, counters[space]++) : counters[space]++ }
  for (const node of result.slice(1)) {
    if (!Array.isArray(node)) continue
    const k = node[0]
    if (k === 'func' || k === 'global' || k === 'table') note(node, k)
    else if (k === 'import') for (const sub of node)
      if (Array.isArray(sub) && (sub[0] === 'func' || sub[0] === 'global' || sub[0] === 'table')) note(sub, sub[0])
  }
  const shifted = (space) => renumberable(space) && [...remap[space]].some(([o, n]) => o !== n)
  if (shifted('func') || shifted('global') || shifted('table')) {
    const isNum = (r) => typeof r === 'number' || (typeof r === 'string' && r !== '' && r[0] !== '$' && !isNaN(r))
    const renum = (space, ref) => {
      if (!renumberable(space) || !isNum(ref)) return ref
      const n = remap[space].get(+ref)
      return n === undefined ? ref : typeof ref === 'number' ? n : String(n)
    }
    walkPost(result, n => {
      if (!Array.isArray(n)) return
      const op = n[0]
      if (op === 'start' || op === 'ref.func' || op === 'call' || op === 'return_call') n[1] = renum('func', n[1])
      else if (op === 'global.get' || op === 'global.set') n[1] = renum('global', n[1])
      else if (op === 'export' && Array.isArray(n[2]) && remap[n[2][0]]) n[2][1] = renum(n[2][0], n[2][1])
      else if (op === 'elem') for (let i = 1; i < n.length; i++) {
        const part = n[i]
        if (Array.isArray(part) && part[0] === 'table') part[1] = renum('table', part[1])
        else if (typeof part === 'string' && part !== 'func' && part !== 'declare' && isNum(part)) n[i] = renum('func', part)
      }
      else if (op === 'call_indirect' || op === 'return_call_indirect') { if (isNum(n[1])) n[1] = renum('table', n[1]) }
      else if (op === 'table.init') { if (n.length > 2) n[1] = renum('table', n[1]) }
      else if (typeof op === 'string' && IMM[op] && IMM[op].startsWith('tableidx')) {
        n[1] = renum('table', n[1])
        if (IMM[op] === 'tableidx_tableidx') n[2] = renum('table', n[2])
      }
    })
  }
  return result
}

// ==================== CONSTANT FOLDING ====================

/** IEEE 754 roundTiesToEven (bankers' rounding) */
const roundEven = (x) => x - Math.floor(x) !== 0.5 ? Math.round(x) : 2 * Math.round(x / 2)

// Bit-exact reinterpret helpers (preserve NaN payloads).
//
// SELF-HOST CONTRACT: this file runs inside the jz kernel, whose BigInt is a
// raw mod-2^64 i64 carrier — BigInt64Array views are a legacy f64-value shim
// (reads return the FLOAT, not the bits), decimal stringification of >2^53
// values and asIntN/asUintN are unfaithful, and adding 2^64 wraps to +0.
// Everything here therefore sticks to the verified-faithful surface:
// Uint32Array aliasing, hex toString(16)/parseInt(,16)/padStart, BigInt('0x…')
// construction, BigInt ===/< comparison, and string arithmetic for two's
// complement. The signed canonicalization `v > MAX_I64 → v − 2^64` is exact
// natively AND a no-op in-kernel (2^64 ≡ 0 there) — correct in both worlds.
const _rb8 = new ArrayBuffer(8)
const _rf64 = new Float64Array(_rb8)
const _ru32 = new Uint32Array(_rb8)   // LE halves: [0]=lo, [1]=hi
const _rb4 = new ArrayBuffer(4)
const _rf32 = new Float32Array(_rb4)
const _ri32 = new Int32Array(_rb4)
const _hex8 = (u) => (u >>> 0).toString(16).padStart(8, '0')
/** Two's complement of a 16-digit hex magnitude — pure string math. */
const _twosComp16 = (mag) => {
  let out = '', carry = 1
  for (let i = 15; i >= 0; i--) {
    const d = (15 - parseInt(mag[i], 16)) + carry
    out = (d & 15).toString(16) + out
    carry = d >> 4
  }
  return out
}
/** Bits of an i64 BigInt (any sign) as a 16-digit hex string. Takes BigInt,
 *  returns STRING — safe to call across kernel function boundaries (strings
 *  are tagged; raw BigInts lose their kind at returns/polymorphic slots). */
const _i64Hex16 = (v) => {
  const h = v.toString(16)
  return h[0] === '-' ? _twosComp16(h.slice(1).padStart(16, '0')) : h.padStart(16, '0')
}
// ============================== i64 VALUE CONTRACT ==========================
// Within this optimizer an i64 const VALUE is the canonical STRING
// '0x' + 16 lowercase hex digits (the raw bits). Strings survive every kernel
// boundary; a BigInt held in a polymorphic slot ({type,value}), an untyped
// param, or a return value is kind-erased in-kernel and every subsequent
// BigInt op on it misdispatches. BigInt math is constructed AND consumed
// inside single folder bodies only; folders return hex strings (or null).
const ZERO64 = '0x0000000000000000', ONE64 = '0x0000000000000001', NEG164 = '0xffffffffffffffff'
/** Canonicalize any i64.const node value (number | decimal/hex string | bigint).
 *  EVERY _i64Hex16 argument here is a freshly-constructed BigInt: passing the
 *  raw polymorphic `val` through would poison _i64Hex16's param kind for ALL
 *  callers in-kernel (param types are per-function — one kind-erased call site
 *  degrades v.toString(16) to dynamic dispatch on raw bits everywhere). */
const _i64Canon = (val) => {
  if (typeof val === 'string') {
    const s = val.replaceAll('_', '')
    if (s.length === 18 && s[1] === 'x') return '0x' + s.slice(2).toLowerCase()
    // BigInt() rejects signed-hex ('-0x1' / '+0x2'); split the sign off the magnitude.
    const neg = s[0] === '-', mag = (s[0] === '-' || s[0] === '+') ? s.slice(1) : s
    return '0x' + _i64Hex16(neg ? -BigInt(mag) : BigInt(mag))
  }
  // bigint stragglers (native-only defensive) route through String → fresh BigInt.
  if (typeof val === 'bigint') return '0x' + _i64Hex16(BigInt(String(val)))
  return '0x' + _i64Hex16(BigInt(Math.trunc(val) || 0))
}
/** Signed-order key: flip the sign bit, then equal-length hex compares
 *  lexicographically in signed order. Pure strings — kernel-safe. */
const _sb = (h) => (parseInt(h[2], 16) ^ 8).toString(16) + h.slice(3)
/** Hex-string i64 ops used by several folders — all pure string/number math. */
const _i64Lo = (h) => parseInt(h.slice(10), 16) | 0
const _i64HiU = (h) => parseInt(h.slice(2, 10), 16) >>> 0
/** Hex-encode an i64 fold result (BigInt, any sign/world — see folder note). */
const _i64Arith = (r) => r == null ? null : '0x' + _i64Hex16(r)
/** SIGNED i64 BigInt from canon hex — exact natively; the subtract arm is
 *  dead in-kernel, where BigInt('0x…') already arrives as the signed carrier. */
const _sgn = (h) => {
  let v = BigInt(h)
  if (v > 0x7fffffffffffffffn) v = v - 0x8000000000000000n - 0x8000000000000000n
  return v
}
const i64FromF64 = (x) => { _rf64[0] = x; return '0x' + _hex8(_ru32[1]) + _hex8(_ru32[0]) }
const f64FromI64 = (h) => {
  _ru32[1] = parseInt(h.slice(2, 10), 16)
  _ru32[0] = parseInt(h.slice(10), 16)
  return _rf64[0]
}
const i32FromF32 = (x) => { _rf32[0] = x; return _ri32[0] }
const f32FromI32 = (x) => { _ri32[0] = x | 0; return _rf32[0] }

/** Build i32 comparison folder: returns 1/0 */
const i32c = (fn) => (a, b) => fn(a, b) ? 1 : 0
/** Build unsigned i32 comparison folder */
const u32c = (fn) => (a, b) => fn(a >>> 0, b >>> 0) ? 1 : 0
/** Signed i64 comparison folder — biased-hex lexicographic (kernel-safe). */
const i64c = (fn) => (a, b) => fn(_sb(a), _sb(b)) ? 1 : 0
/** Unsigned i64 comparison folder — canonical hex compares lexicographically. */
const u64c = (fn) => (a, b) => fn(a, b) ? 1 : 0

/**
 * Constant folders, keyed by op. Each entry is the fold function; the result
 * value-type is derived once via `resultType` (see `fold`).
 */
const FOLDABLE = {
  // i32 arithmetic
  'i32.add': (a, b) => (a + b) | 0,
  'i32.sub': (a, b) => (a - b) | 0,
  'i32.mul': (a, b) => Math.imul(a, b),
  'i32.div_s': (a, b) => b !== 0 ? (a / b) | 0 : null,
  'i32.div_u': (a, b) => b !== 0 ? ((a >>> 0) / (b >>> 0)) | 0 : null,
  'i32.rem_s': (a, b) => b !== 0 ? (a % b) | 0 : null,
  'i32.rem_u': (a, b) => b !== 0 ? ((a >>> 0) % (b >>> 0)) | 0 : null,
  'i32.and': (a, b) => a & b,
  'i32.or':  (a, b) => a | b,
  'i32.xor': (a, b) => a ^ b,
  'i32.shl':   (a, b) => a << (b & 31),
  'i32.shr_s': (a, b) => a >> (b & 31),
  'i32.shr_u': (a, b) => a >>> (b & 31),
  'i32.rotl': (a, b) => { b &= 31; return ((a << b) | (a >>> (32 - b))) | 0 },
  'i32.rotr': (a, b) => { b &= 31; return ((a >>> b) | (a << (32 - b))) | 0 },
  'i32.eq':   i32c((a, b) => a === b),
  'i32.ne':   i32c((a, b) => a !== b),
  'i32.lt_s': i32c((a, b) => a < b),
  'i32.lt_u': u32c((a, b) => a < b),
  'i32.gt_s': i32c((a, b) => a > b),
  'i32.gt_u': u32c((a, b) => a > b),
  'i32.le_s': i32c((a, b) => a <= b),
  'i32.le_u': u32c((a, b) => a <= b),
  'i32.ge_s': i32c((a, b) => a >= b),
  'i32.ge_u': u32c((a, b) => a >= b),
  'i32.eqz':   (a) => a === 0 ? 1 : 0,
  'i32.clz':   (a) => Math.clz32(a),
  'i32.ctz':   (a) => a === 0 ? 32 : 31 - Math.clz32(a & -a),
  'i32.popcnt': (a) => { let c = 0; while (a) { c += a & 1; a >>>= 1 } return c },
  'i32.wrap_i64':   (a) => _i64Lo(a),
  'i32.extend8_s':  (a) => (a << 24) >> 24,
  'i32.extend16_s': (a) => (a << 16) >> 16,

  // i64 — hex-string in, hex-string out, BOTH-WORLDS-EXACT arithmetic.
  // BigInts construct locally (in-expression — kernel kind erasure never
  // applies), but two further kernel facts shape every folder:
  //   (1) the kernel's BigInt is the mod-2^64 i64 CARRIER: BigInt('0xffff…')
  //       arrives NEGATIVE there, so sign-sensitive ops (>>, /, %, unsigned
  //       division) diverge unless the value is sign-canonicalized first;
  //   (2) BigInt.asIntN/asUintN are unfaithful in-kernel — never used.
  // Ring ops {+,−,×,&,|,^,<<} are mod-2^64-compatible: compute then mask with
  // `& 0xffffffffffffffffn` (native: the wrap; kernel: AND with −1 ≡ no-op).
  // `_sgn` yields the SIGNED value in both worlds (the subtract arm is dead
  // in-kernel — same dead-arm trick as slebSize). shr_u is pure u32-half
  // number math. div_u/rem_u fold only below 2^63 (signed==unsigned there);
  // above, they skip — sound degradation, never a wrong constant.
  'i64.add': (a, b) => _i64Arith((BigInt(a) + BigInt(b)) & 0xffffffffffffffffn),
  'i64.sub': (a, b) => _i64Arith((BigInt(a) - BigInt(b)) & 0xffffffffffffffffn),
  'i64.mul': (a, b) => _i64Arith((BigInt(a) * BigInt(b)) & 0xffffffffffffffffn),
  'i64.div_s': (a, b) => b !== ZERO64 && !(a === '0x8000000000000000' && b === NEG164)
    ? _i64Arith((_sgn(a) / _sgn(b)) & 0xffffffffffffffffn) : null,
  'i64.div_u': (a, b) => b !== ZERO64 && !(_i64HiU(a) >>> 31) && !(_i64HiU(b) >>> 31)
    ? _i64Arith(BigInt(a) / BigInt(b)) : null,
  'i64.rem_s': (a, b) => b !== ZERO64
    ? _i64Arith((_sgn(a) % _sgn(b)) & 0xffffffffffffffffn) : null,
  'i64.rem_u': (a, b) => b !== ZERO64 && !(_i64HiU(a) >>> 31) && !(_i64HiU(b) >>> 31)
    ? _i64Arith(BigInt(a) % BigInt(b)) : null,
  'i64.and': (a, b) => _i64Arith(BigInt(a) & BigInt(b) & 0xffffffffffffffffn),
  'i64.or':  (a, b) => _i64Arith((BigInt(a) | BigInt(b)) & 0xffffffffffffffffn),
  'i64.xor': (a, b) => _i64Arith((BigInt(a) ^ BigInt(b)) & 0xffffffffffffffffn),
  'i64.shl':   (a, b) => _i64Arith((BigInt(a) << (BigInt(b) & 63n)) & 0xffffffffffffffffn),
  'i64.shr_s': (a, b) => _i64Arith((_sgn(a) >> (BigInt(b) & 63n)) & 0xffffffffffffffffn),
  'i64.shr_u': (a, b) => {
    const s = parseInt(b.slice(10), 16) & 63
    const hi = _i64HiU(a), lo = parseInt(a.slice(10), 16) >>> 0
    const rh = s >= 32 ? 0 : hi >>> s
    const rl = s === 0 ? lo : s >= 32 ? hi >>> (s - 32) : ((lo >>> s) | (hi << (32 - s))) >>> 0
    return '0x' + _hex8(rh) + _hex8(rl)
  },
  'i64.eq':   (a, b) => a === b ? 1 : 0,
  'i64.ne':   (a, b) => a !== b ? 1 : 0,
  'i64.lt_s': i64c((a, b) => a < b),
  'i64.lt_u': u64c((a, b) => a < b),
  'i64.gt_s': i64c((a, b) => a > b),
  'i64.gt_u': u64c((a, b) => a > b),
  'i64.le_s': i64c((a, b) => a <= b),
  'i64.le_u': u64c((a, b) => a <= b),
  'i64.ge_s': i64c((a, b) => a >= b),
  'i64.ge_u': u64c((a, b) => a >= b),
  'i64.eqz': (a) => a === ZERO64 ? 1 : 0,
  'i64.extend_i32_s': (a) => '0x' + _hex8(a >> 31) + _hex8(a),
  'i64.extend_i32_u': (a) => '0x00000000' + _hex8(a),
  'i64.extend8_s':  (a) => { const v = (_i64Lo(a) << 24) >> 24; return '0x' + _hex8(v >> 31) + _hex8(v) },
  'i64.extend16_s': (a) => { const v = (_i64Lo(a) << 16) >> 16; return '0x' + _hex8(v >> 31) + _hex8(v) },
  'i64.extend32_s': (a) => { const v = _i64Lo(a); return '0x' + _hex8(v >> 31) + _hex8(v) },

  // f32/f64 (NaN/precision-aware via Math.fround)
  'f32.add': (a, b) => Math.fround(a + b),
  'f32.sub': (a, b) => Math.fround(a - b),
  'f32.mul': (a, b) => Math.fround(a * b),
  'f32.div': (a, b) => Math.fround(a / b),
  'f32.neg':   (a) => Math.fround(-a),
  'f32.abs':   (a) => Math.fround(Math.abs(a)),
  'f32.sqrt':  (a) => Math.fround(Math.sqrt(a)),
  'f32.ceil':  (a) => Math.fround(Math.ceil(a)),
  'f32.floor': (a) => Math.fround(Math.floor(a)),
  'f32.trunc': (a) => Math.fround(Math.trunc(a)),
  'f32.nearest': (a) => Math.fround(roundEven(a)),

  'f64.add': (a, b) => a + b,
  'f64.sub': (a, b) => a - b,
  'f64.mul': (a, b) => a * b,
  'f64.div': (a, b) => a / b,
  'f64.neg':   (a) => -a,
  'f64.abs':   Math.abs,
  'f64.sqrt':  Math.sqrt,
  'f64.ceil':  Math.ceil,
  'f64.floor': Math.floor,
  'f64.trunc': Math.trunc,
  'f64.nearest': roundEven,

  // Bit-exact reinterprets (preserve NaN payloads)
  'i32.reinterpret_f32': i32FromF32,
  'f32.reinterpret_i32': f32FromI32,
  'i64.reinterpret_f64': i64FromF64,
  'f64.reinterpret_i64': f64FromI64,

  // Numeric conversions (value-preserving where representable)
  'f32.convert_i32_s': (a) => Math.fround(a | 0),
  'f32.convert_i32_u': (a) => Math.fround(a >>> 0),
  // (hi|0)·2^32 + lo is the exact signed value with ONE rounding at the add —
  // correct f64 conversion semantics, pure number math (kernel-safe).
  'f32.convert_i64_s': (a) => Math.fround((_i64HiU(a) | 0) * 4294967296 + parseInt(a.slice(10), 16)),
  'f32.convert_i64_u': (a) => Math.fround(_i64HiU(a) * 4294967296 + parseInt(a.slice(10), 16)),
  'f64.convert_i32_s': (a) => (a | 0),
  'f64.convert_i32_u': (a) => (a >>> 0),
  'f64.convert_i64_s': (a) => (_i64HiU(a) | 0) * 4294967296 + parseInt(a.slice(10), 16),
  'f64.convert_i64_u': (a) => _i64HiU(a) * 4294967296 + parseInt(a.slice(10), 16),
  'f32.demote_f64':    (a) => Math.fround(a),
  'f64.promote_f32':   (a) => Math.fround(a),
}

/**
 * Parse a WAT `nan` / `nan:canonical` / `nan:arithmetic` / `nan:0xPAYLOAD`
 * literal to a JS number with the exact bit pattern. `Number('nan:0x…')`
 * collapses to canonical NaN, destroying the payload that NaN-boxing schemes
 * (jz, etc.) encode their pointer/sentinel bits into. Returns null if `s` is
 * not a NaN literal so callers can fall through to plain Number parsing.
 */
/** Full 64-bit hex of a WAT f64 NaN literal — pure string/number math, the
 *  payload double is NEVER materialized. In the self-host kernel a NaN-box bit
 *  pattern held as a raw f64 VALUE is indistinguishable from a live pointer
 *  (String / property reads misread it), so reinterpret folding must move the
 *  bits as TEXT. Returns '0x…' (16 digits) or null when `s` isn't a NaN literal. */
const _nanBitsHex = (s) => {
  const i = s?.indexOf?.('nan')
  if (i < 0 || i == null) return null
  const tail = s.slice(i + 4).replaceAll('_', '')
  const payload = (s[i + 3] === ':' && tail !== 'canonical' && tail !== 'arithmetic' ? BigInt(tail) : 0x8000000000000n)
  const h = payload.toString(16).padStart(16, '0')
  const hi = (parseInt(h.slice(0, 8), 16) | 0x7ff00000 | (s[0] === '-' ? 0x80000000 : 0)) >>> 0
  return '0x' + _hex8(hi) + h.slice(8)
}

const _parseNanF64 = (s, i = s?.indexOf?.('nan')) => {
  if (i < 0 || i == null) return null
  const tail = s.slice(i + 4).replaceAll('_', '')
  const payload = (s[i + 3] === ':' && tail !== 'canonical' && tail !== 'arithmetic' ? BigInt(tail) : 0x8000000000000n)
  // Assemble exponent/sign on the u32 halves — kernel-safe (BigInt <</| are not).
  const h = payload.toString(16).padStart(16, '0')
  _ru32[1] = (parseInt(h.slice(0, 8), 16) | 0x7ff00000 | (s[0] === '-' ? 0x80000000 : 0)) >>> 0
  _ru32[0] = parseInt(h.slice(8), 16)
  return _rf64[0]
}
const _parseNanF32 = (s, i = s?.indexOf?.('nan')) => {
  if (i < 0 || i == null) return null
  let tail = s.slice(i + 4).replaceAll('_', ''),
      bits = (s[i + 3] === ':' && tail !== 'canonical' && tail !== 'arithmetic' ? parseInt(tail) : 0x400000)
  _ri32[0] = (bits | 0x7f800000 | (s[0] === '-' ? 0x80000000 : 0)) | 0
  return _rf32[0]
}

/**
 * Extract constant value from node.
 * @param {any} node
 * @returns {{type: string, value: number|bigint}|null}
 */
const getConst = (node) => {
  if (!Array.isArray(node) || node.length !== 2) return null
  const [op, val] = node
  if (op === 'i32.const') return { type: 'i32', value: (typeof val === 'string' ? parseInt(val.replaceAll('_', '')) : val) | 0 }
  if (op === 'i64.const') return { type: 'i64', value: _i64Canon(val) }
  if (op === 'f32.const') {
    const n = _parseNanF32(val)
    return { type: 'f32', value: n !== null ? n : Math.fround(Number(val)) }
  }
  if (op === 'f64.const') {
    const n = _parseNanF64(val)
    const v = n !== null ? n : Number(val)
    // Normalize ANY NaN to the literal NaN — Number.isNaN, NOT `v !== v`:
    // in-kernel `!==` routes through __eq's bit-equality, where a sign-set
    // qNaN (what x64 wasm arithmetic produces) compares EQUAL to itself (the
    // arm that keeps negative i64-carrier BigInts working), so the !== guard
    // misses it. Number.isNaN unboxes to f64 and uses f64.ne — catches every
    // payload. The literal-NaN assignment rewrites the carrier to the
    // canonical atom, so the value can ride kind-erased slots safely (the
    // linux-x64-only selfhost OOB; arm64 arithmetic NaNs are already
    // canonical). Native no-op.
    return { type: 'f64', value: Number.isNaN(v) ? NaN : v }
  }
  return null
}

/**
 * Create const node from value.
 * @param {string} type
 * @param {number|bigint} value
 * @returns {Array}
 */
const makeConst = (type, value) => {
  if (type === 'i32') return ['i32.const', value | 0]
  if (type === 'i64') return ['i64.const', typeof value === 'number' ? value : _i64Canon(value)]   // canonical hex: kernel-safe print, exact round-trip
  // NaN travels as the `nan` TOKEN, never a raw number: the canonical-NaN bit
  // pattern (0x7FF8…) IS the NaN-box ATOM prefix, so a raw NaN node value
  // inside the self-host kernel reads as a pointer and dereferences OOB
  // (same contract as emitNum — folding Math.sqrt(-1) used to trap the
  // kernel's L2 compile). ±Infinity is outside the box space — safe raw.
  if (type === 'f32') { const v = Math.fround(value); return ['f32.const', Number.isNaN(v) ? 'nan' : v] }
  if (type === 'f64') return ['f64.const', Number.isNaN(value) ? 'nan' : value]
  return null
}

/**
 * Fold constant expressions.
 * @param {Array} ast
 * @returns {Array}
 */
// NaN-payload reinterprets fold at the TEXT level — the payload double must never
// ride as a raw f64 value (see _nanBitsHex). Applies in both directions: nan:
// literal → i64 bits, and NaN-pattern i64 → nan: literal. These are MANDATORY
// (correctness, not size — the i64 sleb may out-size the f64 form), so the driver
// runs them once up front, keeping the rounds size-monotone for the guard.
const nanFoldNode = (node) => {
      if (!Array.isArray(node) || node.length !== 2) return
      if (node[0] === 'i64.reinterpret_f64') {
        const inner = node[1]
        if (Array.isArray(inner) && inner.length === 2 && inner[0] === 'f64.const' && typeof inner[1] === 'string') {
          const bits = _nanBitsHex(inner[1])
          if (bits) return ['i64.const', bits]
        }
      }
      if (node[0] === 'f64.reinterpret_i64') {
        const c = getConst(node[1])
        if (c && c.type === 'i64') {
          const h = c.value.slice(2)
          const hi = parseInt(h.slice(0, 8), 16) >>> 0
          const lo = parseInt(h.slice(8), 16) >>> 0
          const isNaN64 = (hi & 0x7ff00000) === 0x7ff00000 && ((hi & 0xfffff) !== 0 || lo !== 0)
          if (isNaN64) return ['f64.const',
            ((hi & 0x80000000) !== 0 ? '-' : '') + 'nan:0x' + (hi & 0xfffff).toString(16).padStart(5, '0') + h.slice(8)]
        }
      }
}

const foldNode = (node) => {
    if (!Array.isArray(node)) return
    const nan = nanFoldNode(node)
    if (nan) return nan
    const fn = FOLDABLE[node[0]]
    if (!fn) return
    // Arity comes from the NODE — every WAT op is fixed-arity, so node.length
    // fully determines unary vs binary (never Function.length: self-host closures
    // don't carry a faithful one).
    // Unary
    if (node.length === 2) {
      const a = getConst(node[1])
      if (!a) return
      const r = fn(a.value)
      if (r === null || r === undefined) return
      // Never inflate: a fixed-width f32/f64.const (5/9 B) or wide-sleb i64.const can
      // out-size the 1-byte op + small const it replaces — (f32.convert_i32_s
      // (i32.const 22)) is 4 B, (f32.const 22) is 5 B. The driver's mayInline fast
      // path (and standalone pass callers) rely on fold being monotonic.
      const out = makeConst(resultType(node[0]), r)
      if (constInstrSize(out) > 1 + constInstrSize(node[1])) return
      return out
    }
    // Binary
    if (node.length === 3) {
      const a = getConst(node[1]), b = getConst(node[2])
      if (!a || !b) return
      const r = fn(a.value, b.value)
      if (r === null || r === undefined) return
      // same monotonicity gate: e.g. (i64.shl (i64.const 1) (i64.const 63)) is 5 B,
      // its folded i64.const is 11 B
      const out = makeConst(resultType(node[0]), r)
      if (constInstrSize(out) > 1 + constInstrSize(node[1]) + constInstrSize(node[2])) return
      return out
    }
}
/** Constant folding as a standalone pass. */
const fold = (ast) => walkPost(ast, foldNode)

// ==================== IDENTITY REMOVAL ====================

/**
 * Create identity checker for commutative binary ops:
 *   neutral op x → x  and  x op neutral → x
 */
const commutativeIdentity = (neutral) => (a, b) => {
  const ca = getConst(a), cb = getConst(b)
  if (ca?.value === neutral) return b
  if (cb?.value === neutral) return a
  return null
}

/**
 * Create identity checker for right-neutral binary ops:
 *   x op neutral → x
 */
const rightIdentity = (neutral) => (a, b) => getConst(b)?.value === neutral ? a : null

/** Identity operations that can be simplified */
const IDENTITIES = {
  // x + 0 → x, 0 + x → x
  'i32.add': commutativeIdentity(0),
  'i64.add': commutativeIdentity(ZERO64),
  // x - 0 → x
  'i32.sub': rightIdentity(0),
  'i64.sub': rightIdentity(ZERO64),
  // x * 1 → x, 1 * x → x
  'i32.mul': commutativeIdentity(1),
  'i64.mul': commutativeIdentity(ONE64),
  // x / 1 → x
  'i32.div_s': rightIdentity(1),
  'i32.div_u': rightIdentity(1),
  'i64.div_s': rightIdentity(ONE64),
  'i64.div_u': rightIdentity(ONE64),
  // x & -1 → x, -1 & x → x (all bits set)
  'i32.and': commutativeIdentity(-1),
  'i64.and': commutativeIdentity(NEG164),
  // x | 0 → x, 0 | x → x
  'i32.or': commutativeIdentity(0),
  'i64.or': commutativeIdentity(ZERO64),
  // x ^ 0 → x, 0 ^ x → x
  'i32.xor': commutativeIdentity(0),
  'i64.xor': commutativeIdentity(ZERO64),
  // x << 0 → x, x >> 0 → x
  'i32.shl': rightIdentity(0),
  'i32.shr_s': rightIdentity(0),
  'i32.shr_u': rightIdentity(0),
  'i64.shl': rightIdentity(ZERO64),
  'i64.shr_s': rightIdentity(ZERO64),
  'i64.shr_u': rightIdentity(ZERO64),
  // f + 0 → x (careful with -0.0, skip for floats)
  // f * 1 → x (careful with NaN, skip for floats)
}

// Unary cast round-trips `outer(inner(x)) → x`. Each pair is bit-for-bit identity:
//   reinterpret∘reinterpret — a value bit-cast to the other repr and back is unchanged.
//   wrap_i64∘extend_i32_{s,u} — extend fills the high 32 bits, wrap drops them, low 32 = x.
// Generic wasm identities (Binaryen folds them); a NaN-box language leans on them heavily,
// since (un)boxing a pointer is exactly a wrap∘reinterpret∘reinterpret∘extend chain that
// collapses to nothing once these fire bottom-up.
const ROUNDTRIP = {
  'i64.reinterpret_f64': 'f64.reinterpret_i64',
  'f64.reinterpret_i64': 'i64.reinterpret_f64',
  'i32.reinterpret_f32': 'f32.reinterpret_i32',
  'f32.reinterpret_i32': 'i32.reinterpret_f32',
  'i32.wrap_i64': new Set(['i64.extend_i32_u', 'i64.extend_i32_s']),
}

/**
 * Remove identity operations.
 * @param {Array} ast
 * @returns {Array}
 */
const identityNode = (node) => {
    if (!Array.isArray(node)) return
    // Unary cast round-trip: outer(inner(x)) → x (post-order, so an inner pair already
    // collapsed before the outer op sees it — the whole box/unbox chain unwinds in one walk).
    if (node.length === 2 && Array.isArray(node[1]) && node[1].length === 2) {
      const inv = ROUNDTRIP[node[0]]
      if (inv && (typeof inv === 'string' ? node[1][0] === inv : inv.has(node[1][0]))) return node[1][1]
      return
    }
    if (node.length !== 3) return
    const fn = IDENTITIES[node[0]]
    if (!fn) return
    const result = fn(node[1], node[2])
    if (result === null) return  // no optimization, keep original
    return result
}
/** Identity elimination as a standalone pass. */
const identity = (ast) => walkPost(ast, identityNode)

// ==================== STRENGTH REDUCTION ====================

/**
 * Strength reduction: replace expensive ops with cheaper equivalents.
 * @param {Array} ast
 * @returns {Array}
 */
const strengthNode = (node) => {
    if (!Array.isArray(node) || node.length !== 3) return
    const [op, a, b] = node

    // x * 2^n → x << n
    if (op === 'i32.mul') {
      const cb = getConst(b)
      if (cb && cb.value > 0 && (cb.value & (cb.value - 1)) === 0) {
        const shift = Math.log2(cb.value)
        if (Number.isInteger(shift)) return ['i32.shl', a, ['i32.const', shift]]
      }
      const ca = getConst(a)
      if (ca && ca.value > 0 && (ca.value & (ca.value - 1)) === 0) {
        const shift = Math.log2(ca.value)
        if (Number.isInteger(shift)) return ['i32.shl', b, ['i32.const', shift]]
      }
    }
    if (op === 'i64.mul') {
      // hex value → LOCAL BigInt (in-expression construction is kernel-safe);
      // shift counts emit as plain numbers.
      const cb = getConst(b), vb = cb ? BigInt(cb.value) : null
      if (vb != null && vb > 0n && (vb & (vb - 1n)) === 0n)
        return ['i64.shl', a, ['i64.const', vb.toString(2).length - 1]]
      const ca = getConst(a), va = ca ? BigInt(ca.value) : null
      if (va != null && va > 0n && (va & (va - 1n)) === 0n)
        return ['i64.shl', b, ['i64.const', va.toString(2).length - 1]]
    }

    // x / 2^n → x >> n (unsigned only, signed division is more complex)
    if (op === 'i32.div_u') {
      const cb = getConst(b)
      if (cb && cb.value > 0 && (cb.value & (cb.value - 1)) === 0) {
        const shift = Math.log2(cb.value)
        if (Number.isInteger(shift)) return ['i32.shr_u', a, ['i32.const', shift]]
      }
    }
    if (op === 'i64.div_u') {
      const cb = getConst(b), vb = cb ? BigInt(cb.value) : null
      if (vb != null && vb > 0n && (vb & (vb - 1n)) === 0n)
        return ['i64.shr_u', a, ['i64.const', vb.toString(2).length - 1]]
    }

    // x % 2^n → x & (2^n - 1) (unsigned only)
    if (op === 'i32.rem_u') {
      const cb = getConst(b)
      if (cb && cb.value > 0 && (cb.value & (cb.value - 1)) === 0) {
        return ['i32.and', a, ['i32.const', cb.value - 1]]
      }
    }
    if (op === 'i64.rem_u') {
      const cb = getConst(b), vb = cb ? BigInt(cb.value) : null
      if (vb != null && vb > 0n && (vb & (vb - 1n)) === 0n)
        return ['i64.and', a, ['i64.const', '0x' + _i64Hex16(vb - 1n)]]
    }
}
/** Strength reduction as a standalone pass. */
const strength = (ast) => walkPost(ast, strengthNode)

// ==================== BRANCH SIMPLIFICATION ====================

/**
 * Simplify branches with constant conditions.
 * @param {Array} ast
 * @returns {Array}
 */
const branch = (ast) => {
  // if-arm value threading: (if C (then (local.set $x A)) (else (local.set $x B)))
  // → (local.set $x (if (result T) C (then A) (else B))) — the set happens on both
  // paths anyway, and the value-form if is one select-promotion away from collapsing.
  // Needs the local's declared type for the result annotation, hence the per-func walk.
  walk(ast, (fn) => {
    if (!Array.isArray(fn) || fn[0] !== 'func') return
    const ltype = new Map()
    for (const c of fn)
      if (Array.isArray(c) && (c[0] === 'local' || c[0] === 'param') && typeof c[1] === 'string' && typeof c[2] === 'string') ltype.set(c[1], c[2])
    if (!ltype.size) return
    walkPost(fn, (node) => {
      if (!Array.isArray(node) || node[0] !== 'if' || node.length !== 4) return
      const { cond, thenBranch, elseBranch } = parseIf(node)
      if (!Array.isArray(cond) || !(thenBranch?.length >= 2) || !(elseBranch?.length >= 2)) return
      const a = thenBranch[thenBranch.length - 1], b = elseBranch[elseBranch.length - 1]
      if (!Array.isArray(a) || a[0] !== 'local.set' || a.length !== 3 || !Array.isArray(a[2])) return
      if (!Array.isArray(b) || b[0] !== 'local.set' || b.length !== 3 || b[1] !== a[1] || !Array.isArray(b[2])) return
      const t = ltype.get(a[1])
      if (typeof t !== 'string' || !/^([if](32|64)|v128)$/.test(t)) return
      // an early exit inside an arm would skip the hoisted set — arms must be branch-free
      let jumps = false
      walk([thenBranch, elseBranch], n => {
        const o = Array.isArray(n) ? n[0] : n
        if (o === 'br' || o === 'br_if' || o === 'br_table' || o === 'return' || o === 'unreachable' ||
            o === 'throw' || o === 'return_call' || o === 'return_call_indirect' || o === 'try_table') jumps = true
      })
      if (jumps) return
      return ['local.set', a[1], ['if', ['result', t], cond,
        ['then', ...thenBranch.slice(1, -1), a[2]],
        ['else', ...elseBranch.slice(1, -1), b[2]]]]
    })
  })
  return walkPost(ast, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]

    // (if (i32.const 0) then else) → else
    // (if (i32.const N) then else) → then (N != 0)
    if (op === 'if') {
      const { condIdx, cond, thenBranch, elseBranch } = parseIf(node)
      const c = getConst(cond)
      // (if (result T) c (then A) (else B)) → (select A B c) for small pure numeric
      // arms — drops ~3 B of block framing per site. select evaluates BOTH arms, so
      // each must be pure AND trap-free (no int div/rem, no float→int trunc), and
      // cheap enough that speculating it costs nothing.
      if (!c) {
        if (!Array.isArray(cond)) return
        const rt = node.find(p => Array.isArray(p) && p[0] === 'result')
        if (!rt || rt.length !== 2 || !/^[if](32|64)$/.test(rt[1])) return
        if (thenBranch?.length !== 2 || elseBranch?.length !== 2) return
        const a = thenBranch[1], b = elseBranch[1]
        if (!isPure(a) || !isPure(b) || count(a) > 6 || count(b) > 6) return
        if (hasTrap(a) || hasTrap(b)) return
        return ['select', a, b, cond]
      }
      const taken = c.value !== 0 && c.value !== ZERO64 ? thenBranch : elseBranch
      if (taken && taken.length > 1) {
        const contents = taken.slice(1)
        // Preserve the if's block type (result/param). A typed `if` leaves a value
        // on the stack; collapsing it to the taken branch must keep that branch's
        // value in a same-typed block, else the contents land in a void context and
        // the value is left dangling → "expected 0 elements on the stack for fallthru".
        const blockType = node.slice(1, condIdx).filter(p => Array.isArray(p) && (p[0] === 'result' || p[0] === 'param'))
        if (blockType.length) return ['block', ...blockType, ...contents]
        return contents.length === 1 ? contents[0] : ['block', ...contents]
      }
      return ['nop']
    }

    // (br_if $label (i32.const 0)) → nop
    // (br_if $label (i32.const N)) → br $label (N != 0)
    if (op === 'br_if' && node.length >= 3) {
      const cond = node[node.length - 1]
      const c = getConst(cond)
      if (!c) return
      if (c.value === 0 || c.value === ZERO64) return ['nop']
      return ['br', node[1]]
    }

    // (select a b (i32.const 0)) → b
    // (select a b (i32.const N)) → a (N != 0)
    // `select` evaluates BOTH arms before choosing, so a side effect in the DISCARDED
    // arm (a `local.tee`/`local.set`, store, or call) must still happen — folding to the
    // kept arm would drop it (e.g. `p=0` compiled as the else arm of `cond?0:p`). Only
    // fold when the discarded arm is pure; otherwise leave the select for a later pass.
    if (op === 'select' && node.length >= 4) {
      const cond = node[node.length - 1]
      const c = getConst(cond)
      if (!c) return
      const zero = c.value === 0 || c.value === ZERO64
      const keep = zero ? node[2] : node[1], discard = zero ? node[1] : node[2]
      if (!isPure(discard)) return
      return keep
    }
  })
}

// ==================== GUARD-AWARE TAG REFINEMENT ====================

/**
 * Fold NaN-box tag reads under dominating tag guards (jz-domain knowledge).
 *
 * jz reads a value's 4-bit NaN-box tag in three equivalent forms:
 *   A. (i32.and (i32.wrap_i64 (i64.shr_u PTR (i64.const 47))) (i32.const 15))
 *   B. (i32.wrap_i64 (i64.and (i64.shr_u PTR (i64.const 47)) (i64.const 15)))
 *   C. (call $__ptr_type PTR)
 * where PTR is (i64.reinterpret_f64 (local.get $X)) or an i64 local copy of it.
 *
 * After `inlineOnce` splices a generic helper (e.g. $__len's 5-way tag
 * dispatch) into an arm already guarded by `tag(X) == K`, the recomputed tag
 * is a known constant — but no structural pass can see it: forms A and B
 * differ shape-wise, and the value flows through reinterpret/copy locals.
 * This pass tracks tag-of-X facts through if-arms and folds tag reads to
 * constants; the regular fold/branch/vacuum passes then delete the dead
 * dispatch arms. This is the single biggest source of wasm-opt's remaining
 * slack on jz output (~10% on typed-array modules).
 *
 * Soundness model — facts and aliases are keyed by the f64 SOURCE local $X
 * (tags live in the value's bits, so only local writes can invalidate, never
 * calls/stores):
 *   - any local.set/tee of $X kills its fact and every alias derived from it
 *   - leaving a block kills facts/aliases for locals written inside it
 *     (a br may have skipped the write)
 *   - entering a loop kills facts for locals written anywhere in it
 *     (the back edge re-enters after the write)
 *   - then/else facts are layered over a snapshot and restored on exit;
 *     writes inside either arm kill outer facts afterward
 *   - within straight-line code, sequential registration is exact: wasm has
 *     no goto, so execution between branch points is linear
 */
const guardRefine = (ast) => {
  if (Array.isArray(ast)) for (const node of ast) if (Array.isArray(node) && node[0] === 'func') refineGuards(node)
  return ast
}

const EMPTY_SET = new Set()

const refineGuards = (fn) => {
  const ptrAlias = new Map()  // i64 local → f64 source local (reinterpret copy)
  const tagAlias = new Map()  // i32 local → f64 source local (holds tag(X))
  const eqFact = new Map()    // f64 local → known tag K
  const neFact = new Map()    // f64 local → Set of excluded tags

  const intVal = (n) => {
    if (!Array.isArray(n) || n.length !== 2 || (n[0] !== 'i32.const' && n[0] !== 'i64.const')) return null
    const v = typeof n[1] === 'string' ? Number(n[1].replaceAll('_', '')) : Number(n[1])
    return Number.isFinite(v) ? v : null
  }
  const i32Val = (n) => Array.isArray(n) && n[0] === 'i32.const' ? intVal(n) : null

  // PTR node → f64 source local, or null.
  const ptrSrc = (n) => {
    if (!Array.isArray(n)) return null
    if (n[0] === 'i64.reinterpret_f64' && Array.isArray(n[1]) && n[1][0] === 'local.get' && typeof n[1][1] === 'string') return n[1][1]
    if (n[0] === 'local.get' && typeof n[1] === 'string') return ptrAlias.get(n[1]) ?? null
    return null
  }
  // tag-of-X node (forms A/B/C or a tag-alias local read) → X, or null.
  const tagSrc = (n) => {
    if (!Array.isArray(n)) return null
    const op = n[0]
    if (op === 'local.get' && typeof n[1] === 'string') return tagAlias.get(n[1]) ?? null
    if (op === 'call' && n[1] === '$__ptr_type' && n.length === 3) return ptrSrc(n[2])
    const shifted = (m) => Array.isArray(m) && m[0] === 'i64.shr_u' && intVal(m[2]) === 47 ? ptrSrc(m[1]) : null
    if (op === 'i32.and' && n.length === 3) {  // form A (mask either side)
      const [a, b] = i32Val(n[2]) === 15 ? [n[1], null] : i32Val(n[1]) === 15 ? [n[2], null] : [null, null]
      if (a && Array.isArray(a) && a[0] === 'i32.wrap_i64') return shifted(a[1])
    }
    if (op === 'i32.wrap_i64' && Array.isArray(n[1]) && n[1][0] === 'i64.and') {  // form B
      const m = n[1]
      if (intVal(m[2]) === 15) return shifted(m[1])
      if (intVal(m[1]) === 15) return shifted(m[2])
    }
    return null
  }

  const killLocal = (name) => {
    ptrAlias.delete(name); tagAlias.delete(name); eqFact.delete(name); neFact.delete(name)
    for (const [p, x] of ptrAlias) if (x === name) ptrAlias.delete(p)
    for (const [t, x] of tagAlias) if (x === name) tagAlias.delete(t)
  }
  // Write-sets are queried per if/loop/block; memoize bottom-up so each node is
  // visited once per function, not once per enclosing construct. Keyed by node
  // identity — sound because walkSeq only ever *replaces* whole subtrees
  // (parent[idx] = const), never adds writes to an existing one.
  const writesMemo = new Map()
  const writesOf = (n) => {
    if (!Array.isArray(n)) return EMPTY_SET
    let s = writesMemo.get(n)
    if (s) return s
    s = new Set()
    if ((n[0] === 'local.set' || n[0] === 'local.tee') && typeof n[1] === 'string') s.add(n[1])
    for (let i = 1; i < n.length; i++) for (const w of writesOf(n[i])) s.add(w)
    writesMemo.set(n, s)
    return s
  }
  const snap = () => [new Map(eqFact), new Map([...neFact].map(([k, s]) => [k, new Set(s)])), new Map(ptrAlias), new Map(tagAlias)]
  const reset = (m, src) => { m.clear(); for (const [k, v] of src) m.set(k, v) }
  const restore = ([e, n, p, t]) => { reset(eqFact, e); reset(neFact, n); reset(ptrAlias, p); reset(tagAlias, t) }

  // Facts implied by `cond` being truthy (sense=true) / falsy (sense=false).
  const condFacts = (cond, sense, out) => {
    if (!Array.isArray(cond)) return out
    const op = cond[0]
    if (op === 'i32.eqz') return condFacts(cond[1], !sense, out)
    if (op === 'i32.and' && sense && cond.length === 3) { condFacts(cond[1], true, out); condFacts(cond[2], true, out); return out }
    if (op === 'i32.or' && !sense && cond.length === 3) { condFacts(cond[1], false, out); condFacts(cond[2], false, out); return out }
    if ((op === 'i32.eq' || op === 'i32.ne') && cond.length === 3) {
      let x = tagSrc(cond[1]), k = i32Val(cond[2])
      if (x == null || k == null) { x = tagSrc(cond[2]); k = i32Val(cond[1]) }
      if (x != null && k != null) out.push({ x, k, eq: (op === 'i32.eq') === sense })
      return out
    }
    const x = tagSrc(cond)  // bare tag as condition: truthy ⇒ tag≠0, falsy ⇒ tag==0
    if (x != null) out.push({ x, k: 0, eq: !sense })
    return out
  }
  const addFacts = (fs) => {
    for (const { x, k, eq } of fs) {
      if (eq) eqFact.set(x, k)
      else { let s = neFact.get(x); if (!s) neFact.set(x, s = new Set()); s.add(k) }
    }
  }

  const walkSeq = (node, parent, idx) => {
    if (!Array.isArray(node)) return
    const op = node[0]

    if (op === 'local.set' || op === 'local.tee') {
      if (Array.isArray(node[2])) walkSeq(node[2], node, 2)
      const name = node[1]
      if (typeof name !== 'string') return
      killLocal(name)
      const v = node[2]
      if (Array.isArray(v)) {
        if (v[0] === 'i64.reinterpret_f64' && Array.isArray(v[1]) && v[1][0] === 'local.get' && typeof v[1][1] === 'string') ptrAlias.set(name, v[1][1])
        else if (v[0] === 'local.get' && typeof v[1] === 'string' && ptrAlias.has(v[1])) ptrAlias.set(name, ptrAlias.get(v[1]))
        else { const tx = tagSrc(v); if (tx != null) tagAlias.set(name, tx) }
      }
      return
    }

    if (op === 'if') {
      const { condIdx } = parseIf(node)
      if (Array.isArray(node[condIdx])) walkSeq(node[condIdx], node, condIdx)
      const cond = node[condIdx]  // re-read: the walk may have folded it
      const { thenBranch, elseBranch } = parseIf(node)
      const writes = writesOf(node)
      const pre = snap()
      addFacts(condFacts(cond, true, []))
      if (thenBranch) for (let i = 1; i < thenBranch.length; i++) walkSeq(thenBranch[i], thenBranch, i)
      restore(pre)
      addFacts(condFacts(cond, false, []))
      if (elseBranch) for (let i = 1; i < elseBranch.length; i++) walkSeq(elseBranch[i], elseBranch, i)
      restore(pre)
      for (const w of writes) killLocal(w)
      return
    }

    if (op === 'loop') {
      const writes = writesOf(node)
      for (const w of writes) killLocal(w)
      for (let i = 1; i < node.length; i++) walkSeq(node[i], node, i)
      for (const w of writes) killLocal(w)
      return
    }

    if (op === 'block') {
      for (let i = 1; i < node.length; i++) walkSeq(node[i], node, i)
      for (const w of writesOf(node)) killLocal(w)
      return
    }

    // Whole-node tag read under an equality fact → constant.
    const tx = tagSrc(node)
    if (tx != null && eqFact.has(tx) && parent) { parent[idx] = ['i32.const', eqFact.get(tx)]; return }

    // eq/ne against a constant under a ne-fact (eq-facts are covered by the
    // tag-read fold above plus the regular `fold` pass).
    if ((op === 'i32.eq' || op === 'i32.ne') && node.length === 3) {
      let x = tagSrc(node[1]), k = i32Val(node[2])
      if (x == null || k == null) { x = tagSrc(node[2]); k = i32Val(node[1]) }
      if (x != null && k != null && neFact.get(x)?.has(k) && parent) {
        parent[idx] = ['i32.const', op === 'i32.eq' ? 0 : 1]
        return
      }
    }

    for (let i = 1; i < node.length; i++) walkSeq(node[i], node, i)
  }

  for (let i = 1; i < fn.length; i++) walkSeq(fn[i], fn, i)
}

// ==================== DEAD CODE ELIMINATION ====================

/** Control flow terminators */
const TERMINATORS = new Set(['unreachable', 'return', 'br', 'br_table'])

/**
 * Remove dead code after control flow terminators.
 * @param {Array} ast
 * @returns {Array}
 */
const deadcode = (ast) => {
  // Process each function body
  walk(ast, (node) => {
    if (!Array.isArray(node)) return
    const kind = node[0]

    // Process blocks: func, block, loop, if branches
    if (kind === 'func' || kind === 'block' || kind === 'loop') {
      eliminateDeadInBlock(node)
    }
    if (kind === 'if') {
      // Process then/else branches
      for (let i = 1; i < node.length; i++) {
        if (Array.isArray(node[i]) && (node[i][0] === 'then' || node[i][0] === 'else')) {
          eliminateDeadInBlock(node[i])
        }
      }
    }
  })

  return ast
}

/**
 * Remove instructions after the first terminator within a block.
 *
 * Depth-aware of WAT's flat (unfolded) control style, which parse keeps as bare
 * sibling STRINGS: 'block'/'loop'/'if' open a sub-block whose matching bare 'end'
 * closes a live branch-landing label — a terminator inside it only ends that
 * sub-block's own tail, and anything after a bare 'end'/'else' is reachable again
 * (Duff's-device br_table dispatch relies on exactly this). So a cut only starts
 * at depth 0 and is cancelled by any later flat landing token.
 * Bare 'br'/'br_table' strings carry their immediates as following siblings, so
 * they never start a cut (their extent is unknowable here); folded arrays and the
 * immediate-less 'return'/'unreachable' do.
 * @param {Array} block
 */
const eliminateDeadInBlock = (block) => {
  let cut = -1, depth = 0
  for (let i = 1; i < block.length; i++) {
    const node = block[i], op = Array.isArray(node) ? node[0] : node
    if (typeof op !== 'string') continue
    // skip head annotations
    if (op === 'param' || op === 'result' || op === 'local' || op === 'type' || op === 'export') continue
    if (typeof node === 'string') {
      if (op === 'block' || op === 'loop' || op === 'if') { depth++; continue }
      if (op === 'end') { depth && depth--, cut = -1; continue }
      if (op === 'else') { cut = -1; continue }
    }
    if (depth || cut >= 0) continue
    if (TERMINATORS.has(op) && (Array.isArray(node) || op === 'return' || op === 'unreachable')) cut = i + 1
  }
  if (cut > 0 && cut < block.length) block.splice(cut)
}

// ==================== LOCAL REUSE ====================

/**
 * Reuse locals of the same type to reduce total local count.
 * Basic version: deduplicate unused locals.
 * @param {Array} ast
 * @returns {Array}
 */
const localReuse = (ast) => {
  walk(ast, (node) => {
    if (!Array.isArray(node) || node[0] !== 'func') return

    // Collect local declarations and their types
    const localDecls = []
    const localTypes = new Map() // $name → type
    const usedLocals = new Set()

    // Find all local declarations and usages
    for (let i = 1; i < node.length; i++) {
      const sub = node[i]
      if (!Array.isArray(sub)) continue

      if (sub[0] === 'local') {
        localDecls.push({ node: sub, idx: i })
        // (local $name type) or (local type)
        if (typeof sub[1] === 'string' && sub[1][0] === '$') {
          localTypes.set(sub[1], sub[2])
        }
      }
      if (sub[0] === 'param') {
        // Params are also locals
        if (typeof sub[1] === 'string' && sub[1][0] === '$') {
          localTypes.set(sub[1], sub[2])
          usedLocals.add(sub[1]) // params always used
        }
      }
    }

    // Find which locals are actually used
    let numericRef = false
    walk(node, (n) => {
      if (!Array.isArray(n)) return
      const op = n[0]
      if (op === 'local.get' || op === 'local.set' || op === 'local.tee') {
        const ref = n[1]
        if (typeof ref === 'string') { usedLocals.add(ref); if (ref[0] !== '$') numericRef = true }
        else if (typeof ref === 'number') { usedLocals.add(String(ref)); numericRef = true }
      }
    })

    // Remove unused named declarations — but any bare-numeric ref pins the whole
    // index layout (removal would shift every later slot), so only the trailing
    // prune below applies then.
    if (!numericRef) for (let i = localDecls.length - 1; i >= 0; i--) {
      const { idx, node: decl } = localDecls[i]
      const name = typeof decl[1] === 'string' && decl[1][0] === '$' ? decl[1] : null
      if (name && !usedLocals.has(name)) {
        node.splice(idx, 1)
      }
    }

    // Trailing UNNAMED slots prune from the end only — no later index can shift.
    let params = 0
    for (const sub of node) if (Array.isArray(sub) && sub[0] === 'param')
      params += typeof sub[1] === 'string' && sub[1][0] === '$' ? 1 : sub.length - 1
    const decls = []
    for (let i = 1; i < node.length; i++) if (Array.isArray(node[i]) && node[i][0] === 'local') decls.push(node[i])
    let slot = params
    const slotOf = new Map() // decl → first slot index
    for (const d of decls) {
      slotOf.set(d, slot)
      slot += typeof d[1] === 'string' && d[1][0] === '$' ? 1 : d.length - 1
    }
    for (let i = decls.length - 1; i >= 0; i--) {
      const d = decls[i]
      if (typeof d[1] === 'string' && d[1][0] === '$') {
        if (usedLocals.has(d[1]) || usedLocals.has(String(slotOf.get(d)))) break
        node.splice(node.indexOf(d), 1)
        continue
      }
      let len = d.length
      while (len > 1 && !usedLocals.has(String(slotOf.get(d) + len - 2))) len--
      if (len === d.length) break
      d.length = len
      if (len === 1) node.splice(node.indexOf(d), 1)
      else break
    }
  })

  return ast
}

// ==================== PROPAGATION & LOCAL ELIMINATION ====================

/** Operators with side effects: calls, mutators, control flow, exceptions, drops. */
const IMPURE_OPS = new Set([
  'call', 'call_indirect', 'return_call', 'return_call_indirect',
  'table.set', 'table.grow', 'table.fill', 'table.copy', 'table.init',
  'struct.set', 'struct.new',
  'array.set', 'array.new', 'array.new_fixed', 'array.new_data', 'array.new_elem',
  'array.init_data', 'array.init_elem', 'ref.i31',
  'global.set', 'local.set', 'local.tee',
  'unreachable', 'return',
  'br', 'br_if', 'br_table', 'br_on_null', 'br_on_non_null', 'br_on_cast', 'br_on_cast_fail',
  'throw', 'rethrow', 'throw_ref', 'try_table',
  'data.drop', 'elem.drop',
])

/** Substrings that flag an op as side-effecting (loads can trap, stores/atomics/memory ops mutate). */
const IMPURE_SUBSTRINGS = ['.store', 'memory.', '.atomic.']

/**
 * Pure means: no side effects, no traps we care about, no control flow.
 * Conservative — returns false for anything that might trap, mutate state, or branch.
 */
const isPure = (node) => {
  // A bare string can be a stack-style INSTRUCTION token ('return', 'drop', …), not
  // just an immediate — judge it by the same op tables as the folded form.
  if (typeof node === 'string') return !IMPURE_OPS.has(node) && !IMPURE_SUBSTRINGS.some(s => node.includes(s))
  if (!Array.isArray(node)) return true
  const op = node[0]
  if (typeof op !== 'string') return false
  if (IMPURE_OPS.has(op)) return false
  for (const sub of IMPURE_SUBSTRINGS) if (op.includes(sub)) return false
  for (let i = 1; i < node.length; i++) if (Array.isArray(node[i]) && !isPure(node[i])) return false
  return true
}

// Structured / control-flow forms: they do NOT evaluate all children eagerly
// (an `if` runs one arm; a `block`/`loop` scopes branches), so their side effects
// can't be flattened to the children's — they stay whole under a drop. (`br*`,
// `try_table` are already in IMPURE_OPS.)
const STRUCTURED_OPS = new Set(['if', 'then', 'else', 'block', 'loop', 'try'])

// `op` is an EAGER value operation: it evaluates every operand unconditionally
// and only computes a result (arithmetic, compare, convert, select, load) — so
// discarding its value leaves just the operands' side effects. Excludes impure
// ops and the structured forms above.
const isEagerValueOp = (op) => typeof op === 'string' && !IMPURE_OPS.has(op) &&
  !STRUCTURED_OPS.has(op) && !IMPURE_SUBSTRINGS.some(s => op.includes(s))

// Statements that preserve `node`'s side effects when its VALUE is discarded.
// A fully-pure value contributes nothing; an eager value op contributes only its
// operands' effects (the op result is dead); a `local.tee` keeps the store as a
// `local.set`; anything else (call, store-expr, structured form) stays under a drop.
// This turns `drop(i32.sub(tee X V, 1))` — the post-increment's dropped old value
// — into the bare `local.set X V`, eliminating dead arithmetic the plain
// `drop(PURE)→nop` rule can't (the tee makes the whole subtree impure).
const dropEffects = (node) => {
  if (!Array.isArray(node) || isPure(node)) return []
  const op = node[0]
  if (op === 'local.tee' && node.length === 3) return [['local.set', node[1], node[2]]]
  if (isEagerValueOp(op)) {
    const eff = []
    for (let i = 1; i < node.length; i++) eff.push(...dropEffects(node[i]))
    return eff
  }
  return [['drop', node]]
}

/** Count all local.get/set/tee occurrences in one walk */
const countLocalUses = (node) => {
  const counts = new Map()
  const ensure = name => { if (!counts.has(name)) counts.set(name, { gets: 0, sets: 0, tees: 0 }); return counts.get(name) }
  walk(node, n => {
    if (!Array.isArray(n) || n.length < 2 || typeof n[1] !== 'string') return
    if (n[0] === 'local.get') ensure(n[1]).gets++
    else if (n[0] === 'local.set') ensure(n[1]).sets++
    else if (n[0] === 'local.tee') ensure(n[1]).tees++
  })
  return counts
}

/** A constant whose inlined form (opcode + immediate) is no wider than the ~2 B
 *  `local.get` it would replace — so propagating it to every use is byte-neutral
 *  at worst, and still drops the `local.set` + the `local` decl. f32/f64 consts
 *  (5/9 B) lose on reuse, so only narrow i32/i64 literals qualify. */
const isTinyConst = (node) => {
  const c = getConst(node)
  if (!c) return false
  if (c.type === 'i32') { const v = c.value | 0; return v >= -64 && v <= 63 }
  if (c.type === 'i64') { const v = BigInt(c.value); return v <= 63n || v >= 0xffffffffffffffc0n }   // unsigned bits: [0,63] or two's-comp [−64,−1]
  return false
}

/** A pure local→local copy value `(local.get $src)`, with $src ≠ the local being set.
 *  Substituting it for a `(local.get $dst)` is byte-neutral (local.get for local.get),
 *  so — unlike a reused wide constant — it can never grow an instruction, and it turns
 *  the copy `$dst = $src` into a dead store the next pass drops. Self-copies are
 *  excluded: they're no-ops that would re-trigger `changed` every round. (Propagating a
 *  copy lengthens $src's live range, which can rarely cost coalesceLocals a slot — a
 *  few bytes — but net-shrinks across the corpus, e.g. −1.7 KB on the watr self-host.) */
const isLocalCopy = (val, dest) =>
  Array.isArray(val) && val[0] === 'local.get' && val.length === 2 &&
  typeof val[1] === 'string' && val[1] !== dest

/** Can this tracked value be substituted for a local.get?
 *  - single use of a pure value: always shrinks (drops the set, the lone get, the decl);
 *  - any use of a tiny constant: byte-neutral at worst, still drops the set + decl;
 *  - any use of a pure local copy: byte-neutral, frees the copy as a dead store.
 *  Anything else (a wide constant reused many times, an impure expr) could inflate
 *  or reorder side effects, so it's left alone. Copy validity (the source not being
 *  reassigned between copy and use) is enforced by the same purgeRefs/branch-clear
 *  machinery that guards every tracked value. */
const canSubst = (k) => (k.pure && k.singleUse) || isTinyConst(k.val) || k.copy

/** Drop tracked values that read `$name`: rewriting `$name` makes them stale. */
const purgeRefs = (known, name) => {
  for (const [key, tracked] of known) {
    let refs = false
    walk(tracked.val, n => { if (Array.isArray(n) && (n[0] === 'local.get' || n[0] === 'local.tee') && n[1] === name) refs = true })
    if (refs) known.delete(key)
  }
}

/** Drop tracked values that read global `$name`: a `global.set $name` makes them stale.
 *  The local-only {@link purgeRefs} misses this — so a value captured from a global
 *  (`let s = f`, where `f` is a reassignable module-level binding) would survive an
 *  intervening `f = …` and substitute the NEW global. That silently breaks the canonical
 *  pointer swap `let s = f; f = g; g = s` (g would read post-swap f, i.e. itself). */
const purgeGlobalRefs = (known, name) => {
  for (const [key, tracked] of known) {
    let refs = false
    walk(tracked.val, n => { if (Array.isArray(n) && n[0] === 'global.get' && n[1] === name) refs = true })
    if (refs) known.delete(key)
  }
}

/** True if `node` recursively contains an op that may read linear memory.
 *  Tracked values whose RHS reads memory go stale after any intervening
 *  memory-mutating op (`*.store`, `memory.copy/fill/init`, atomic stores/rmw). */
const readsMemory = (node) => {
  if (!Array.isArray(node)) return false
  const op = node[0]
  if (typeof op === 'string') {
    if (op.includes('.load') || op === 'memory.copy' || op === 'memory.size') return true
  }
  for (let i = 1; i < node.length; i++) if (readsMemory(node[i])) return true
  return false
}

/** True if `node` references state a `call` could mutate.
 *  Calls cannot touch caller locals (those live in the function frame), so
 *  pure expressions over locals + constants survive any intervening call; only
 *  memory loads, global reads, and table reads (or further calls) can be stale
 *  after one. */
const readsCallableState = (node) => {
  if (!Array.isArray(node)) return false
  const op = node[0]
  if (typeof op === 'string') {
    if (op === 'global.get' || op === 'table.get' || op === 'table.size') return true
    if (op === 'call' || op === 'call_indirect' || op === 'return_call' || op === 'return_call_indirect') return true
    if (op.includes('.load') || op === 'memory.copy' || op === 'memory.size') return true
  }
  for (let i = 1; i < node.length; i++) if (readsCallableState(node[i])) return true
  return false
}

/** True if `node` recursively contains an op that may write linear memory. */
const writesMemory = (node) => {
  if (!Array.isArray(node)) return false
  const op = node[0]
  if (typeof op === 'string') {
    if (op.endsWith('.store') || op === 'memory.copy' || op === 'memory.fill' || op === 'memory.init') return true
    // Atomic RMW / store / notify all mutate memory; `.atomic.load` doesn't.
    if (op.includes('.atomic.') && !op.endsWith('.load')) return true
  }
  for (let i = 1; i < node.length; i++) if (writesMemory(node[i])) return true
  return false
}

/** Try substitute local.get nodes with known values.
 *  When entering a nested scope (block/loop/if), drop tracking for any local
 *  that's re-assigned inside the subtree — the outer-tracked value is stale
 *  there. Without this, an outer `(local.set $x C)` would clobber an inner
 *  `(local.set $x V) (local.get $x)` (the inner get rewritten to `C` instead
 *  of `V`). Mostly latent until something — typically coalesceLocals — reuses
 *  one slot for the outer and inner roles, after which it surfaces as silent
 *  memory corruption. */
const substGets = (node, known) => {
  if (!Array.isArray(node)) return node
  const op = node[0]
  if (op === 'local.get' && node.length === 2) {
    const k = typeof node[1] === 'string' && known.get(node[1])
    if (k && canSubst(k)) return clone(k.val)
    return node
  }
  let inner = known
  if (isBranchScope(op)) {
    let cloned = null
    walk(node, n => {
      if (!Array.isArray(n)) return
      if ((n[0] === 'local.set' || n[0] === 'local.tee') && typeof n[1] === 'string' && known.has(n[1])) {
        if (!cloned) cloned = new Map(known)
        cloned.delete(n[1])
      }
    })
    if (cloned) inner = cloned
  }
  for (let i = 1; i < node.length; i++) {
    const r = substGets(node[i], inner)
    if (r !== node[i]) node[i] = r
    // WASM evaluates operands left-to-right. A `local.set`/`local.tee` in this
    // child updates the local before the next sibling reads it — drop tracked
    // entries that are now stale, else a pre-tee constant leaks into the next
    // sibling's `local.get` (visible after `coalesceLocals` aliases the tee'd
    // local with a sibling-read local, e.g. `alloc($x<<3, $x)` collapsing to
    // `alloc(BIG, SMALL)`).
    if (i + 1 < node.length && Array.isArray(node[i])) {
      walk(node[i], n => {
        if (!Array.isArray(n)) return
        if ((n[0] === 'local.set' || n[0] === 'local.tee') && typeof n[1] === 'string') {
          if (inner === known) inner = new Map(known)
          inner.delete(n[1])
          purgeRefs(inner, n[1])
        } else if (n[0] === 'global.set' && typeof n[1] === 'string') {   // same staleness as a local write — a sibling operand's
          if (inner === known) inner = new Map(known)                     // global write invalidates a later operand's global-sourced copy
          purgeGlobalRefs(inner, n[1])
        }
      })
    }
  }
  return node
}

/**
 * Forward propagation pass: track local.set values and substitute local.gets.
 * Returns true if any substitution was made.
 * @param {Array} funcNode
 * @param {Set<string>} params
 * @param {Map<string,{gets:number,sets:number,tees:number}>} useCounts
 */
const forwardPropagate = (funcNode, params, useCounts) => {
  let changed = false
  const getUseCount = name => useCounts.get(name) || { gets: 0, sets: 0, tees: 0 }
  const known = new Map()

  for (let i = 1; i < funcNode.length; i++) {
    const instr = funcNode[i]
    if (!Array.isArray(instr)) continue
    const op = instr[0]

    if (op === 'param' || op === 'result' || op === 'local' || op === 'type' || op === 'export') continue

    // Track local.set / local.tee values (tee writes too — its result also leaves
    // the value on the stack but the local is updated identically to set).
    if ((op === 'local.set' || op === 'local.tee') && instr.length === 3 && typeof instr[1] === 'string') {
      // substGets returns its argument unchanged unless the whole subtree
      // resolves to a substitution (bare `(local.get $x)` root case) — assign
      // back so the bare-RHS pattern actually propagates.
      const sr = substGets(instr[2], known)
      if (sr !== instr[2]) { instr[2] = sr; changed = true }
      // Nested `local.set`/`local.tee` inside the RHS already ran when the next
      // statement begins — drop tracked values that read those locals, else a
      // later `local.get` substitutes a stale expression (e.g. `$ptr`'s
      // `(local.get $ai0)` after a nested `(local.tee $ai0 …)` overwrites it).
      walk(instr[2], n => {
        if (!Array.isArray(n)) return
        if ((n[0] === 'local.set' || n[0] === 'local.tee') && typeof n[1] === 'string')
          { known.delete(n[1]); purgeRefs(known, n[1]) }
        else if (n[0] === 'global.set' && typeof n[1] === 'string') purgeGlobalRefs(known, n[1])
      })
      const uses = getUseCount(instr[1])
      purgeRefs(known, instr[1]) // entries that read this local just went stale
      // Any tracked value whose RHS reads memory must be invalidated by the
      // RHS itself if it writes memory (rare — only via nested store/copy/etc.,
      // which would also pass through the post-statement purge below).
      if (writesMemory(instr[2])) {
        for (const [key, tracked] of known) if (tracked.readsMem) known.delete(key)
      }
      known.set(instr[1], {
        val: instr[2], pure: isPure(instr[2]),
        readsMem: readsMemory(instr[2]),
        singleUse: uses.gets <= 1 && uses.sets <= 1 && uses.tees === 0,
        copy: isLocalCopy(instr[2], instr[1])
      })
      continue
    }

    // An if's TEST evaluates before the branch is entered — substitute into it
    // with the pre-branch knowledge before invalidating.
    if (op === 'if') {
      const { condIdx, cond } = parseIf(instr)
      if (Array.isArray(cond)) { const r = substGets(cond, known); if (r !== cond) instr[condIdx] = r, changed = true }
    }
    // Invalidate at control-flow boundaries
    if (isBranchScope(op)) known.clear()
    // Calls invalidate tracked values that read state a callee can mutate
    // (memory, globals, tables, nested calls). Pure expressions over locals
    // and constants survive — callees can't reach caller locals.
    if (op === 'call' || op === 'call_indirect' || op === 'return_call' || op === 'return_call_indirect')
      for (const [key, tracked] of known) if (readsCallableState(tracked.val)) known.delete(key)

    // Substitute: standalone local.get (walkPost can't replace root)
    if (op === 'local.get' && instr.length === 2 && typeof instr[1] === 'string') {
      const tracked = known.get(instr[1])
      if (tracked && canSubst(tracked)) {
        const replacement = clone(tracked.val)
        instr.length = 0; instr.push(...(Array.isArray(replacement) ? replacement : [replacement]))
        changed = true; continue
      }
    }

    // Substitute nested local.gets (skip control-flow nodes — locals may be reassigned inside)
    if (op !== 'block' && op !== 'loop' && op !== 'if') {
      const prev = clone(instr)
      substGets(instr, known)
      if (!equal(prev, instr)) changed = true
      // Invalidate tracking for any names written by a nested set/tee — those
      // writes happened mid-expression and the substGets above used the
      // pre-write tracked value (correct), but later reads must see the new
      // (untracked) value, not the stale constant.
      walk(instr, n => {
        if (!Array.isArray(n)) return
        if ((n[0] === 'local.set' || n[0] === 'local.tee') && typeof n[1] === 'string')
          { known.delete(n[1]); purgeRefs(known, n[1]) }
        else if (n[0] === 'global.set' && typeof n[1] === 'string') purgeGlobalRefs(known, n[1])
      })
      // Memory write in this statement (any nested store / memory.copy / etc.)
      // invalidates every tracked value whose RHS reads memory: inlining one
      // later would substitute a now-stale load. Without this, a swap idiom
      //   (local.set $t (f64.load $p)) (f64.store $p (f64.load $q)) (f64.store $q (local.get $t))
      // collapses to two stores that round-trip the same value:
      //   (f64.store $p (f64.load $q)) (f64.store $q (f64.load $p))   ;; bug
      if (writesMemory(instr)) {
        for (const [key, tracked] of known) if (tracked.readsMem) known.delete(key)
      }
    }
  }

  return changed
}

/**
 * A `(local.set $x V)` (pure V) immediately before a `loop` is dead when the write can
 * never be observed: (a) inside the loop, every path from the top reaches a write of $x
 * before any read — checked by an evaluation-order scan where if-arms fork (a read
 * counts against EITHER arm, a def only when BOTH arms guarantee it), nested loops and
 * try_table are opaque (reads fail, defs aren't credited), br/br_table/return end their
 * path, br_if falls through, and any br inside a block resets the def state after it —
 * and (b) $x is read NOWHERE outside that loop body, so the loop's exit-time value is
 * unobservable regardless of which exit path ran (the counterexample class: a zero-trip
 * inner loop leaking the previous outer iteration's value to a post-loop read).
 */
const deadThroughLoop = (funcNode, name, loop) => {
  let total = 0, inside = 0
  walk(funcNode, n => { if (Array.isArray(n) && n[0] === 'local.get' && n[1] === name) total++ })
  walk(loop, n => { if (Array.isArray(n) && n[0] === 'local.get' && n[1] === name) inside++ })
  if (total !== inside) return false // (b) — read outside the loop may observe it
  const readsAny = (n) => { let r = false; walk(n, c => { if (Array.isArray(c) && c[0] === 'local.get' && c[1] === name) r = true }); return r }
  const hasBr = (n) => { let r = false; walk(n, c => { const o = Array.isArray(c) ? c[0] : c; if (o === 'br' || o === 'br_if' || o === 'br_table') r = true }); return r }
  const scanList = (list, from, def) => {
    for (let i = from; i < list.length; i++) {
      const r = scanExpr(list[i], def)
      if (!r.ok) return r
      def = r.def
      if (r.end) return { ok: true, def, end: true }
    }
    return { ok: true, def }
  }
  const scanExpr = (n, def) => {
    if (!Array.isArray(n)) {
      if (typeof n === 'string' && OPCODE[n] !== undefined) return { ok: false } // flat token — order unattributable
      return { ok: true, def }
    }
    const op = n[0]
    if (op === 'param' || op === 'result' || op === 'type' || op === 'local' || op === 'export') return { ok: true, def }
    if (op === 'local.get') return n[1] === name && !def ? { ok: false } : { ok: true, def }
    if (op === 'local.set' || op === 'local.tee') {
      const r = n.length > 2 ? scanExpr(n[2], def) : { ok: true, def }
      if (!r.ok || r.end) return r
      return { ok: true, def: r.def || n[1] === name }
    }
    if (op === 'if') {
      const { condIdx, thenBranch, elseBranch } = parseIf(n)
      let d = def
      for (let k = 1; k <= condIdx && k < n.length; k++) {
        if (n[k] === thenBranch || n[k] === elseBranch) continue
        const r = scanExpr(n[k], d)
        if (!r.ok || r.end) return r
        d = r.def
      }
      const t = thenBranch ? scanList(thenBranch, 1, d) : { ok: true, def: d }
      if (!t.ok) return t
      const e = elseBranch ? scanList(elseBranch, 1, d) : { ok: true, def: d }
      if (!e.ok) return e
      return { ok: true, def: (t.end ? d : t.def) && (e.end ? d : e.def) }
    }
    if (op === 'loop' || op === 'try_table') return readsAny(n) ? { ok: false } : { ok: true, def }
    if (op === 'block') {
      const r = scanList(n, 1, def)
      if (!r.ok) return r
      // brs inside a block reconverge after it: a def already made before the block
      // survives; one made inside only counts when nothing could jump around it
      return { ok: true, def: def || (r.def && !hasBr(n)) }
    }
    if (op === 'br' || op === 'br_table' || op === 'return' || op === 'unreachable' || op === 'throw' ||
        op === 'return_call' || op === 'return_call_indirect') {
      let d = def
      for (let k = 1; k < n.length; k++) { const r = scanExpr(n[k], d); if (!r.ok) return r; d = r.def }
      return { ok: true, def: d, end: true }
    }
    let d = def
    for (let k = 1; k < n.length; k++) {
      const r = scanExpr(n[k], d)
      if (!r.ok || r.end) return r
      d = r.def
    }
    return { ok: true, def: d }
  }
  return scanList(loop, 1, false).ok
}

/**
 * Sink (local.set $x V) into the next statement when that statement's FIRST-evaluated
 * instruction is (local.get $x): sole-use pairs substitute V outright, multi-use ones
 * fuse into (local.tee $x V). Subsumes the old adjacent-only set/get-pair and tee
 * passes — the get may sit arbitrarily deep (call argument, store address, br_if
 * condition) as long as it is on the first-evaluated path, which keeps V's
 * evaluation order identical.
 * @param {Array} funcNode - straight-line scope (body / block / then / else)
 * @param {Set<string>} params
 * @param {Map<string,{gets:number,sets:number,tees:number}>} useCounts
 */
const sinkSets = (funcNode, params, useCounts) => {
  let changed = false

  for (let i = 1; i < funcNode.length - 1; i++) {
    const setNode = funcNode[i]
    // node[2] must be the folded value EXPRESSION — a bare string there is a
    // trailing stack-style instruction riding the same node, not a value
    if (!Array.isArray(setNode) || setNode[0] !== 'local.set' || setNode.length !== 3 || !Array.isArray(setNode[2])) continue
    const name = setNode[1]
    if (typeof name !== 'string') continue // params sink like locals: past this set the argument value is dead
    const val = setNode[2]
    // The landing site is the statement that first touches $name — a PURE value may
    // cross up to a few non-interfering statements to reach it (bounded lookahead:
    // the win class is near-adjacent; unbounded scans cost quadratic time for
    // nothing). Crossed statements must not write the value's inputs, and when the
    // value reads memory they must not write memory or call out.
    const vLocals = new Set(), vGlobals = new Set()
    walk(val, n => {
      if (!Array.isArray(n)) return
      if ((n[0] === 'local.get' || n[0] === 'local.tee') && typeof n[1] === 'string') vLocals.add(n[1])
      else if (n[0] === 'global.get' && typeof n[1] === 'string') vGlobals.add(n[1])
    })
    const vMem = readsMemory(val)
    const vPure = isPure(val)
    let hit = null, skipped = null
    for (let j = i + 1; j < funcNode.length && j <= i + 5; j++) {
      const stmt = funcNode[j]
      if (!Array.isArray(stmt)) break // flat token — order unattributable
      const h0 = stmt[0]
      if (h0 === 'param' || h0 === 'result' || h0 === 'local' || h0 === 'type' || h0 === 'export') continue
      let touches = false
      walk(stmt, n => { if (Array.isArray(n) && typeof n[1] === 'string' && n[1] === name &&
        (n[0] === 'local.get' || n[0] === 'local.set' || n[0] === 'local.tee')) touches = true })
      if (touches) {
        skipped = new Set()
        const state = { reads: false }
        hit = stmt[0] === 'local.get' && stmt[1] === name && stmt.length === 2
          ? [funcNode, j] : firstEvalGet(stmt, name, skipped, state)
        // crossed pure subtrees may read globals/memory — an effectful value must
        // not move past them
        if (hit && state.reads && !vPure) hit = null
        break
      }
      // only a PURE value crosses; interference blocks
      let bad = !vPure || (vMem && writesMemory(stmt))
      if (!bad) walk(stmt, (n, parent, idx) => {
        // op-position strings are the folded node's own mnemonic, not flat tokens
        if (!Array.isArray(n)) { if (idx !== 0 && typeof n === 'string' && OPCODE[n] !== undefined) bad = true; return }
        const o = n[0]
        if ((o === 'local.set' || o === 'local.tee') && vLocals.has(n[1])) bad = true
        else if (o === 'global.set' && vGlobals.has(n[1])) bad = true
        else if ((o === 'call' || o === 'call_indirect' || o === 'return_call' || o === 'return_call_indirect') && (vMem || vGlobals.size)) bad = true
        else if (isBranchScope(o) || o === 'br' || o === 'br_if' || o === 'br_table' || o === 'return' || o === 'unreachable' || o === 'throw') bad = true
      })
      if (bad) break
    }
    if (!hit) continue
    // the sunk value now evaluates AFTER the skipped leaves — it must not write them
    if (skipped.size) {
      let writes = false
      walk(setNode[2], n => { if (Array.isArray(n) && (n[0] === 'local.set' || n[0] === 'local.tee') && skipped.has(n[1])) writes = true })
      if (writes) continue
    }
    const uses = useCounts.get(name) || { gets: 0, sets: 0, tees: 0 }
    // Sole set+get pair → substitute the value outright (decl dies next sweep);
    // otherwise fuse into a tee at the get site. Either way the value's evaluation
    // point is unchanged — the get was the first instruction executed after the set.
    const single = uses.sets === 1 && uses.gets === 1 && uses.tees === 0
    hit[0][hit[1]] = single ? clone(setNode[2]) : ['local.tee', name, clone(setNode[2])]
    funcNode.splice(i, 1)
    changed = true
    i--
  }

  return changed
}

/**
 * Locate the (local.get $name) that is provably the FIRST instruction executed in
 * `stmt`, descending the first-evaluated path: at each level the first non-immediate
 * (array) child of a left-to-right op is what runs first. Annotation heads are
 * skipped; bodies that are entered conditionally or repeatedly (then/else arms,
 * loops, try_table) are opaque — descent stops there. → [parent, idx] or null.
 */
const firstEvalGet = (stmt, name, skipped, state) => {
  // Full evaluation-order scan: operands are visited left-to-right; the target get
  // may sit at any nesting level. A completed subtree may be CROSSED (the sunk value
  // then evaluates after it) only when it is pure and trap-free — its local reads are
  // recorded in `skipped` (the caller verifies the value doesn't write them) and any
  // global/memory read sets `state.reads` (the caller then requires a pure value).
  // Conditionally or repeatedly (re-)entered bodies stay opaque.
  let hit = null
  const scan = (cur) => {
    if (hit) return true
    if (!Array.isArray(cur)) return true
    const h = cur[0]
    if (h === 'loop' || h === 'then' || h === 'else' || h === 'try_table') return false
    for (let i = 1; i < cur.length; i++) {
      const c = cur[i]
      if (!Array.isArray(c)) continue // strings/numbers: immediates, labels, memargs
      const ch = c[0]
      if (ch === 'result' || ch === 'param' || ch === 'type' || ch === 'local' || ch === 'export') continue
      if (ch === 'local.get' && c.length === 2) {
        if (c[1] === name) { hit = [cur, i]; return true }
        skipped?.add(c[1])
        continue
      }
      if (isPure(c) && !hasTrap(c)) {
        let containsTarget = false
        walk(c, x => { if (Array.isArray(x) && x[0] === 'local.get' && x[1] === name) containsTarget = true })
        if (containsTarget) return scan(c) // the target lives here — descend, same rules
        // crossable — collect what it observes
        walk(c, x => {
          if (!Array.isArray(x)) return
          if (x[0] === 'local.get' && typeof x[1] === 'string') skipped?.add(x[1])
          else if (x[0] === 'global.get' || (typeof x[0] === 'string' && x[0].includes('.load'))) state && (state.reads = true)
        })
        continue
      }
      // first non-crossable child: the spine — descend; failure inside blocks the scan
      return scan(c)
    }
    return true
  }
  const ok = scan(stmt)
  return ok && hit ? hit : null
}

/**
 * Remove dead stores and unused local declarations in a reverse pass.
 * Returns true if anything was removed.
 * @param {Array} funcNode
 * @param {Set<string>} params
 * @param {Map<string,{gets:number,sets:number,tees:number}>} useCounts
 */
const eliminateDeadStores = (funcNode, params, useCounts) => {
  let changed = false
  const getPostUseCount = name => useCounts.get(name) || { gets: 0, sets: 0, tees: 0 }

  // Dead tee (statement-level or nested): written but never read back — the value on
  // the stack is all that matters, so unwrap it (the decl dies via the unused sweep).
  walkPost(funcNode, n => {
    if (Array.isArray(n) && n[0] === 'local.tee' && n.length === 3 &&
        typeof n[1] === 'string' && getPostUseCount(n[1]).gets === 0) {
      changed = true
      return n[2]
    }
  })

  for (let i = funcNode.length - 1; i >= 1; i--) {
    const sub = funcNode[i]
    if (!Array.isArray(sub)) continue
    const name = typeof sub[1] === 'string' ? sub[1] : null
    if (!name) continue
    const uses = getPostUseCount(name)
    // Dead store: set but never read.
    if (sub[0] === 'local.set' && uses.gets === 0 && uses.tees === 0) {
      // `(local.set $D (CMP (local.tee $L X) CONST))` with $D never read: the
      // comparison is non-trapping and its other operand a literal — only the
      // tee's store matters. Collapse to `(local.set $L X)`.
      if (sub.length === 3 && Array.isArray(sub[2]) && sub[2].length === 3 &&
          /\.(eq|ne|[lg][te](_[su])?)$/.test(sub[2][0])) {
        const [, a, b] = sub[2]
        const tee = Array.isArray(a) && a[0] === 'local.tee' ? a : Array.isArray(b) && b[0] === 'local.tee' ? b : null
        const other = tee === a ? b : a
        if (tee && tee.length === 3 && tee[1] !== name && Array.isArray(other) && other[0]?.endsWith?.('.const')) {
          funcNode[i] = ['local.set', tee[1], tee[2]]
          changed = true
          continue
        }
      }
      // `(local.set $x VALUE)` — drop the store with its value, but only when
      // VALUE is pure (its side effects would otherwise still need to run);
      // an impure but trap-free VALUE reduces to its side-effect core.
      if (sub.length === 3) {
        if (isPure(sub[2])) { funcNode.splice(i, 1); changed = true }
        else if (!hasTrap(sub[2])) { funcNode.splice(i, 1, ...dropEffects(sub[2])); changed = true }
      }
      // Bare `(local.set $x)` — the value is implicit on the stack (e.g. an
      // exception payload landing from a `try_table` catch). Demote to `drop`
      // so the dead store goes away without unbalancing the stack.
      else if (sub.length === 2) {
        funcNode[i] = ['drop']; changed = true
      }
    }
    // Unused local declaration
    else if (sub[0] === 'local' && name[0] === '$' && uses.gets === 0 && uses.sets === 0 && uses.tees === 0) {
      funcNode.splice(i, 1); changed = true
    }
  }

  return changed
}

/**
 * Drop `(local.set $x A)` when the very next statement re-sets $x without reading it
 * first (A pure). The two writes are adjacent, so A's value is overwritten before any
 * observation — it's dead. The whole-function {@link eliminateDeadStores} misses this:
 * it only fires when $x is read NOWHERE, whereas here $x is live later, just not
 * between these two writes. Pairs with copy-propagation, which rewrites
 * `$x=$y; $x=f($x)` to `$x=$y; $x=f($y)` — an adjacent dead store this removes,
 * collapsing the round-trip jz's value-model lowering leaves behind.
 * @param {Array} funcNode  a straight-line scope (body / block / loop / then / else)
 * @param {Set<string>} params
 */
const eliminateAdjacentDeadStores = (funcNode, params) => {
  let changed = false
  for (let i = 1; i < funcNode.length - 1; i++) {
    const a = funcNode[i], b = funcNode[i + 1]
    // `a` must be a plain set (a tee leaves its value on the stack — not removable);
    // `b` may be a set OR a tee (both overwrite the local before `a`'s value is read).
    if (!Array.isArray(a) || a[0] !== 'local.set' || a.length !== 3) continue
    if (!Array.isArray(b) || (b[0] !== 'local.set' && b[0] !== 'local.tee') || b.length !== 3 || b[1] !== a[1]) continue
    if (params.has(a[1]) || !isPure(a[2])) continue
    // Dead only if b's value doesn't read $x before overwriting it.
    let reads = false
    walk(b[2], n => { if (Array.isArray(n) && (n[0] === 'local.get' || n[0] === 'local.tee') && n[1] === a[1]) reads = true })
    if (reads) continue
    funcNode.splice(i, 1); changed = true; i--
  }
  return changed
}

// Conservative LOW estimate of a subtree's encoded bytes (under-estimating keeps the
// CSE profit gate honest: never fire on a loss).
const estBytes = (n) => {
  if (!Array.isArray(n)) return typeof n === 'number' ? 2 : 1
  let b = OPCODE[n[0]] > 0xffff ? 2 : 1
  for (let i = 1; i < n.length; i++) b += estBytes(n[i])
  return b
}

/**
 * Local common-subexpression elimination: identical pure subtrees repeated within a
 * straight-line scope compute once into a fresh local (first site tees, later sites
 * get). Grouping stops at every invalidation: a statement that writes a local the
 * expression reads, writes memory (for memory-reading exprs), or calls out (memory/
 * global-reading exprs). Candidates come only from the unconditional part of each
 * statement — nested control bodies are separate scopes with their own table.
 * Fires only when the byte win is provable: (n−1)·bytes(expr) > tee+gets+decl cost.
 * @param {Array} ast
 * @returns {Array}
 */
const cse = (ast) => {
  let uid = 0
  walk(ast, (fn) => {
    if (!Array.isArray(fn) || fn[0] !== 'func') return
    const scopes = []
    walkPost(fn, n => { if (isScopeNode(n)) scopes.push(n) })
    const decls = []
    for (const scope of scopes) {
      const live = new Map(), all = []
      for (let si = 1; si < scope.length; si++) {
        const stmt = scope[si]
        if (!Array.isArray(stmt)) { live.clear(); continue } // flat token — unknown order
        const h = stmt[0]
        if (h === 'param' || h === 'result' || h === 'local' || h === 'type' || h === 'export') continue
        // this statement's write effects
        const wLocals = new Set(), wGlobals = new Set()
        let wMem = writesMemory(stmt), call = false
        walk(stmt, n => {
          if (!Array.isArray(n)) return
          const o = n[0]
          if ((o === 'local.set' || o === 'local.tee') && typeof n[1] === 'string') wLocals.add(n[1])
          else if (o === 'global.set' && typeof n[1] === 'string') wGlobals.add(n[1])
          else if (o === 'call' || o === 'call_indirect' || o === 'return_call' || o === 'return_call_indirect') call = true
        })
        // candidates from the unconditional spine of the statement
        const collect = (n, parent, idx) => {
          if (!Array.isArray(n)) return
          const o = n[0]
          if (o === 'if' || o === 'block' || o === 'loop' || o === 'then' || o === 'else' || o === 'try_table') return
          if (typeof o === 'string' && resultType(o) && isPure(n)) {
            const est = estBytes(n)
            if (est >= 4) {
              const key = hashFunc(n, EMPTY_SET)
              let g = live.get(key)
              if (!g) {
                g = { expr: n, sites: [], est, type: resultType(o), reads: new Set(), mem: readsMemory(n), glob: false }
                walk(n, c => {
                  if (!Array.isArray(c)) return
                  if (c[0] === 'local.get' && typeof c[1] === 'string') g.reads.add(c[1])
                  else if (c[0] === 'global.get') g.glob = true
                })
                live.set(key, g); all.push(g)
              }
              g.sites.push([parent, idx])
              // repeats never yield sub-candidates: a group seeded inside a repeat
              // would tee into a subtree the outer conversion detaches
              if (g.sites.length > 1) return
            }
          }
          for (let i = 1; i < n.length; i++) collect(n[i], n, i)
        }
        collect(stmt, scope, si)
        // invalidate against this statement's writes
        for (const [k, g] of live) {
          if (g.mem && (wMem || call)) { live.delete(k); continue }
          if (g.glob && (call || wGlobals.size)) { live.delete(k); continue }
          for (const l of wLocals) if (g.reads.has(l)) { live.delete(k); break }
        }
      }
      for (const g of all) {
        const n = g.sites.length
        if (n < 2 || (n - 1) * (g.est - 2) <= 4) continue
        const name = '$cse' + uid++
        decls.push(['local', name, g.type])
        const [p0, i0] = g.sites[0]
        p0[i0] = ['local.tee', name, g.expr]
        for (let k = 1; k < n; k++) { const [p, i] = g.sites[k]; p[i] = ['local.get', name] }
      }
    }
    if (decls.length) {
      let at = typeof fn[1] === 'string' && fn[1][0] === '$' ? 2 : 1
      while (at < fn.length && Array.isArray(fn[at]) &&
        (fn[at][0] === 'export' || fn[at][0] === 'type' || fn[at][0] === 'param' || fn[at][0] === 'result' || fn[at][0] === 'local')) at++
      fn.splice(at, 0, ...decls)
    }
  })
  return ast
}

/**
 * Macro inlining: a function whose whole body is ONE small expression using each
 * param exactly once, in declaration order, expands at every call site by
 * substituting the arguments positionally — no wrapper, no locals, argument
 * evaluation order preserved verbatim (so impure args stay sound). The husk loses
 * its callers and treeshake collects it; the expansion feeds fold/offset/cse.
 * @param {Array} ast
 * @returns {Array}
 */
const inlineMacro = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast
  const macros = new Map()
  for (const n of ast.slice(1)) {
    if (!Array.isArray(n) || n[0] !== 'func' || typeof n[1] !== 'string' || n[1][0] !== '$') continue
    if (n.some(c => Array.isArray(c) && c[0] === 'export')) continue
    const params = [], body = []
    let results = 0, ok = true
    for (let i = 2; i < n.length && ok; i++) {
      const c = n[i]
      if (c === 'return' && i === n.length - 1) continue // trailing bare return is a no-op
      if (!Array.isArray(c)) ok = false
      else if (c[0] === 'param') (typeof c[1] === 'string' && c[1][0] === '$' && c.length === 3) ? params.push(c[1]) : ok = false
      else if (c[0] === 'result') results += c.length - 1
      else if (c[0] === 'local') ok = false
      else if (c[0] === 'type') continue
      else body.push(c)
    }
    if (!ok || body.length !== 1 || results !== 1) continue
    const expr = body[0]
    if (estBytes(expr) > 12) continue
    // params each read once, in order; no writes, control, or self-recursion inside
    const seq = []
    let bad = false
    walk(expr, c => {
      const o = Array.isArray(c) ? c[0] : c
      if (o === 'local.get') seq.push(c[1])
      else if (o === 'local.set' || o === 'local.tee' || o === 'return' || o === 'br' || o === 'br_if' ||
               o === 'br_table' || o === 'block' || o === 'loop' || o === 'if' || o === 'try_table' ||
               ((o === 'call' || o === 'return_call') && c[1] === n[1])) bad = true
    })
    if (bad || seq.length !== params.length || seq.some((x, i) => x !== params[i])) continue
    macros.set(n[1], { params, expr })
  }
  if (!macros.size) return ast
  walkPost(ast, n => {
    if (!Array.isArray(n) || n[0] !== 'call' || !macros.has(n[1])) return
    const m = macros.get(n[1])
    if (n.length - 2 !== m.params.length) return
    const idx = new Map(m.params.map((p, i) => [p, i]))
    const out = clone(m.expr)
    const expanded = walkPost(out, c => {
      if (Array.isArray(c) && c[0] === 'local.get' && idx.has(c[1])) return n[2 + idx.get(c[1])]
    })
    return expanded
  })
  return ast
}

/**
 * Specialize parameters that every call site passes the same constant: the param
 * becomes a local initialized to that constant, and the argument disappears from
 * every site. Named, unexported callees whose name appears ONLY as folded
 * (call $f …) sites qualify; int constants compare by canonical value, floats by
 * Object.is on non-NaN (per the signed-zero refutation — -0/NaN defer).
 * @param {Array} ast
 * @returns {Array}
 */
const specializeParams = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast
  const sameConst = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a[0] !== b[0] || !a[0].endsWith?.('.const')) return false
    const ca = getConst(a), cb = getConst(b)
    if (!ca || !cb) return false
    if (a[0] === 'i32.const' || a[0] === 'i64.const') return String(ca.value) === String(cb.value)
    const na = Number(ca.value), nb = Number(cb.value)
    return !Number.isNaN(na) && !Number.isNaN(nb) && Object.is(na, nb)
  }
  // one module walk: call sites and raw name occurrences for every func
  const allSites = new Map(), occ = new Map()
  walk(ast, n => {
    if (Array.isArray(n)) {
      if (n[0] === 'call' && typeof n[1] === 'string') {
        let a = allSites.get(n[1])
        if (!a) allSites.set(n[1], a = [])
        a.push(n)
      }
      return
    }
    if (typeof n === 'string' && n[0] === '$') occ.set(n, (occ.get(n) || 0) + 1)
  })
  for (const fn of ast.slice(1)) {
    if (!Array.isArray(fn) || fn[0] !== 'func' || typeof fn[1] !== 'string' || fn[1][0] !== '$') continue
    if (fn.some(c => Array.isArray(c) && (c[0] === 'export' || c[0] === 'type'))) continue
    const name = fn[1]
    const params = []
    for (const c of fn) if (Array.isArray(c) && c[0] === 'param') {
      if (typeof c[1] !== 'string' || c[1][0] !== '$' || c.length !== 3) { params.length = 0; break }
      params.push(c)
    }
    if (!params.length) continue
    // every textual occurrence of the name must be a folded call head or the def
    const sites = allSites.get(name) || []
    if (!sites.length || (occ.get(name) || 0) !== sites.length + 1) continue
    if (sites.some(c => c.length - 2 !== params.length)) continue
    for (let k = params.length - 1; k >= 0; k--) {
      const first = sites[0][2 + k]
      if (!sites.every(c => sameConst(c[2 + k], first))) continue
      const cost = 4 + constInstrSize(first) // local decl + set + const at callee
      const gain = sites.length * constInstrSize(first) + 1
      if (gain <= cost) continue
      // callee: param → zero-cost local + init
      const pd = params[k]
      const pi = fn.indexOf(pd)
      fn.splice(pi, 1)
      let at = 2
      while (at < fn.length && Array.isArray(fn[at]) &&
        (fn[at][0] === 'export' || fn[at][0] === 'param' || fn[at][0] === 'result' || fn[at][0] === 'local')) at++
      fn.splice(at, 0, ['local', pd[1], pd[2]], ['local.set', pd[1], clone(first)])
      for (const c of sites) c.splice(2 + k, 1)
      params.splice(k, 1)
    }
  }
  return ast
}

/**
 * Tail-merge duplicated early-exit epilogues: several `(if C (then STMTS… (return V)))`
 * sites whose arm bodies are byte-identical collapse to `(br_if $L C)` into one shared
 * copy placed after a block wrapping the body. Sound under the verifier's contract:
 * arm bodies are strictly branch-free straight-line code (calls / local & global
 * accesses / numeric ops) ending in a function-level `return` — the only relocated
 * instructions are position-independent, and each branch arrives with whatever state
 * its site had, exactly as the duplicated copy would. The function's own last
 * statement must already terminate, so the block can never fall through into the
 * shared copy.
 * @param {Array} ast
 * @returns {Array}
 */
let tmUid = 0
const tailmerge = (ast) => {
  walk(ast, (fn) => {
    if (!Array.isArray(fn) || fn[0] !== 'func') return
    const isTerm = (n) => n === 'unreachable' || n === 'return' ||
      (Array.isArray(n) && (n[0] === 'return' || n[0] === 'unreachable' || n[0] === 'br'))
    const last = fn[fn.length - 1]
    if (!isTerm(last)) return
    // linear, position-independent snippet: no branch/control may relocate
    const movable = (body) => {
      let ok = true
      walk(body, x => {
        const o = Array.isArray(x) ? x[0] : (typeof x === 'string' && OPCODE[x] !== undefined ? x : null)
        if (o === 'br' || o === 'br_if' || o === 'br_table' || o === 'return_call' || o === 'return_call_indirect' ||
            o === 'loop' || o === 'block' || o === 'if' || o === 'try_table' || o === 'unreachable') ok = false
      })
      return ok
    }
    const EMPTY_MAP = new Map()
    const groups = new Map()
    // sites may sit at any depth: `return` exits the function from anywhere, and the
    // replacement br_if targets the wrapper block by NAME
    walk(fn, (st, parent, idx) => {
      if (!Array.isArray(st) || st[0] !== 'if' || st.length !== 3 || !parent) return
      const { cond, thenBranch, elseBranch } = parseIf(st)
      if (!Array.isArray(cond) || !thenBranch || elseBranch) return
      const body = thenBranch.slice(1)
      if (!body.length) return
      // folded (return V) or wax's stacked `VALUE return` pair
      const ret = body[body.length - 1]
      if (!(Array.isArray(ret) && ret[0] === 'return') && ret !== 'return') return
      if (!movable(body) || estBytes(['b', ...body]) < 5) return
      const key = hashFunc(['b', ...body], EMPTY_MAP)
      let g = groups.get(key)
      if (!g) groups.set(key, g = { body, sites: [] })
      g.sites.push([parent, idx])
    })
    // every qualifying group wraps its own labeled block (inner groups nest inside
    // the earlier wrappers; br_if targets by name, so depth is irrelevant)
    const chosen = [...groups.values()].filter(g => g.sites.length >= 2)
    for (const g of chosen) {
      const label = '$__tm' + tmUid++
      for (const [parent, idx] of g.sites) {
        const { cond } = parseIf(parent[idx])
        parent[idx] = ['br_if', label, cond]
      }
      let at = typeof fn[1] === 'string' && fn[1][0] === '$' ? 2 : 1
      while (at < fn.length && Array.isArray(fn[at]) &&
        (fn[at][0] === 'export' || fn[at][0] === 'type' || fn[at][0] === 'param' || fn[at][0] === 'result' || fn[at][0] === 'local')) at++
      const stmts = fn.splice(at, fn.length - at)
      fn.push(['block', label, ...stmts], ...g.body)
    }
  })
  return ast
}

/**
 * Merge alias locals: `(local.set $A (local.tee $B V))` writes the same value into
 * two slots. When that is the ONLY write either local ever gets, their write
 * histories are identical — every read of $A (even one sequenced before the def,
 * which sees the zero default on both) equals the same read of $B. So $A's reads
 * rename to $B and the alias write drops. Params are excluded ($B would carry a
 * call-argument value where $A held zero).
 * @param {Array} ast
 * @returns {Array}
 */
const mergeLocals = (ast) => {
  walk(ast, (fn) => {
    if (!Array.isArray(fn) || fn[0] !== 'func') return
    const params = new Set()
    for (const c of fn) if (Array.isArray(c) && c[0] === 'param' && typeof c[1] === 'string') params.add(c[1])
    const counts = countLocalUses(fn)
    const renames = new Map()
    walkPost(fn, (n) => {
      if (!Array.isArray(n) || n[0] !== 'local.set' || n.length !== 3 ||
          !Array.isArray(n[2]) || n[2][0] !== 'local.tee' || n[2].length !== 3) return
      const A = n[1], B = n[2][1]
      if (typeof A !== 'string' || typeof B !== 'string' || A === B) return
      if (params.has(A) || params.has(B) || renames.has(A) || renames.has(B)) return
      const ca = counts.get(A), cb = counts.get(B)
      if (!ca || !cb || ca.sets !== 1 || ca.tees !== 0 || cb.sets !== 0 || cb.tees !== 1) return
      renames.set(A, B)
      return ['local.set', B, n[2][2]]
    })
    if (renames.size) walkPost(fn, (n) => {
      if (Array.isArray(n) && n[0] === 'local.get' && renames.has(n[1])) return ['local.get', renames.get(n[1])]
    })
  })
  return ast
}

/**
 * Propagate values through locals and eliminate single-use/dead locals.
 * Constants propagate to all uses; pure single-use exprs inline into get site.
 * Multi-pass with batch counting for convergence.
 */
/** Block-like nodes whose body is a straight-line instruction list (after any header). */
const isScopeNode = (n) => Array.isArray(n) &&
  (n[0] === 'func' || n[0] === 'block' || n[0] === 'loop' || n[0] === 'then' || n[0] === 'else')

/** Branch-target scopes: ops that carry an optional label/result header and can be jumped to via br/br_if. */
const isBranchScope = (op) => op === 'block' || op === 'loop' || op === 'if'

const propagate = (ast) => {
  walk(ast, (funcNode) => {
    if (!Array.isArray(funcNode) || funcNode[0] !== 'func') return

    const params = new Set()
    for (const sub of funcNode)
      if (Array.isArray(sub) && sub[0] === 'param' && typeof sub[1] === 'string') params.add(sub[1])

    // Propagation runs per straight-line scope: the function body and every nested
    // `block`/`loop`/`then`/`else` (including ones embedded in an expression, e.g. the
    // `(block (result i32) …)` an inlined call leaves behind). Collect scopes deepest-
    // first so inner simplifications shrink the use-counts the outer scopes see.
    // Use-counts are always whole-function — a set/get pair or dead store is only
    // touched when it's globally the sole occurrence, so per-scope work stays sound.
    const scopes = []
    walkPost(funcNode, n => { if (isScopeNode(n)) scopes.push(n) })

    // One use-count per propagation sweep: for the cautious sub-passes a stale count
    // only over-counts (skip a not-yet-provably-dead store) — never wrongly. The
    // exception is sinkSets' sole-use substitution: copy-propagation REPLICATES gets
    // of a copy's source local, so an under-count there would orphan a surviving get —
    // recount once after the propagation sweep before sinking. (Recounting per
    // sub-pass per scope is O(scopes·funcSize) and crippling on big modules.)
    for (let round = 0; round < MAX_PROP_ROUNDS; round++) {
      const useCounts = countLocalUses(funcNode)
      let progressed = false
      for (const scope of scopes) if (forwardPropagate(scope, params, useCounts)) progressed = true
      const counts = progressed ? countLocalUses(funcNode) : useCounts
      for (const scope of scopes) {
        // pure set feeding a loop (possibly through a run of other pure sets that
        // don't read it) which provably clobbers it on every path before any read,
        // with no reads outside the loop: dead
        for (let i = 1; i < scope.length - 1; i++) {
          const st = scope[i]
          if (!(Array.isArray(st) && st[0] === 'local.set' && st.length === 3 && typeof st[1] === 'string' &&
                Array.isArray(st[2]) && isPure(st[2]) && !hasTrap(st[2]))) continue
          let j = i + 1, blocked = false
          while (j < scope.length) {
            const nx = scope[j]
            if (Array.isArray(nx) && nx[0] === 'loop') break
            // an intervening statement may only be another pure set that neither
            // reads nor writes this local
            if (!(Array.isArray(nx) && nx[0] === 'local.set' && nx.length === 3 && nx[1] !== st[1] &&
                  Array.isArray(nx[2]) && isPure(nx[2]))) { blocked = true; break }
            let touches = false
            walk(nx[2], c => { if (Array.isArray(c) && (c[0] === 'local.get' || c[0] === 'local.tee') && c[1] === st[1]) touches = true })
            if (touches) { blocked = true; break }
            j++
          }
          if (blocked || j >= scope.length || !Array.isArray(scope[j]) || scope[j][0] !== 'loop') continue
          if (deadThroughLoop(funcNode, st[1], scope[j])) { scope.splice(i, 1); i--; progressed = true }
        }
        if (sinkSets(scope, params, counts)) progressed = true
        if (eliminateDeadStores(scope, params, counts)) progressed = true
        if (eliminateAdjacentDeadStores(scope, params)) progressed = true
      }
      if (!progressed) break
    }
  })

  return ast
}

// ==================== FUNCTION INLINING ====================

// Shared inliner primitives, used by BOTH passes below: `inline` (duplicates tiny
// multi-caller bodies — size-for-speed) and `inlineOnce` (splices single-caller
// bodies, never duplicates). The lift technique is identical — rename the callee's
// params/locals/labels to fresh `$__inlN_*` names, evaluate args once into the
// renamed param locals, turn `return X` into `br $__inlN X`, wrap the body in a
// `(block $__inlN (result T)? …)`. Only the SELECTION policy differs (one caller vs
// every caller of a small body), so the lift lives here once.

let inlineUid = 0
const INL_HEAD = new Set(['export', 'type', 'param', 'result', 'local'])
const inlBodyStart = (fn) => {
  let i = 2
  while (i < fn.length && (typeof fn[i] === 'string' || (Array.isArray(fn[i]) && INL_HEAD.has(fn[i][0])))) i++
  return i
}
const inlIsBranch = op => op === 'br' || op === 'br_if' || op === 'br_table'
// A subtree we can't lift into a (block …): depth-relative branch labels (which would
// shift under the added nesting) or tail calls (which would escape the wrapping block).
// Flat (unfolded) control tokens can't be relabeled under the inline wrapper's added
// nesting — bodies carrying them don't lift. Bare 'return' is exempt: buildInline
// rewrites it to a br. Bare value ops ('drop', 'i32.add', …) are position-independent.
const FLAT_CTRL = new Set(['block', 'loop', 'if', 'else', 'end', 'br', 'br_if', 'br_table',
  'try_table', 'catch', 'catch_all', 'delegate', 'rethrow', 'return_call', 'return_call_indirect'])
const inlUnsafe = (n) => {
  if (typeof n === 'string') return FLAT_CTRL.has(n)
  if (!Array.isArray(n)) return false
  const op = n[0]
  if (op === 'return_call' || op === 'return_call_indirect' || op === 'return_call_ref') return true
  if (op === 'try' || op === 'try_table' || op === 'delegate' || op === 'rethrow') return true  // exception labels — not handled by the relabeler below
  // NUMERIC branch labels are safe to splice: internal depths are preserved verbatim,
  // and a function-frame branch (depth past every callee block) lands exactly on the
  // single wrapper block buildInline adds — the same return-to-exit semantics.
  for (let i = 1; i < n.length; i++) if (inlUnsafe(n[i])) return true
  return false
}
const inlCallsSelf = (n, name) => {
  if (!Array.isArray(n)) return false
  if ((n[0] === 'call' || n[0] === 'return_call') && n[1] === name) return true
  for (let i = 1; i < n.length; i++) if (inlCallsSelf(n[i], name)) return true
  return false
}
// Per-call zero-init constant for a callee local re-entered from a caller loop.
// null ⇒ a type we can't safely zero here (skip inlining such a callee).
const inlZeroFor = (t) => {
  if (t === 'i32') return ['i32.const', 0]
  if (t === 'i64') return ['i64.const', 0]
  if (t === 'f32') return ['f32.const', 0]
  if (t === 'f64') return ['f64.const', 0]
  if (t === 'v128') return ['v128.const', 'i64x2', '0', '0']  // STRING lanes — watr's v128 encoder calls .replaceAll
  return null
}
// A callee local needs a per-entry reset only if some path reads it before any
// unconditional write (so it relied on the callee's fresh zero-init). Mirrors
// coalesceLocals' readsZero heuristic; unconditionally-written scratch needs none.
const inlNeedsReset = (body, name) => {
  let seen = false, conditional = false, depth = 0
  const visit = (n) => {
    if (seen || !Array.isArray(n)) return
    const op = n[0]
    const isSet = op === 'local.set' || op === 'local.tee'
    if ((isSet || op === 'local.get') && n[1] === name) {
      if (isSet) for (let i = 2; i < n.length && !seen; i++) visit(n[i])
      if (seen) return
      seen = true
      if (op === 'local.get' || depth > 0) conditional = true
      return
    }
    const isIf = op === 'if'
    for (let i = 1; i < n.length && !seen; i++) {
      const c = n[i]
      const cond = isIf && Array.isArray(c) && (c[0] === 'then' || c[0] === 'else')
      if (cond) depth++
      visit(c)
      if (cond) depth--
    }
  }
  for (const n of body) { if (seen) break; visit(n) }
  if (!seen) return false
  return conditional
}
// Module-level references that pin a function (can't be inlined-away/removed).
const inlCollectPinned = (n, pinned) => {
  if (!Array.isArray(n)) return
  const op = n[0]
  if (op === 'export' && Array.isArray(n[2]) && n[2][0] === 'func' && typeof n[2][1] === 'string') pinned.add(n[2][1])
  else if (op === 'start' && typeof n[1] === 'string') pinned.add(n[1])
  else if (op === 'ref.func' && typeof n[1] === 'string') pinned.add(n[1])
  else if (op === 'elem') for (const c of n) if (typeof c === 'string' && c[0] === '$') pinned.add(c)
  for (const c of n) inlCollectPinned(c, pinned)
}

/** Pinned function names (export/start/ref.func/elem targets) across the module's
 *  non-func nodes — a Set the inliner must never dissolve.
 *
 *  KEEP THIS EXTRACTED — do not inline back into inlineOnce. The self-host kernel
 *  (jz compiling jz) mis-compiles this `new Set()` + scan when it lives inside the
 *  oversized inlineOnce scope: the `pinned` value's pointer is zeroed, so the first
 *  `pinned.add` traps in `__set_add` ("memory access out of bounds") on every L2
 *  compile of a program with an inlinable helper. Building it in this small scope
 *  keeps the local count under the threshold that triggers the miscompile. Pinned by
 *  test/selfhost.js "level-2 inliner is sound". (Underlying large-function self-host
 *  codegen bug is tracked separately; this is the surgical dodge.) */
const inlBuildPinned = (ast) => {
  const pinned = new Set()
  for (const n of ast) if (!Array.isArray(n) || n[0] !== 'func') inlCollectPinned(n, pinned)
  return pinned
}

// Parse a func node into { params, locals, inlResult } once, enforcing the
// liftability contract (named params/locals, zero-init-able local types, ≤1
// result, no inline export). Returns null if the func can't be lifted.
const inlParse = (fn) => {
  const params = [], locals = []
  let inlResult = null, ok = true, nResult = 0
  for (let i = 2; i < fn.length; i++) {
    const c = fn[i]
    if (typeof c === 'string') continue
    if (!Array.isArray(c)) { ok = false; break }
    if (c[0] === 'param') { if (typeof c[1] !== 'string' || c[1][0] !== '$') { ok = false; break } params.push({ name: c[1], type: c[2] }) }
    else if (c[0] === 'local') { if (typeof c[1] !== 'string' || c[1][0] !== '$' || !inlZeroFor(c[2])) { ok = false; break } locals.push({ name: c[1], type: c[2] }) }
    else if (c[0] === 'result') { nResult += c.length - 1; if (c.length > 1) inlResult = c[1] }
    else if (c[0] === 'export') { ok = false; break }
    else if (c[0] === 'type') continue
    else break
  }
  if (nResult > 1) ok = false
  return ok ? { params, locals, inlResult } : null
}

// IR-node count of a callee body — the cheap size proxy gating multi-caller inline.
const inlBodySize = (fn) => {
  let n = 0
  const count = (x) => { if (!Array.isArray(x)) return; n++; for (let i = 1; i < x.length; i++) count(x[i]) }
  for (let i = inlBodyStart(fn); i < fn.length; i++) count(fn[i])
  return n
}

/**
 * Lift one callee into ONE `(call …)` node. Returns `{ block, decls }` — `block`
 * replaces the call; `decls` are the renamed param+local declarations to splice into
 * the caller's local list. A fresh uid per invocation keeps every inlined copy's
 * locals/labels unique, so the same body can be lifted into many sites.
 *
 *   (call $f a0 a1 …) → (block $__inlN (result T)?
 *     (local.set $__inlN_p0 a0) …            ;; args evaluated once, in order
 *     (local.set $__inlN_l reset) …          ;; only locals that rely on zero-init
 *     …body, renamed, `return X` → `br $__inlN X`…)
 */
const buildInline = (params, locals, inlResult, cBody, args) => {
  const uid = ++inlineUid
  const exit = `$__inl${uid}`
  const rename = new Map()
  for (const p of params) rename.set(p.name, `$__inl${uid}_${p.name.slice(1)}`)
  for (const l of locals) rename.set(l.name, `$__inl${uid}_${l.name.slice(1)}`)
  // The callee's own block/loop/if labels would shadow same-named caller labels (and
  // break depth resolution) under the added nesting — give them fresh names too.
  const labelRename = new Map()
  const collectLabels = (n) => {
    if (!Array.isArray(n)) return
    if (isBranchScope(n[0]) && typeof n[1] === 'string' && n[1][0] === '$' && !labelRename.has(n[1]))
      labelRename.set(n[1], `$__inl${uid}L_${n[1].slice(1)}`)
    for (let i = 1; i < n.length; i++) collectLabels(n[i])
  }
  for (const n of cBody) collectLabels(n)
  const sub = (n) => {
    if (n === 'return') return ['br', exit] // bare stack-style return — value already on stack
    if (!Array.isArray(n)) return n
    const op = n[0]
    if ((op === 'local.get' || op === 'local.set' || op === 'local.tee') && typeof n[1] === 'string' && rename.has(n[1]))
      return [op, rename.get(n[1]), ...n.slice(2).map(sub)]
    if (op === 'return') return ['br', exit, ...n.slice(1).map(sub)]
    if (isBranchScope(op) && typeof n[1] === 'string' && labelRename.has(n[1]))
      return [op, labelRename.get(n[1]), ...n.slice(2).map(sub)]
    if (inlIsBranch(op)) return [op, ...n.slice(1).map(c => (typeof c === 'string' && labelRename.has(c)) ? labelRename.get(c) : sub(c))]
    return n.map((c, i) => i === 0 ? c : sub(c))
  }
  const setup = params.map((p, k) => ['local.set', rename.get(p.name), args[k]])
  const resets = locals.filter(l => inlNeedsReset(cBody, l.name)).map(l => ['local.set', rename.get(l.name), inlZeroFor(l.type)])
  const inner = cBody.map(sub)
  const block = inlResult
    ? ['block', exit, ['result', inlResult], ...setup, ...resets, ...inner]
    : ['block', exit, ...setup, ...resets, ...inner]
  const decls = [...params, ...locals].map(p => ['local', rename.get(p.name), p.type])
  return { block, decls }
}

/**
 * Inline SMALL functions into every caller, then delete them — the multi-caller
 * complement to {@link inlineOnce}. inlineOnce only fires for a lone caller (so it
 * never duplicates); this duplicates a tiny body across ALL its sites, trading a
 * bounded amount of size to remove call overhead from hot inner loops (e.g. a
 * raymarcher's per-step SDF, evaluated 4-wide but still paying a wasm call each
 * march step). Size-for-speed — opt-in, on at the 'speed' level only.
 *
 * A callee qualifies when it is small (≤ INLINE_MAX_NODES IR nodes), named with
 * named params/locals, single-result-or-void, non-recursive, not pinned
 * (export/start/elem/ref.func), not in the caller's `pin` set, and free of
 * depth-relative branches / tail calls (the inlParse + inlUnsafe liftability
 * contract). Runs to a fixpoint so small-helper chains (sdf → sdRep) collapse.
 *
 * `simdOnly` (the speed-level default) restricts inlining to pure SIMD helpers —
 * every param and the result are `v128`. That targets the case this exists for —
 * a hand-vectorized hot loop's per-step helper (a raymarcher's SDF), where the call
 * overhead is paid every iteration and V8's wasm JIT won't inline it — while leaving
 * SCALAR helpers untouched: those are where jz's codegen-shape/size tuning and the
 * auto-vectorizer's call-lifting (plasma's fbm → sin2) live, and duplicating them
 * both bloats and perturbs that machinery for no gain (V8's JIT inlines scalar
 * helpers itself). The unrestricted form stays available as `watr: { inline: true }`.
 *
 * @param {Array} ast
 * @param {{simdOnly?: boolean}} [opts]
 * @returns {Array}
 */
const INLINE_MAX_NODES = 90
const isV128SimdHelper = (params, inlResult) =>
  inlResult === 'v128' && params.length > 0 && params.every(p => p.type === 'v128')
const inline = (ast, { simdOnly = false, pin = EMPTY_SET } = {}) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  const skip = new Set()  // callees with a non-inlinable site (arity mismatch) — don't re-pick
  for (let round = 0; round < MAX_INLINE_ROUNDS; round++) {
    const funcs = ast.filter(n => Array.isArray(n) && n[0] === 'func')
    const funcByName = new Map()
    for (const n of funcs) if (typeof n[1] === 'string') funcByName.set(n[1], n)

    const callRefs = new Map(), otherRef = new Set()
    const countRefs = (n) => {
      if (!Array.isArray(n)) return
      const op = n[0]
      if (op === 'call' && typeof n[1] === 'string') callRefs.set(n[1], (callRefs.get(n[1]) || 0) + 1)
      else if (op === 'return_call' && typeof n[1] === 'string') otherRef.add(n[1])
      for (let i = 1; i < n.length; i++) countRefs(n[i])
    }
    countRefs(ast)
    const pinned = new Set()
    for (const n of ast) if (!Array.isArray(n) || n[0] !== 'func') inlCollectPinned(n, pinned)

    // Pick a small, liftable, non-recursive callee with ≥1 plain-call site.
    let calleeName = null, parsed = null
    for (const [name, fn] of funcByName) {
      if (skip.has(name) || pinned.has(name) || otherRef.has(name) || pin.has(name)) continue
      if (!(callRefs.get(name) >= 1)) continue
      if (inlBodySize(fn) > INLINE_MAX_NODES) continue
      if (inlCallsSelf(fn, name)) continue
      const p = inlParse(fn)
      if (!p) continue
      if (simdOnly && !isV128SimdHelper(p.params, p.inlResult)) continue
      let bad = false
      for (let i = inlBodyStart(fn); i < fn.length; i++) if (inlUnsafe(fn[i])) { bad = true; break }
      if (bad) continue
      calleeName = name; parsed = p; break
    }
    if (!calleeName) break

    const callee = funcByName.get(calleeName)
    const { params, locals, inlResult } = parsed
    const cBody = callee.slice(inlBodyStart(callee))
    const expected = callRefs.get(calleeName) || 0  // callee is non-recursive ⇒ all sites are in other funcs
    let replaced = 0

    // Splice into EVERY caller. A body that itself still calls an as-yet-uninlined
    // helper is fine — later rounds collapse it (or it stays a call).
    for (const fn of funcs) {
      if (fn === callee) continue
      const addDecls = []
      for (let i = inlBodyStart(fn); i < fn.length; i++) {
        fn[i] = walkPost(fn[i], (n) => {
          if (!Array.isArray(n) || n[0] !== 'call' || n[1] !== calleeName) return
          const args = n.slice(2)
          if (args.length !== params.length) return  // arity mismatch — leave the call
          const { block, decls } = buildInline(params, locals, inlResult, cBody, args)
          addDecls.push(...decls)
          replaced++
          return block
        })
      }
      if (addDecls.length) fn.splice(inlBodyStart(fn), 0, ...addDecls)
    }

    // Drop the callee only if every site inlined; else keep it and stop re-picking it.
    if (replaced === expected) { const idx = ast.indexOf(callee); if (idx >= 0) ast.splice(idx, 1) }
    else skip.add(calleeName)
  }

  return ast
}

// ==================== INLINE-ONCE ====================

/**
 * Devirtualize `call_indirect` through NaN-boxed closure values with a statically
 * known candidate set. `let f = c ? a : b; … f(x)` emits a select of two i64
 * closure constants into an f64 local; every call site then derives the table
 * slot from that local's bits:
 *   (i32.wrap_i64 (i64.and (i64.shr_u (i64.reinterpret_f64 (local.get $f))
 *                                     (i64.const 32)) (i64.const 32767)))
 * When EVERY write to $f in the function is such a constant set (≤2 candidates),
 * each call site becomes a guarded direct call —
 *   (if (result …) (i64.eq (i64.reinterpret_f64 (local.get $f)) (i64.const C1))
 *     (then (call $tramp1 …args)) (else <next guard | original call_indirect>))
 * — with the ORIGINAL call_indirect kept as the final arm, so unknown flows
 * (zero-init paths the analysis can't see) behave exactly as before: the rewrite
 * is a pure branch-predicted fast path, ~25% on callback loops, and the direct
 * calls participate in inlining. A trivially-constant slot ((i32.const N) after
 * fold) becomes a bare direct call with no guard.
 *
 * Soundness: the guard compares the SAME bits the slot extraction reads, so
 * whichever constant flows to the call dispatches identically in both forms;
 * candidates that don't resolve to an elem entry (or whose target's signature
 * differs from the call's type — would-be runtime trap) disable the site. Any
 * table mutation op in the module disables the pass entirely. The function
 * table is exported for host-side closure invocation (reads); host mutation of
 * it is outside the ABI contract, same as the closure-constant model itself.
 */
const devirt = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast
  // Module facts: elem slot → func name (constant offsets only), type defs,
  // named funcs. Bail on dynamic elem offsets or table mutation anywhere.
  const slots = new Map(), typeDefs = new Map(), funcsByName = new Map(), allFuncs = []
  let tableMutated = false
  walk(ast, n => {
    if (Array.isArray(n) && typeof n[0] === 'string' &&
        (n[0] === 'table.set' || n[0] === 'table.grow' || n[0] === 'table.init' ||
         n[0] === 'table.copy' || n[0] === 'table.fill')) tableMutated = true
  })
  if (tableMutated) return ast
  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) continue
    if (node[0] === 'elem') {
      const off = node[1]
      if (!Array.isArray(off) || off[0] !== 'i32.const') return ast
      let base = Number(off[1])
      for (let i = 2; i < node.length; i++)
        if (typeof node[i] === 'string' && node[i][0] === '$') slots.set(base++, node[i])
    }
    else if (node[0] === 'type' && typeof node[1] === 'string') typeDefs.set(node[1], node[2])
    else if (node[0] === 'func') { allFuncs.push(node); if (typeof node[1] === 'string') funcsByName.set(node[1], node) }
  }
  if (!slots.size) return ast

  // Closure-valued GLOBALS: multiProp function-property slots dissolve into
  // f64 module globals (plan/scope.js flattenFuncNamespaces) — the subscript
  // hook pattern (`parse.space = fn`, overridden per feature at module init).
  // Every observed `global.set $G <closure-const>` contributes a candidate;
  // a non-const store poisons the global. The guard ladder stays SOUND even
  // with an incomplete set — unknown values take the original call_indirect
  // fallback arm — so candidates only need to cover the hot value.
  const globalCands = new Map()

  // All i64 const handling is canonical-hex STRING math (see the i64 VALUE
  // CONTRACT above): a helper RETURNING a BigInt is kind-erased in-kernel and
  // every op on it misdispatches — devirt silently no-ops.
  const isC64 = (n, hex) => Array.isArray(n) && n[0] === 'i64.const' && _i64Canon(n[1]) === hex
  const MASK15 = '0x0000000000007fff', SHIFT32 = '0x0000000000000020'
  // Collect the i64 constants reachable through reinterpret/select arms.
  const boxConsts = (v, out) => {
    if (!Array.isArray(v)) return false
    if (v[0] === 'i64.const') { out.push(v); return true }
    // f64-carrier closure const (`f64.const nan:0xHEX`) — the form module-init
    // global.set stores for hook slots; normalize to its i64 bits.
    if (v[0] === 'f64.const' && typeof v[1] === 'string' && v[1].startsWith('nan:')) {
      out.push(['i64.const', _i64Canon(v[1].slice(4))])
      return true
    }
    if (v[0] === 'f64.reinterpret_i64' && v.length === 2) return boxConsts(v[1], out)
    if (v[0] === 'select' && v.length === 4) return boxConsts(v[1], out) && boxConsts(v[2], out)
    return false
  }
  // Per-global write VALUES collected first; candidates resolved by fixpoint so
  // the hook-alias pattern works: `baseSpace = parse.space ?? default` stores a
  // select/if whose arms are a GLOBAL READ of another const slot plus a const —
  // candidates = union through the alias edge. Soundness is unchanged (the
  // guard ladder keeps the original indirect fallback for unknown values); the
  // fixpoint only widens the candidate set. `if (result f64)` arms and
  // `__is_nullish`-style guard CONDITIONS are skipped — only VALUE positions
  // contribute. A write that contains anything else poisons the global.
  const globalWrites = new Map()
  walk(ast, n => {
    if (!Array.isArray(n) || n[0] !== 'global.set' || typeof n[1] !== 'string') return
    if (!globalWrites.has(n[1])) globalWrites.set(n[1], [])
    globalWrites.get(n[1]).push(n[2])
  })
  // Value-position scan: consts and global.get leaves, through reinterprets,
  // select arms and if/result arms. Returns false (poison) on anything else.
  const candLeaves = (v, consts, reads) => {
    if (!Array.isArray(v)) return false
    if (v[0] === 'i64.const') { consts.push(v); return true }
    if (v[0] === 'f64.const' && typeof v[1] === 'string' && v[1].startsWith('nan:')) {
      consts.push(['i64.const', _i64Canon(v[1].slice(4))]); return true
    }
    if ((v[0] === 'f64.reinterpret_i64' || v[0] === 'i64.reinterpret_f64') && v.length === 2)
      return candLeaves(v[1], consts, reads)
    if (v[0] === 'global.get' && typeof v[1] === 'string') { reads.push(v[1]); return true }
    if (v[0] === 'local.get' || v[0] === 'local.tee') {
      // a tee'd copy of one of the above — the tee VALUE was already scanned
      // where it was written; the bare read alone proves nothing → poison
      return v[0] === 'local.tee' && v.length === 3 ? candLeaves(v[2], consts, reads) : false
    }
    if (v[0] === 'select' && v.length === 4)
      return candLeaves(v[1], consts, reads) && candLeaves(v[2], consts, reads)
    if (v[0] === 'if') {
      // (if (result T) COND (then A) (else B)) — arms are value positions
      let ok = true, seenArm = false
      for (let i = 1; i < v.length; i++) {
        const p = v[i]
        if (!Array.isArray(p)) continue
        if (p[0] === 'then' || p[0] === 'else') {
          seenArm = true
          if (p.length !== 2 || !candLeaves(p[1], consts, reads)) ok = false
        }
      }
      return ok && seenArm
    }
    return false
  }
  const writeFacts = new Map()   // global → { consts: [...], reads: [...] } | null
  for (const [g, ws] of globalWrites) {
    let consts = [], reads = [], ok = true
    for (const w of ws) if (!candLeaves(w, consts, reads)) { ok = false; break }
    writeFacts.set(g, ok ? { consts, reads } : null)
  }
  // Fixpoint: a global's candidates = its const writes ∪ candidates of every
  // global it reads in value position. A poisoned alias poisons the reader.
  let changed = true
  const resolved = new Map()
  while (changed) {
    changed = false
    for (const [g, f] of writeFacts) {
      if (resolved.get(g) === null) continue
      if (f === null) { if (resolved.get(g) !== null) { resolved.set(g, null); changed = true } continue }
      const m = resolved.get(g) || new Map()
      const before = m.size
      let poisoned = false
      for (const c of f.consts) m.set(_i64Canon(c[1]), c)
      for (const r of f.reads) {
        if (writeFacts.get(r) === null || resolved.get(r) === null) { poisoned = true; break }
        const rm = resolved.get(r)
        if (rm) for (const [hex, c] of rm) m.set(hex, c)
      }
      if (poisoned) { resolved.set(g, null); changed = true; continue }
      if (!resolved.has(g) || m.size !== before) { resolved.set(g, m); changed = true }
    }
  }
  for (const [g, m] of resolved) globalCands.set(g, m)

  // The slot-extraction idiom — returns the source local name or null.
  const matchSlotOfLocal = (e) => {
    if (!Array.isArray(e) || e[0] !== 'i32.wrap_i64') return null
    const a = e[1]
    if (!Array.isArray(a) || a[0] !== 'i64.and') return null
    let sh = a[1], mk = a[2]
    if (!isC64(mk, MASK15)) { sh = a[2]; mk = a[1] }
    if (!isC64(mk, MASK15) || !Array.isArray(sh) || sh[0] !== 'i64.shr_u' || !isC64(sh[2], SHIFT32)) return null
    const ri = sh[1]
    if (!Array.isArray(ri) || ri[0] !== 'i64.reinterpret_f64') return null
    const leaf = ri[1]
    if (Array.isArray(leaf) && leaf[0] === 'local.get' && typeof leaf[1] === 'string') return { local: leaf[1] }
    if (Array.isArray(leaf) && leaf[0] === 'global.get' && typeof leaf[1] === 'string') return { global: leaf[1] }
    return null
  }
  // Canonical "params -> results" token string for signature comparison.
  const tokSig = (parts) => {
    const ps = [], rs = []
    for (const p of parts) {
      if (!Array.isArray(p)) continue
      if (p[0] === 'param') { for (const t of p.slice(1)) if (typeof t === 'string' && t[0] !== '$') ps.push(t) }
      else if (p[0] === 'result') rs.push(...p.slice(1))
    }
    return ps.join(',') + '->' + rs.join(',')
  }

  for (const fn of allFuncs) {   // rewrite call_indirect in EVERY func, named or not
    // Candidate sets: local → Map<bits, constNode>, or null once poisoned.
    // Params are poisoned (incoming value unknown).
    const cands = new Map()
    for (const part of fn)
      if (Array.isArray(part) && part[0] === 'param' && typeof part[1] === 'string') cands.set(part[1], null)
    walk(fn, n => {
      if (!Array.isArray(n) || (n[0] !== 'local.set' && n[0] !== 'local.tee') || typeof n[1] !== 'string') return
      if (cands.get(n[1]) === null) return
      const out = []
      if (boxConsts(n[2], out)) {
        const m = cands.get(n[1]) || new Map()
        for (const c of out) m.set(_i64Canon(c[1]), c)
        cands.set(n[1], m)
      } else if (Array.isArray(n[2]) && n[2][0] === 'global.get' && typeof n[2][1] === 'string'
          && globalCands.get(n[2][1])) {
        // promoteGlobals snapshot (`$_pg = global.get $G`) — inherit G's set
        const g = globalCands.get(n[2][1])
        const m = cands.get(n[1]) || new Map()
        for (const [hex, c] of g) m.set(hex, c)
        cands.set(n[1], m)
      } else cands.set(n[1], null)
    })

    walkPost(fn, (n, parent) => {
      if (!Array.isArray(n) || n[0] !== 'call_indirect') return
      // A call_indirect sitting directly under an `else` is (or looks exactly
      // like) the fallback arm of an existing guard — never re-wrap it, so the
      // pass is idempotent across repeated optimize() runs.
      if (parent && parent[0] === 'else') return
      const typeUse = Array.isArray(n[1]) && n[1][0] === 'type' ? n[1] : null
      if (!typeUse) return
      const sig = typeDefs.get(typeUse[1])
      const callSig = Array.isArray(sig) ? tokSig(sig.slice(1)) : null
      if (callSig == null) return
      const results = []
      for (const s of sig.slice(1)) if (Array.isArray(s) && s[0] === 'result') results.push(...s.slice(1))
      const args = n.slice(2, -1)
      const idx = n[n.length - 1]
      const sigOk = (name) => {
        const target = funcsByName.get(name)
        if (!target) return false
        const tu = target.find(p => Array.isArray(p) && p[0] === 'type')
        if (tu) return tu[1] === typeUse[1] ||
          (typeDefs.get(tu[1]) && tokSig(typeDefs.get(tu[1]).slice(1)) === callSig)
        return tokSig(target.slice(2)) === callSig
      }
      // Constant slot → bare direct call.
      if (Array.isArray(idx) && idx[0] === 'i32.const') {
        const name = slots.get(Number(idx[1]))
        return name && sigOk(name) ? ['call', name, ...args] : undefined
      }
      const f = matchSlotOfLocal(idx)
      if (!f) return
      const m = f.local != null ? cands.get(f.local) : globalCands.get(f.global)
      if (!m || m.size === 0 || m.size > 4) return
      const arms = []
      for (const cNode of m.values()) {
        const name = slots.get(_i64HiU(_i64Canon(cNode[1])) & 32767)
        if (!name || !sigOk(name)) return
        arms.push([cNode, name])
      }
      const readBack = f.local != null ? ['local.get', f.local] : ['global.get', f.global]
      let out = n
      for (let i = arms.length - 1; i >= 0; i--) {
        const [cNode, name] = arms[i]
        out = ['if', ...(results.length ? [['result', ...results]] : []),
          ['i64.eq', ['i64.reinterpret_f64', clone(readBack)], clone(cNode)],
          ['then', ['call', name, ...args.map(clone)]],
          ['else', out]]
      }
      return out
    })
  }
  return ast
}

/**
 * Inline functions that are called from exactly one place into their lone caller,
 * then delete them. Unlike {@link inline} (which duplicates tiny stateless bodies),
 * this never duplicates code and never inflates: each inlined function drops a
 * function-section entry, a type-section entry (if now unused), and a `call`
 * instruction, paying back only a `block`/`local.set` wrapper. This is what
 * `wasm-opt -Oz` does — collapsing helper chains down to a couple of functions —
 * and it's the bulk of the gap between hand-tuned WASM and naive codegen.
 *
 * A function `$f` qualifies when it is, all of:
 *  • named, with named params and locals (numeric indices can't be safely renamed);
 *  • referenced exactly once across the whole module, by a plain `call` (no
 *    `return_call`, `ref.func`, `elem`, `export`, or `start` reference, and not
 *    recursive);
 *  • single-result or void (a multi-value result can't be modeled as `(block (result …))`);
 *  • free of numeric (depth-relative) branch labels — those would shift under the
 *    extra block nesting — and of `return_call*` in its body.
 *
 * `(call $f a0 a1 …)` becomes
 *   (block $__inlN (result T)?
 *     (local.set $__inlN_p0 a0) (local.set $__inlN_p1 a1) …   ;; args evaluated once, in order
 *     …body, params/locals renamed to $__inlN_*, `return X` → `br $__inlN X`…)
 * and the renamed params+locals are appended to the caller's `local` decls; the
 * body's own block/loop/if labels are renamed too so they can't shadow the caller's.
 * Runs to a fixpoint so helper chains fully collapse.
 *
 * @param {Array} ast
 * @returns {Array}
 */
const inlineOnce = (ast, { pin = EMPTY_SET } = {}) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  // Lift primitives are shared with `inline` (defined once above buildInline). inlineOnce
  // splices into a SINGLE caller (never duplicating); `inline` duplicates into every caller.
  const bodyStart = inlBodyStart, callsSelf = inlCallsSelf, unsafe = inlUnsafe, isBranch = inlIsBranch
  const zeroFor = inlZeroFor, needsReset = inlNeedsReset

  for (let round = 0; round < MAX_INLINE_ROUNDS; round++) {
    const funcs = ast.filter(n => Array.isArray(n) && n[0] === 'func')
    const funcByName = new Map()
    for (const n of funcs) if (typeof n[1] === 'string') funcByName.set(n[1], n)

    // Count plain-call references across the WHOLE module (anonymous exported funcs
    // call helpers too); flag any non-call reference (return_call etc.).
    const callRefs = new Map(), otherRef = new Set()
    const countRefs = (n) => {
      if (!Array.isArray(n)) return
      const op = n[0]
      if (op === 'call' && typeof n[1] === 'string') callRefs.set(n[1], (callRefs.get(n[1]) || 0) + 1)
      else if (op === 'return_call' && typeof n[1] === 'string') otherRef.add(n[1])
      for (let i = 1; i < n.length; i++) countRefs(n[i])
    }
    countRefs(ast)
    const pinned = inlBuildPinned(ast)
    // a func may carry its own (export "name") — the signature scan below rejects those too

    // Pick a callee.
    let calleeName = null
    for (const [name, fn] of funcByName) {
      if (pinned.has(name) || otherRef.has(name)) continue
      if (callRefs.get(name) !== 1) continue
      // Caller-pinned functions stay intact: inlining a single-caller helper would dissolve the
      // call node, and a consumer may rely on it surviving (e.g. jz pins the scalar transcendentals
      // its auto-vectorizer later rewrites to f64x2 mirrors). The policy lives with the caller.
      if (pin.has(name)) continue
      if (callsSelf(fn, name)) continue
      // named params/locals only (we'll rename them); reject locals with types
      // we can't zero-init on block re-entry.
      let ok = true, nResult = 0
      for (let i = 2; i < fn.length; i++) {
        const c = fn[i]
        if (typeof c === 'string') continue
        if (!Array.isArray(c)) { ok = false; break }
        if (c[0] === 'param' || c[0] === 'local') {
          if (typeof c[1] !== 'string' || c[1][0] !== '$') { ok = false; break }
          if (c[0] === 'local' && !zeroFor(c[2])) { ok = false; break }
        }
        else if (c[0] === 'result') nResult += c.length - 1
        else if (c[0] === 'export') { ok = false; break }
        else if (c[0] === 'type') continue
        else break
      }
      if (!ok || nResult > 1) continue
      let bad = false
      for (let i = bodyStart(fn); i < fn.length; i++) if (unsafe(fn[i])) { bad = true; break }
      if (bad) continue
      calleeName = name; break
    }
    if (!calleeName) break

    const callee = funcByName.get(calleeName)
    const params = [], locals = []
    let inlResult = null
    for (let i = 2; i < callee.length; i++) {
      const c = callee[i]
      if (typeof c === 'string' || !Array.isArray(c)) continue
      if (c[0] === 'param') params.push({ name: c[1], type: c[2] })
      else if (c[0] === 'result') { if (c.length > 1) inlResult = c[1] }
      else if (c[0] === 'local') locals.push({ name: c[1], type: c[2] })
      else if (c[0] === 'export' || c[0] === 'type') continue
      else break
    }
    const cBody = callee.slice(bodyStart(callee))

    const uid = ++inlineUid
    const exit = `$__inl${uid}`
    const rename = new Map()
    for (const p of params) rename.set(p.name, `$__inl${uid}_${p.name.slice(1)}`)
    for (const l of locals) rename.set(l.name, `$__inl${uid}_${l.name.slice(1)}`)
    // The callee's own block/loop/if labels would shadow same-named labels in the
    // caller after nesting (and break depth resolution) — give them fresh names too.
    const labelRename = new Map()
    const collectLabels = (n) => {
      if (!Array.isArray(n)) return
      if (isBranchScope(n[0]) && typeof n[1] === 'string' && n[1][0] === '$' && !labelRename.has(n[1]))
        labelRename.set(n[1], `$__inl${uid}L_${n[1].slice(1)}`)
      for (let i = 1; i < n.length; i++) collectLabels(n[i])
    }
    for (const n of cBody) collectLabels(n)
    const sub = (n) => {
      if (!Array.isArray(n)) return n
      const op = n[0]
      if ((op === 'local.get' || op === 'local.set' || op === 'local.tee') && typeof n[1] === 'string' && rename.has(n[1]))
        return [op, rename.get(n[1]), ...n.slice(2).map(sub)]
      if (op === 'return') return ['br', exit, ...n.slice(1).map(sub)]
      if (isBranchScope(op) && typeof n[1] === 'string' && labelRename.has(n[1]))
        return [op, labelRename.get(n[1]), ...n.slice(2).map(sub)]
      if (isBranch(op)) return [op, ...n.slice(1).map(c => (typeof c === 'string' && labelRename.has(c)) ? labelRename.get(c) : sub(c))]
      return n.map((c, i) => i === 0 ? c : sub(c))
    }

    // Splice into the (unique) caller (which may be an anonymous exported func).
    let done = false
    for (const fn of funcs) {
      if (fn === callee || done) continue
      const start = bodyStart(fn)
      for (let i = start; i < fn.length; i++) {
        const replaced = walkPost(fn[i], (n) => {
          if (done || !Array.isArray(n) || n[0] !== 'call' || n[1] !== calleeName) return
          const args = n.slice(2)
          if (args.length !== params.length) return  // arity mismatch — leave it
          const setup = params.map((p, k) => ['local.set', rename.get(p.name), args[k]])
          // Re-zero only the callee locals that actually depend on the per-call
          // zero-init (read-before-write, or first-write inside a conditional
          // branch). Unconditionally-written-before-read scratch locals don't
          // need a reset, and emitting one inflates their set-count enough to
          // break propagation/coalescing of the helper that follows.
          const resets = locals
            .filter(l => needsReset(cBody, l.name))
            .map(l => ['local.set', rename.get(l.name), zeroFor(l.type)])
          const inner = cBody.map(sub)
          done = true
          return inlResult
            ? ['block', exit, ['result', inlResult], ...setup, ...resets, ...inner]
            : ['block', exit, ...setup, ...resets, ...inner]
        })
        if (replaced !== fn[i]) fn[i] = replaced
        if (done) {
          const decls = [...params, ...locals].map(p => ['local', rename.get(p.name), p.type])
          if (decls.length) fn.splice(bodyStart(fn), 0, ...decls)
          break
        }
      }
      if (done) break
    }
    if (!done) break  // call site not found inside a func body — give up

    const idx = ast.indexOf(callee)
    if (idx >= 0) ast.splice(idx, 1)
  }

  return ast
}

// ==================== MERGE BLOCKS ====================

/**
 * Does `body` contain a branch instruction targeting `label`, ignoring inner
 * blocks/loops that re-bind the same label?
 */
const targetsLabel = (body, label) => {
  let found = false
  const search = (n, shadowed) => {
    if (found || !Array.isArray(n)) return
    const op = n[0]
    let inner = shadowed
    if ((op === 'block' || op === 'loop') && typeof n[1] === 'string' && n[1] === label) inner = true
    if (!shadowed) {
      if (op === 'br' || op === 'br_if' || op === 'br_on_null' || op === 'br_on_non_null' ||
          op === 'br_on_cast' || op === 'br_on_cast_fail') {
        if (n[1] === label) { found = true; return }
      } else if (op === 'br_table') {
        for (let j = 1; j < n.length; j++) {
          if (typeof n[j] === 'string') { if (n[j] === label) { found = true; return } }
          else break
        }
      } else if (op === 'catch' || op === 'catch_ref') {
        // `try_table` catch clause `(catch $tag $label)` / `(catch_ref $tag $label)`
        // branches to an enclosing block label just like `br` does.
        if (n[2] === label) { found = true; return }
      } else if (op === 'catch_all' || op === 'catch_all_ref') {
        // `(catch_all $label)` / `(catch_all_ref $label)`
        if (n[1] === label) { found = true; return }
      }
    }
    for (let i = 1; i < n.length; i++) search(n[i], inner)
  }
  for (const node of body) search(node, false)
  return found
}

/**
 * Unwrap redundant blocks whose label is never targeted. The block's stack
 * effect is determined entirely by its body, so removing the `block`/`end`
 * framing is sound as long as no `br` reaches into the block from inside.
 *
 * Three complementary patterns:
 *
 * 1. **Block at scope level** (sibling in `func`/`block`/`loop`/`then`/`else`):
 *    splice body into the parent scope. Works for untyped, `(result T)`-typed,
 *    or even `(param …)`-typed blocks — in all cases the body produces the
 *    same net stack effect as the framed block did, at the same position.
 * 2. **Result-typed block in expression position** (`(block (result T) expr)`
 *    as the value of some operand): collapse to `expr` if the body is a
 *    single value expression. Catches the wrappers jz codegen leaves around
 *    arena allocations once `propagate` has folded the intermediate
 *    set/get pairs to a single call.
 * 3. **Result-typed block as the sole operand of a void consumer** at scope:
 *    `(local.set $x (block (result T) stmt* expr))` → splice `stmt*` into
 *    the parent scope and rewrite the consumer to `(local.set $x expr)`.
 *    Same shape for `global.set` and `drop`. Cleans up the multi-stmt
 *    wrappers `inlineOnce` leaves when inlining helpers whose return value
 *    is fed into a single set/drop.
 *
 * Pattern 2 runs first (post-order) so patterns 1+3 see cleaned-up parents.
 * @param {Array} ast
 * @returns {Array}
 */
const mergeBlocks = (ast) => {
  walkPost(ast, (node) => {
    if (!Array.isArray(node) || node[0] !== 'block') return
    let bi = 1, label = null
    if (typeof node[1] === 'string' && node[1][0] === '$') { label = node[1]; bi = 2 }
    let hasResult = false
    while (bi < node.length) {
      const c = node[bi]
      if (Array.isArray(c) && (c[0] === 'param' || c[0] === 'type')) { bi++; continue }
      if (Array.isArray(c) && c[0] === 'result') { hasResult = true; bi++; continue }
      break
    }
    const body = node.slice(bi)
    if (!hasResult || body.length !== 1) return
    const only = body[0]
    if (!Array.isArray(only)) return
    if (label && targetsLabel(body, label)) return
    node.length = 0
    for (const tok of only) node.push(tok)
  })

  walk(ast, (node) => {
    if (!isScopeNode(node)) return
    let i = 1
    while (i < node.length) {
      const child = node[i]
      if (!Array.isArray(child)) { i++; continue }

      // Pattern 3: void-consumer wrapping a result-typed block at scope level.
      //   (local.set $x (block $L (result T) stmt* expr))   →   stmt* (local.set $x expr)
      // Same logic for `global.set` and `drop`. The block's body produces a
      // single value at the end; the leading stmts run for side-effect and
      // can move into the parent scope unchanged. Label must be unreferenced
      // (an inner `br $L value` would skip later stmts after splicing).
      // Catches the (block (result T) … (local.get $tmp)) wrappers inlineOnce
      // leaves around inlined helper bodies.
      {
        const cop = child[0]
        const oi = (cop === 'local.set' || cop === 'global.set') ? 2
                 : cop === 'drop' ? 1 : -1
        if (oi >= 0 && child.length === oi + 1) {
          const operand = child[oi]
          if (Array.isArray(operand) && operand[0] === 'block') {
            let bi = 1, label = null
            if (typeof operand[1] === 'string' && operand[1][0] === '$') { label = operand[1]; bi = 2 }
            let hasResult = false
            while (bi < operand.length) {
              const c = operand[bi]
              if (Array.isArray(c) && (c[0] === 'param' || c[0] === 'type')) { bi++; continue }
              if (Array.isArray(c) && c[0] === 'result') { hasResult = true; bi++; continue }
              break
            }
            const body = hasResult ? operand.slice(bi) : null
            if (body && body.length >= 2 && !(label && targetsLabel(body, label))) {
              const expr = body[body.length - 1]
              const setup = body.slice(0, -1)
              child[oi] = expr
              node.splice(i, 1, ...setup, child)
              continue  // re-examine position i (now setup[0]) — may itself be a splice candidate
            }
          }
        }
      }

      if (child[0] !== 'block') { i++; continue }
      let bi = 1, label = null
      if (typeof child[1] === 'string' && child[1][0] === '$') { label = child[1]; bi = 2 }
      // Skip leading typing annotations; they describe the block's stack effect,
      // which the body already produces verbatim, so they're discarded on splice.
      while (bi < child.length) {
        const c = child[bi]
        if (Array.isArray(c) && (c[0] === 'param' || c[0] === 'result' || c[0] === 'type')) { bi++; continue }
        break
      }
      const body = child.slice(bi)
      if (label && targetsLabel(body, label)) { i++; continue }
      node.splice(i, 1, ...body)
      i += body.length
    }
  })
  return ast
}

// ==================== COALESCE LOCALS ====================

/**
 * Share local slots between same-type locals with non-overlapping live ranges.
 * Live range = [first pos, last pos] of any local.get/set/tee, extended over
 * any loop containing a reference (so a value read across loop iterations stays
 * intact). Greedy slot assignment by start position. Params and unnamed/numeric
 * references are left alone; `localReuse` later removes the renamed-away decls.
 *
 * Soundness: WASM zero-initializes locals at function entry, so a local whose
 * first reference (in walk order) is a `local.get` *relies* on that implicit
 * zero — coalescing it into a slot whose previous user left a non-zero residue
 * would silently change behavior (e.g. a `for (let i=0; …)` loop counter
 * inheriting `N*4` from a sibling temp). Such "read-first" locals can still
 * serve as a slot's *primary* (the slot then keeps the function's zero start),
 * but can never be a donor merged into an existing slot.
 * @param {Array} ast
 * @returns {Array}
 */
const coalesceLocals = (ast) => {
  walk(ast, (funcNode) => {
    if (!Array.isArray(funcNode) || funcNode[0] !== 'func') return

    const decls = new Map(), params = new Map()
    for (const sub of funcNode) {
      if (!Array.isArray(sub) || typeof sub[1] !== 'string' || sub[1][0] !== '$' || typeof sub[2] !== 'string') continue
      if (sub[0] === 'local') decls.set(sub[1], sub[2])
      else if (sub[0] === 'param') params.set(sub[1], sub[2])
    }
    if (!decls.size || decls.size + params.size < 2) return

    const uses = new Map()
    const loopStack = [], condStack = []
    let pos = 0, abort = false
    // effective innermost arm for a local: frames where BOTH sibling arms write it
    // at statement level are transparent (the write happens on every path)
    const effArm = (name) => {
      let k = condStack.length - 1
      while (k >= 0 && condStack[k].bothW && condStack[k].bothW.has(name)) k--
      return k >= 0 ? condStack[k] : null
    }
    // statement-level writes of a branch-free arm; null when the arm can exit early
    const armSets = (arm) => {
      let ok = true
      walk(arm, x => {
        const o = Array.isArray(x) ? x[0] : x
        if (o === 'br' || o === 'br_if' || o === 'br_table' || o === 'return' || o === 'unreachable' ||
            o === 'throw' || o === 'return_call' || o === 'return_call_indirect') ok = false
      })
      if (!ok) return null
      const set = new Set()
      for (let k = 1; k < arm.length; k++) {
        const st = arm[k]
        if (Array.isArray(st) && (st[0] === 'local.set' || st[0] === 'local.tee') && typeof st[1] === 'string') set.add(st[1])
      }
      return set
    }

    const visit = (n) => {
      if (abort || !Array.isArray(n)) return
      const op = n[0]
      const isLoop = op === 'loop'
      if (isLoop) loopStack.push({ start: pos, end: pos })
      const isSet = op === 'local.set' || op === 'local.tee'

      if (isSet || op === 'local.get') {
        const name = n[1]
        if (typeof name !== 'string' || name[0] !== '$') { abort = true; return }
        // Execution order: evaluate set/tee value BEFORE recording the write,
        // so a `(local.set $x (… (local.get $x) …))` is correctly seen as a
        // read-then-write of $x (firstOp = local.get).
        if (isSet) for (let i = 2; i < n.length; i++) visit(n[i])
        const here = pos++
        if (decls.has(name) || params.has(name)) {
          let u = uses.get(name)
          // A first WRITE only licenses slot-joining when it executes on EVERY path that
          // reaches a later read — else the read must see the local's implicit ZERO, and a
          // joined slot would leak the previous occupant's residue. Three skippable
          // contexts break the guarantee: an if/else arm (condDepth), a LOOP body (a
          // zero-trip loop skips the write but a read after the loop still runs — the
          // mat4 `iters=0` miscompile), and any statement AFTER a br/br_if/return in the
          // same list (the rotated-loop entry guard `(block (br_if $out …) …)` shape).
          if (!u) {
            u = { start: here, end: here, firstOp: op,
                  firstArm: effArm(name), armEscapes: false,
                  firstLoop: loopStack[loopStack.length - 1] ?? null, escapes: false, loops: new Set() }
            uses.set(name, u)
          } else {
            // a use outside the first write's innermost loop makes zero-trip skips
            // observable; a use outside its EFFECTIVE arm can execute on a path that
            // never wrote — either way the slot must not be joined. (A local written
            // at statement level in BOTH branch-free arms of an if is written on
            // every path through it, so those arm frames are transparent for it.)
            if ((loopStack[loopStack.length - 1] ?? null) !== u.firstLoop) u.escapes = true
            if (effArm(name) !== u.firstArm) u.armEscapes = true
          }
          if (here > u.end) u.end = here
          for (const ls of loopStack) u.loops.add(ls)
        }
      } else {
        pos++
        const isIf = op === 'if'
        let bothW = null
        if (isIf) {
          const { thenBranch, elseBranch } = parseIf(n)
          if (thenBranch && elseBranch) {
            const a = armSets(thenBranch), b = armSets(elseBranch)
            if (a && b) { bothW = new Set(); for (const x of a) if (b.has(x)) bothW.add(x); if (!bothW.size) bothW = null }
          }
        }
        let branched = false   // a direct-child br/br_if/return makes the REST of this list conditional
        for (let i = 1; i < n.length; i++) {
          const c = n[i]
          const isArm = isIf && Array.isArray(c) && (c[0] === 'then' || c[0] === 'else')
          const cond = isArm || branched
          if (cond) condStack.push({ bothW: isArm ? bothW : null })
          visit(c)
          if (cond) condStack.pop()
          if (Array.isArray(c) && (c[0] === 'br_if' || c[0] === 'br' || c[0] === 'br_table' || c[0] === 'return' || c[0] === 'return_call' || c[0] === 'return_call_indirect' || c[0] === 'unreachable')) branched = true
        }
      }

      if (isLoop) { const ls = loopStack.pop(); ls.end = pos }
    }
    visit(funcNode)
    if (abort) return

    // A use inside a loop must stay live for the whole loop — the next iteration
    // could read what this iteration wrote. EXCEPT a write-first, unconditional,
    // non-escaping local: every trip rewrites it before any read, so its lifetime
    // is per-iteration and its raw [write, lastUse] range is the true one.
    for (const u of uses.values()) {
      if (u.firstOp !== 'local.get' && !u.escapes && (u.firstArm === null || !u.armEscapes) && u.firstLoop !== null) continue
      for (const ls of u.loops) {
        if (ls.start < u.start) u.start = ls.start
        if (ls.end > u.end) u.end = ls.end
      }
    }

    const ordered = [...uses.entries()].filter(([n]) => decls.has(n)).sort((a, b) => a[1].start - b[1].start)
    const rename = new Map()
    // Params seed pre-colored slots: the argument value is live from entry to its last
    // use — after that the slot is free scratch for a same-typed local. Zero-reading
    // locals still never join (a param holds the caller's residue, not zero).
    const slots = [...params].map(([name, type]) => ({ primary: name, type, end: uses.get(name)?.end ?? -1 }))
    for (const [name, range] of ordered) {
      // Read-first locals depend on the implicit zero — they may *start* a fresh
      // slot (the function's zero init) but never *join* one. A first WRITE joins
      // when it dominates every read: uses confined to the write's own if-arm run
      // only on the path that wrote (arm-contained), and uses confined to the
      // write's loop are rewritten every trip (loop-carried read-before-write
      // shows up as a firstOp get). A use escaping either region could observe a
      // skipped write — the previous occupant's residue — so it blocks joining.
      const readsZero = range.firstOp === 'local.get' ||
        (range.firstArm !== null && range.armEscapes) ||
        (range.firstLoop !== null && range.escapes)
      const type = decls.get(name)
      const slot = readsZero ? null : slots.find(s => s.type === type && s.end < range.start)
      if (slot) { rename.set(name, slot.primary); if (range.end > slot.end) slot.end = range.end }
      else slots.push({ primary: name, type, end: range.end })
    }
    if (rename.size === 0) return

    walk(funcNode, (n) => {
      if (Array.isArray(n) &&
          (n[0] === 'local.get' || n[0] === 'local.set' || n[0] === 'local.tee') &&
          rename.has(n[1])) {
        n[1] = rename.get(n[1])
      }
    })
  })
  return ast
}

// ==================== VACUUM ====================

/**
 * Remove no-op code: nops, drop of pure expressions, empty branches,
 * and select with identical arms.
 * @param {Array} ast
 * @returns {Array}
 */
const vacuum = (ast) => {
  return walkPost(ast, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]

    // Remove nop entirely (return array marker; parent or post-pass cleans it)
    if (op === 'nop') return ['nop']

    // (drop V) → just V's side effects. Pure V vanishes (→ nop); a pure op over
    // a `local.tee` collapses to the bare store (kills the post-increment's dead
    // old-value arithmetic); impure V is kept under a drop.
    if (op === 'drop' && node.length === 2) {
      const eff = dropEffects(node[1])
      if (eff.length === 0) return ['nop']
      if (eff.length === 1) return eff[0]
      return ['block', ...eff]
    }

    // (select x x cond) → x — only when the arm AND cond are PURE. select evaluates BOTH
    // arms, so collapsing two identical IMPURE arms to one would drop a side effect (run it
    // once, not twice); and an impure cond may set a local a later op reads (an address
    // `local.tee` the matching store reuses) — dropping it leaves that local stale. Keep
    // the select unless everything discarded is pure.
    if (op === 'select' && node.length >= 4 && equal(node[1], node[2]) && isPure(node[1]) && isPure(node[3])) return node[1]

    if (op === 'if') {
      const { cond, thenBranch, elseBranch } = parseIf(node)
      const thenEmpty = !thenBranch || thenBranch.length <= 1
      const elseEmpty = !elseBranch || elseBranch.length <= 1

      // (if cond () ()) → nop or (drop cond)
      if (thenEmpty && elseEmpty) return isPure(cond) ? ['nop'] : ['drop', cond]

      // (if cond (then X) (else)) → drop the empty else
      if (elseBranch && elseEmpty && !thenEmpty) {
        return node.filter(c => c !== elseBranch)
      }

      // (if cond (then) (else X)) → (if (i32.eqz cond) (then X)) — void ifs only
      // (a result-typed if needs both arms); the eqz byte costs less than the
      // else marker + arm framing it removes.
      if (thenEmpty && thenBranch && elseBranch && !elseEmpty && Array.isArray(cond) &&
          !node.some(c => Array.isArray(c) && c[0] === 'result')) {
        return node.filter(c => c !== thenBranch && c !== elseBranch && c !== cond)
          .concat([['i32.eqz', cond], ['then', ...elseBranch.slice(1)]])
      }
    }

    // Clean out nops, drop-of-pure sequences, and empty annotations from blocks
    if (isScopeNode(node)) {
      const cleaned = [op]
      for (let i = 1; i < node.length; i++) {
        const child = node[i]
        if (child === 'nop' || (Array.isArray(child) && child[0] === 'nop')) continue
        // Stack-form `EXPR drop`: a pure EXPR drops out entirely; a bare
        // `tee X V drop` keeps just the store (`set X V`) — the dropped value
        // was the only reason it was a tee.
        const next = node[i + 1]
        const isDrop = next === 'drop' || (Array.isArray(next) && next[0] === 'drop' && next.length === 1)
        if (Array.isArray(child) && isDrop && isPure(child)) {
          i++ // skip the drop too
          continue
        }
        if (Array.isArray(child) && isDrop && child[0] === 'local.tee' && child.length === 3) {
          cleaned.push(['local.set', child[1], child[2]])
          i++ // skip the drop
          continue
        }
        cleaned.push(child)
      }
      if (cleaned.length !== node.length) return cleaned
    }
  })
}

// ==================== PEEPHOLE ====================

/** Peephole optimizations: simple algebraic identities.
 *  Every rule that DROPS an operand guards on isPure: an impure operand must still
 *  be evaluated for its side effects. The load-bearing case is a typed-array element
 *  store, whose address is a `local.tee` inside the value expression (the element's
 *  own read); dropping that operand (e.g. `(a[i] op a[i]) & 0`) would strand the
 *  store with a stale address — a silent miscompile. When impure, keep the op (it
 *  still yields the same value AND runs the operand). */
const selfFold = (val) => (a, b) => equal(a, b) && isPure(a) ? val : null
const PEEPHOLE = {
  // (local.tee $x (local.get $x)) re-stores the exact value already held — for any
  // bit pattern — so it is the bare get.
  'local.tee': (a, b) => Array.isArray(b) && b[0] === 'local.get' && b[1] === a ? b : null,
  // Self-cancelling / tautological binary ops — drop both (equal) operands.
  'i32.sub': selfFold(['i32.const', 0]),
  'i64.sub': selfFold(['i64.const', 0]),
  'i32.xor': selfFold(['i32.const', 0]),
  'i64.xor': selfFold(['i64.const', 0]),
  'i32.eq':  selfFold(['i32.const', 1]),
  'i64.eq':  selfFold(['i32.const', 1]),
  'i32.ne':  selfFold(['i32.const', 0]),
  'i64.ne':  selfFold(['i32.const', 0]),
  'i32.lt_s': selfFold(['i32.const', 0]),
  'i32.lt_u': selfFold(['i32.const', 0]),
  'i32.gt_s': selfFold(['i32.const', 0]),
  'i32.gt_u': selfFold(['i32.const', 0]),
  'i32.le_s': selfFold(['i32.const', 1]),
  'i32.le_u': selfFold(['i32.const', 1]),
  'i32.ge_s': selfFold(['i32.const', 1]),
  'i32.ge_u': selfFold(['i32.const', 1]),
  'i64.lt_s': selfFold(['i32.const', 0]),
  'i64.lt_u': selfFold(['i32.const', 0]),
  'i64.gt_s': selfFold(['i32.const', 0]),
  'i64.gt_u': selfFold(['i32.const', 0]),
  'i64.le_s': selfFold(['i32.const', 1]),
  'i64.le_u': selfFold(['i32.const', 1]),
  'i64.ge_s': selfFold(['i32.const', 1]),
  'i64.ge_u': selfFold(['i32.const', 1]),

  // Zero/all-bits absorption — drops the NON-const operand, so guard its purity.
  'i32.mul': (a, b) => {
    if (getConst(b)?.value === 0 && isPure(a)) return ['i32.const', 0]
    if (getConst(a)?.value === 0 && isPure(b)) return ['i32.const', 0]
    return null
  },
  'i64.mul': (a, b) => {
    if (getConst(b)?.value === ZERO64 && isPure(a)) return ['i64.const', 0]
    if (getConst(a)?.value === ZERO64 && isPure(b)) return ['i64.const', 0]
    return null
  },
  'i32.and': (a, b) => {
    if (equal(a, b) && isPure(b)) return a
    if (getConst(b)?.value === 0 && isPure(a)) return ['i32.const', 0]
    if (getConst(a)?.value === 0 && isPure(b)) return ['i32.const', 0]
    return null
  },
  'i64.and': (a, b) => {
    if (equal(a, b) && isPure(b)) return a
    if (getConst(b)?.value === ZERO64 && isPure(a)) return ['i64.const', 0]
    if (getConst(a)?.value === ZERO64 && isPure(b)) return ['i64.const', 0]
    return null
  },
  'i32.or': (a, b) => {
    if (equal(a, b) && isPure(b)) return a
    if (getConst(b)?.value === -1 && isPure(a)) return ['i32.const', -1]
    if (getConst(a)?.value === -1 && isPure(b)) return ['i32.const', -1]
    return null
  },
  'i64.or': (a, b) => {
    if (equal(a, b) && isPure(b)) return a
    if (getConst(b)?.value === NEG164 && isPure(a)) return ['i64.const', -1]
    if (getConst(a)?.value === NEG164 && isPure(b)) return ['i64.const', -1]
    return null
  },

  // (local.set $x (local.get $x)) → nop
  'local.set': (a, b) => Array.isArray(b) && b[0] === 'local.get' && b[1] === a ? ['nop'] : null,
}

/**
 * Apply peephole optimizations.
 * @param {Array} ast
 * @returns {Array}
 */
const peepholeNode = (node) => {
    if (!Array.isArray(node) || node.length !== 3) return
    const fn = PEEPHOLE[node[0]]
    if (!fn) return
    const result = fn(node[1], node[2])
    if (result !== null) return result
}
/** Peephole rules as a standalone pass. */
const peephole = (ast) => walkPost(ast, peepholeNode)

/**
 * Fused algebraic sweep — fold → identity → strength → peephole applied per node in
 * ONE bottom-up traversal instead of four, re-running the family on a node until it
 * stabilizes (children are final when the parent is visited, so cross-rule cascades
 * converge in-walk instead of across driver rounds). The rule set follows the same
 * option keys as the standalone passes.
 */
const SIMPLIFY = [['fold', foldNode], ['identity', identityNode], ['strength', strengthNode], ['peephole', peepholeNode]]
const SIMPLIFY_KEYS = new Set(SIMPLIFY.map(([k]) => k))
const simplify = (ast, opts) => {
  const rules = SIMPLIFY.filter(([k]) => opts[k]).map(([, f]) => f)
  if (!rules.length) return ast
  return walkPost(ast, (node) => {
    let out
    for (let i = 0, spins = 0; i < rules.length; i++) {
      const r = rules[i](out === undefined ? node : out)
      if (r !== undefined && spins++ < 10) { out = r, i = -1 } // a hit re-runs the family
    }
    return out
  })
}

// ==================== GLOBAL CONSTANT PROPAGATION ====================

/** Bytes a signed-LEB128 integer encodes to. */
const slebSize = (v) => {
  // BigInt() rejects signed hex ('-0x1', '+0x2') — strip the sign and reapply.
  let x = typeof v === 'bigint' ? v
    : typeof v === 'string' ? (v = v.replaceAll('_', ''), v[0] === '-' ? -BigInt(v.slice(1)) : BigInt(v[0] === '+' ? v.slice(1) : v))
    : BigInt(Math.trunc(Number(v) || 0))
  // Signed view of raw bits — exact natively; in-kernel the arm is dead
  // (BigInt('0x…') already arrives as the signed i64 carrier there).
  if (x > 0x7fffffffffffffffn) x = x - 0x8000000000000000n - 0x8000000000000000n
  let n = 1
  while (true) {
    const b = x & 0x7fn
    x >>= 7n
    if ((x === 0n && (b & 0x40n) === 0n) || (x === -1n && (b & 0x40n) !== 0n)) return n
    n++
  }
}
/** Encoded byte size of a constant init instruction (opcode + immediate). */
const constInstrSize = (node) => {
  if (!Array.isArray(node)) return 4
  switch (node[0]) {
    case 'i32.const': case 'i64.const': return 1 + slebSize(node[1])
    case 'f32.const': return 5
    case 'f64.const': return 9
    case 'v128.const': return 18
    default: return 4 // ref.null/ref.func/global.get — conservative
  }
}
const GLOBAL_GET_SIZE = 2 // 0x23 opcode + 1-byte globalidx (typical)

/**
 * Replace `global.get` of an immutable, const-initialised global with the
 * constant — but only when it doesn't grow the module. A `global.get` costs
 * ~2 B; an `i32.const 12345` costs 4 B; an `f64.const` costs 9 B. Naively
 * inlining a big constant read from many sites trades a few cheap reads + one
 * global decl for many fat immediates — pure bloat (and the node-count size
 * guard can't see it: same number of AST nodes). So we only propagate a global
 * when `refs·constSize ≤ refs·2 + declSize`; when every read is replaced and
 * the global isn't exported, its now-dead decl is dropped here too.
 * @param {Array} ast
 * @returns {Array}
 */
const globals = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  // Immutable globals with a constant init: name → init node.
  const constGlobals = new Map()
  const exported = new Set() // globals pinned by an export — keep the decl

  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) continue
    if (node[0] === 'export' && Array.isArray(node[2]) && node[2][0] === 'global' && typeof node[2][1] === 'string') { exported.add(node[2][1]); continue }
    if (node[0] !== 'global') continue
    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name) continue
    // (global $g (export "x") …) inline export → pinned
    if (node.some(c => Array.isArray(c) && c[0] === 'export')) exported.add(name)
    const typeSlot = node[2]
    if (Array.isArray(typeSlot) && typeSlot[0] === 'mut') continue       // mutable
    if (Array.isArray(typeSlot) && typeSlot[0] === 'import') continue    // imported
    const init = node[3]
    if (getConst(init)) constGlobals.set(name, init)
  }
  if (constGlobals.size === 0) return ast

  // Drop any global that is ever written (defensive — an immutable global can't
  // be, but a malformed module might) and tally read counts.
  const reads = new Map()
  walk(ast, (n) => {
    if (!Array.isArray(n)) return
    const ref = n[1]
    if (typeof ref !== 'string' || ref[0] !== '$') return
    if (n[0] === 'global.set') constGlobals.delete(ref)
    else if (n[0] === 'global.get') reads.set(ref, (reads.get(ref) || 0) + 1)
  })

  // Keep only globals where propagation is size-neutral or better.
  const propagate = new Set()
  for (const [name, init] of constGlobals) {
    const r = reads.get(name) || 0
    if (r === 0) continue // dead anyway — leave to treeshake
    const cs = constInstrSize(init)
    const declSize = cs + 2 // valtype + mutability byte + init expr + `end`
    const before = r * GLOBAL_GET_SIZE + declSize
    const after = r * cs + (exported.has(name) ? declSize : 0)
    if (after <= before) propagate.add(name)
  }
  if (propagate.size === 0) return ast

  walkPost(ast, (node) => {
    if (!Array.isArray(node) || node[0] !== 'global.get' || node.length !== 2) return
    if (propagate.has(node[1])) return clone(constGlobals.get(node[1]))
  })
  // Their reads are all gone now — remove the decls we're free to remove.
  for (let i = ast.length - 1; i >= 1; i--) {
    const n = ast[i]
    if (Array.isArray(n) && n[0] === 'global' && typeof n[1] === 'string' && propagate.has(n[1]) && !exported.has(n[1])) ast.splice(i, 1)
  }
  return ast
}

// ==================== LOAD/STORE OFFSET FOLDING ====================

/** Match (type.load/store (i32.add ptr (type.const N))) and fold offset */
const offset = (ast) => {
  return walkPost(ast, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]
    if (typeof op !== 'string' || (!op.endsWith('load') && !op.endsWith('store'))) return

    // Memory ops have memarg as first immediate after optional memoryidx, then operands
    // In AST form from parse: (i32.load offset=4 align=8 ptr) or (i32.load ptr)
    // Store: (i32.store offset=4 ptr val) — ptr is second-to-last, val is last
    // Load:  (i32.load offset=4 ptr)      — ptr is last
    const isStore = op.endsWith('store')

    // Find current offset from memparams
    let currentOffset = 0
    let memIdx = null
    let argStart = 1

    // Check for memory index
    if (typeof node[1] === 'string' && (node[1][0] === '$' || !isNaN(node[1]))) {
      memIdx = node[1]
      argStart = 2
    }

    // Check for memparams (offset=, align=)
    while (argStart < node.length && typeof node[argStart] === 'string' &&
           (node[argStart].startsWith('offset=') || node[argStart].startsWith('align='))) {
      if (node[argStart].startsWith('offset=')) {
        currentOffset = +node[argStart].slice(7)
      }
      argStart++
    }

    // Determine pointer index
    const ptrIdx = isStore ? node.length - 2 : node.length - 1
    const valIdx = isStore ? node.length - 1 : -1
    if (ptrIdx < argStart) return

    const ptr = node[ptrIdx]
    if (!Array.isArray(ptr) || ptr[0] !== 'i32.add' || ptr.length !== 3) return

    const a = ptr[1], b = ptr[2]
    const ca = getConst(a), cb = getConst(b)

    let base = null, addend = null
    if (ca && ca.type === 'i32') { addend = ca.value; base = b }
    else if (cb && cb.type === 'i32') { addend = cb.value; base = a }
    if (base === null || addend === null) return

    const newOffset = currentOffset + addend
    const newNode = [op]
    if (memIdx !== null) newNode.push(memIdx)
    newNode.push(`offset=${newOffset}`)
    // Preserve align if present
    let alignParam = null
    for (let i = argStart; i < ptrIdx; i++) {
      if (typeof node[i] === 'string' && node[i].startsWith('align=')) {
        alignParam = node[i]
      }
    }
    if (alignParam) newNode.push(alignParam)
    newNode.push(base)
    if (isStore) newNode.push(node[valIdx])
    return newNode
  })
}

// ==================== REDUNDANT BR REMOVAL ====================

/**
 * Remove br to a block's own label when it is the last instruction.
 * @param {Array} ast
 * @returns {Array}
 */
const unbranch = (ast) => {
  // Func names/indices whose signature has no result — their calls are stack-neutral
  // statements for the trailing-return check below.
  const voidFuncs = new Set()
  if (Array.isArray(ast) && ast[0] === 'module') {
    for (const n of ast.slice(1)) {
      if (!Array.isArray(n)) continue
      const fn = n[0] === 'func' ? n : n[0] === 'import' ? n.find(s => Array.isArray(s) && s[0] === 'func') : null
      if (!fn) continue
      // Named only: declaration order diverges from binary index under inline
      // imports, so numeric call refs are never trusted here.
      if (typeof fn[1] === 'string' && fn[1][0] === '$' &&
          !fn.some(c => Array.isArray(c) && (c[0] === 'result' || c[0] === 'type'))) voidFuncs.add(fn[1])
    }
  }
  // A statement that provably leaves nothing on the stack. `return` mid-body is fine
  // (dead tail); anything unrecognized — including bare tokens — bails the transform.
  const stackNeutral = (n) => {
    if (n === 'nop' || n === 'unreachable' || n === 'return') return true
    if (!Array.isArray(n)) return false
    const op = n[0]
    if (op === 'param' || op === 'result' || op === 'local' || op === 'type' || op === 'export') return true
    if (op === 'local.set' || op === 'global.set' || op === 'drop' || op === 'nop' || op === 'return' ||
        op === 'br' || op === 'unreachable' || op === 'memory.copy' || op === 'memory.fill' ||
        op === 'store' || op?.includes?.('.store')) return true
    if (op === 'br_if') return n.length <= 3 // (br_if l cond) — no extra value operand
    if (op === 'block' || op === 'loop' || op === 'if')
      return !n.some(c => Array.isArray(c) && c[0] === 'result')
    if (op === 'call') return voidFuncs.has(n[1])
    return false
  }
  walk(ast, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]
    // A `return` as a function's LAST instruction is the func-level twin: falling off
    // the body returns anyway, so `(return v…)` there just leaves v… as the result.
    // Sound only when every earlier statement is stack-neutral: `return` DISCARDS any
    // extra stack values, fall-through does not.
    if (op === 'func') {
      const last = node[node.length - 1]
      const isRet = last === 'return' ? 1 : Array.isArray(last) && last[0] === 'return' ? 2 : 0
      if (!isRet || !node.slice(1, -1).every(stackNeutral)) return
      // bare `return` returns the values already on the stack — elidable only for a
      // void func (a value-returning bare return implies a non-neutral producer anyway)
      if (isRet === 1) node.pop()
      else node.splice(node.length - 1, 1, ...last.slice(1))
      return
    }
    // Loops: `br $loop_label` jumps BACK to loop top (continue), not out.
    // Only `block` allows trailing-br elision because `br $block_label` exits the block.
    if (op !== 'block') return

    // Get the block's label
    let labelIdx = 1
    let label = null
    if (typeof node[1] === 'string' && node[1][0] === '$') {
      label = node[1]
      labelIdx = 2
    }
    if (!label) return

    // Find the last executable instruction (skip result/type annotations)
    let lastIdx = -1
    for (let i = node.length - 1; i >= labelIdx; i--) {
      const child = node[i]
      if (!Array.isArray(child)) {
        if (child !== 'nop' && child !== 'end') lastIdx = i
        continue
      }
      const cop = child[0]
      if (cop === 'param' || cop === 'result' || cop === 'local' || cop === 'type' || cop === 'export') continue
      lastIdx = i
      break
    }
    if (lastIdx < 0) return

    const last = node[lastIdx]
    if (Array.isArray(last) && last[0] === 'br' && last[1] === label) {
      // `(br $L v…)` as a block's last instruction just leaves v… as the block's
      // result — splice the value operand(s) in its place (none → plain removal).
      node.splice(lastIdx, 1, ...last.slice(2))
    }
  })

  return ast
}

// ==================== WHILE-LOOP CANONICALIZATION ====================

/**
 * Collapse the `while`-emit idiom into a single loop.
 *
 *   (block $A
 *     (loop $B
 *       (br_if $A (i32.eqz cond))   ;; exit when cond is false
 *       …body…
 *       (br $B)                      ;; continue
 *     ))
 *
 * becomes
 *
 *   (loop $B
 *     (if cond (then …body… (br $B))))
 *
 * Saves ~3 B per while-loop (drop the outer block framing + the `i32.eqz`,
 * trade `br_if`→`if`). Safe only when:
 *  - the block contains nothing but the loop (plus optional `type` slot),
 *  - block / loop are void (no result),
 *  - $A is never targeted from within body (only the head `br_if` uses it).
 *
 * @param {Array} ast
 * @returns {Array}
 */
const loopify = (ast) => {
  walk(ast, (node) => {
    if (!Array.isArray(node) || node[0] !== 'block') return
    let bi = 1, label = null
    if (typeof node[1] === 'string' && node[1][0] === '$') { label = node[1]; bi = 2 }
    if (!label) return
    while (bi < node.length) {
      const c = node[bi]
      if (Array.isArray(c) && c[0] === 'type') { bi++; continue }
      if (Array.isArray(c) && (c[0] === 'param' || c[0] === 'result')) return // typed → skip
      break
    }
    if (node.length - bi !== 1) return
    const loop = node[bi]
    if (!Array.isArray(loop) || loop[0] !== 'loop') return
    let li = 1, loopLabel = null
    if (typeof loop[1] === 'string' && loop[1][0] === '$') { loopLabel = loop[1]; li = 2 }
    const loopHeader = []
    while (li < loop.length) {
      const c = loop[li]
      if (Array.isArray(c) && c[0] === 'type') { loopHeader.push(c); li++; continue }
      if (Array.isArray(c) && (c[0] === 'param' || c[0] === 'result')) return // typed → skip
      break
    }
    const body = loop.slice(li)
    if (body.length < 2) return
    const head = body[0]
    const tail = body[body.length - 1]
    if (!Array.isArray(head) || head[0] !== 'br_if' || head[1] !== label || head.length !== 3) return
    if (!Array.isArray(tail) || tail[0] !== 'br' || tail[1] !== loopLabel || tail.length !== 2) return
    const inner = body.slice(1, -1)
    if (targetsLabel(inner, label)) return

    // br_if exits when `cond` is non-zero — `if`'s then-arm runs when its
    // condition is non-zero. So the if-condition is the negation. Strip a
    // wrapping `i32.eqz` if present; otherwise wrap.
    let cond = head[2]
    if (Array.isArray(cond) && cond[0] === 'i32.eqz' && cond.length === 2) cond = cond[1]
    else cond = ['i32.eqz', cond]

    const newLoop = ['loop']
    if (loopLabel) newLoop.push(loopLabel)
    for (const h of loopHeader) newLoop.push(h)
    newLoop.push(['if', cond, ['then', ...inner, tail]])

    node.length = 0
    for (const tok of newLoop) node.push(tok)
  })
  return ast
}

// ==================== STRIP MUT FROM GLOBALS ====================

/**
 * Strip mutability from globals that are never written.
 * Enables globals constant-propagation for more globals.
 * @param {Array} ast
 * @returns {Array}
 */
const stripmut = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  const written = new Set()
  walk(ast, (n) => {
    if (Array.isArray(n) && n[0] === 'global.set' && typeof n[1] === 'string') written.add(n[1])
  })

  return walkPost(ast, (node) => {
    if (!Array.isArray(node) || node[0] !== 'global') return
    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name || written.has(name)) return

    const hasName = typeof node[1] === 'string' && node[1][0] === '$'
    const typeSlot = hasName ? node[2] : node[1]
    if (Array.isArray(typeSlot) && typeSlot[0] === 'mut') {
      const newNode = [...node]
      newNode[hasName ? 2 : 1] = typeSlot[1] // replace (mut T) with T
      return newNode
    }
  })
}

// ==================== IF-THEN-BR → BR_IF ====================

/**
 * Simplify (if cond (then (br $label))) → (br_if $label cond)
 * and (if cond (then) (else (br $label))) → (br_if $label (i32.eqz cond))
 * Only when the br is the sole instruction in the arm.
 * @param {Array} ast
 * @returns {Array}
 */
// Dissolving an `if` removes one level of branch-target nesting (the if's own
// implicit label). A $name label re-resolves relative to its new depth, but a raw
// numeric (depth-relative) label goes stale and must drop by 1. Label 0 targets the
// if's own end — no equivalent exists one level up, so that shape is not rewritten.
const unnest = (l) => typeof l === 'string' && l[0] === '$' ? l : +l > 0 ? +l - 1 : null

/** Ops that can trap even when 'pure': int div/rem, float→int trunc. */
const hasTrap = (n) => {
  let t = false
  walk(n, c => { const o = Array.isArray(c) ? c[0] : c; if (typeof o === 'string' && /\.(div|rem)_[su]$|\.trunc_f/.test(o)) t = true })
  return t
}

// In TEST position (if/br_if/select condition) only non-zero-ness matters, so a
// double eqz is a no-op there: (i32.eqz (i32.eqz X)) → X. (In value contexts it
// normalizes to 0/1 and must stay.)
const untest = (c) => Array.isArray(c) && c[0] === 'i32.eqz' && Array.isArray(c[1]) && c[1][0] === 'i32.eqz' ? untest(c[1][1]) : c

const brif = (ast) => {
  return walkPost(ast, (node) => {
    // (br_if $L A) (br_if $L B) → (br_if $L (i32.or A B)) — one branch instruction
    // instead of two. B now evaluates even when A already branches, so it must be
    // pure and trap-free; evaluation order A-then-B is preserved.
    if (Array.isArray(node) && (isScopeNode(node) || node[0] === 'if')) {
      for (let i = 1; i < node.length - 1; i++) {
        const a = node[i], b = node[i + 1]
        if (Array.isArray(a) && a[0] === 'br_if' && a.length === 3 && Array.isArray(a[2]) &&
            Array.isArray(b) && b[0] === 'br_if' && b.length === 3 && b[1] === a[1] &&
            Array.isArray(b[2]) && isPure(b[2]) && !hasTrap(b[2])) {
          node.splice(i, 2, ['br_if', a[1], ['i32.or', a[2], b[2]]])
          i--
        }
      }
    }
    // double-eqz vanishes in test position
    if (Array.isArray(node)) {
      if (node[0] === 'br_if' && node.length === 3) { const c = untest(node[2]); if (c !== node[2]) node[2] = c }
      else if (node[0] === 'if') { const { condIdx, cond } = parseIf(node); const c = untest(cond); if (c !== cond) node[condIdx] = c }
      else if (node[0] === 'select' && node.length === 4) { const c = untest(node[3]); if (c !== node[3]) node[3] = c }
    }
    if (!Array.isArray(node) || node[0] !== 'if') return
    const { cond, thenBranch, elseBranch } = parseIf(node)
    const thenEmpty = !thenBranch || thenBranch.length <= 1
    const elseEmpty = !elseBranch || elseBranch.length <= 1

    // (if cond (then (br $l))) → (br_if $l cond)
    if (!thenEmpty && elseEmpty && thenBranch.length === 2) {
      const t = thenBranch[1], l = Array.isArray(t) && t[0] === 'br' && t.length === 2 && unnest(t[1])
      if (l != null && l !== false) return ['br_if', l, cond]
    }

    // (if cond (then) (else (br $l))) → (br_if $l (i32.eqz cond))
    if (thenEmpty && !elseEmpty && elseBranch.length === 2) {
      const e = elseBranch[1], l = Array.isArray(e) && e[0] === 'br' && e.length === 2 && unnest(e[1])
      if (l != null && l !== false) return ['br_if', l, ['i32.eqz', cond]]
    }
  })
}

// ==================== MERGE IDENTICAL IF ARMS ====================

/**
 * Fold identical trailing code out of if/else arms.
 * (if cond (then A X) (else B X)) → (if cond (then A) (else B)) X
 * @param {Array} ast
 * @returns {Array}
 */
const foldarms = (ast) => {
  return walkPost(ast, (node) => {
    if (!Array.isArray(node) || node[0] !== 'if') return
    const { thenBranch, elseBranch } = parseIf(node)
    if (!thenBranch || !elseBranch) return
    if (thenBranch.length <= 1 || elseBranch.length <= 1) return

    // Only fold when the if has an explicit result type.
    // Without a result annotation the branches are void; hoisting a suffix
    // like `drop` can expose a value and leave the if branches ill-typed.
    const hasResult = node.some(c => Array.isArray(c) && c[0] === 'result')
    if (!hasResult) return

    let common = 0
    const minLen = Math.min(thenBranch.length, elseBranch.length)
    for (let i = 1; i < minLen; i++) {
      if (!equal(thenBranch[thenBranch.length - i], elseBranch[elseBranch.length - i])) break
      common++
    }
    if (common === 0) return

    const hoisted = thenBranch.slice(thenBranch.length - common)
    const newThen = thenBranch.slice(0, thenBranch.length - common)
    const newElse = elseBranch.slice(0, elseBranch.length - common)

    const block = ['block']
    for (let i = 1; i < node.length; i++) {
      const c = node[i]
      if (Array.isArray(c) && (c[0] === 'then' || c[0] === 'else')) break
      if (Array.isArray(c) && (c[0] === 'result' || c[0] === 'type')) block.push(c)
    }

    // Inner if becomes void: the result/type annotation now lives on the outer block,
    // since the value-producing trailing instructions have moved there. Without
    // stripping, the inner (if (result f64)) claims to produce f64 from branches
    // whose trailing value-producing instructions just got hoisted out — invalid.
    const newIf = ['if']
    for (let i = 1; i < node.length; i++) {
      const c = node[i]
      if (Array.isArray(c) && (c[0] === 'then' || c[0] === 'else')) break
      if (Array.isArray(c) && (c[0] === 'result' || c[0] === 'type')) continue
      newIf.push(c)
    }
    newIf.push(newThen.length > 1 ? newThen : ['then'])
    newIf.push(newElse.length > 1 ? newElse : ['else'])

    block.push(newIf, ...hoisted)
    return block
  })
}

// ==================== DUPLICATE FUNCTION ELIMINATION ====================

/**
 * Fast structural hash for a function node, normalizing local names.
 * Uses a stack-based walk to avoid expensive JSON.stringify.
 */
const hashFunc = (node, localNames) => {
  const parts = []
  const stack = [node]
  while (stack.length) {
    const v = stack.pop()
    if (Array.isArray(v)) {
      if (v[0] === 'export') continue // export names are identity, not body
      stack.push('|')
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i])
      stack.push('[')
    } else if (typeof v === 'string') {
      const t = localNames.get ? localNames.get(v) : localNames.has(v) ? '$__L' : undefined
      // a bare-numeric ref right after a local op is the same slot as its named twin
      parts.push(t ?? ((parts[parts.length - 1] === 'local.get' || parts[parts.length - 1] === 'local.set' || parts[parts.length - 1] === 'local.tee') && v !== '' && !isNaN(v) ? 'L' + +v : v))
    } else if (typeof v === 'bigint') {
      parts.push(v.toString() + 'n')
    } else if (typeof v === 'number') {
      parts.push(v.toString())
    } else if (v === null) {
      parts.push('null')
    } else if (v === true) {
      parts.push('t')
    } else if (v === false) {
      parts.push('f')
    } else {
      parts.push(String(v))
    }
  }
  return parts.join(',')
}

/**
 * Eliminate duplicate functions by hashing bodies.
 * Keeps the first occurrence and redirects all references to it.
 * @param {Array} ast
 * @returns {Array}
 */
const dedupe = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  // Hash function bodies (normalize local/param names to avoid false negatives)
  const signatures = new Map() // hash → canonical $name
  const redirects = new Map()  // duplicate $name → canonical $name

  for (const node of ast.slice(1)) {
    if (!Array.isArray(node) || node[0] !== 'func') continue
    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name) continue

    // Canonical positional identity: params/locals map to their INDEX ('L0', 'L1'…
    // — bare-numeric refs land on the same tokens), labels to first-occurrence
    // order ('B0'…), the func's own name to 'F'. Positional tokens make the hash a
    // faithful canonical form: same string ⇔ structurally equivalent modulo naming
    // (the old single-token collapse hashed (sub $a $b) equal to (sub $b $a)).
    // Declarations leave the body hash and return as a positional type vector, so
    // a named-decl clone matches its unnamed twin.
    const canon = new Map([[name, 'F']])
    const types = []
    let li = 0, bi = 0
    const body = ['func']
    for (let i = 2; i < node.length; i++) {
      const c = node[i]
      if (Array.isArray(c) && (c[0] === 'param' || c[0] === 'local')) {
        if (typeof c[1] === 'string' && c[1][0] === '$') { canon.set(c[1], 'L' + li++); types.push(c[0] === 'param' ? 'p' + c[2] : c[2]) }
        else for (let k = 1; k < c.length; k++) { types.push(c[0] === 'param' ? 'p' + c[k] : c[k]); li++ }
      }
      else body.push(c)
    }
    walk(node, (n) => {
      if (Array.isArray(n) && isBranchScope(n[0]) && typeof n[1] === 'string' && n[1][0] === '$' && !canon.has(n[1])) canon.set(n[1], 'B' + bi++)
    })
    const hash = types.join(' ') + '#' + hashFunc(body, canon)

    if (signatures.has(hash)) {
      redirects.set(name, signatures.get(hash))
    } else {
      signatures.set(hash, name)
    }
  }

  if (redirects.size === 0) return ast

  // A duplicate's inline exports move to standalone exports of the canonical —
  // the husk loses its pin and treeshake collects it next sweep.
  for (const node of ast.slice(1)) {
    if (!Array.isArray(node) || node[0] !== 'func') continue
    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name || !redirects.has(name)) continue
    for (let i = node.length - 1; i >= 2; i--) {
      if (Array.isArray(node[i]) && node[i][0] === 'export') {
        ast.push(['export', node[i][1], ['func', redirects.get(name)]])
        node.splice(i, 1)
      }
    }
  }

  // Rewrite all references: calls, ref.func, elem segments, call_indirect type
  walkPost(ast, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]
    if ((op === 'call' || op === 'return_call') && redirects.has(node[1])) {
      return [op, redirects.get(node[1]), ...node.slice(2)]
    }
    if (op === 'ref.func' && redirects.has(node[1])) {
      return ['ref.func', redirects.get(node[1])]
    }
    if (op === 'elem') {
      return node.map(p => typeof p === 'string' && redirects.has(p) ? redirects.get(p) : p)
    }
    if (op === 'start' && redirects.has(node[1])) return ['start', redirects.get(node[1])]
    if (op === 'export' && Array.isArray(node[2]) && node[2][0] === 'func' && redirects.has(node[2][1])) {
      return ['export', node[1], ['func', redirects.get(node[2][1])]]
    }
    if (op === 'call_indirect' && node.length >= 3) {
      const typeRef = node[1]
      if (typeof typeRef === 'string' && redirects.has(typeRef)) {
        return ['call_indirect', redirects.get(typeRef), ...node.slice(2)]
      }
    }
  })

  return ast
}

// ==================== TYPE DEDUPLICATION ====================

/**
 * Merge structurally identical (type ...) definitions.
 * Keeps the first occurrence and redirects all references.
 * @param {Array} ast
 * @returns {Array}
 */
const dedupTypes = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  const signatures = new Map() // hash → canonical $name
  const redirects = new Map()  // duplicate $name → canonical $name

  for (const node of ast.slice(1)) {
    if (!Array.isArray(node) || node[0] !== 'type') continue
    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name) continue

    // Hash the type body, normalizing only the type's own name
    const hash = hashFunc(node, new Set([name]))

    if (signatures.has(hash)) {
      redirects.set(name, signatures.get(hash))
    } else {
      signatures.set(hash, name)
    }
  }

  if (redirects.size === 0) return ast

  // Remove duplicate type nodes
  for (let i = ast.length - 1; i >= 0; i--) {
    const node = ast[i]
    if (Array.isArray(node) && node[0] === 'type') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
      if (name && redirects.has(name)) ast.splice(i, 1)
    }
  }

  walkPost(ast, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]

    // (func $f (type $t) ...)
    if (op === 'func') {
      for (let i = 1; i < node.length; i++) {
        const sub = node[i]
        if (Array.isArray(sub) && sub[0] === 'type' && typeof sub[1] === 'string' && redirects.has(sub[1])) {
          node[i] = ['type', redirects.get(sub[1])]
        }
      }
    }

    // (import "m" "n" (func (type $t)))
    if (op === 'import') {
      for (let i = 1; i < node.length; i++) {
        const sub = node[i]
        if (Array.isArray(sub)) {
          for (let j = 1; j < sub.length; j++) {
            const inner = sub[j]
            if (Array.isArray(inner) && inner[0] === 'type' && typeof inner[1] === 'string' && redirects.has(inner[1])) {
              sub[j] = ['type', redirects.get(inner[1])]
            }
          }
        }
      }
    }

    // call_indirect $t  or  (call_indirect (type $t) ...)
    if (op === 'call_indirect' || op === 'return_call_indirect') {
      if (typeof node[1] === 'string' && redirects.has(node[1])) {
        return [op, redirects.get(node[1]), ...node.slice(2)]
      }
      if (Array.isArray(node[1]) && node[1][0] === 'type' && typeof node[1][1] === 'string' && redirects.has(node[1][1])) {
        return [op, ['type', redirects.get(node[1][1])], ...node.slice(2)]
      }
    }
  })

  return ast
}

// ==================== DATA SEGMENT PACKING ====================

/** Parse a WAT data string literal into a plain byte array. Plain arrays —
 *  not Uint8Array — throughout the data codecs: typed-array views/methods have
 *  spotty native lowerings (subarray dispatches to the HOST, in-situ variable-
 *  index reads misread in the kernel), while plain number arrays are the
 *  optimizer's lingua franca and proven kernel-faithful. */
const parseDataString = (str) => {
  if (typeof str !== 'string' || str.length < 2 || str[0] !== '"') return []
  const bytes = []
  // Hex digit value by char code, −1 for non-hex — pure number math (no
  // regex/slice/parseInt on string views; see contract note above).
  const hexv = (c) => c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1
  const end = str.length - 1   // skip surrounding quotes
  for (let i = 1; i < end; i++) {
    const c = str.charCodeAt(i)
    if (c !== 92) { bytes.push(c); continue }
    const n = str.charCodeAt(++i)
    if (n === 120 || n === 88) {        // \xHH
      bytes.push((hexv(str.charCodeAt(i + 1)) << 4) | hexv(str.charCodeAt(i + 2)))
      i += 2
    } else {
      const h1 = hexv(n), h2 = i + 1 < end ? hexv(str.charCodeAt(i + 1)) : -1
      if (h1 >= 0 && h2 >= 0) { bytes.push((h1 << 4) | h2); i++ }
      else if (n === 110) bytes.push(10)       // \n
      else if (n === 116) bytes.push(9)        // \t
      else if (n === 114) bytes.push(13)       // \r
      else bytes.push(n)                       // \\ \" and any other escaped char
    }
  }
  return bytes
}

/** Encode a plain byte array as a WAT data string literal; `end` bounds the
 *  bytes (always passed explicitly — see parseDataString's contract note).
 *  (`b` comes from a plain-array element read, i.e. an untyped receiver — the
 *  `.toString(16)` here is exactly the dispatch the tryRuntimeNumberMethod /
 *  runtime-string-fork number arm exists for; it used to yield `undefined`
 *  in-kernel and zeroed every escaped byte of the emitted data segment.) */
const encodeDataString = (bytes, end) => {
  let str = '"'
  for (let i = 0; i < end; i++) {
    const b = bytes[i]
    if (b >= 32 && b < 127 && b !== 34 && b !== 92) str += String.fromCharCode(b)
    else str += '\\' + b.toString(16).padStart(2, '0')
  }
  return str + '"'
}

/** Trim trailing zeros from data content items. Per-byte pushes (never
 *  push(...spread) — a segment can be hundreds of KB and spreading overflows
 *  V8's argument stack; never Uint8Array — see parseDataString's note). */
const trimTrailingZeros = (items) => {
  const bytes = []
  for (const item of items) {
    if (typeof item === 'string') {
      const chunk = parseDataString(item)
      for (let i = 0; i < chunk.length; i++) bytes.push(chunk[i])
    } else if (Array.isArray(item) && item[0] === 'i8') {
      for (let i = 1; i < item.length; i++) bytes.push(Number(item[i]) & 0xff)
    } else {
      return items // non-trimmable item
    }
  }
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end--
  if (end === bytes.length) return items
  if (end === 0) return []
  return [encodeDataString(bytes, end)]
}

/** Extract { memidx, offset } from an active data segment with constant offset */
const getDataOffset = (node) => {
  let idx = 1
  if (typeof node[idx] === 'string' && node[idx][0] === '$') idx++
  if (Array.isArray(node[idx]) && node[idx][0] === 'memory') {
    const mem = node[idx][1]
    idx++
    const off = node[idx]
    if (Array.isArray(off) && (off[0] === 'i32.const' || off[0] === 'i64.const')) {
      return { memidx: mem, offset: Number(off[1]) }
    }
    return null
  }
  const off = node[idx]
  if (Array.isArray(off) && (off[0] === 'i32.const' || off[0] === 'i64.const')) {
    return { memidx: 0, offset: Number(off[1]) }
  }
  return null
}

/** Get byte length of data segment content */
const getDataLength = (node) => {
  let idx = 1
  if (typeof node[idx] === 'string' && node[idx][0] === '$') idx++
  if (Array.isArray(node[idx]) && node[idx][0] === 'memory') idx++
  if (Array.isArray(node[idx]) && typeof node[idx][0] === 'string' && !node[idx][0].startsWith('"')) idx++
  let len = 0
  for (let i = idx; i < node.length; i++) {
    const item = node[i]
    if (typeof item === 'string') len += parseDataString(item).length
    else if (Array.isArray(item) && item[0] === 'i8') len += item.length - 1
    else return null
  }
  return len
}

/** Merge segment b into a (consecutive offsets, same memory) */
const mergeDataSegments = (a, b) => {
  let aIdx = 1
  if (typeof a[aIdx] === 'string' && a[aIdx][0] === '$') aIdx++
  if (Array.isArray(a[aIdx]) && a[aIdx][0] === 'memory') aIdx++
  if (Array.isArray(a[aIdx]) && typeof a[aIdx][0] === 'string' && !a[aIdx][0].startsWith('"')) aIdx++

  let bIdx = 1
  if (typeof b[bIdx] === 'string' && b[bIdx][0] === '$') bIdx++
  if (Array.isArray(b[bIdx]) && b[bIdx][0] === 'memory') bIdx++
  if (Array.isArray(b[bIdx]) && typeof b[bIdx][0] === 'string' && !b[bIdx][0].startsWith('"')) bIdx++

  const aContent = a.slice(aIdx)
  const bContent = b.slice(bIdx)

  if (aContent.length === 1 && bContent.length === 1 &&
      typeof aContent[0] === 'string' && typeof bContent[0] === 'string') {
    const aBytes = parseDataString(aContent[0])
    const bBytes = parseDataString(bContent[0])
    for (let i = 0; i < bBytes.length; i++) aBytes.push(bBytes[i])
    a.length = aIdx
    a.push(encodeDataString(aBytes, aBytes.length))
    return true
  }

  a.length = aIdx
  a.push(...aContent, ...bContent)
  return true
}

/**
 * Pack data segments: trim trailing zeros and merge adjacent constant-offset segments.
 * @param {Array} ast
 * @returns {Array}
 */
const packData = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  // Trim trailing zeros
  for (const node of ast) {
    if (!Array.isArray(node) || node[0] !== 'data') continue
    let contentStart = 1
    if (typeof node[1] === 'string' && node[1][0] === '$') contentStart = 2
    if (contentStart < node.length && Array.isArray(node[contentStart]) &&
        typeof node[contentStart][0] === 'string' && !node[contentStart][0].startsWith('"')) {
      contentStart++
    }
    const content = node.slice(contentStart)
    if (content.length === 0) continue
    const trimmed = trimTrailingZeros(content)
    if (trimmed.length !== content.length || (trimmed.length > 0 && trimmed[0] !== content[0])) {
      node.length = contentStart
      node.push(...trimmed)
    }
  }

  // Merge adjacent active segments with same memory and consecutive offsets
  const dataNodes = []
  for (let i = 0; i < ast.length; i++) {
    const node = ast[i]
    if (Array.isArray(node) && node[0] === 'data') {
      const info = getDataOffset(node)
      if (info) {
        const len = getDataLength(node)
        if (len !== null) dataNodes.push({ ...info, node, index: i, len })
      }
    }
  }

  dataNodes.sort((a, b) => {
    const ma = String(a.memidx), mb = String(b.memidx)
    if (ma !== mb) return ma.localeCompare(mb)
    return a.offset - b.offset
  })

  const toRemove = new Set()
  for (let i = 0; i < dataNodes.length - 1; i++) {
    const a = dataNodes[i]
    const b = dataNodes[i + 1]
    if (toRemove.has(a.index) || String(a.memidx) !== String(b.memidx)) continue
    if (a.offset + a.len !== b.offset) continue
    if (mergeDataSegments(a.node, b.node)) {
      toRemove.add(b.index)
      a.len = getDataLength(a.node)
    }
  }

  if (toRemove.size > 0) {
    ast = ast.filter((_, i) => !toRemove.has(i))
  }

  // Split active segments at long interior zero runs and shift leading zeros into
  // the offset — unwritten memory is zero-initialized anyway. Sound only when no
  // instruction references data indices (splitting renumbers segments) and no
  // memory is imported (an import's pre-existing bytes must be overwritten, not
  // skipped). Named segments are left whole (a name implies index identity).
  let refsData = false, importedMem = false
  walk(ast, n => {
    const op = Array.isArray(n) ? n[0] : n
    if (op === 'memory.init' || op === 'data.drop' || op === 'array.new_data' || op === 'array.init_data') refsData = true
    if (!Array.isArray(n)) return
    if ((op === 'import' || op === 'memory') && n.some(s => Array.isArray(s) && (s[0] === 'memory' || s[0] === 'import'))) importedMem = true
  })
  if (refsData || importedMem) return ast

  const out = []
  for (const node of ast) {
    if (!Array.isArray(node) || node[0] !== 'data' || (typeof node[1] === 'string' && node[1][0] === '$')) { out.push(node); continue }
    let idx = 1
    const mem = Array.isArray(node[idx]) && node[idx][0] === 'memory' ? node[idx++] : null
    const off = node[idx]
    if (!Array.isArray(off) || (off[0] !== 'i32.const' && off[0] !== 'i64.const')) { out.push(node); continue }
    const items = node.slice(idx + 1)
    if (!items.length || !items.every(s => typeof s === 'string')) { out.push(node); continue }
    const bytes = items.flatMap(parseDataString)
    const base = Number(off[1])
    // collect [start, end) pieces separated by zero runs longer than the cost of a
    // fresh segment header (mode + offset expr + end + length prefix)
    const pieces = []
    let s = -1
    for (let i = 0; i <= bytes.length; i++) {
      if (i < bytes.length && bytes[i] !== 0) { s < 0 && (s = i); continue }
      if (s < 0) continue
      // extend over short zero runs: find next nonzero
      let j = i
      while (j < bytes.length && bytes[j] === 0) j++
      const segCost = 4 + slebSize(base + j) + 1
      if (j - i > segCost || j >= bytes.length) pieces.push([s, i]), s = -1
      i = j - 1
    }
    if (!pieces.length) continue // all zeros — segment is a no-op, drop it
    if (pieces.length === 1 && pieces[0][0] === 0 && pieces[0][1] === bytes.length) { out.push(node); continue }
    for (const [ps, pe] of pieces) {
      const head = mem ? ['data', mem] : ['data']
      out.push([...head, [off[0], String(base + ps)], encodeDataString(bytes.slice(ps), pe - ps)])
    }
  }
  return out
}

// ==================== IMPORT FIELD MINIFICATION ====================

/** Create a shortener that maps names to a, b, ..., z, aa, ab, ... */
const makeShortener = () => {
  const map = new Map()
  let n = 0
  return (name) => {
    if (!map.has(name)) {
      let id = '', x = n++
      do {
        id = String.fromCharCode(97 + (x % 26)) + id
        x = Math.floor(x / 26) - 1
      } while (x >= 0)
      map.set(name, id || 'a')
    }
    return map.get(name)
  }
}

/**
 * Minify import module and field names for smaller binaries.
 * Only safe when you control the host environment.
 * @param {Array} ast
 * @returns {Array}
 */
const minifyImports = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast
  const shortMod = makeShortener()
  const shortField = makeShortener()

  for (const node of ast) {
    if (!Array.isArray(node) || node[0] !== 'import') continue
    if (typeof node[1] === 'string' && node[1][0] === '"') {
      node[1] = '"' + shortMod(node[1].slice(1, -1)) + '"'
    }
    if (typeof node[2] === 'string' && node[2][0] === '"') {
      node[2] = '"' + shortField(node[2].slice(1, -1)) + '"'
    }
  }

  return ast
}

// ==================== REORDER FUNCTIONS ====================

/**
 * Count direct calls and sort functions so hot ones come first.
 * Smaller LEB128 indices for frequent calls reduce binary size.
 * Imports must stay before defined functions to preserve the index space.
 * @param {Array} ast
 * @returns {Array}
 */
/** True iff every defined func has a $name and every func reference is by $name */
const reorderSafe = (ast) => {
  let safe = true
  walk(ast, (n) => {
    if (!safe || !Array.isArray(n)) return
    const op = n[0]
    if (op === 'func' && (typeof n[1] !== 'string' || n[1][0] !== '$')) safe = false
    else if ((op === 'call' || op === 'return_call' || op === 'ref.func') &&
             (typeof n[1] !== 'string' || n[1][0] !== '$')) safe = false
    else if (op === 'start' && (typeof n[1] !== 'string' || n[1][0] !== '$')) safe = false
    else if (op === 'elem') {
      // Numeric func indices in elem segments would break too
      for (const sub of n) {
        if (typeof sub === 'string' && sub[0] !== '$' && /^\d/.test(sub)) { safe = false; break }
        if (Array.isArray(sub) && sub[0] === 'ref.func' &&
            (typeof sub[1] !== 'string' || sub[1][0] !== '$')) { safe = false; break }
      }
    }
  })
  return safe
}

const reorder = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast
  // Sorting changes the function index space. Skip if any reference is numeric,
  // since we'd silently retarget unnamed callers/start/elem entries.
  if (!reorderSafe(ast)) return ast

  const callCounts = new Map()
  walk(ast, (n) => {
    if (!Array.isArray(n)) return
    if (n[0] === 'call' || n[0] === 'return_call') {
      callCounts.set(n[1], (callCounts.get(n[1]) || 0) + 1)
    }
  })

  // Imports must precede defined funcs (compile.js assigns indices in AST order).
  const imports = [], funcs = [], others = []
  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) { others.push(node); continue }
    if (node[0] === 'import') imports.push(node)
    else if (node[0] === 'func') funcs.push(node)
    else others.push(node)
  }

  funcs.sort((a, b) => (callCounts.get(b[1]) || 0) - (callCounts.get(a[1]) || 0))
  return ['module', ...imports, ...funcs, ...others]
}

// ==================== LOOP-INVARIANT CODE MOTION ====================

/**
 * licm — hoist loop-invariant PURE, NON-TRAPPING value expressions out of loops into
 * fresh locals computed once before the loop. The mechanical half of LICM: no alias
 * analysis, so memory loads and calls are never hoisted; only arithmetic/compare/
 * select/conversion/SIMD subtrees whose leaves are constants, loop-unwritten locals,
 * or immutable globals. Hoisting is speculation-safe (an `if`-arm expression now runs
 * every entry, a zero-trip loop runs it once) because every whitelisted op is pure and
 * cannot trap — trapping ops (int div/rem, non-saturating float→int trunc) and effects
 * (loads/stores/calls/tees) are excluded, so the only cost is wasted work, never a
 * changed result. Identical hoists within one loop share one local (loop-level CSE —
 * repeated `f64x2.splat (f64.const C)` broadcasts collapse to a single set).
 *
 * Runs ONCE after the rounds (like `inline`): the invariants worth hoisting only exist
 * after inlineOnce/inline splice callee bodies into the loop, and a later `propagate`
 * round would forward a single-use hoist straight back into the loop, undoing it.
 * Opt-in (speed-for-size: new locals + sets grow the binary slightly).
 *
 * Loops are processed innermost-first; a hoisted inner set whose RHS is invariant to
 * the outer loop hoists again on the outer pass (the RHS is a value position of the
 * set), cascading multi-level invariants outward one level per enclosing loop.
 */
// Pure & non-trapping op test. v128/SIMD ops are all non-trapping except memory ops;
// scalar arithmetic is safe except int div/rem (trap on 0/overflow) and the trapping
// float→int truncations (`iNN.trunc_fMM_x`; the `trunc_sat` forms saturate instead).
const licmPure = (op) => {
  if (typeof op !== 'string') return false
  if (op === 'select') return true
  if (/^(v128|[if](8x16|16x8|32x4|64x2))\./.test(op)) return !/\.(load|store)/.test(op)
  if (!/^[if](32|64)\./.test(op) && !/^f(32|64)\./.test(op)) return false
  if (/\.(load|store)/.test(op)) return false
  if (/\.(div_[su]|rem_[su])$/.test(op)) return false
  if (/^i(32|64)\.trunc_f/.test(op) && !op.includes('trunc_sat')) return false
  return true
}

const licm = (ast) => {
  for (const func of ast) {
    if (!Array.isArray(func) || func[0] !== 'func') continue

    // Local/param types (for typing hoisted expressions through local.get leaves).
    const localTypes = new Map()
    let declEnd = 1   // insertion point for fresh (local …) decls: after params/result/locals
    for (let i = 1; i < func.length; i++) {
      const c = func[i]
      if (!Array.isArray(c)) { if (typeof c === 'string' && c[0] === '$') declEnd = i + 1; continue }
      if (c[0] === 'param' || c[0] === 'local') {
        if (typeof c[1] === 'string' && c[1][0] === '$') localTypes.set(c[1], c[2])
        declEnd = i + 1
      } else if (c[0] === 'result' || c[0] === 'export' || c[0] === 'type') declEnd = i + 1
      else break
    }

    // Immutable module globals: declared without (mut …) — reads are invariant everywhere.
    const immutGlobals = new Set()
    for (const g of ast) {
      if (!Array.isArray(g)) continue
      if (g[0] === 'global' && typeof g[1] === 'string' && !g.some(c => Array.isArray(c) && c[0] === 'mut')) immutGlobals.add(g[1])
      if (g[0] === 'import') { const d = g[g.length - 1]; if (Array.isArray(d) && d[0] === 'global' && typeof d[1] === 'string' && !d.some(c => Array.isArray(c) && c[0] === 'mut')) immutGlobals.add(d[1]) }
    }

    // Result type of a hoistable subtree (null ⇒ untypeable ⇒ don't hoist).
    const typeOf = (n) => {
      if (!Array.isArray(n)) return null
      const op = n[0]
      if (op === 'select') return typeOf(n[1])
      if (op === 'local.get') return localTypes.get(n[1]) ?? null
      if (/\.extract_lane/.test(op)) { const p = op.slice(0, op.indexOf('.')); return p === 'f64x2' ? 'f64' : p === 'f32x4' ? 'f32' : p === 'i64x2' ? 'i64' : 'i32' }
      if (/^(v128|[if](8x16|16x8|32x4|64x2))\./.test(op)) return op.endsWith('any_true') || op.endsWith('all_true') || op.endsWith('bitmask') ? 'i32' : 'v128'
      return resultType(op)
    }

    let minted = 0
    const freshName = () => {
      let n
      do { n = `$__licm${minted++}` } while (localTypes.has(n))
      return n
    }
    const newDecls = []

    const processLoop = (loop, parent, idx) => {
      // Only hoist when the loop sits in a statement list we can splice into.
      const pop = Array.isArray(parent) ? parent[0] : null
      if (pop !== 'func' && pop !== 'block' && pop !== 'loop' && pop !== 'then' && pop !== 'else') return

      // Loop effect summary: the write-set of locals, and whether globals stay stable.
      const writes = new Set()
      let hasCall = false, hasGlobalSet = false
      walk(loop, (n) => {
        if (!Array.isArray(n)) return
        const op = n[0]
        if ((op === 'local.set' || op === 'local.tee') && typeof n[1] === 'string') writes.add(n[1])
        else if (op === 'global.set') hasGlobalSet = true
        else if (op === 'call' || op === 'call_indirect' || op === 'call_ref' || op === 'return_call' || op === 'return_call_indirect') hasCall = true
      })

      // Invariant: every node in the subtree is a const, an unwritten local, a stable
      // global read, or a whitelisted pure op. Non-array children of whitelisted ops
      // are immediates (lane indices, shuffle masks, v128.const payload) — allowed.
      const inv = (n) => {
        if (!Array.isArray(n)) return false
        const op = n[0]
        if (typeof op !== 'string') return false
        if (op.endsWith('.const')) return true
        if (op === 'local.get') return typeof n[1] === 'string' && !writes.has(n[1])
        if (op === 'global.get') return typeof n[1] === 'string' && (immutGlobals.has(n[1]) || (!hasGlobalSet && !hasCall))
        if (!licmPure(op)) return false
        for (let i = 1; i < n.length; i++) if (Array.isArray(n[i]) && !inv(n[i])) return false
        return true
      }
      // Cost gate: ≥2 real ops (consts/gets free) — hoisting a lone add trades a local
      // for one op and mostly just grows the binary; a guard pair or splat-chain pays.
      const opCount = (n) => {
        if (!Array.isArray(n)) return 0
        const op = n[0]
        let c = (typeof op === 'string' && !op.endsWith('.const') && op !== 'local.get') ? 1 : 0
        for (let i = 1; i < n.length; i++) c += opCount(n[i])
        return c
      }

      const hoisted = []            // [ ['local.set', name, expr] … ]
      const byKey = new Map()       // stringified expr → local name (dedupe within this loop)
      const tryHoist = (node, par, i) => {
        if (!Array.isArray(node)) return
        const op = node[0]
        // Never lift a bare statement/decl; only value expressions match the pure set.
        // Cost gate: ≥2 real ops — except a v128 SPLAT root, worth hoisting even alone: a
        // broadcast re-materialized per iteration occupies a vector unit + widens live ranges
        // (the colorpq 1M-iteration splat(coeff) recompute), where scalar 1-op trees are
        // register-trivial and V8 folds them anyway.
        const isSplat = typeof node[0] === 'string' && node[0].endsWith('.splat')
        if (inv(node) && (opCount(node) >= 2 || isSplat)) {
          const ty = typeOf(node)
          if (ty) {
            let key
            try { key = JSON.stringify(node) } catch { key = null }
            let name = key != null ? byKey.get(key) : undefined
            if (name === undefined) {
              name = freshName()
              localTypes.set(name, ty)
              newDecls.push(['local', name, ty])
              hoisted.push(['local.set', name, node])
              if (key != null) byKey.set(key, name)
            }
            par[i] = ['local.get', name]
            return
          }
        }
        for (let i2 = 1; i2 < node.length; i2++) tryHoist(node[i2], node, i2)
      }
      for (let i = 1; i < loop.length; i++) if (Array.isArray(loop[i])) tryHoist(loop[i], loop, i)
      if (hoisted.length) parent.splice(idx, 0, ...hoisted)
    }

    // Innermost-first: recurse before processing, and track (parent, idx) for splicing.
    // Indices shift as hoists are spliced in — iterate by live position.
    const visit = (parent) => {
      for (let i = 1; i < parent.length; i++) {
        const n = parent[i]
        if (!Array.isArray(n)) continue
        visit(n)
        if (n[0] === 'loop') { const before = parent.length; processLoop(n, parent, i); i += parent.length - before }
      }
    }
    visit(func)
    if (newDecls.length) func.splice(declEnd, 0, ...newDecls)
  }
  return ast
}

// ==================== MAIN ====================

/**
 * Optimization passes, in the order they run within each round. Each entry is
 * `[optionKey, fn, defaultOn, doc]` — the single source of truth that the
 * dispatch loop, the `OPTS` catalogue, and `normalize` all derive from.
 * Passes that are off by default can bloat output or are expensive — opt-in.
 */
const PASSES = [
  ['stripmut',      stripmut,       true,  'strip mut from never-written globals'],
  ['globals',       globals,        true,  'propagate immutable global constants'],
  ['guardRefine',   guardRefine,    false, 'fold NaN-box tag reads under dominating tag guards (jz NaN-box-specific; opt-in)'],
  ['fold',          fold,           true,  'constant folding'],
  ['identity',      identity,       true,  'remove identity ops (x + 0 → x)'],
  ['peephole',      peephole,       true,  'x-x→0, x&0→0, etc.'],
  ['strength',      strength,       true,  'strength reduction (x * 2 → x << 1)'],
  ['branch',        branch,         true,  'simplify constant branches'],
  ['propagate',     propagate,      true,  'forward-propagate single-use locals & tiny consts (never inflates)'],
  ['merge',         mergeLocals,    true,  'merge alias locals written once by the same set(tee) value'],
  ['macro',         inlineMacro,    true,  'expand single-expression functions at call sites (positional, zero wrapper)'],
  ['spec',          specializeParams, true, 'drop parameters every call site passes the same constant'],
  ['devirt',        devirt,         false, 'call_indirect with a constant or known closure-const index → direct/guarded calls — grows bytes for speed'],
  ['dedupe',        dedupe,         true,  'eliminate duplicate functions (before inlineOnce dissolves identical single-caller helpers)'],
  ['inlineOnce',    inlineOnce,     true,  'inline single-call functions into their lone caller (never duplicates)'],
  ['inline',        inline,         false, 'inline tiny functions — can duplicate bodies'],
  ['licm',          licm,           false, 'hoist loop-invariant pure arithmetic out of loops — adds locals (speed-for-size); runs once after rounds'],
  ['offset',        offset,         true,  'fold add+const into load/store offset'],
  ['cse',           cse,            true,  'reuse repeated pure subexpressions via a tee\'d local — runs once after rounds (byte-profit gated)'],
  ['unbranch',      unbranch,       true,  'remove redundant br at end of own block'],
  ['loopify',       loopify,        true,  'collapse block+loop+brif while-idiom into loop+if'],
  ['brif',          brif,           true,  'if-then-br → br_if'],
  ['tailmerge',     tailmerge,      true,  'share byte-identical early-exit epilogues via block + br_if'],
  ['foldarms',      foldarms,       false, 'merge identical trailing if arms — can add block wrapper'],
  ['deadcode',      deadcode,       true,  'eliminate dead code after unreachable/br/return'],
  ['vacuum',        vacuum,         true,  'remove nops, drop-of-pure, empty branches'],
  ['mergeBlocks',   mergeBlocks,    true,  'unwrap `(block $L …)` whose label is never targeted'],
  ['coalesce',      coalesceLocals, true,  'share local slots between same-type non-overlapping locals'],
  ['locals',        localReuse,     true,  'remove unused locals'],
  ['dedupTypes',    dedupTypes,     true,  'merge identical type definitions'],
  ['packData',      packData,       true,  'trim trailing zeros, merge adjacent data segments'],
  ['reorder',       reorder,        false, 'put hot functions first — no AST reduction'],
  ['treeshake',     treeshake,      true,  'remove unused funcs/globals/types/tables'],
  ['minifyImports', minifyImports,  false, 'shorten import names — enable only when you control the host'],
]

/** Option name → default-on map — the public catalogue of passes. */
const OPTS = Object.fromEntries(PASSES.map(p => [p[0], p[2]]))

/**
 * Normalize options to a { passName: bool } map. An explicit object is kept
 * as-is (preserving `log`/`verbose`), with any unmentioned pass filled to its
 * default; `true` selects the defaults; a string selects only the named
 * passes (or all of them via `'all'`).
 *
 * @param {boolean|string|Object} opts
 * @returns {Object}
 */
const normalize = (opts) => {
  if (opts === false) return {}
  if (opts !== true && typeof opts !== 'string') {
    const m = { ...opts }
    for (const p of PASSES) if (m[p[0]] === undefined) m[p[0]] = p[2]
    return m
  }
  const set = typeof opts === 'string' ? new Set(opts.split(/\s+/).filter(Boolean)) : null
  const m = {}
  for (const p of PASSES) m[p[0]] = set ? (set.has('all') || set.has(p[0])) : p[2]
  return m
}

/**
 * Optimize AST.
 *
 * @param {Array|string} ast - AST or WAT source
 * @param {boolean|string|Object} [opts=true] - Optimization options
 * @returns {Array} Optimized AST
 *
 * @example
 * optimize(ast)                      // all optimizations
 * optimize(ast, 'treeshake')         // only treeshake
 * optimize(ast, { fold: true })      // explicit
 */
/**
 * Could `inlineOnce`/`inline` grow the binary on this module? They are the only
 * size-*increasing* passes: splicing a callee body plus its `block`/param-setup
 * wrapper can exceed the `call` it removes. Every other pass strictly shrinks or
 * holds. So if no function is even a candidate (called exactly once, not pinned
 * by export/start/elem/ref.func, not its own exporter), nothing can inflate and
 * the size guard is dead weight. Cheap over-approximation of inlineOnce's own
 * gating — a false positive only costs the guarded path (correct, just slower).
 */
const mayInline = (ast) => {
  if (!Array.isArray(ast)) return false
  const callRefs = new Map(), pinned = new Set(), other = new Set()
  const scan = (n) => {
    if (!Array.isArray(n)) return
    const op = n[0]
    if (op === 'call' && typeof n[1] === 'string') callRefs.set(n[1], (callRefs.get(n[1]) || 0) + 1)
    else if (op === 'return_call' && typeof n[1] === 'string') other.add(n[1])
    else if (op === 'ref.func' && typeof n[1] === 'string') pinned.add(n[1])
    else if (op === 'export' && Array.isArray(n[2]) && n[2][0] === 'func' && typeof n[2][1] === 'string') pinned.add(n[2][1])
    else if (op === 'start' && typeof n[1] === 'string') pinned.add(n[1])
    else if (op === 'elem') for (const c of n) if (typeof c === 'string' && c[0] === '$') pinned.add(c)
    for (let i = 1; i < n.length; i++) scan(n[i])
  }
  scan(ast)
  for (const n of ast) {
    if (!Array.isArray(n) || n[0] !== 'func' || typeof n[1] !== 'string') continue
    const name = n[1]
    if (callRefs.get(name) !== 1 || pinned.has(name) || other.has(name)) continue
    if (n.some(c => Array.isArray(c) && c[0] === 'export')) continue // self-exporting func
    return true
  }
  return false
}

// A `__start` whose body DCE emptied down to nothing — plus its `(start)`
// directive — is pure noise: the directive invokes a no-op. jz's buildStartFn
// only emits `__start` when it has content, so an empty one is always a post-DCE
// artifact (e.g. a top-level `1 + 2;` whose dropped value the dead-code pass
// removed). Drop both. Header nodes (param/result/local/export/type) don't count
// as a body — a function carrying only locals still does nothing.
export default function optimize(ast, opts = true) {
  if (typeof ast === 'string') ast = parse(ast)   // accept WAT source directly
  const strictGuard = opts === true  // default: zero tolerance for bloat
  opts = normalize(opts)
  // `pin`: caller-supplied function names that inlineOnce/inline must NOT dissolve. Keeps
  // optimizer policy with the CALLER — e.g. jz pins the scalar transcendentals its own
  // auto-vectorizer later rewrites to f64x2 mirrors, so no consumer-specific names live here.
  opts.pin = opts.pin instanceof Set ? opts.pin : new Set(opts.pin || [])

  const log = opts.log ? (msg, delta) => opts.log(msg, delta) : () => {}
  const verbose = opts.verbose || opts.log

  ast = clone(ast)

  // devirt trades bytes for speed by design (guards + duplicated args), so it
  // runs ONCE after the rounds — its candidate shape (select of two i64 closure
  // constants) only emerges from fold/propagate, and its intended growth must
  // not trip the size-guard into reverting a whole round. A single sweep is
  // complete: every call_indirect is visited; rewritten sites keep the original
  // as the guarded fallback arm.
  // `inline` (multi-caller, size-for-speed) is like `devirt`: it INTENTIONALLY grows
  // the binary, so it must run OUTSIDE the per-round size-revert guard below (which
  // would otherwise undo it). Run it once after the rounds converge, then tidy the
  // (block (local.set $p arg) … body) wrappers it leaves with the same cleanup passes
  // a normal round would. opt-in (speed level); a no-op when no small callee qualifies.
  const runInline = (a) => {
    if (!opts.inline) return a
    // `inline: 'simd'` → SIMD-helper-only (jz's speed tier, avoids general bloat);
    // `inline: true` / `'all'` → general inlining of tiny functions.
    a = inline(a, { simdOnly: opts.inline === 'simd', pin: opts.pin })
    if (opts.propagate) a = propagate(a)
    if (opts.mergeBlocks) a = mergeBlocks(a)
    if (opts.vacuum) a = vacuum(a)
    if (opts.coalesceLocals) a = coalesceLocals(a)
    return a
  }
  // parse() returns [comment…, ['module',…]] when top-level trivia precedes the module —
  // whole-module passes key on ast[0] === 'module' and would silently no-op on the wrapper.
  // Run the pipeline on the module node itself and splice it back, so comments survive.
  let wrapper = null, slot = -1
  if (Array.isArray(ast) && ast[0] !== 'module') {
    const i = ast.findIndex(n => Array.isArray(n) && n[0] === 'module')
    if (i >= 0) wrapper = ast, slot = i, ast = ast[i]
  }

  // Strip comment trivia inside the module: parse keeps `;;`/`(;` as string children,
  // which blocks every adjacency-windowed pass (set→get fusion, dead-store pairs).
  // Top-level banner comments survive in the wrapper above.
  walkPost(ast, n => {
    if (!Array.isArray(n)) return
    for (let i = n.length - 1; i >= 0; i--) {
      const c = n[i]
      if (typeof c === 'string' && (c[0] === ';' || (c[0] === '(' && c[1] === ';'))) n.splice(i, 1)
    }
  })

  // Mandatory NaN-payload canonicalization, ONCE before the rounds: these folds may
  // grow bytes yet must never revert — hoisting keeps the rounds size-monotone, so
  // the guard below can compare entry vs exit without penalizing required folds.
  if (opts.fold) walkPost(ast, nanFoldNode)

  // licm runs ONCE after the rounds + inline: its invariants only exist after inlining, and a
  // later propagate round would forward a single-use hoist back into the loop, undoing it.
  // devirt must run BEFORE licm: its collector pattern-matches the in-loop closure-const
  // select chain feeding a call_indirect, and licm hoists exactly that chain into a local —
  // hoist first and no call site ever devirtualizes (jz speed tier, closures devirt tests).
  const finish = (a) => {
    a = runInline(a)
    if (opts.devirt) a = devirt(a)
    if (opts.licm) a = licm(a)
    // cse runs ONCE at fixpoint: inside the rounds its tee'd locals block the very
    // collapses (propagate/sink/merge) that would erase the expressions outright,
    // and any net wobble trips the exit guard into unwinding a whole round.
    if (opts.cse) {
      a = cse(a)
      if (opts.coalesce) a = coalesceLocals(a)
      if (opts.locals) a = localReuse(a)
    }
    return wrapper ? (wrapper[slot] = a, wrapper) : a
  }

  // Fast path: jz owns this optimizer and feeds it a controlled, type-aware IR.
  // The only passes that can *grow* the binary are inlineOnce/inline; when no
  // function is an inline candidate (the common case for scalar REPL kernels)
  // nothing can inflate, so we skip watr's per-round `binarySize` re-compile
  // guard — up to four full encodes per call — and iterate to a fixpoint with
  // zero compiles. A round that changes nothing is the natural exit.
  if (!((opts.inlineOnce || opts.inline) && mayInline(ast))) {
    // inlineOnce/inline can't fire here, so skip them — their candidate scan
    // (a 16-round whole-module walk) is the second-costliest thing after
    // propagate, and it would only confirm what `mayInline` already proved.
    for (let round = 0; round < 3; round++) {
      const beforeRound = clone(ast)
      let fused = false
      for (const [key, fn] of PASSES) {
        if (!opts[key] || key === 'inlineOnce' || key === 'inline' || key === 'devirt' || key === 'licm' || key === 'cse') continue
        if (SIMPLIFY_KEYS.has(key)) { if (!fused) ast = simplify(ast, opts), fused = true; continue }
        ast = fn(ast, opts)
      }
      if (equal(beforeRound, ast)) break // fixpoint
      if (verbose) log(`  round ${round + 1} applied`)
    }
    // treeshake/dedupe can EXPOSE single-caller candidates mid-rounds (dropping the
    // other callers) — the entry check was a snapshot; recheck before finishing
    if (!((opts.inlineOnce || opts.inline) && mayInline(ast))) return finish(ast)
  }

  // Guarded path: inlining can inflate (a body bigger than the call it replaces).
  // Rounds run unmeasured — every non-inline pass is size-monotone (NaN folds were
  // hoisted above) — and a single exit encode compares against the entry size.
  // Net growth unwinds the last round, then everything: two encodes in the common
  // case instead of one per round; `binarySize` returns Infinity for invalid wat,
  // so a broken round unwinds the same way.
  const pristine = clone(ast)
  const sizeBefore = binarySize(ast)
  let beforeRound = null
  for (let round = 0; round < 3; round++) {
    const snapshot = clone(ast)

    let fused = false
    for (const [key, fn] of PASSES) {
      if (!opts[key] || key === 'devirt' || key === 'inline' || key === 'licm' || key === 'cse') continue
      if (SIMPLIFY_KEYS.has(key)) { if (!fused) ast = simplify(ast, opts), fused = true; continue }
      ast = fn(ast, opts)
    }
    // Second propagate sweep: `inlineOnce`/`inline` (above) leave fresh
    // `(local.set $p arg) … (local.get $p)` wrappers around each inlined call —
    // collapse them within the same round.
    if (opts.propagate && (opts.inlineOnce || opts.inline)) ast = propagate(ast)

    if (equal(snapshot, ast)) break // fixpoint
    beforeRound = snapshot
  }

  // Default optimize must never inflate; explicit passes get slight leniency.
  const tolerance = strictGuard ? 0 : 16
  let sizeAfter = binarySize(ast)
  if (sizeAfter - sizeBefore > tolerance && beforeRound) {
    if (verbose) log(`  ⚠ net +${sizeAfter - sizeBefore} bytes — unwinding last round`, sizeAfter - sizeBefore)
    ast = beforeRound
    sizeAfter = binarySize(ast)
    if (sizeAfter - sizeBefore > tolerance) ast = pristine
  }

  return finish(ast)
}

/** Count AST nodes (fast size heuristic). */
export { count as size, count, binarySize }
export { optimize, treeshake, fold, deadcode, localReuse, identity, strength, branch, propagate, mergeLocals, cse, inlineMacro, tailmerge, inline, inlineOnce, devirt, normalize, OPTS, vacuum, peephole, globals, offset, unbranch, loopify, stripmut, brif, foldarms, dedupe, reorder, dedupTypes, packData, minifyImports, mergeBlocks, coalesceLocals }
