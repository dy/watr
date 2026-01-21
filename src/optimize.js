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
}

/** All optimization names */
const ALL = Object.keys(OPTS)

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
    // If single optimization name, enable just that one
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

// ==================== TREESHAKE ====================

/**
 * Remove unused functions, globals, types, tables.
 * Keeps exports and their transitive dependencies.
 * @param {Array} ast
 * @returns {Array}
 */
const treeshake = (ast) => {
  if (!Array.isArray(ast) || ast[0] !== 'module') return ast

  // Collect all definitions
  const funcs = new Map()    // $name|idx → node
  const globals = new Map()
  const types = new Map()
  const tables = new Map()
  const memories = new Map()
  const exports = []
  const starts = []

  let funcIdx = 0, globalIdx = 0, typeIdx = 0, tableIdx = 0, memIdx = 0, importFuncIdx = 0

  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) continue
    const kind = node[0]

    if (kind === 'type') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : typeIdx
      types.set(name, { node, idx: typeIdx, used: false })
      if (typeof name === 'string') types.set(typeIdx, types.get(name))
      typeIdx++
    }
    else if (kind === 'func') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : funcIdx
      // Check for inline export: (func $name (export "...") ...)
      const hasInlineExport = node.some(sub => Array.isArray(sub) && sub[0] === 'export')
      funcs.set(name, { node, idx: funcIdx, used: hasInlineExport })
      if (typeof name === 'string') funcs.set(funcIdx, funcs.get(name))
      funcIdx++
    }
    else if (kind === 'global') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : globalIdx
      const hasInlineExport = node.some(sub => Array.isArray(sub) && sub[0] === 'export')
      globals.set(name, { node, idx: globalIdx, used: hasInlineExport })
      if (typeof name === 'string') globals.set(globalIdx, globals.get(name))
      globalIdx++
    }
    else if (kind === 'table') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : tableIdx
      const hasInlineExport = node.some(sub => Array.isArray(sub) && sub[0] === 'export')
      tables.set(name, { node, idx: tableIdx, used: hasInlineExport })
      if (typeof name === 'string') tables.set(tableIdx, tables.get(name))
      tableIdx++
    }
    else if (kind === 'memory') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : memIdx
      const hasInlineExport = node.some(sub => Array.isArray(sub) && sub[0] === 'export')
      memories.set(name, { node, idx: memIdx, used: hasInlineExport })
      if (typeof name === 'string') memories.set(memIdx, memories.get(name))
      memIdx++
    }
    else if (kind === 'import') {
      // Imports are always kept; mark as used
      for (const sub of node) {
        if (Array.isArray(sub) && sub[0] === 'func') {
          const name = typeof sub[1] === 'string' && sub[1][0] === '$' ? sub[1] : importFuncIdx
          funcs.set(name, { node, idx: importFuncIdx, used: true, isImport: true })
          if (typeof name === 'string') funcs.set(importFuncIdx, funcs.get(name))
          importFuncIdx++
          funcIdx++
        }
      }
    }
    else if (kind === 'export') {
      exports.push(node)
    }
    else if (kind === 'start') {
      starts.push(node)
    }
  }

  // Mark exports as used
  for (const exp of exports) {
    for (const sub of exp) {
      if (!Array.isArray(sub)) continue
      const [kind, ref] = sub
      if (kind === 'func' && funcs.has(ref)) funcs.get(ref).used = true
      else if (kind === 'global' && globals.has(ref)) globals.get(ref).used = true
      else if (kind === 'table' && tables.has(ref)) tables.get(ref).used = true
      else if (kind === 'memory' && memories.has(ref)) memories.get(ref).used = true
    }
  }

  // Mark start function as used
  for (const start of starts) {
    const ref = start[1]
    if (funcs.has(ref)) funcs.get(ref).used = true
  }

  // Count items with inline exports
  let hasExports = exports.length > 0 || starts.length > 0
  if (!hasExports) {
    for (const [, entry] of funcs) if (entry.used) { hasExports = true; break }
    if (!hasExports) for (const [, entry] of globals) if (entry.used) { hasExports = true; break }
    if (!hasExports) for (const [, entry] of tables) if (entry.used) { hasExports = true; break }
    if (!hasExports) for (const [, entry] of memories) if (entry.used) { hasExports = true; break }
  }

  // If no exports/start at all, keep everything (module may be used differently)
  if (!hasExports) {
    for (const [, entry] of funcs) entry.used = true
    for (const [, entry] of globals) entry.used = true
    for (const [, entry] of tables) entry.used = true
    for (const [, entry] of memories) entry.used = true
  }

  // Mark elem-referenced functions as used
  for (const node of ast.slice(1)) {
    if (!Array.isArray(node) || node[0] !== 'elem') continue
    walk(node, n => {
      if (Array.isArray(n) && n[0] === 'ref.func') {
        const ref = n[1]
        if (funcs.has(ref)) funcs.get(ref).used = true
      }
      // Also plain func refs in elem
      if (typeof n === 'string' && n[0] === '$' && funcs.has(n)) funcs.get(n).used = true
    })
  }

  // Propagate: find dependencies of used functions
  let changed = true
  while (changed) {
    changed = false
    for (const [, entry] of funcs) {
      if (!entry.used || entry.isImport) continue
      walk(entry.node, n => {
        if (!Array.isArray(n)) {
          // Direct func reference
          if (typeof n === 'string' && n[0] === '$' && funcs.has(n) && !funcs.get(n).used) {
            funcs.get(n).used = true
            changed = true
          }
          return
        }
        const [op, ref] = n
        if ((op === 'call' || op === 'return_call' || op === 'ref.func') && funcs.has(ref) && !funcs.get(ref).used) {
          funcs.get(ref).used = true
          changed = true
        }
        if ((op === 'global.get' || op === 'global.set') && globals.has(ref) && !globals.get(ref).used) {
          globals.get(ref).used = true
          changed = true
        }
        if (op === 'call_indirect' || op === 'return_call_indirect') {
          // Tables used by call_indirect
          for (const sub of n) {
            if (typeof sub === 'string' && sub[0] === '$' && tables.has(sub) && !tables.get(sub).used) {
              tables.get(sub).used = true
              changed = true
            }
          }
        }
        if (op === 'type' && types.has(ref) && !types.get(ref).used) {
          types.get(ref).used = true
          changed = true
        }
      })
    }
  }

  // Filter AST keeping only used items
  const result = ['module']
  for (const node of ast.slice(1)) {
    if (!Array.isArray(node)) { result.push(node); continue }
    const kind = node[0]

    if (kind === 'func') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
      const entry = name ? funcs.get(name) : [...funcs.values()].find(e => e.node === node)
      if (entry?.used) result.push(node)
    }
    else if (kind === 'global') {
      const name = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
      const entry = name ? globals.get(name) : [...globals.values()].find(e => e.node === node)
      if (entry?.used) result.push(node)
    }
    else if (kind === 'type') {
      // Keep all types for now (complex to treeshake due to inline types)
      result.push(node)
    }
    else {
      result.push(node)
    }
  }

  return result
}

// ==================== CONSTANT FOLDING ====================

/** Operators that can be constant-folded */
const FOLDABLE = {
  // i32
  'i32.add': (a, b) => (a + b) | 0,
  'i32.sub': (a, b) => (a - b) | 0,
  'i32.mul': (a, b) => Math.imul(a, b),
  'i32.div_s': (a, b) => b !== 0 ? (a / b) | 0 : null,
  'i32.div_u': (a, b) => b !== 0 ? ((a >>> 0) / (b >>> 0)) | 0 : null,
  'i32.rem_s': (a, b) => b !== 0 ? (a % b) | 0 : null,
  'i32.rem_u': (a, b) => b !== 0 ? ((a >>> 0) % (b >>> 0)) | 0 : null,
  'i32.and': (a, b) => a & b,
  'i32.or': (a, b) => a | b,
  'i32.xor': (a, b) => a ^ b,
  'i32.shl': (a, b) => a << (b & 31),
  'i32.shr_s': (a, b) => a >> (b & 31),
  'i32.shr_u': (a, b) => a >>> (b & 31),
  'i32.rotl': (a, b) => { b &= 31; return ((a << b) | (a >>> (32 - b))) | 0 },
  'i32.rotr': (a, b) => { b &= 31; return ((a >>> b) | (a << (32 - b))) | 0 },
  'i32.eq': (a, b) => a === b ? 1 : 0,
  'i32.ne': (a, b) => a !== b ? 1 : 0,
  'i32.lt_s': (a, b) => a < b ? 1 : 0,
  'i32.lt_u': (a, b) => (a >>> 0) < (b >>> 0) ? 1 : 0,
  'i32.gt_s': (a, b) => a > b ? 1 : 0,
  'i32.gt_u': (a, b) => (a >>> 0) > (b >>> 0) ? 1 : 0,
  'i32.le_s': (a, b) => a <= b ? 1 : 0,
  'i32.le_u': (a, b) => (a >>> 0) <= (b >>> 0) ? 1 : 0,
  'i32.ge_s': (a, b) => a >= b ? 1 : 0,
  'i32.ge_u': (a, b) => (a >>> 0) >= (b >>> 0) ? 1 : 0,
  'i32.eqz': (a) => a === 0 ? 1 : 0,
  'i32.clz': (a) => Math.clz32(a),
  'i32.ctz': (a) => a === 0 ? 32 : 31 - Math.clz32(a & -a),
  'i32.popcnt': (a) => { let c = 0; while (a) { c += a & 1; a >>>= 1 } return c },
  'i32.wrap_i64': (a) => Number(BigInt.asIntN(32, a)),

  // i64 (using BigInt)
  'i64.add': (a, b) => BigInt.asIntN(64, a + b),
  'i64.sub': (a, b) => BigInt.asIntN(64, a - b),
  'i64.mul': (a, b) => BigInt.asIntN(64, a * b),
  'i64.div_s': (a, b) => b !== 0n ? BigInt.asIntN(64, a / b) : null,
  'i64.div_u': (a, b) => b !== 0n ? BigInt.asUintN(64, BigInt.asUintN(64, a) / BigInt.asUintN(64, b)) : null,
  'i64.rem_s': (a, b) => b !== 0n ? BigInt.asIntN(64, a % b) : null,
  'i64.rem_u': (a, b) => b !== 0n ? BigInt.asUintN(64, BigInt.asUintN(64, a) % BigInt.asUintN(64, b)) : null,
  'i64.and': (a, b) => BigInt.asIntN(64, a & b),
  'i64.or': (a, b) => BigInt.asIntN(64, a | b),
  'i64.xor': (a, b) => BigInt.asIntN(64, a ^ b),
  'i64.shl': (a, b) => BigInt.asIntN(64, a << (b & 63n)),
  'i64.shr_s': (a, b) => BigInt.asIntN(64, a >> (b & 63n)),
  'i64.shr_u': (a, b) => BigInt.asUintN(64, BigInt.asUintN(64, a) >> (b & 63n)),
  'i64.eq': (a, b) => a === b ? 1 : 0,
  'i64.ne': (a, b) => a !== b ? 1 : 0,
  'i64.lt_s': (a, b) => a < b ? 1 : 0,
  'i64.lt_u': (a, b) => BigInt.asUintN(64, a) < BigInt.asUintN(64, b) ? 1 : 0,
  'i64.gt_s': (a, b) => a > b ? 1 : 0,
  'i64.gt_u': (a, b) => BigInt.asUintN(64, a) > BigInt.asUintN(64, b) ? 1 : 0,
  'i64.le_s': (a, b) => a <= b ? 1 : 0,
  'i64.le_u': (a, b) => BigInt.asUintN(64, a) <= BigInt.asUintN(64, b) ? 1 : 0,
  'i64.ge_s': (a, b) => a >= b ? 1 : 0,
  'i64.ge_u': (a, b) => BigInt.asUintN(64, a) >= BigInt.asUintN(64, b) ? 1 : 0,
  'i64.eqz': (a) => a === 0n ? 1 : 0,
  'i64.extend_i32_s': (a) => BigInt(a),
  'i64.extend_i32_u': (a) => BigInt(a >>> 0),

  // f32/f64 - be careful with NaN/precision
  'f32.add': (a, b) => Math.fround(a + b),
  'f32.sub': (a, b) => Math.fround(a - b),
  'f32.mul': (a, b) => Math.fround(a * b),
  'f32.div': (a, b) => Math.fround(a / b),
  'f32.neg': (a) => Math.fround(-a),
  'f32.abs': (a) => Math.fround(Math.abs(a)),
  'f32.sqrt': (a) => Math.fround(Math.sqrt(a)),
  'f32.ceil': (a) => Math.fround(Math.ceil(a)),
  'f32.floor': (a) => Math.fround(Math.floor(a)),
  'f32.trunc': (a) => Math.fround(Math.trunc(a)),
  'f32.nearest': (a) => Math.fround(Math.round(a)),

  'f64.add': (a, b) => a + b,
  'f64.sub': (a, b) => a - b,
  'f64.mul': (a, b) => a * b,
  'f64.div': (a, b) => a / b,
  'f64.neg': (a) => -a,
  'f64.abs': (a) => Math.abs(a),
  'f64.sqrt': (a) => Math.sqrt(a),
  'f64.ceil': (a) => Math.ceil(a),
  'f64.floor': (a) => Math.floor(a),
  'f64.trunc': (a) => Math.trunc(a),
  'f64.nearest': (a) => Math.round(a),
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
    const op = node[0]
    const fn = FOLDABLE[op]
    if (!fn) return

    // Unary ops
    if (fn.length === 1 && node.length === 2) {
      const a = getConst(node[1])
      if (!a) return
      const result = fn(a.value)
      if (result === null) return
      const resultType = op.startsWith('i64.') && !op.includes('eqz') ? 'i64' :
                         op.startsWith('f32.') ? 'f32' :
                         op.startsWith('f64.') ? 'f64' : 'i32'
      return makeConst(resultType, result)
    }

    // Binary ops
    if (fn.length === 2 && node.length === 3) {
      const a = getConst(node[1])
      const b = getConst(node[2])
      if (!a || !b) return
      const result = fn(a.value, b.value)
      if (result === null) return
      // Comparisons return i32
      const isCompare = /\.(eq|ne|[lg][te])/.test(op)
      const resultType = isCompare ? 'i32' :
                         op.startsWith('i64.') ? 'i64' :
                         op.startsWith('f32.') ? 'f32' :
                         op.startsWith('f64.') ? 'f64' : 'i32'
      return makeConst(resultType, result)
    }
  })
}

// ==================== IDENTITY REMOVAL ====================

/** Identity operations that can be simplified */
const IDENTITIES = {
  // x + 0 → x, 0 + x → x
  'i32.add': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0) return b
    if (cb?.value === 0) return a
    return null
  },
  'i64.add': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0n) return b
    if (cb?.value === 0n) return a
    return null
  },
  // x - 0 → x
  'i32.sub': (a, b) => getConst(b)?.value === 0 ? a : null,
  'i64.sub': (a, b) => getConst(b)?.value === 0n ? a : null,
  // x * 1 → x, 1 * x → x
  'i32.mul': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 1) return b
    if (cb?.value === 1) return a
    return null
  },
  'i64.mul': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 1n) return b
    if (cb?.value === 1n) return a
    return null
  },
  // x / 1 → x
  'i32.div_s': (a, b) => getConst(b)?.value === 1 ? a : null,
  'i32.div_u': (a, b) => getConst(b)?.value === 1 ? a : null,
  'i64.div_s': (a, b) => getConst(b)?.value === 1n ? a : null,
  'i64.div_u': (a, b) => getConst(b)?.value === 1n ? a : null,
  // x & -1 → x, -1 & x → x (all bits set)
  'i32.and': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === -1) return b
    if (cb?.value === -1) return a
    return null
  },
  'i64.and': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === -1n) return b
    if (cb?.value === -1n) return a
    return null
  },
  // x | 0 → x, 0 | x → x
  'i32.or': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0) return b
    if (cb?.value === 0) return a
    return null
  },
  'i64.or': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0n) return b
    if (cb?.value === 0n) return a
    return null
  },
  // x ^ 0 → x, 0 ^ x → x
  'i32.xor': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0) return b
    if (cb?.value === 0) return a
    return null
  },
  'i64.xor': (a, b) => {
    const ca = getConst(a), cb = getConst(b)
    if (ca?.value === 0n) return b
    if (cb?.value === 0n) return a
    return null
  },
  // x << 0 → x, x >> 0 → x
  'i32.shl': (a, b) => getConst(b)?.value === 0 ? a : null,
  'i32.shr_s': (a, b) => getConst(b)?.value === 0 ? a : null,
  'i32.shr_u': (a, b) => getConst(b)?.value === 0 ? a : null,
  'i64.shl': (a, b) => getConst(b)?.value === 0n ? a : null,
  'i64.shr_s': (a, b) => getConst(b)?.value === 0n ? a : null,
  'i64.shr_u': (a, b) => getConst(b)?.value === 0n ? a : null,
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
      // Find condition - first non-annotation child that's an expression
      let condIdx = 1
      while (condIdx < node.length) {
        const child = node[condIdx]
        if (Array.isArray(child) && (child[0] === 'then' || child[0] === 'else' || child[0] === 'result' || child[0] === 'param')) {
          condIdx++
          continue
        }
        break
      }

      const cond = node[condIdx]
      const c = getConst(cond)
      if (!c) return

      // Find then/else branches
      let thenBranch = null, elseBranch = null
      for (let i = condIdx + 1; i < node.length; i++) {
        const child = node[i]
        if (Array.isArray(child)) {
          if (child[0] === 'then') thenBranch = child
          else if (child[0] === 'else') elseBranch = child
        }
      }

      // Condition is truthy → replace with then contents
      if (c.value !== 0 && c.value !== 0n) {
        if (thenBranch && thenBranch.length > 1) {
          // Return block with then contents (or just contents if single)
          const contents = thenBranch.slice(1)
          if (contents.length === 1) return contents[0]
          return ['block', ...contents]
        }
        return ['nop']
      }
      // Condition is falsy → replace with else contents
      else {
        if (elseBranch && elseBranch.length > 1) {
          const contents = elseBranch.slice(1)
          if (contents.length === 1) return contents[0]
          return ['block', ...contents]
        }
        return ['nop']
      }
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
        localDecls.push({ idx: i, node: sub })
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

// ==================== CONSTANT PROPAGATION ====================

/**
 * Propagate constant values through local variables.
 * When a local is set to a constant and not modified before use, replace the get with the constant.
 * @param {Array} ast
 * @returns {Array}
 */
const propagate = (ast) => {
  const result = clone(ast)

  walk(result, (node) => {
    if (!Array.isArray(node) || node[0] !== 'func') return

    // Track which locals have known constant values
    // This is a simple single-pass analysis within straight-line code
    const constLocals = new Map() // $name → const node

    // Process function body in order
    const processBlock = (block, startIdx = 1) => {
      for (let i = startIdx; i < block.length; i++) {
        const instr = block[i]
        if (!Array.isArray(instr)) continue

        const op = instr[0]

        // local.set $x (const) → remember constant
        if (op === 'local.set' && instr.length === 3) {
          const local = instr[1]
          const val = instr[2]
          const c = getConst(val)
          if (c && typeof local === 'string') {
            constLocals.set(local, val)
          } else if (typeof local === 'string') {
            constLocals.delete(local) // invalidate if set to non-const
          }
        }
        // local.tee also sets
        else if (op === 'local.tee' && instr.length === 3) {
          const local = instr[1]
          const val = instr[2]
          const c = getConst(val)
          if (c && typeof local === 'string') {
            constLocals.set(local, val)
          } else if (typeof local === 'string') {
            constLocals.delete(local)
          }
        }
        // local.get $x → replace with const if known
        else if (op === 'local.get' && instr.length === 2) {
          const local = instr[1]
          if (typeof local === 'string' && constLocals.has(local)) {
            const constVal = constLocals.get(local)
            // Replace in place
            instr.length = 0
            instr.push(...clone(constVal))
          }
        }
        // Control flow invalidates all knowledge (conservative)
        else if (op === 'block' || op === 'loop' || op === 'if' || op === 'call' || op === 'call_indirect') {
          constLocals.clear()
        }

        // Recursively process nested expressions that might have local.get
        walkPost(instr, (n) => {
          if (!Array.isArray(n) || n[0] !== 'local.get' || n.length !== 2) return
          const local = n[1]
          if (typeof local === 'string' && constLocals.has(local)) {
            const constVal = constLocals.get(local)
            return clone(constVal)
          }
        })
      }
    }

    processBlock(node)
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

    // Only inline: no locals, <= 2 params, single expression body, not exported
    if (params && !hasLocals && !hasExport && params.length <= 2 && body.length === 1) {
      inlinable.set(name, { body: body[0], params })
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

// ==================== COMMON SUBEXPRESSION ELIMINATION ====================

/**
 * Hash an expression for comparison.
 * @param {any} node
 * @returns {string}
 */
const exprHash = (node) => JSON.stringify(node)

/**
 * Eliminate common subexpressions by caching repeated computations.
 * Limited to pure expressions within a function.
 * @param {Array} ast
 * @returns {Array}
 */
const cse = (ast) => {
  // CSE is complex and can increase code size (extra locals)
  // Simple version: detect and report, but actual elimination needs careful analysis
  // For now, implement a basic version that works on adjacent identical expressions

  const result = clone(ast)

  walk(result, (node) => {
    if (!Array.isArray(node) || node[0] !== 'func') return

    // Find sequences of identical pure expressions
    const seen = new Map() // hash → { node, count }

    walk(node, (n) => {
      if (!Array.isArray(n)) return
      const op = n[0]
      // Only consider pure operations
      if (!op || typeof op !== 'string') return
      if (op.startsWith('i32.') || op.startsWith('i64.') || op.startsWith('f32.') || op.startsWith('f64.')) {
        // Skip simple consts
        if (op.endsWith('.const')) return
        // Skip if has side effects (calls, memory ops)
        let hasSideEffects = false
        walk(n, (sub) => {
          if (Array.isArray(sub) && (sub[0] === 'call' || sub[0]?.includes('load') || sub[0]?.includes('store'))) {
            hasSideEffects = true
          }
        })
        if (hasSideEffects) return

        const hash = exprHash(n)
        if (seen.has(hash)) {
          seen.get(hash).count++
        } else {
          seen.set(hash, { node: n, count: 1 })
        }
      }
    })

    // For now, just report - full CSE would require inserting locals
    // which changes the function structure significantly
  })

  return result
}

// ==================== LOOP INVARIANT HOISTING ====================

/**
 * Hoist loop-invariant computations out of loops.
 * @param {Array} ast
 * @returns {Array}
 */
const hoist = (ast) => {
  const result = clone(ast)

  walk(result, (node) => {
    if (!Array.isArray(node) || node[0] !== 'func') return

    // Find loops
    walk(node, (loopNode, parent, idx) => {
      if (!Array.isArray(loopNode) || loopNode[0] !== 'loop') return

      // Collect all locals modified in loop
      const modifiedLocals = new Set()
      walk(loopNode, (n) => {
        if (!Array.isArray(n)) return
        if (n[0] === 'local.set' || n[0] === 'local.tee') {
          if (typeof n[1] === 'string') modifiedLocals.add(n[1])
        }
      })

      // Find invariant expressions (don't depend on modified locals or memory)
      const invariants = []

      for (let i = 1; i < loopNode.length; i++) {
        const instr = loopNode[i]
        if (!Array.isArray(instr)) continue

        const op = instr[0]
        // Skip control flow
        if (op === 'block' || op === 'loop' || op === 'if' || op === 'br' || op === 'br_if') continue

        // Check if pure and invariant
        let isInvariant = true
        let isPure = true

        walk(instr, (n) => {
          if (!Array.isArray(n)) return
          const subOp = n[0]
          // Side effects
          if (subOp === 'call' || subOp === 'call_indirect' || subOp?.includes('store') || subOp?.includes('load')) {
            isPure = false
          }
          // Depends on modified local
          if (subOp === 'local.get' && typeof n[1] === 'string' && modifiedLocals.has(n[1])) {
            isInvariant = false
          }
        })

        // Only hoist simple const expressions for safety
        if (isPure && isInvariant && op?.endsWith('.const')) {
          // Actually, consts are already cheap - skip
        }
      }

      // Full hoisting would require inserting code before the loop
      // This is complex and risky, so we keep it minimal
    })
  })

  return result
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

  if (opts.fold) ast = fold(ast)
  if (opts.identity) ast = identity(ast)
  if (opts.strength) ast = strength(ast)
  if (opts.branch) ast = branch(ast)
  if (opts.propagate) ast = propagate(ast)
  if (opts.inline) ast = inline(ast)
  if (opts.deadcode) ast = deadcode(ast)
  if (opts.locals) ast = localReuse(ast)
  if (opts.treeshake) ast = treeshake(ast)

  return ast
}

export { optimize, treeshake, fold, deadcode, localReuse, identity, strength, branch, propagate, inline, normalize, OPTS }
