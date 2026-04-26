/**
 * AST optimizations for WebAssembly modules.
 * Reduces code size and improves runtime performance.
 *
 * @module watr/optimize
 */

import parse from './parse.js'

/** Optimizations that can be applied */
const OPTS = {
  treeshake: true,    // remove unused funcs/globals/types/tables
  fold: true,         // constant folding
  deadcode: true,     // eliminate dead code after unreachable/br/return
  locals: true,       // remove unused locals
  identity: true,     // remove identity ops (x + 0 → x)
  strength: true,     // strength reduction (x * 2 → x << 1)
  branch: true,       // simplify constant branches
  propagate: true,    // constant propagation through locals
  inline: true,       // inline tiny functions
  vacuum: true,       // remove nops, drop-of-pure, empty branches
  peephole: true,     // x-x→0, x&0→0, etc.
  globals: true,      // propagate immutable global constants
  offset: true,       // fold add+const into load/store offset
  unbranch: true,     // remove redundant br at end of own block
  stripmut: true,     // strip mut from never-written globals
  brif: true,         // if-then-br → br_if
  foldarms: true,     // merge identical trailing if arms
  // minify: true,    // NOTE: disabled — renaming $ids has no binary-size effect
                       // without a names section, and risks local-name collisions.
  dedupe: true,       // eliminate duplicate functions
  reorder: true,      // put hot functions first for smaller LEBs
  dedupTypes: true,   // merge identical type definitions
  packData: true,     // trim trailing zeros, merge adjacent data segments
  minifyImports: false, // shorten import names — enable only when you control the host
}

/** All optimization names */
const ALL = Object.keys(OPTS)

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
 * Normalize options to { opt: bool } map.
 * @param {boolean|string|Object} opts
 * @returns {Object}
 */
const normalize = (opts) => {
  if (opts === true) return { ...OPTS }
  if (opts === false) return {}
  if (typeof opts === 'string') {
    const set = new Set(opts.split(/\s+/).filter(Boolean))
    // Special case: a single explicit pass name (e.g. 'fold') enables only that pass,
    // rather than treating it as a sparse map where everything else is disabled.
    if (set.size === 1 && ALL.includes([...set][0])) {
      return Object.fromEntries(ALL.map(f => [f, set.has(f)]))
    }
    return Object.fromEntries(ALL.map(f => [f, set.has(f) || set.has('all')]))
  }
  return { ...OPTS, ...opts }
}
/**
 * Deep clone AST.
 * @param {any} node
 * @returns {any}
 */
const clone = (node) => {
  if (!Array.isArray(node)) return node
  return node.map(clone)
}

/**
 * Walk AST depth-first (pre-order).
 * @param {any} node
 * @param {Function} fn - (node, parent, idx) => void
 * @param {any} [parent]
 * @param {number} [idx]
 */
const walk = (node, fn, parent, idx) => {
  fn(node, parent, idx)
  if (Array.isArray(node)) for (let i = 0; i < node.length; i++) walk(node[i], fn, node, i)
}

/**
 * Walk AST depth-first (post-order), transform children before parent.
 * Returns the (potentially replaced) node.
 * @param {any} node
 * @param {Function} fn - (node, parent, idx) => newNode|undefined
 * @param {any} [parent]
 * @param {number} [idx]
 * @returns {any}
 */
const walkPost = (node, fn, parent, idx) => {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const result = walkPost(node[i], fn, node, i)
      if (result !== undefined) node[i] = result
    }
  }
  const result = fn(node, parent, idx)
  return result !== undefined ? result : node
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

  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) continue
    const kind = node[0]
    if (kind === 'type')   register(types,   node, typeIdx++)
    else if (kind === 'func')   register(funcs,   node, funcIdx++)
    else if (kind === 'global') register(globals, node, globalIdx++)
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

  // Worklist: function entries whose body still needs to be scanned for refs.
  const work = []
  const enqueue = (entry) => { if (entry && !entry.scanned) work.push(entry) }
  const markFunc = (ref) => {
    const e = funcs.get(ref); if (!e) return
    if (!e.used) e.used = true
    enqueue(e)
  }
  const markGlobal = (ref) => { const e = globals.get(ref); if (e) e.used = true }
  const markTable  = (ref) => { const e = tables.get(ref);  if (e) e.used = true }
  const markMemory = (ref) => { if (typeof ref === 'string' && ref[0] !== '$') ref = +ref; const e = memories.get(ref); if (e) e.used = true }
  const markType   = (ref) => { const e = types.get(ref);   if (e) e.used = true }

  // Roots: explicit exports, start funcs, elem-referenced funcs, inline-exported items.
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
  for (const start of starts) {
    let ref = start[1]
    if (typeof ref === 'string' && ref[0] !== '$') ref = +ref
    markFunc(ref)
  }
  for (const elem of elems) {
    walk(elem, n => {
      if (Array.isArray(n) && n[0] === 'ref.func') markFunc(n[1])
      else if (typeof n === 'string' && n[0] === '$') markFunc(n)
    })
  }
  for (const d of data) {
    const first = d[1]
    if (Array.isArray(first) && first[0] === 'memory') markMemory(first[1])
    else if (typeof first === 'string' && first[0] === '$') markMemory(first)
    else if (Array.isArray(first)) markMemory(0)
  }
  for (const m of [funcs, globals, tables, memories]) for (const e of m.values()) if (e.used) enqueue(e)

  // If nothing anchors the module (no exports, start, elem, or inline exports),
  // assume the module is consumed elsewhere and keep everything.
  const hasAnchor = exports.length > 0 || starts.length > 0 || elems.length > 0 || work.length > 0
  if (!hasAnchor) {
    for (const m of [funcs, globals, tables, memories]) for (const e of m.values()) e.used = true
    return ast
  }

  // Drain worklist: each function body gets walked exactly once.
  while (work.length) {
    const entry = work.pop()
    if (entry.scanned) continue
    entry.scanned = true
    if (entry.isImport) continue
    walk(entry.node, n => {
      if (!Array.isArray(n)) {
        if (typeof n === 'string' && n[0] === '$') markFunc(n)
        return
      }
      const [op, ref] = n
      if (op === 'call' || op === 'return_call' || op === 'ref.func') markFunc(ref)
      else if (op === 'global.get' || op === 'global.set') markGlobal(ref)
      else if (op === 'type') markType(ref)
      else if (op === 'call_indirect' || op === 'return_call_indirect') {
        for (const sub of n) if (typeof sub === 'string' && sub[0] === '$') markTable(sub)
      }
      if (typeof op === 'string' && (op.startsWith('memory.') || op.includes('.load') || op.includes('.store'))) {
        markMemory(0)
      }
    })
  }

  // Filter: keep used definitions. nodeMap handles unnamed entries directly.
  const result = ['module']
  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) { result.push(node); continue }
    const kind = node[0]
    if (kind === 'func' || kind === 'global' || kind === 'type') {
      if (nodeMap.get(node)?.used) result.push(node)
    } else if (kind === 'import') {
      // Keep import only if any of its sub-items is used.
      let used = false
      for (const sub of node) {
        if (!Array.isArray(sub)) continue
        const e = nodeMap.get(sub)
        if (e?.used) { used = true; break }
      }
      if (used) result.push(node)
    } else {
      result.push(node)
    }
  }
  return result
}

// ==================== CONSTANT FOLDING ====================

/** IEEE 754 roundTiesToEven (bankers' rounding) */
const roundEven = (x) => x - Math.floor(x) !== 0.5 ? Math.round(x) : 2 * Math.round(x / 2)

/** Build i32 comparison folder: returns 1/0 */
const i32c = (fn) => (a, b) => fn(a, b) ? 1 : 0
/** Build unsigned i32 comparison folder */
const u32c = (fn) => (a, b) => fn(a >>> 0, b >>> 0) ? 1 : 0
/** Build i64 comparison folder */
const i64c = (fn) => (a, b) => fn(a, b) ? 1 : 0
/** Build unsigned i64 comparison folder */
const u64c = (fn) => (a, b) => fn(BigInt.asUintN(64, a), BigInt.asUintN(64, b)) ? 1 : 0

/**
 * Constant folders, keyed by op. Each entry is [fn, resultType].
 * Comparisons return i32, conversions return their named output type.
 */
const FOLDABLE = {
  // i32 arithmetic
  'i32.add': [(a, b) => (a + b) | 0, 'i32'],
  'i32.sub': [(a, b) => (a - b) | 0, 'i32'],
  'i32.mul': [(a, b) => Math.imul(a, b), 'i32'],
  'i32.div_s': [(a, b) => b !== 0 ? (a / b) | 0 : null, 'i32'],
  'i32.div_u': [(a, b) => b !== 0 ? ((a >>> 0) / (b >>> 0)) | 0 : null, 'i32'],
  'i32.rem_s': [(a, b) => b !== 0 ? (a % b) | 0 : null, 'i32'],
  'i32.rem_u': [(a, b) => b !== 0 ? ((a >>> 0) % (b >>> 0)) | 0 : null, 'i32'],
  'i32.and': [(a, b) => a & b, 'i32'],
  'i32.or':  [(a, b) => a | b, 'i32'],
  'i32.xor': [(a, b) => a ^ b, 'i32'],
  'i32.shl':   [(a, b) => a << (b & 31), 'i32'],
  'i32.shr_s': [(a, b) => a >> (b & 31), 'i32'],
  'i32.shr_u': [(a, b) => a >>> (b & 31), 'i32'],
  'i32.rotl': [(a, b) => { b &= 31; return ((a << b) | (a >>> (32 - b))) | 0 }, 'i32'],
  'i32.rotr': [(a, b) => { b &= 31; return ((a >>> b) | (a << (32 - b))) | 0 }, 'i32'],
  'i32.eq':   [i32c((a, b) => a === b), 'i32'],
  'i32.ne':   [i32c((a, b) => a !== b), 'i32'],
  'i32.lt_s': [i32c((a, b) => a < b),  'i32'],
  'i32.lt_u': [u32c((a, b) => a < b),  'i32'],
  'i32.gt_s': [i32c((a, b) => a > b),  'i32'],
  'i32.gt_u': [u32c((a, b) => a > b),  'i32'],
  'i32.le_s': [i32c((a, b) => a <= b), 'i32'],
  'i32.le_u': [u32c((a, b) => a <= b), 'i32'],
  'i32.ge_s': [i32c((a, b) => a >= b), 'i32'],
  'i32.ge_u': [u32c((a, b) => a >= b), 'i32'],
  'i32.eqz':   [(a) => a === 0 ? 1 : 0, 'i32'],
  'i32.clz':   [(a) => Math.clz32(a), 'i32'],
  'i32.ctz':   [(a) => a === 0 ? 32 : 31 - Math.clz32(a & -a), 'i32'],
  'i32.popcnt': [(a) => { let c = 0; while (a) { c += a & 1; a >>>= 1 } return c }, 'i32'],
  'i32.wrap_i64':   [(a) => Number(BigInt.asIntN(32, a)), 'i32'],
  'i32.extend8_s':  [(a) => (a << 24) >> 24, 'i32'],
  'i32.extend16_s': [(a) => (a << 16) >> 16, 'i32'],

  // i64 (using BigInt)
  'i64.add': [(a, b) => BigInt.asIntN(64, a + b), 'i64'],
  'i64.sub': [(a, b) => BigInt.asIntN(64, a - b), 'i64'],
  'i64.mul': [(a, b) => BigInt.asIntN(64, a * b), 'i64'],
  'i64.div_s': [(a, b) => b !== 0n ? BigInt.asIntN(64, a / b) : null, 'i64'],
  'i64.div_u': [(a, b) => b !== 0n ? BigInt.asUintN(64, BigInt.asUintN(64, a) / BigInt.asUintN(64, b)) : null, 'i64'],
  'i64.rem_s': [(a, b) => b !== 0n ? BigInt.asIntN(64, a % b) : null, 'i64'],
  'i64.rem_u': [(a, b) => b !== 0n ? BigInt.asUintN(64, BigInt.asUintN(64, a) % BigInt.asUintN(64, b)) : null, 'i64'],
  'i64.and': [(a, b) => BigInt.asIntN(64, a & b), 'i64'],
  'i64.or':  [(a, b) => BigInt.asIntN(64, a | b), 'i64'],
  'i64.xor': [(a, b) => BigInt.asIntN(64, a ^ b), 'i64'],
  'i64.shl':   [(a, b) => BigInt.asIntN(64, a << (b & 63n)), 'i64'],
  'i64.shr_s': [(a, b) => BigInt.asIntN(64, a >> (b & 63n)), 'i64'],
  'i64.shr_u': [(a, b) => BigInt.asUintN(64, BigInt.asUintN(64, a) >> (b & 63n)), 'i64'],
  'i64.eq':   [i64c((a, b) => a === b), 'i32'],
  'i64.ne':   [i64c((a, b) => a !== b), 'i32'],
  'i64.lt_s': [i64c((a, b) => a < b),   'i32'],
  'i64.lt_u': [u64c((a, b) => a < b),   'i32'],
  'i64.gt_s': [i64c((a, b) => a > b),   'i32'],
  'i64.gt_u': [u64c((a, b) => a > b),   'i32'],
  'i64.le_s': [i64c((a, b) => a <= b),  'i32'],
  'i64.le_u': [u64c((a, b) => a <= b),  'i32'],
  'i64.ge_s': [i64c((a, b) => a >= b),  'i32'],
  'i64.ge_u': [u64c((a, b) => a >= b),  'i32'],
  'i64.eqz': [(a) => a === 0n ? 1 : 0, 'i32'],
  'i64.extend_i32_s': [(a) => BigInt(a), 'i64'],
  'i64.extend_i32_u': [(a) => BigInt(a >>> 0), 'i64'],
  'i64.extend8_s':    [(a) => BigInt.asIntN(64, BigInt.asIntN(8, a)),  'i64'],
  'i64.extend16_s':   [(a) => BigInt.asIntN(64, BigInt.asIntN(16, a)), 'i64'],
  'i64.extend32_s':   [(a) => BigInt.asIntN(64, BigInt.asIntN(32, a)), 'i64'],

  // f32/f64 (NaN/precision-aware via Math.fround)
  'f32.add': [(a, b) => Math.fround(a + b), 'f32'],
  'f32.sub': [(a, b) => Math.fround(a - b), 'f32'],
  'f32.mul': [(a, b) => Math.fround(a * b), 'f32'],
  'f32.div': [(a, b) => Math.fround(a / b), 'f32'],
  'f32.neg':   [(a) => Math.fround(-a), 'f32'],
  'f32.abs':   [(a) => Math.fround(Math.abs(a)), 'f32'],
  'f32.sqrt':  [(a) => Math.fround(Math.sqrt(a)), 'f32'],
  'f32.ceil':  [(a) => Math.fround(Math.ceil(a)), 'f32'],
  'f32.floor': [(a) => Math.fround(Math.floor(a)), 'f32'],
  'f32.trunc': [(a) => Math.fround(Math.trunc(a)), 'f32'],
  'f32.nearest': [(a) => Math.fround(roundEven(a)), 'f32'],

  'f64.add': [(a, b) => a + b, 'f64'],
  'f64.sub': [(a, b) => a - b, 'f64'],
  'f64.mul': [(a, b) => a * b, 'f64'],
  'f64.div': [(a, b) => a / b, 'f64'],
  'f64.neg':   [(a) => -a, 'f64'],
  'f64.abs':   [Math.abs, 'f64'],
  'f64.sqrt':  [Math.sqrt, 'f64'],
  'f64.ceil':  [Math.ceil, 'f64'],
  'f64.floor': [Math.floor, 'f64'],
  'f64.trunc': [Math.trunc, 'f64'],
  'f64.nearest': [roundEven, 'f64'],
}

/**
 * Extract constant value from node.
 * @param {any} node
 * @returns {{type: string, value: number|bigint}|null}
 */
const getConst = (node) => {
  if (!Array.isArray(node) || node.length !== 2) return null
  const [op, val] = node
  if (op === 'i32.const') return { type: 'i32', value: Number(val) | 0 }
  if (op === 'i64.const') return { type: 'i64', value: BigInt(val) }
  if (op === 'f32.const') return { type: 'f32', value: Math.fround(Number(val)) }
  if (op === 'f64.const') return { type: 'f64', value: Number(val) }
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
  if (type === 'i64') return ['i64.const', value]
  if (type === 'f32') return ['f32.const', Math.fround(value)]
  if (type === 'f64') return ['f64.const', value]
  return null
}

/**
 * Fold constant expressions.
 * @param {Array} ast
 * @returns {Array}
 */
const fold = (ast) => {
  return walkPost(clone(ast), (node) => {
    if (!Array.isArray(node)) return
    const entry = FOLDABLE[node[0]]
    if (!entry) return
    const [fn, t] = entry

    // Unary
    if (fn.length === 1 && node.length === 2) {
      const a = getConst(node[1])
      if (!a) return
      const r = fn(a.value)
      if (r === null) return
      return makeConst(t, r)
    }
    // Binary
    if (fn.length === 2 && node.length === 3) {
      const a = getConst(node[1]), b = getConst(node[2])
      if (!a || !b) return
      const r = fn(a.value, b.value)
      if (r === null) return
      return makeConst(t, r)
    }
  })
}

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
  'i64.add': commutativeIdentity(0n),
  // x - 0 → x
  'i32.sub': rightIdentity(0),
  'i64.sub': rightIdentity(0n),
  // x * 1 → x, 1 * x → x
  'i32.mul': commutativeIdentity(1),
  'i64.mul': commutativeIdentity(1n),
  // x / 1 → x
  'i32.div_s': rightIdentity(1),
  'i32.div_u': rightIdentity(1),
  'i64.div_s': rightIdentity(1n),
  'i64.div_u': rightIdentity(1n),
  // x & -1 → x, -1 & x → x (all bits set)
  'i32.and': commutativeIdentity(-1),
  'i64.and': commutativeIdentity(-1n),
  // x | 0 → x, 0 | x → x
  'i32.or': commutativeIdentity(0),
  'i64.or': commutativeIdentity(0n),
  // x ^ 0 → x, 0 ^ x → x
  'i32.xor': commutativeIdentity(0),
  'i64.xor': commutativeIdentity(0n),
  // x << 0 → x, x >> 0 → x
  'i32.shl': rightIdentity(0),
  'i32.shr_s': rightIdentity(0),
  'i32.shr_u': rightIdentity(0),
  'i64.shl': rightIdentity(0n),
  'i64.shr_s': rightIdentity(0n),
  'i64.shr_u': rightIdentity(0n),
  // f + 0 → x (careful with -0.0, skip for floats)
  // f * 1 → x (careful with NaN, skip for floats)
}

/**
 * Remove identity operations.
 * @param {Array} ast
 * @returns {Array}
 */
const identity = (ast) => {
  return walkPost(clone(ast), (node) => {
    if (!Array.isArray(node) || node.length !== 3) return
    const fn = IDENTITIES[node[0]]
    if (!fn) return
    const result = fn(node[1], node[2])
    if (result === null) return  // no optimization, keep original
    return result
  })
}

// ==================== STRENGTH REDUCTION ====================

/**
 * Strength reduction: replace expensive ops with cheaper equivalents.
 * @param {Array} ast
 * @returns {Array}
 */
const strength = (ast) => {
  return walkPost(clone(ast), (node) => {
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
      const cb = getConst(b)
      if (cb && cb.value > 0n && (cb.value & (cb.value - 1n)) === 0n) {
        const shift = BigInt(cb.value.toString(2).length - 1)
        return ['i64.shl', a, ['i64.const', shift]]
      }
      const ca = getConst(a)
      if (ca && ca.value > 0n && (ca.value & (ca.value - 1n)) === 0n) {
        const shift = BigInt(ca.value.toString(2).length - 1)
        return ['i64.shl', b, ['i64.const', shift]]
      }
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
      const cb = getConst(b)
      if (cb && cb.value > 0n && (cb.value & (cb.value - 1n)) === 0n) {
        const shift = BigInt(cb.value.toString(2).length - 1)
        return ['i64.shr_u', a, ['i64.const', shift]]
      }
    }

    // x % 2^n → x & (2^n - 1) (unsigned only)
    if (op === 'i32.rem_u') {
      const cb = getConst(b)
      if (cb && cb.value > 0 && (cb.value & (cb.value - 1)) === 0) {
        return ['i32.and', a, ['i32.const', cb.value - 1]]
      }
    }
    if (op === 'i64.rem_u') {
      const cb = getConst(b)
      if (cb && cb.value > 0n && (cb.value & (cb.value - 1n)) === 0n) {
        return ['i64.and', a, ['i64.const', cb.value - 1n]]
      }
    }
  })
}

// ==================== BRANCH SIMPLIFICATION ====================

/**
 * Simplify branches with constant conditions.
 * @param {Array} ast
 * @returns {Array}
 */
const branch = (ast) => {
  return walkPost(clone(ast), (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]

    // (if (i32.const 0) then else) → else
    // (if (i32.const N) then else) → then (N != 0)
    if (op === 'if') {
      const { cond, thenBranch, elseBranch } = parseIf(node)
      const c = getConst(cond)
      if (!c) return
      const taken = c.value !== 0 && c.value !== 0n ? thenBranch : elseBranch
      if (taken && taken.length > 1) {
        const contents = taken.slice(1)
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
      if (c.value === 0 || c.value === 0n) return ['nop']
      return ['br', node[1]]
    }

    // (select a b (i32.const 0)) → b
    // (select a b (i32.const N)) → a (N != 0)
    if (op === 'select' && node.length >= 4) {
      const cond = node[node.length - 1]
      const c = getConst(cond)
      if (!c) return
      if (c.value === 0 || c.value === 0n) return node[2] // b
      return node[1] // a
    }
  })
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
  const result = clone(ast)

  // Process each function body
  walk(result, (node) => {
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

  return result
}

/**
 * Remove instructions after terminators within a block.
 * @param {Array} block
 */
const eliminateDeadInBlock = (block) => {
  let terminated = false
  let firstTerminator = -1

  for (let i = 1; i < block.length; i++) {
    const node = block[i]

    // Skip type annotations
    if (Array.isArray(node)) {
      const op = node[0]
      if (op === 'param' || op === 'result' || op === 'local' || op === 'type' || op === 'export') continue

      if (terminated) {
        if (firstTerminator === -1) firstTerminator = i
      }

      if (TERMINATORS.has(op)) {
        terminated = true
        firstTerminator = i + 1
      }
    } else if (typeof node === 'string') {
      // String instructions like 'unreachable', 'return', 'drop', 'nop'
      if (terminated) {
        if (firstTerminator === -1) firstTerminator = i
      }

      if (TERMINATORS.has(node)) {
        terminated = true
        firstTerminator = i + 1
      }
    }
  }

  // Remove dead code
  if (firstTerminator > 0 && firstTerminator < block.length) {
    block.splice(firstTerminator)
  }
}

// ==================== LOCAL REUSE ====================

/**
 * Reuse locals of the same type to reduce total local count.
 * Basic version: deduplicate unused locals.
 * @param {Array} ast
 * @returns {Array}
 */
const localReuse = (ast) => {
  const result = clone(ast)

  walk(result, (node) => {
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
    walk(node, (n) => {
      if (!Array.isArray(n)) return
      const op = n[0]
      if (op === 'local.get' || op === 'local.set' || op === 'local.tee') {
        const ref = n[1]
        if (typeof ref === 'string') usedLocals.add(ref)
      }
    })

    // Remove unused local declarations
    for (let i = localDecls.length - 1; i >= 0; i--) {
      const { idx, node: decl } = localDecls[i]
      const name = typeof decl[1] === 'string' && decl[1][0] === '$' ? decl[1] : null
      if (name && !usedLocals.has(name)) {
        node.splice(idx, 1)
      }
    }
  })

  return result
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
  if (!Array.isArray(node)) return true
  const op = node[0]
  if (typeof op !== 'string') return false
  if (IMPURE_OPS.has(op)) return false
  for (const sub of IMPURE_SUBSTRINGS) if (op.includes(sub)) return false
  for (let i = 1; i < node.length; i++) if (Array.isArray(node[i]) && !isPure(node[i])) return false
  return true
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

/** Can this tracked value be substituted for a local.get? */
const canSubst = (k) => getConst(k.val) || (k.pure && k.singleUse)

/** Try substitute local.get nodes with known values */
const substGets = (node, known) => walkPost(node, n => {
  if (!Array.isArray(n) || n[0] !== 'local.get' || n.length !== 2) return
  const k = typeof n[1] === 'string' && known.get(n[1])
  if (k && canSubst(k)) return clone(k.val)
})

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

    // Track local.set values
    if (op === 'local.set' && instr.length === 3 && typeof instr[1] === 'string') {
      substGets(instr[2], known) // substitute known values in RHS
      const uses = getUseCount(instr[1])
      known.set(instr[1], {
        val: instr[2], pure: isPure(instr[2]),
        singleUse: uses.gets <= 1 && uses.sets <= 1 && uses.tees === 0
      })
      continue
    }

    // Invalidate at control-flow boundaries
    if (op === 'block' || op === 'loop' || op === 'if') known.clear()
    // Calls only invalidate non-constant tracked values
    if (op === 'call' || op === 'call_indirect' || op === 'return_call' || op === 'return_call_indirect')
      for (const [key, tracked] of known) if (!getConst(tracked.val)) known.delete(key)

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
    }
  }

  return changed
}

/**
 * Remove adjacent (local.set $x expr) (local.get $x) pairs when $x has no other uses.
 * Returns true if any pair was removed.
 * @param {Array} funcNode
 * @param {Set<string>} params
 * @param {Map<string,{gets:number,sets:number,tees:number}>} useCounts
 */
const eliminateSetGetPairs = (funcNode, params, useCounts) => {
  let changed = false

  for (let i = 1; i < funcNode.length - 1; i++) {
    const setNode = funcNode[i]
    const getNode = funcNode[i + 1]
    if (!Array.isArray(setNode) || setNode[0] !== 'local.set' || setNode.length !== 3) continue
    if (!Array.isArray(getNode) || getNode[0] !== 'local.get' || getNode.length !== 2) continue
    const name = setNode[1]
    if (getNode[1] !== name || params.has(name)) continue
    const uses = useCounts.get(name) || { gets: 0, sets: 0, tees: 0 }
    // Must be exactly 1 set and 1 get (the pair), no tees
    if (uses.sets !== 1 || uses.gets !== 1 || uses.tees !== 0) continue
    // Replace the pair with just the expression
    const expr = clone(setNode[2])
    funcNode.splice(i, 2, ...(Array.isArray(expr) ? [expr] : [expr]))
    changed = true
    i-- // adjust index because we removed 2 and inserted 1
  }

  return changed
}

/**
 * Convert (local.set $x expr) (local.get $x) to (local.tee $x expr)
 * when $x has additional uses beyond this pair.
 * @param {Array} funcNode
 * @param {Set<string>} params
 * @param {Map<string,{gets:number,sets:number,tees:number}>} useCounts
 */
const createLocalTees = (funcNode, params, useCounts) => {
  let changed = false

  for (let i = 1; i < funcNode.length - 1; i++) {
    const setNode = funcNode[i]
    const getNode = funcNode[i + 1]
    if (!Array.isArray(setNode) || setNode[0] !== 'local.set' || setNode.length !== 3) continue
    if (!Array.isArray(getNode) || getNode[0] !== 'local.get' || getNode.length !== 2) continue
    const name = setNode[1]
    if (getNode[1] !== name || params.has(name)) continue
    const uses = useCounts.get(name) || { gets: 0, sets: 0, tees: 0 }
    // Only if there's more than just this set+get pair
    if (uses.sets + uses.gets + uses.tees <= 2) continue
    // Replace with local.tee (set+get combined)
    funcNode.splice(i, 2, ['local.tee', name, clone(setNode[2])])
    changed = true
  }

  return changed
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

  for (let i = funcNode.length - 1; i >= 1; i--) {
    const sub = funcNode[i]
    if (!Array.isArray(sub)) continue
    const name = typeof sub[1] === 'string' ? sub[1] : null
    if (!name || params.has(name)) continue
    const uses = getPostUseCount(name)
    // Dead store: set but never read, pure RHS
    if (sub[0] === 'local.set' && uses.gets === 0 && uses.tees === 0 && isPure(sub[2])) {
      funcNode.splice(i, 1); changed = true
    }
    // Unused local declaration
    else if (sub[0] === 'local' && name[0] === '$' && uses.gets === 0 && uses.sets === 0 && uses.tees === 0) {
      funcNode.splice(i, 1); changed = true
    }
  }

  return changed
}

/**
 * Propagate values through locals and eliminate single-use/dead locals.
 * Constants propagate to all uses; pure single-use exprs inline into get site.
 * Multi-pass with batch counting for convergence.
 */
const propagate = (ast) => {
  const result = clone(ast)

  walk(result, (funcNode) => {
    if (!Array.isArray(funcNode) || funcNode[0] !== 'func') return

    const params = new Set()
    for (const sub of funcNode)
      if (Array.isArray(sub) && sub[0] === 'param' && typeof sub[1] === 'string') params.add(sub[1])

    // useCounts must be refreshed before every sub-pass: each mutation
    // (substitution, set/get pair removal, tee creation, dead-store removal)
    // changes the gets/sets/tees totals that downstream sub-passes rely on.
    for (let pass = 0; pass < 4; pass++) {
      let changed = false
      if (forwardPropagate(funcNode, params, countLocalUses(funcNode))) changed = true
      if (eliminateSetGetPairs(funcNode, params, countLocalUses(funcNode))) changed = true
      if (createLocalTees(funcNode, params, countLocalUses(funcNode))) changed = true
      if (eliminateDeadStores(funcNode, params, countLocalUses(funcNode))) changed = true
      if (!changed) break
    }
  })

  return result
}

// ==================== FUNCTION INLINING ====================

/**
 * Inline tiny functions (single expression, no locals, no params or simple params).
 * @param {Array} ast
 * @returns {Array}
 */
const inline = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast
  const result = clone(ast)

  // Collect inlinable functions
  const inlinable = new Map() // $name → { body, params }

  for (const node of result.slice(1)) {
    if (!Array.isArray(node) || node[0] !== 'func') continue

    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name) continue

    // Check if function is small enough to inline
    let params = []
    let body = []
    let hasLocals = false
    let hasExport = false

    for (let i = 1; i < node.length; i++) {
      const sub = node[i]
      if (!Array.isArray(sub)) continue
      if (sub[0] === 'param') {
        // Collect param names and types
        if (typeof sub[1] === 'string' && sub[1][0] === '$') {
          params.push({ name: sub[1], type: sub[2] })
        } else {
          // Unnamed params - harder to inline
          params = null
          break
        }
      } else if (sub[0] === 'local') {
        hasLocals = true
      } else if (sub[0] === 'export') {
        hasExport = true
      } else if (sub[0] !== 'result' && sub[0] !== 'type') {
        body.push(sub)
      }
    }

    // Inline: no locals, <= 4 params, single expression body, not exported
    if (params && !hasLocals && !hasExport && params.length <= 4 && body.length === 1) {
      // Check if function mutates any of its params (local.set/tee on param)
      const paramNames = new Set(params.map(p => p.name))
      let mutatesParam = false
      walk(body[0], (n) => {
        if (!Array.isArray(n)) return
        if ((n[0] === 'local.set' || n[0] === 'local.tee') && paramNames.has(n[1])) {
          mutatesParam = true
        }
      })
      if (!mutatesParam) {
        inlinable.set(name, { body: body[0], params })
      }
    }
  }

  // Replace calls with inlined body
  if (inlinable.size === 0) return result

  walkPost(result, (node) => {
    if (!Array.isArray(node) || node[0] !== 'call') return
    const fname = node[1]
    if (!inlinable.has(fname)) return

    const { body, params } = inlinable.get(fname)
    const args = node.slice(2)

    // Simple case: no params
    if (params.length === 0) {
      return clone(body)
    }

    // Substitute params with args
    const substituted = clone(body)
    walkPost(substituted, (n) => {
      if (!Array.isArray(n) || n[0] !== 'local.get') return
      const local = n[1]
      const paramIdx = params.findIndex(p => p.name === local)
      if (paramIdx !== -1 && args[paramIdx]) {
        return clone(args[paramIdx])
      }
    })

    return substituted
  })

  return result
}

// ==================== VACUUM ====================

/**
 * Remove no-op code: nops, drop of pure expressions, empty branches,
 * and select with identical arms.
 * @param {Array} ast
 * @returns {Array}
 */
const vacuum = (ast) => {
  return walkPost(clone(ast), (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]

    // Remove nop entirely (return array marker; parent or post-pass cleans it)
    if (op === 'nop') return ['nop']

    // (drop PURE) → nop
    if (op === 'drop' && node.length === 2 && isPure(node[1])) {
      return ['nop']
    }

    // (select x x cond) → x
    if (op === 'select' && node.length >= 4 && equal(node[1], node[2])) return node[1]

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
    }

    // Clean out nops, drop-of-pure sequences, and empty annotations from blocks
    if (op === 'func' || op === 'block' || op === 'loop' || op === 'then' || op === 'else') {
      const cleaned = [op]
      for (let i = 1; i < node.length; i++) {
        const child = node[i]
        if (child === 'nop' || (Array.isArray(child) && child[0] === 'nop')) continue
        // Pure expression followed by standalone drop → remove both
        const next = node[i + 1]
        const isDrop = next === 'drop' || (Array.isArray(next) && next[0] === 'drop' && next.length === 1)
        if (Array.isArray(child) && isPure(child) && isDrop) {
          i++ // skip the drop too
          continue
        }
        cleaned.push(child)
      }
      if (cleaned.length !== node.length) return cleaned
    }
  })
}

// ==================== PEEPHOLE ====================

/** Peephole optimizations: simple algebraic identities */
const PEEPHOLE = {
  // Self-cancelling / tautological binary ops
  'i32.sub': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i64.sub': (a, b) => equal(a, b) ? ['i64.const', 0n] : null,
  'i32.xor': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i64.xor': (a, b) => equal(a, b) ? ['i64.const', 0n] : null,
  'i32.and': (a, b) => equal(a, b) ? a : null,
  'i64.and': (a, b) => equal(a, b) ? a : null,
  'i32.or':  (a, b) => equal(a, b) ? a : null,
  'i64.or':  (a, b) => equal(a, b) ? a : null,
  'i32.eq':  (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i64.eq':  (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i32.ne':  (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i64.ne':  (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i32.lt_s': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i32.lt_u': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i32.gt_s': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i32.gt_u': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i32.le_s': (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i32.le_u': (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i32.ge_s': (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i32.ge_u': (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i64.lt_s': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i64.lt_u': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i64.gt_s': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i64.gt_u': (a, b) => equal(a, b) ? ['i32.const', 0] : null,
  'i64.le_s': (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i64.le_u': (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i64.ge_s': (a, b) => equal(a, b) ? ['i32.const', 1] : null,
  'i64.ge_u': (a, b) => equal(a, b) ? ['i32.const', 1] : null,

  // Zero/all-bits absorption
  'i32.mul': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0 || cb?.value === 0) return ['i32.const', 0]
    return null
  },
  'i64.mul': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0n || cb?.value === 0n) return ['i64.const', 0n]
    return null
  },
  'i32.and': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0 || cb?.value === 0) return ['i32.const', 0]
    // x & x → x handled above in self-operands, but null here lets that win
    return null
  },
  'i64.and': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0n || cb?.value === 0n) return ['i64.const', 0n]
    return null
  },
  'i32.or': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === -1 || cb?.value === -1) return ['i32.const', -1]
    return null
  },
  'i64.or': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === -1n || cb?.value === -1n) return ['i64.const', -1n]
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
const peephole = (ast) => {
  return walkPost(clone(ast), (node) => {
    if (!Array.isArray(node) || node.length !== 3) return
    const fn = PEEPHOLE[node[0]]
    if (!fn) return
    const result = fn(node[1], node[2])
    if (result !== null) return result
  })
}

// ==================== GLOBAL CONSTANT PROPAGATION ====================

/**
 * Replace global.get of immutable globals with their constant init values.
 * @param {Array} ast
 * @returns {Array}
 */
const globals = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast
  const result = clone(ast)

  // Find immutable globals with const init
  const constGlobals = new Map() // name → const node
  const mutableGlobals = new Set()

  for (const node of result.slice(1)) {
    if (!Array.isArray(node) || node[0] !== 'global') continue
    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name) continue

    // Check mutability: (global $g (mut i32) init) vs (global $g i32 init)
    const hasName = typeof node[1] === 'string' && node[1][0] === '$'
    const initIdx = hasName ? 3 : 2

    // Skip mutable globals
    const typeSlot = hasName ? node[2] : node[1]
    if (Array.isArray(typeSlot) && typeSlot[0] === 'mut') continue

    const init = node[initIdx]
    if (getConst(init)) constGlobals.set(name, init)
  }

  // Also mark any global that is ever written as mutable
  walk(result, (n) => {
    if (!Array.isArray(n) || n[0] !== 'global.set') return
    const ref = n[1]
    if (typeof ref === 'string' && ref[0] === '$') mutableGlobals.add(ref)
  })

  // Remove mutable ones from propagation set
  for (const name of mutableGlobals) constGlobals.delete(name)
  if (constGlobals.size === 0) return result

  // Substitute global.get with const
  return walkPost(result, (node) => {
    if (!Array.isArray(node) || node[0] !== 'global.get' || node.length !== 2) return
    const ref = node[1]
    if (constGlobals.has(ref)) return clone(constGlobals.get(ref))
  })
}

// ==================== LOAD/STORE OFFSET FOLDING ====================

/** Match (type.load/store (i32.add ptr (type.const N))) and fold offset */
const offset = (ast) => {
  return walkPost(clone(ast), (node) => {
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
  const result = clone(ast)

  walk(result, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]
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
      node.splice(lastIdx, 1)
    }
  })

  return result
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
  const result = clone(ast)

  const written = new Set()
  walk(result, (n) => {
    if (Array.isArray(n) && n[0] === 'global.set' && typeof n[1] === 'string') written.add(n[1])
  })

  return walkPost(result, (node) => {
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
const brif = (ast) => {
  return walkPost(clone(ast), (node) => {
    if (!Array.isArray(node) || node[0] !== 'if') return
    const { cond, thenBranch, elseBranch } = parseIf(node)
    const thenEmpty = !thenBranch || thenBranch.length <= 1
    const elseEmpty = !elseBranch || elseBranch.length <= 1

    // (if cond (then (br $l))) → (br_if $l cond)
    if (!thenEmpty && elseEmpty && thenBranch.length === 2) {
      const t = thenBranch[1]
      if (Array.isArray(t) && t[0] === 'br' && t.length === 2) return ['br_if', t[1], cond]
    }

    // (if cond (then) (else (br $l))) → (br_if $l (i32.eqz cond))
    if (thenEmpty && !elseEmpty && elseBranch.length === 2) {
      const e = elseBranch[1]
      if (Array.isArray(e) && e[0] === 'br' && e.length === 2) return ['br_if', e[1], ['i32.eqz', cond]]
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
  return walkPost(clone(ast), (node) => {
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
      stack.push('|')
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i])
      stack.push('[')
    } else if (typeof v === 'string') {
      parts.push(localNames.has(v) ? '$__L' : v)
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
  const result = clone(ast)

  // Hash function bodies (normalize local/param names to avoid false negatives)
  const signatures = new Map() // hash → canonical $name
  const redirects = new Map()  // duplicate $name → canonical $name

  for (const node of result.slice(1)) {
    if (!Array.isArray(node) || node[0] !== 'func') continue
    const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!name) continue

    // Collect names that are internal to this function: the func name itself,
    // its params, locals, and any block/loop labels nested in the body. All of
    // these get normalized to a single token in the hash so that two funcs
    // differing only in identifier choices still dedupe.
    const localNames = new Set()
    if (typeof node[1] === 'string' && node[1][0] === '$') localNames.add(node[1])
    walk(node, (n) => {
      if (!Array.isArray(n) || typeof n[1] !== 'string' || n[1][0] !== '$') return
      const op = n[0]
      if (op === 'param' || op === 'local' || op === 'block' || op === 'loop' || op === 'if') {
        localNames.add(n[1])
      }
    })

    const hash = hashFunc(node, localNames)

    if (signatures.has(hash)) {
      redirects.set(name, signatures.get(hash))
    } else {
      signatures.set(hash, name)
    }
  }

  if (redirects.size === 0) return result

  // Rewrite all references: calls, ref.func, elem segments, call_indirect type
  walkPost(result, (node) => {
    if (!Array.isArray(node)) return
    const op = node[0]
    if ((op === 'call' || op === 'return_call') && redirects.has(node[1])) {
      return [op, redirects.get(node[1]), ...node.slice(2)]
    }
    if (op === 'ref.func' && redirects.has(node[1])) {
      return ['ref.func', redirects.get(node[1])]
    }
    if (op === 'elem') {
      const funcs = node[node.length - 1]
      if (Array.isArray(funcs)) {
        return [...node.slice(0, -1), funcs.map(f => redirects.get(f) || f)]
      }
    }
    if (op === 'call_indirect' && node.length >= 3) {
      const typeRef = node[1]
      if (typeof typeRef === 'string' && redirects.has(typeRef)) {
        return ['call_indirect', redirects.get(typeRef), ...node.slice(2)]
      }
    }
  })

  return result
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
  const result = clone(ast)

  const signatures = new Map() // hash → canonical $name
  const redirects = new Map()  // duplicate $name → canonical $name

  for (const node of result.slice(1)) {
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

  if (redirects.size === 0) return result

  // Remove duplicate type nodes
  for (let i = result.length - 1; i >= 0; i--) {
    const node = result[i]
    if (Array.isArray(node) && node[0] === 'type') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
      if (name && redirects.has(name)) result.splice(i, 1)
    }
  }

  walkPost(result, (node) => {
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

  return result
}

// ==================== DATA SEGMENT PACKING ====================

/** Parse a WAT data string literal into Uint8Array */
const parseDataString = (str) => {
  if (typeof str !== 'string' || str.length < 2 || str[0] !== '"') return new Uint8Array()
  const inner = str.slice(1, -1)
  const bytes = []
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') {
      const next = inner[++i]
      if (next === 'x' || next === 'X') {
        bytes.push(parseInt(inner.slice(i + 1, i + 3), 16))
        i += 2
      } else if (/[0-9a-fA-F]/.test(next) && /[0-9a-fA-F]/.test(inner[i + 1])) {
        bytes.push(parseInt(inner.slice(i, i + 2), 16))
        i++
      } else if (next === 'n') bytes.push(10)
      else if (next === 't') bytes.push(9)
      else if (next === 'r') bytes.push(13)
      else if (next === '\\') bytes.push(92)
      else if (next === '"') bytes.push(34)
      else bytes.push(next.charCodeAt(0))
    } else {
      bytes.push(inner.charCodeAt(i))
    }
  }
  return new Uint8Array(bytes)
}

/** Encode Uint8Array as WAT data string literal */
const encodeDataString = (bytes) => {
  let str = '"'
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b >= 32 && b < 127 && b !== 34 && b !== 92) {
      str += String.fromCharCode(b)
    } else {
      str += '\\' + b.toString(16).padStart(2, '0')
    }
  }
  return str + '"'
}

/** Trim trailing zeros from data content items */
const trimTrailingZeros = (items) => {
  const bytes = []
  for (const item of items) {
    if (typeof item === 'string') {
      bytes.push(...parseDataString(item))
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
  return [encodeDataString(new Uint8Array(bytes.slice(0, end)))]
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
    const merged = new Uint8Array(aBytes.length + bBytes.length)
    merged.set(aBytes)
    merged.set(bBytes, aBytes.length)
    a.length = aIdx
    a.push(encodeDataString(merged))
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
  let result = clone(ast)

  // Trim trailing zeros
  for (const node of result) {
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
  for (let i = 0; i < result.length; i++) {
    const node = result[i]
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
    result = result.filter((_, i) => !toRemove.has(i))
  }

  return result
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
  const result = clone(ast)
  const shortMod = makeShortener()
  const shortField = makeShortener()

  for (const node of result) {
    if (!Array.isArray(node) || node[0] !== 'import') continue
    if (typeof node[1] === 'string' && node[1][0] === '"') {
      node[1] = '"' + shortMod(node[1].slice(1, -1)) + '"'
    }
    if (typeof node[2] === 'string' && node[2][0] === '"') {
      node[2] = '"' + shortField(node[2].slice(1, -1)) + '"'
    }
  }

  return result
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
  const result = clone(ast)

  const callCounts = new Map()
  walk(result, (n) => {
    if (!Array.isArray(n)) return
    if (n[0] === 'call' || n[0] === 'return_call') {
      callCounts.set(n[1], (callCounts.get(n[1]) || 0) + 1)
    }
  })

  // Imports must precede defined funcs (compile.js assigns indices in AST order).
  const imports = [], funcs = [], others = []
  for (const node of result.slice(1)) {
    if (!Array.isArray(node)) { others.push(node); continue }
    if (node[0] === 'import') imports.push(node)
    else if (node[0] === 'func') funcs.push(node)
    else others.push(node)
  }

  funcs.sort((a, b) => (callCounts.get(b[1]) || 0) - (callCounts.get(a[1]) || 0))
  return ['module', ...imports, ...funcs, ...others]
}

// ==================== MAIN ====================

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
export default function optimize(ast, opts = true) {
  if (typeof ast === 'string') ast = parse(ast)
  ast = clone(ast)
  opts = normalize(opts)

  // Each pass clones its input before mutating, so the original `before`
  // reference stays untouched and can be used for the convergence check
  // without an extra deep clone.
  for (let round = 0; round < 6; round++) {
    const before = ast

    if (opts.stripmut) ast = stripmut(ast)
    if (opts.globals) ast = globals(ast)
    if (opts.fold) ast = fold(ast)
    if (opts.identity) ast = identity(ast)
    if (opts.peephole) ast = peephole(ast)
    if (opts.strength) ast = strength(ast)
    if (opts.branch) ast = branch(ast)
    if (opts.propagate) ast = propagate(ast)
    if (opts.inline) ast = inline(ast)
    if (opts.offset) ast = offset(ast)
    if (opts.unbranch) ast = unbranch(ast)
    if (opts.brif) ast = brif(ast)
    if (opts.foldarms) ast = foldarms(ast)
    if (opts.deadcode) ast = deadcode(ast)
    if (opts.vacuum) ast = vacuum(ast)
    if (opts.locals) ast = localReuse(ast)
    if (opts.dedupe) ast = dedupe(ast)
    if (opts.dedupTypes) ast = dedupTypes(ast)
    if (opts.packData) ast = packData(ast)
    if (opts.reorder) ast = reorder(ast)
    if (opts.treeshake) ast = treeshake(ast)
    if (opts.minifyImports) ast = minifyImports(ast)
    if (equal(before, ast)) break
  }

  return ast
}

export { optimize, treeshake, fold, deadcode, localReuse, identity, strength, branch, propagate, inline, normalize, OPTS, vacuum, peephole, globals, offset, unbranch, stripmut, brif, foldarms, dedupe, reorder, dedupTypes, packData, minifyImports }
