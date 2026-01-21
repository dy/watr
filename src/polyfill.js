/**
 * Polyfill transforms for newer WebAssembly features to MVP-compatible code.
 * Transforms AST before compilation to enable running on older runtimes.
 *
 * @module watr/polyfill
 */

import parse from './parse.js'

/** Features that can be polyfilled */
const FEATURES = {
  funcref: ['ref.func', 'call_ref', 'return_call_ref'],
  // Future: struct, array, i31, externref
}

/** All feature names */
const ALL = Object.keys(FEATURES)

/**
 * Normalize polyfill options to { feature: bool } map.
 * @param {boolean|string|Object} opts
 * @returns {Object} Normalized options
 */
const normalize = (opts) => {
  if (opts === true) return Object.fromEntries(ALL.map(f => [f, true]))
  if (opts === false) return {}
  if (typeof opts === 'string') {
    const set = new Set(opts.split(/\s+/).filter(Boolean))
    return Object.fromEntries(ALL.map(f => [f, set.has(f) || set.has('all')]))
  }
  return { ...opts }
}

/**
 * Walk AST depth-first (pre-order), call fn on each node.
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
 * @param {any} node
 * @param {Function} fn - (node, parent, idx) => void
 * @param {any} [parent]
 * @param {number} [idx]
 */
const walkPost = (node, fn, parent, idx) => {
  if (Array.isArray(node)) for (let i = 0; i < node.length; i++) walkPost(node[i], fn, node, i)
  fn(node, parent, idx)
}

/**
 * Detect which polyfillable features are used in AST.
 * @param {Array} ast
 * @returns {Set<string>} Set of feature names
 */
const detect = (ast) => {
  const used = new Set()
  walk(ast, node => {
    if (typeof node !== 'string') return
    for (const [feat, ops] of Object.entries(FEATURES)) {
      if (ops.some(op => node === op || node.startsWith(op + ' '))) used.add(feat)
    }
  })
  return used
}

/**
 * Deep clone AST to avoid mutating original.
 * @param {any} node
 * @returns {any}
 */
const clone = (node) => Array.isArray(node) ? node.map(clone) : node

/**
 * Find module-level nodes by kind (func, table, etc).
 * @param {Array} ast - Module AST
 * @param {string} kind
 * @returns {Array} Matching nodes
 */
const findNodes = (ast, kind) => {
  const nodes = []
  const start = ast[0] === 'module' ? 1 : 0
  for (let i = start; i < ast.length; i++) {
    if (Array.isArray(ast[i]) && ast[i][0] === kind) nodes.push({ node: ast[i], idx: i })
  }
  return nodes
}

/**
 * Insert node into module at position.
 * @param {Array} ast
 * @param {number} idx
 * @param {Array} node
 */
const insert = (ast, idx, node) => ast.splice(idx, 0, node)

/**
 * Generate unique id.
 */
let uid = 0
const genId = (prefix) => `$__${prefix}${uid++}`

// ============================================================================
// FUNCREF POLYFILL
// Transforms funcref usage to table indirection.
// ref.func $f → i32 index into polyfill table
// call_ref → call_indirect via polyfill table
// ============================================================================

/**
 * Transform funcref to table indirection.
 * @param {Array} ast - Module AST (cloned)
 * @param {Object} ctx - Transform context
 * @returns {Array} Transformed AST
 */
const funcref = (ast, ctx) => {
  // Collect all ref.func targets
  const refs = new Set()
  walk(ast, node => {
    if (Array.isArray(node) && node[0] === 'ref.func') refs.add(node[1])
  })

  if (!refs.size) return ast

  // Create polyfill table with elem for referenced functions
  const tableId = genId('fntbl')
  const refList = [...refs]
  const refIdx = Object.fromEntries(refList.map((r, i) => [r, i]))

  // Find insert position (after imports, before funcs)
  const funcs = findNodes(ast, 'func')
  const insertPos = funcs.length ? funcs[0].idx : (ast[0] === 'module' ? 1 : 0)

  // Insert table with inline elem: (table $id funcref (elem $f1 $f2 ...))
  insert(ast, insertPos, ['table', tableId, 'funcref', ['elem', ...refList]])

  // Collect function signatures for call_indirect
  const funcSigs = {}
  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'func') return
    const id = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!id) return
    // Extract type info
    const params = [], results = []
    for (const part of node) {
      if (Array.isArray(part) && part[0] === 'param') {
        for (let i = 1; i < part.length; i++) if (part[i][0] !== '$') params.push(part[i])
      }
      if (Array.isArray(part) && part[0] === 'result') {
        for (let i = 1; i < part.length; i++) results.push(part[i])
      }
    }
    funcSigs[id] = { params, results }
  })

  // Transform instructions (post-order so children are transformed first)
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return

    // ref.func $f → i32.const <idx>
    if (node[0] === 'ref.func' && refIdx[node[1]] !== undefined) {
      parent[idx] = ['i32.const', refIdx[node[1]]]
    }

    // call_ref $type [args...] → call_indirect $tableId (type $type) [args...]
    // The funcref (now i32) should be last arg
    if (node[0] === 'call_ref') {
      const typeRef = node[1] // type index/name
      const args = node.slice(2) // remaining args (funcref is among them, now i32.const)
      parent[idx] = ['call_indirect', tableId, ['type', typeRef], ...args]
    }

    // return_call_ref $type → return_call_indirect
    if (node[0] === 'return_call_ref') {
      const typeRef = node[1]
      const args = node.slice(2)
      parent[idx] = ['return_call_indirect', tableId, ['type', typeRef], ...args]
    }
  })

  return ast
}

/** Feature transforms */
const transforms = { funcref }

/**
 * Apply polyfill transforms to AST.
 *
 * @param {Array|string} ast - Module AST or source string
 * @param {boolean|string|Object} [opts=true] - Polyfill options
 *   - true: polyfill all detected features
 *   - 'funcref struct': space-separated feature list
 *   - { funcref: true, struct: false }: feature map
 * @returns {Array} Transformed AST
 *
 * @example
 * polyfill(ast)                      // auto-detect and polyfill all
 * polyfill(ast, 'funcref')           // only funcref
 * polyfill(ast, { funcref: true })   // explicit
 */
export default function polyfill(ast, opts = true) {
  if (typeof ast === 'string') ast = parse(ast)
  ast = clone(ast)
  opts = normalize(opts)

  const used = detect(ast)
  const ctx = { uid: 0 }

  for (const feat of ALL) {
    if (used.has(feat) && opts[feat] !== false && transforms[feat]) {
      ast = transforms[feat](ast, ctx)
    }
  }

  return ast
}

export { polyfill, detect, normalize, FEATURES }
