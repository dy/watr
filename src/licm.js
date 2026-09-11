import { resultType } from './const.js'

// A structural key must distinguish every Wasm literal, including signed zero,
// infinities and BigInt. JSON alone silently conflates several of these.
export function structuralKey(v) {
  if (Array.isArray(v)) { let s = '['; for (let i = 0; i < v.length; i++) s += (i ? ',' : '') + structuralKey(v[i]); return s + ']' }
  if (typeof v === 'bigint') return `${v}n`
  if (typeof v === 'number' && (Number.isNaN(v) || v === Infinity || v === -Infinity || Object.is(v, -0)))
    return Number.isNaN(v) ? '#NaN' : v === Infinity ? '#Inf' : v === -Infinity ? '#-Inf' : '#-0'
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}

/**
 * Hoist maximal invariant expressions, innermost loops first, in one function.
 * `analyze(loop, nested)` returns a predicate `(node, privateLocals) => boolean`:
 * acceptance guarantees an invariant result, no observable effects, and safe
 * speculative execution (including a zero-trip loop). The engine independently
 * checks that every local written by a candidate is private to that candidate.
 * Proofs belong to this invocation; they are rebuilt after inner-loop rewrites.
 * `callType(name)` supplies a proven single-result call signature when needed.
 * No proofs are stored on instruction arrays or survive a transformation.
 * @param {any[]} fn
 * @param {{analyze: Function, callType?: Function, prefix?: string}} opts
 */
export function hoistInvariants(fn, { analyze, callType, prefix = '$__licm' }) {
  if (!Array.isArray(fn) || fn[0] !== 'func') return
  const types = new Map()
  let start = 1
  for (; start < fn.length; start++) {
    const n = fn[start]
    if (!Array.isArray(n)) continue
    if (n[0] === 'local' || n[0] === 'param') { if (typeof n[1] === 'string') types.set(n[1], n[2]); continue }
    if (n[0] !== 'result' && n[0] !== 'export' && n[0] !== 'type') break
  }
  const refs = new Map()
  let hasLoop = false
  const countRefs = n => {
    if (!Array.isArray(n)) return
    const count = (refs.get(n) || 0) + 1
    refs.set(n, count)
    if (count > 1) return
    if (n[0] === 'loop') hasLoop = true
    for (let i = 1; i < n.length; i++) countRefs(n[i])
  }
  countRefs(fn)
  if (!hasLoop) return
  // One function-wide census. Hoisting moves references unchanged; merging
  // duplicate expressions removes their extra copies. Keep those deltas below
  // instead of rebuilding every subtree's counts for each loop.
  const localCounts = new Map()
  const countLocals = n => {
    if (!Array.isArray(n)) return
    if (n[0] === 'local.get' || n[0] === 'local.set' || n[0] === 'local.tee')
      localCounts.set(n[1], (localCounts.get(n[1]) || 0) + 1)
    for (let i = 1; i < n.length; i++) countLocals(n[i])
  }
  countLocals(fn)
  const typeOf = n => {
    const op = n[0]
    if (op === 'local.get' || op === 'local.tee') return types.get(n[1])
    if (op === 'select') return typeOf(n[1])
    if (op === 'block' || op === 'if') { const r = n.find(c => Array.isArray(c) && c[0] === 'result'); return r?.length === 2 ? r[1] : null }
    if (op === 'call') return callType?.(n[1])
    if (op.includes('.extract_lane')) { const p = op.slice(0, op.indexOf('.')); return p === 'f64x2' ? 'f64' : p === 'f32x4' ? 'f32' : p === 'i64x2' ? 'i64' : 'i32' }
    if (/^(v128|[if](8x16|16x8|32x4|64x2))\./.test(op)) return op.endsWith('any_true') || op.endsWith('all_true') || op.endsWith('bitmask') ? 'i32' : 'v128'
    return resultType(op)
  }
  let minted = 0
  const decls = []
  const processLoop = (loop, nested) => {
    visit(loop, true)
    const accept = analyze(loop, nested)
    const counts = new Map(), writes = new Map(), emptyCounts = new Map(), emptyWrites = new Set()
    const countsOf = n => {
      if (!Array.isArray(n)) return emptyCounts
      let m = counts.get(n)
      if (m) return m
      m = new Map()
      if (n[0] === 'local.get' || n[0] === 'local.set' || n[0] === 'local.tee') m.set(n[1], 1)
      for (let i = 1; i < n.length; i++) for (const [k, v] of countsOf(n[i])) m.set(k, (m.get(k) || 0) + v)
      counts.set(n, m)
      return m
    }
    const writesOf = n => {
      if (!Array.isArray(n)) return emptyWrites
      let s = writes.get(n)
      if (s) return s
      s = new Set()
      if (n[0] === 'local.set' || n[0] === 'local.tee') s.add(n[1])
      for (let i = 1; i < n.length; i++) for (const k of writesOf(n[i])) s.add(k)
      writes.set(n, s)
      return s
    }
    const sites = new Map()
    const collect = (n, parent, idx) => {
      if (!Array.isArray(n) || n[0] === 'loop' || refs.get(n) > 1) return
      const op = n[0]
      if (op === 'local.get' || op === 'global.get' || op.endsWith('.const')) return
      const bound = writesOf(n)
      let privateWrites = true
      for (const k of bound) if (localCounts.get(k) !== countsOf(n).get(k)) { privateWrites = false; break }
      if (privateWrites && accept(n, bound) && (refs.get(n) || 0) <= 1 && (refs.get(parent) || 0) <= 1 && typeOf(n)) {
        const key = structuralKey(n)
        let found = sites.get(key)
        if (!found) sites.set(key, found = [])
        found.push({ parent, idx, node: n })
        return
      }
      for (let i = 1; i < n.length; i++) collect(n[i], n, i)
    }
    for (let i = 1; i < loop.length; i++) collect(loop[i], loop, i)
    const hoisted = []
    for (const [, found] of sites) {
      let name
      do { name = prefix + minted++ } while (types.has(name))
      const node = found[0].node, type = typeOf(node)
      types.set(name, type)
      decls.push(['local', name, type])
      hoisted.push(['local.set', name, node])
      if (found.length > 1) for (const [k, v] of countsOf(node))
        localCounts.set(k, localCounts.get(k) - v * (found.length - 1))
      localCounts.set(name, found.length + 1)
      for (const site of found) site.parent[site.idx] = ['local.get', name]
    }
    return hoisted
  }
  const visit = (parent, nested) => {
    for (let i = 1; i < parent.length; i++) {
      const n = parent[i]
      if (!Array.isArray(n) || refs.get(n) > 1) continue
      if (n[0] !== 'loop') { visit(n, nested); continue }
      // A preheader must be a statement list, never another instruction's operands.
      const op = parent[0]
      if (op !== 'func' && op !== 'block' && op !== 'loop' && op !== 'then' && op !== 'else') continue
      const hoisted = processLoop(n, nested)
      if (hoisted.length) { parent.splice(i, 0, ...hoisted); i += hoisted.length }
    }
  }
  visit(fn, false)
  if (decls.length) fn.splice(start, 0, ...decls)
}
