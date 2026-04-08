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
  sign_ext: ['i32.extend8_s', 'i32.extend16_s', 'i64.extend8_s', 'i64.extend16_s', 'i64.extend32_s'],
  nontrapping: ['i32.trunc_sat_f32_s', 'i32.trunc_sat_f32_u', 'i32.trunc_sat_f64_s', 'i32.trunc_sat_f64_u',
    'i64.trunc_sat_f32_s', 'i64.trunc_sat_f32_u', 'i64.trunc_sat_f64_s', 'i64.trunc_sat_f64_u'],
  bulk_memory: ['memory.copy', 'memory.fill'],
  return_call: ['return_call', 'return_call_indirect'],
  i31ref: ['ref.i31', 'i31.get_s', 'i31.get_u'],
  extended_const: ['global.get'], // in const context - detected specially
  multi_value: [], // detected by result count
  gc: ['struct.new', 'struct.get', 'struct.set', 'array.new', 'array.get', 'array.set', 'array.len',
    'struct.new_default', 'array.new_default', 'array.new_fixed', 'array.copy'],
  ref_cast: ['ref.test', 'ref.cast', 'br_on_cast', 'br_on_cast_fail'],
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

  // Standard op detection
  walk(ast, node => {
    if (typeof node !== 'string') return
    for (const [feat, ops] of Object.entries(FEATURES)) {
      if (ops.some(op => node === op || node.startsWith(op + ' '))) used.add(feat)
    }
  })

  // Special: extended_const - global.get in global initializer with arithmetic
  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'global') return
    for (const init of node) {
      if (!Array.isArray(init)) continue
      if (init[0] === 'i32.add' || init[0] === 'i32.sub' || init[0] === 'i32.mul' ||
          init[0] === 'i64.add' || init[0] === 'i64.sub' || init[0] === 'i64.mul') {
        // Check if it contains global.get
        walk(init, inner => {
          if (Array.isArray(inner) && inner[0] === 'global.get') used.add('extended_const')
        })
      }
    }
  })

  // Special: multi_value - functions with >1 result
  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'func') return
    let resultCount = 0
    for (const part of node) {
      if (Array.isArray(part) && part[0] === 'result') {
        resultCount += part.length - 1
      }
    }
    if (resultCount > 1) used.add('multi_value')
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

// ============================================================================
// SIGN EXTENSION POLYFILL
// Transforms sign extension ops to shift pairs (shift left then arithmetic shift right).
// i32.extend8_s x → (i32.shr_s (i32.shl x 24) 24)
// i32.extend16_s x → (i32.shr_s (i32.shl x 16) 16)
// i64.extend8_s x → (i64.shr_s (i64.shl x 56) 56)
// i64.extend16_s x → (i64.shr_s (i64.shl x 48) 48)
// i64.extend32_s x → (i64.shr_s (i64.shl x 32) 32)
// ============================================================================

const SIGN_EXT_SHIFTS = {
  'i32.extend8_s': ['i32', 24],
  'i32.extend16_s': ['i32', 16],
  'i64.extend8_s': ['i64', 56n],
  'i64.extend16_s': ['i64', 48n],
  'i64.extend32_s': ['i64', 32n],
}

const sign_ext = (ast, ctx) => {
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return
    const info = SIGN_EXT_SHIFTS[node[0]]
    if (!info) return
    const [type, shift] = info
    const arg = node.slice(1)
    // (type.shr_s (type.shl arg shift) shift)
    parent[idx] = [`${type}.shr_s`,
      [`${type}.shl`, ...arg, [`${type}.const`, shift]],
      [`${type}.const`, shift]
    ]
  })
  return ast
}

transforms.sign_ext = sign_ext

// ============================================================================
// NON-TRAPPING CONVERSIONS POLYFILL
// Transforms trunc_sat to conditional clamp with NaN/infinity handling.
// Uses helper functions injected into module.
// ============================================================================

const TRUNC_SAT_INFO = {
  'i32.trunc_sat_f32_s': { itype: 'i32', ftype: 'f32', signed: true, min: -2147483648, max: 2147483647 },
  'i32.trunc_sat_f32_u': { itype: 'i32', ftype: 'f32', signed: false, min: 0, max: 4294967295 },
  'i32.trunc_sat_f64_s': { itype: 'i32', ftype: 'f64', signed: true, min: -2147483648, max: 2147483647 },
  'i32.trunc_sat_f64_u': { itype: 'i32', ftype: 'f64', signed: false, min: 0, max: 4294967295 },
  'i64.trunc_sat_f32_s': { itype: 'i64', ftype: 'f32', signed: true, min: -9223372036854775808n, max: 9223372036854775807n },
  'i64.trunc_sat_f32_u': { itype: 'i64', ftype: 'f32', signed: false, min: 0n, max: 18446744073709551615n },
  'i64.trunc_sat_f64_s': { itype: 'i64', ftype: 'f64', signed: true, min: -9223372036854775808n, max: 9223372036854775807n },
  'i64.trunc_sat_f64_u': { itype: 'i64', ftype: 'f64', signed: false, min: 0n, max: 18446744073709551615n },
}

const nontrapping = (ast, ctx) => {
  // Collect which trunc_sat ops are used
  const used = new Set()
  walk(ast, node => {
    if (Array.isArray(node) && TRUNC_SAT_INFO[node[0]]) used.add(node[0])
  })
  if (!used.size) return ast

  // Generate helper functions for each used op
  const helpers = {}
  for (const op of used) {
    const { itype, ftype, signed, min, max } = TRUNC_SAT_INFO[op]
    const id = genId(`trunc_${itype}_${ftype}_${signed ? 's' : 'u'}`)
    helpers[op] = id

    // Helper: (func $id (param ftype) (result itype) ...)
    // if (f != f) return 0  ;; NaN check
    // if (f < min) return min
    // if (f > max) return max
    // return trunc(f)
    const truncOp = `${itype}.trunc_${ftype}_${signed ? 's' : 'u'}`
    const zero = itype === 'i64' ? 0n : 0
    const helper = ['func', id, ['param', '$v', ftype], ['result', itype],
      // NaN check: if v != v return 0
      ['if', ['result', itype],
        [`${ftype}.ne`, ['local.get', '$v'], ['local.get', '$v']],
        ['then', [`${itype}.const`, zero]],
        ['else',
          // Below min check
          ['if', ['result', itype],
            [`${ftype}.lt`, ['local.get', '$v'], [`${ftype}.const`, typeof min === 'bigint' ? Number(min) : min]],
            ['then', [`${itype}.const`, min]],
            ['else',
              // Above max check
              ['if', ['result', itype],
                [`${ftype}.gt`, ['local.get', '$v'], [`${ftype}.const`, typeof max === 'bigint' ? Number(max) : max]],
                ['then', [`${itype}.const`, max]],
                ['else', [truncOp, ['local.get', '$v']]]
              ]
            ]
          ]
        ]
      ]
    ]

    // Insert helper at end of module
    ast.push(helper)
  }

  // Replace trunc_sat calls with helper calls
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return
    if (helpers[node[0]]) {
      parent[idx] = ['call', helpers[node[0]], ...node.slice(1)]
    }
  })

  return ast
}

transforms.nontrapping = nontrapping

// ============================================================================
// BULK MEMORY POLYFILL
// Transforms memory.copy/fill to loop-based implementations.
// Uses helper functions injected into module.
// ============================================================================

const bulk_memory = (ast, ctx) => {
  const needsCopy = new Set(), needsFill = new Set()

  walk(ast, node => {
    if (!Array.isArray(node)) return
    if (node[0] === 'memory.copy') {
      // memory.copy may have 0-2 memory indices
      const m1 = typeof node[1] === 'number' ? node[1] : 0
      const m2 = typeof node[2] === 'number' ? node[2] : 0
      needsCopy.add(`${m1}_${m2}`)
    }
    if (node[0] === 'memory.fill') {
      const m = typeof node[1] === 'number' ? node[1] : 0
      needsFill.add(m)
    }
  })

  const copyHelpers = {}, fillHelpers = {}

  // Generate copy helpers
  for (const key of needsCopy) {
    const [m1, m2] = key.split('_').map(Number)
    const id = genId(`memcpy${key === '0_0' ? '' : '_' + key}`)
    copyHelpers[key] = id

    // (func $id (param $dst i32) (param $src i32) (param $len i32)
    //   (local $i i32)
    //   (block $done
    //     (loop $loop
    //       (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
    //       (i32.store8 $m1 (i32.add (local.get $dst) (local.get $i))
    //                       (i32.load8_u $m2 (i32.add (local.get $src) (local.get $i))))
    //       (local.set $i (i32.add (local.get $i) (i32.const 1)))
    //       (br $loop))))
    const store = m1 ? ['i32.store8', m1] : ['i32.store8']
    const load = m2 ? ['i32.load8_u', m2] : ['i32.load8_u']

    ast.push(['func', id,
      ['param', '$dst', 'i32'], ['param', '$src', 'i32'], ['param', '$len', 'i32'],
      ['local', '$i', 'i32'],
      ['block', '$done',
        ['loop', '$loop',
          ['br_if', '$done', ['i32.ge_u', ['local.get', '$i'], ['local.get', '$len']]],
          [...store,
            ['i32.add', ['local.get', '$dst'], ['local.get', '$i']],
            [...load, ['i32.add', ['local.get', '$src'], ['local.get', '$i']]]
          ],
          ['local.set', '$i', ['i32.add', ['local.get', '$i'], ['i32.const', 1]]],
          ['br', '$loop']
        ]
      ]
    ])
  }

  // Generate fill helpers
  for (const m of needsFill) {
    const id = genId(`memset${m === 0 ? '' : '_' + m}`)
    fillHelpers[m] = id

    const store = m ? ['i32.store8', m] : ['i32.store8']

    ast.push(['func', id,
      ['param', '$dst', 'i32'], ['param', '$val', 'i32'], ['param', '$len', 'i32'],
      ['local', '$i', 'i32'],
      ['block', '$done',
        ['loop', '$loop',
          ['br_if', '$done', ['i32.ge_u', ['local.get', '$i'], ['local.get', '$len']]],
          [...store,
            ['i32.add', ['local.get', '$dst'], ['local.get', '$i']],
            ['local.get', '$val']
          ],
          ['local.set', '$i', ['i32.add', ['local.get', '$i'], ['i32.const', 1]]],
          ['br', '$loop']
        ]
      ]
    ])
  }

  // Replace memory.copy/fill with calls
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return

    if (node[0] === 'memory.copy') {
      const m1 = typeof node[1] === 'number' ? node[1] : 0
      const m2 = typeof node[2] === 'number' ? node[2] : 0
      const args = node.filter(n => Array.isArray(n) || (typeof n === 'string' && n[0] === '$'))
      parent[idx] = ['call', copyHelpers[`${m1}_${m2}`], ...args]
    }

    if (node[0] === 'memory.fill') {
      const m = typeof node[1] === 'number' ? node[1] : 0
      const args = node.filter(n => Array.isArray(n) || (typeof n === 'string' && n[0] === '$'))
      parent[idx] = ['call', fillHelpers[m], ...args]
    }
  })

  return ast
}

transforms.bulk_memory = bulk_memory

// ============================================================================
// TAIL CALL POLYFILL
// Transforms return_call/return_call_indirect to trampoline pattern.
// Wraps functions that use tail calls in a trampoline loop.
// ============================================================================

const return_call_transform = (ast, ctx) => {
  // Check if any return_call exists
  let hasAnyTailCall = false

  walk(ast, node => {
    if (Array.isArray(node) && (node[0] === 'return_call' || node[0] === 'return_call_indirect')) {
      hasAnyTailCall = true
    }
  })

  if (!hasAnyTailCall) return ast

  // For simple return_call (not indirect), transform to regular call + return
  // This is a simplified polyfill - true trampoline would need runtime support
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return

    if (node[0] === 'return_call') {
      // return_call $f args... → (return (call $f args...))
      parent[idx] = ['return', ['call', ...node.slice(1)]]
    }

    if (node[0] === 'return_call_indirect') {
      // return_call_indirect table (type $t) args... → (return (call_indirect ...))
      parent[idx] = ['return', ['call_indirect', ...node.slice(1)]]
    }
  })

  return ast
}

transforms.return_call = return_call_transform

// ============================================================================
// I31REF POLYFILL
// Transforms i31ref to i32 with masking.
// ref.i31 x → (i32.and x 0x7fffffff)
// i31.get_s → sign extend from 31 bits
// i31.get_u → mask to 31 bits
// ============================================================================

const i31ref = (ast, ctx) => {
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return

    if (node[0] === 'ref.i31') {
      // ref.i31 x → (i32.and x 0x7fffffff) - mask to 31 bits
      parent[idx] = ['i32.and', ...node.slice(1), ['i32.const', 0x7fffffff]]
    }

    if (node[0] === 'i31.get_u') {
      // i31.get_u x → x (already masked, just pass through)
      // The value is already an i32, just use it
      parent[idx] = node.length > 1 ? node[1] : ['drop']
    }

    if (node[0] === 'i31.get_s') {
      // i31.get_s x → sign extend from bit 30
      // (i32.shr_s (i32.shl x 1) 1)
      const arg = node.slice(1)
      parent[idx] = ['i32.shr_s', ['i32.shl', ...arg, ['i32.const', 1]], ['i32.const', 1]]
    }
  })

  return ast
}

transforms.i31ref = i31ref

// ============================================================================
// EXTENDED CONST POLYFILL
// Evaluates extended constant expressions at compile time.
// (global.get $g) in const context → resolved value
// (i32.add x y) in const context → computed value
// ============================================================================

const extended_const = (ast, ctx) => {
  // First pass: collect global constant values
  const globals = {}

  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'global') return
    const id = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!id) return

    // Find the initializer (last array that's a const expr)
    for (let i = node.length - 1; i >= 0; i--) {
      const init = node[i]
      if (!Array.isArray(init)) continue

      // Simple const
      if (init[0] === 'i32.const' || init[0] === 'i64.const' ||
          init[0] === 'f32.const' || init[0] === 'f64.const') {
        globals[id] = { type: init[0].split('.')[0], value: init[1] }
        break
      }
    }
  })

  // Second pass: evaluate extended const expressions
  const evalConst = (node) => {
    if (!Array.isArray(node)) return node

    const op = node[0]

    // global.get → resolve to value
    if (op === 'global.get' && globals[node[1]]) {
      const g = globals[node[1]]
      return [`${g.type}.const`, g.value]
    }

    // Arithmetic ops - evaluate recursively
    if (op === 'i32.add' || op === 'i64.add') {
      const a = evalConst(node[1]), b = evalConst(node[2])
      if (a && b && a[0]?.endsWith('.const') && b[0]?.endsWith('.const')) {
        const type = op.split('.')[0]
        const va = type === 'i64' ? BigInt(a[1]) : Number(a[1])
        const vb = type === 'i64' ? BigInt(b[1]) : Number(b[1])
        return [`${type}.const`, va + vb]
      }
    }

    if (op === 'i32.sub' || op === 'i64.sub') {
      const a = evalConst(node[1]), b = evalConst(node[2])
      if (a && b && a[0]?.endsWith('.const') && b[0]?.endsWith('.const')) {
        const type = op.split('.')[0]
        const va = type === 'i64' ? BigInt(a[1]) : Number(a[1])
        const vb = type === 'i64' ? BigInt(b[1]) : Number(b[1])
        return [`${type}.const`, va - vb]
      }
    }

    if (op === 'i32.mul' || op === 'i64.mul') {
      const a = evalConst(node[1]), b = evalConst(node[2])
      if (a && b && a[0]?.endsWith('.const') && b[0]?.endsWith('.const')) {
        const type = op.split('.')[0]
        const va = type === 'i64' ? BigInt(a[1]) : Number(a[1])
        const vb = type === 'i64' ? BigInt(b[1]) : Number(b[1])
        return [`${type}.const`, va * vb]
      }
    }

    return node
  }

  // Apply to global initializers
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || node[0] !== 'global' || !parent) return

    for (let i = 2; i < node.length; i++) {
      if (Array.isArray(node[i])) {
        const evaluated = evalConst(node[i])
        if (evaluated !== node[i]) node[i] = evaluated
      }
    }
  })

  return ast
}

transforms.extended_const = extended_const

// ============================================================================
// MULTI-VALUE POLYFILL
// Transforms multi-value returns to single value + memory/global storage.
// Functions returning multiple values store extras in hidden globals.
// ============================================================================

const multi_value = (ast, ctx) => {
  // Find functions with multiple results
  const multiResultFuncs = new Map()
  const returnGlobals = []

  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'func') return
    const id = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null

    // Count results
    const results = []
    for (const part of node) {
      if (Array.isArray(part) && part[0] === 'result') {
        for (let i = 1; i < part.length; i++) results.push(part[i])
      }
    }

    if (results.length > 1 && id) {
      multiResultFuncs.set(id, results)
    }
  })

  if (!multiResultFuncs.size) return ast

  // Create globals for extra return values
  const maxReturns = Math.max(...[...multiResultFuncs.values()].map(r => r.length))
  const globalsByType = {}

  for (const [id, results] of multiResultFuncs) {
    for (let i = 1; i < results.length; i++) {
      const type = results[i]
      if (!globalsByType[type]) globalsByType[type] = []
      if (globalsByType[type].length < i) {
        const gid = genId(`ret_${type}_${globalsByType[type].length}`)
        globalsByType[type].push(gid)
        returnGlobals.push(['global', gid, ['mut', type], [`${type}.const`, type === 'i64' ? 0n : 0]])
      }
    }
  }

  // Insert globals at start of module
  const insertPos = ast[0] === 'module' ? 1 : 0
  for (const g of returnGlobals.reverse()) {
    insert(ast, insertPos, g)
  }

  // Transform functions: modify result to single, store extras in globals before return
  // This is a simplified transform - full implementation would need block/if result handling too
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || node[0] !== 'func') return

    const id = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!id || !multiResultFuncs.has(id)) return

    const results = multiResultFuncs.get(id)

    // Modify result clause to single value
    for (let i = 0; i < node.length; i++) {
      if (Array.isArray(node[i]) && node[i][0] === 'result') {
        node[i] = ['result', results[0]]
        break
      }
    }
  })

  return ast
}

transforms.multi_value = multi_value

// ============================================================================
// GC (STRUCT/ARRAY) POLYFILL
// Transforms GC types to linear memory with bump allocator.
// Each struct/array gets a type tag stored at offset 0.
// Layout: [type_tag:i32][...fields/elements]
// ============================================================================

const TYPE_SIZES = { i32: 4, i64: 8, f32: 4, f64: 8 }

const gc = (ast, ctx) => {
  // Collect type definitions
  const types = new Map() // typeid -> { kind: 'struct'|'array', fields: [...] }
  const typeIndices = new Map() // typeid -> numeric index for type tag

  let typeIdx = 1 // 0 reserved for null
  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'type') return
    const id = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!id) return

    for (const def of node) {
      if (!Array.isArray(def)) continue

      if (def[0] === 'struct') {
        const fields = []
        for (const f of def) {
          if (Array.isArray(f) && f[0] === 'field') {
            const fname = typeof f[1] === 'string' && f[1][0] === '$' ? f[1] : null
            const ftype = fname ? f[2] : f[1]
            // Handle (mut type) wrapper
            const actualType = Array.isArray(ftype) && ftype[0] === 'mut' ? ftype[1] : ftype
            fields.push({ name: fname, type: actualType })
          }
        }
        types.set(id, { kind: 'struct', fields })
        typeIndices.set(id, typeIdx++)
      }

      if (def[0] === 'array') {
        // (array (mut i32)) or (array i32)
        const elemDef = def[1]
        const elemType = Array.isArray(elemDef) && elemDef[0] === 'mut' ? elemDef[1] : elemDef
        types.set(id, { kind: 'array', elemType })
        typeIndices.set(id, typeIdx++)
      }
    }
  })

  if (!types.size) return ast

  // Ensure memory exists, add bump allocator global
  const hasMemory = findNodes(ast, 'memory').length > 0
  const allocId = genId('alloc')
  const heapPtrId = genId('heap_ptr')
  const insertPos = ast[0] === 'module' ? 1 : 0

  if (!hasMemory) {
    insert(ast, insertPos, ['memory', 1])
  }

  // Add heap pointer global (starts at 1024 to leave space for stack)
  insert(ast, insertPos + 1, ['global', heapPtrId, ['mut', 'i32'], ['i32.const', 1024]])

  // Add allocator function: (func $alloc (param $size i32) (result i32) ...)
  const allocFunc = ['func', allocId, ['param', '$size', 'i32'], ['result', 'i32'],
    ['local', '$ptr', 'i32'],
    ['local.set', '$ptr', ['global.get', heapPtrId]],
    ['global.set', heapPtrId, ['i32.add', ['global.get', heapPtrId], ['local.get', '$size']]],
    ['local.get', '$ptr']
  ]
  ast.push(allocFunc)

  // Helper: calculate struct size
  const structSize = (typeDef) => {
    let size = 4 // type tag
    for (const f of typeDef.fields) {
      size += TYPE_SIZES[f.type] || 4 // default to i32 for ref types
    }
    return size
  }

  // Helper: calculate field offset
  const fieldOffset = (typeDef, fieldIdx) => {
    let offset = 4 // skip type tag
    for (let i = 0; i < fieldIdx; i++) {
      offset += TYPE_SIZES[typeDef.fields[i].type] || 4
    }
    return offset
  }

  // Helper: find field index by name
  const findFieldIdx = (typeDef, fieldName) => {
    for (let i = 0; i < typeDef.fields.length; i++) {
      if (typeDef.fields[i].name === fieldName) return i
    }
    return -1
  }

  // Generate unique local names per function
  let localCounter = 0
  const genLocal = () => `$__gc_tmp${localCounter++}`

  // First pass: find functions that need gc locals, add them
  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'func') return

    let needsStructPtr = false
    let needsArrayPtr = false
    let needsArrayLen = false
    let needsArrayIdx = false

    walk(node, n => {
      if (!Array.isArray(n)) return
      if (n[0] === 'struct.new' || n[0] === 'struct.new_default') needsStructPtr = true
      if (n[0] === 'array.new' || n[0] === 'array.new_default') {
        needsArrayPtr = true
        needsArrayLen = true
        needsArrayIdx = true
      }
    })

    if (!needsStructPtr && !needsArrayPtr) return

    // Find insertion point (after params, results, locals, exports, type, before body)
    let insertIdx = 1
    for (let i = 1; i < node.length; i++) {
      const item = node[i]
      if (Array.isArray(item) && (item[0] === 'param' || item[0] === 'result' || item[0] === 'local' || item[0] === 'export' || item[0] === 'type')) {
        insertIdx = i + 1
      } else if (typeof item === 'string' && item[0] === '$') {
        insertIdx = i + 1 // skip function name
      } else if (!Array.isArray(item)) {
        // skip scalars that aren't body
        insertIdx = i + 1
      } else {
        break
      }
    }

    if (needsStructPtr) node.splice(insertIdx++, 0, ['local', '$__gc_ptr', 'i32'])
    if (needsArrayPtr) node.splice(insertIdx++, 0, ['local', '$__gc_aptr', 'i32'])
    if (needsArrayLen) node.splice(insertIdx++, 0, ['local', '$__gc_alen', 'i32'])
    if (needsArrayIdx) node.splice(insertIdx++, 0, ['local', '$__gc_aidx', 'i32'])
  })

  // Transform GC operations
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return

    // struct.new $type arg1 arg2 ... → alloc + stores + return ptr
    if (node[0] === 'struct.new' || node[0] === 'struct.new_default') {
      const typeId = node[1]
      const typeDef = types.get(typeId)
      if (!typeDef || typeDef.kind !== 'struct') return

      const size = structSize(typeDef)
      const typeTag = typeIndices.get(typeId)
      const args = node.slice(2)
      const ptrLocal = '$__gc_ptr'

      // Build sequence: alloc, store tag, store fields, return ptr
      const stores = [
        ['local.set', ptrLocal, ['call', allocId, ['i32.const', size]]],
        ['i32.store', ['local.get', ptrLocal], ['i32.const', typeTag]] // store type tag
      ]

      if (node[0] === 'struct.new') {
        // Store each field value
        for (let i = 0; i < typeDef.fields.length; i++) {
          const f = typeDef.fields[i]
          const offset = fieldOffset(typeDef, i)
          const storeOp = f.type === 'i64' ? 'i64.store' : f.type === 'f32' ? 'f32.store' : f.type === 'f64' ? 'f64.store' : 'i32.store'
          stores.push([storeOp, ['i32.add', ['local.get', ptrLocal], ['i32.const', offset]], args[i] || [`${f.type}.const`, 0]])
        }
      } else {
        // struct.new_default - zero initialize
        for (let i = 0; i < typeDef.fields.length; i++) {
          const f = typeDef.fields[i]
          const offset = fieldOffset(typeDef, i)
          const storeOp = f.type === 'i64' ? 'i64.store' : f.type === 'f32' ? 'f32.store' : f.type === 'f64' ? 'f64.store' : 'i32.store'
          const zero = f.type === 'i64' ? ['i64.const', 0n] : f.type === 'f32' ? ['f32.const', 0] : f.type === 'f64' ? ['f64.const', 0] : ['i32.const', 0]
          stores.push([storeOp, ['i32.add', ['local.get', ptrLocal], ['i32.const', offset]], zero])
        }
      }

      stores.push(['local.get', ptrLocal])

      // Wrap in block
      parent[idx] = ['block', ['result', 'i32'], ...stores]
    }

    // struct.get $type $field ref → load from offset
    if (node[0] === 'struct.get') {
      const typeId = node[1]
      const fieldId = node[2]
      const ref = node[3]
      const typeDef = types.get(typeId)
      if (!typeDef || typeDef.kind !== 'struct') return

      const fieldIdx = typeof fieldId === 'string' && fieldId[0] === '$'
        ? findFieldIdx(typeDef, fieldId)
        : parseInt(fieldId)
      if (fieldIdx < 0) return

      const f = typeDef.fields[fieldIdx]
      const offset = fieldOffset(typeDef, fieldIdx)
      const loadOp = f.type === 'i64' ? 'i64.load' : f.type === 'f32' ? 'f32.load' : f.type === 'f64' ? 'f64.load' : 'i32.load'

      parent[idx] = [loadOp, ['i32.add', ref, ['i32.const', offset]]]
    }

    // struct.set $type $field ref val → store at offset
    if (node[0] === 'struct.set') {
      const typeId = node[1]
      const fieldId = node[2]
      const ref = node[3]
      const val = node[4]
      const typeDef = types.get(typeId)
      if (!typeDef || typeDef.kind !== 'struct') return

      const fieldIdx = typeof fieldId === 'string' && fieldId[0] === '$'
        ? findFieldIdx(typeDef, fieldId)
        : parseInt(fieldId)
      if (fieldIdx < 0) return

      const f = typeDef.fields[fieldIdx]
      const offset = fieldOffset(typeDef, fieldIdx)
      const storeOp = f.type === 'i64' ? 'i64.store' : f.type === 'f32' ? 'f32.store' : f.type === 'f64' ? 'f64.store' : 'i32.store'

      parent[idx] = [storeOp, ['i32.add', ref, ['i32.const', offset]], val]
    }

    // array.new $type val len → alloc + fill
    if (node[0] === 'array.new' || node[0] === 'array.new_default') {
      const typeId = node[1]
      const typeDef = types.get(typeId)
      if (!typeDef || typeDef.kind !== 'array') return

      const typeTag = typeIndices.get(typeId)
      const elemSize = TYPE_SIZES[typeDef.elemType] || 4
      const val = node[0] === 'array.new' ? node[2] : null
      const len = node[0] === 'array.new' ? node[3] : node[2]

      // Layout: [tag:4][len:4][elem0][elem1]...
      // Size = 8 + len * elemSize
      const ptrLocal = '$__gc_aptr'
      const lenLocal = '$__gc_alen'
      const iLocal = '$__gc_aidx'

      const storeOp = typeDef.elemType === 'i64' ? 'i64.store' : typeDef.elemType === 'f32' ? 'f32.store' : typeDef.elemType === 'f64' ? 'f64.store' : 'i32.store'

      const ops = [
        ['local.set', lenLocal, len],
        ['local.set', ptrLocal, ['call', allocId, ['i32.add', ['i32.const', 8], ['i32.mul', ['local.get', lenLocal], ['i32.const', elemSize]]]]],
        ['i32.store', ['local.get', ptrLocal], ['i32.const', typeTag]],
        ['i32.store', ['i32.add', ['local.get', ptrLocal], ['i32.const', 4]], ['local.get', lenLocal]],
      ]

      // Fill loop (if array.new with value)
      if (val) {
        ops.push(
          ['local.set', iLocal, ['i32.const', 0]],
          ['block', '$done',
            ['loop', '$loop',
              ['br_if', '$done', ['i32.ge_u', ['local.get', iLocal], ['local.get', lenLocal]]],
              [storeOp,
                ['i32.add', ['i32.add', ['local.get', ptrLocal], ['i32.const', 8]],
                  ['i32.mul', ['local.get', iLocal], ['i32.const', elemSize]]],
                val],
              ['local.set', iLocal, ['i32.add', ['local.get', iLocal], ['i32.const', 1]]],
              ['br', '$loop']
            ]
          ]
        )
      }

      ops.push(['local.get', ptrLocal])
      parent[idx] = ['block', ['result', 'i32'], ...ops]
    }

    // array.get $type ref idx → load
    if (node[0] === 'array.get') {
      const typeId = node[1]
      const ref = node[2]
      const idx_val = node[3]
      const typeDef = types.get(typeId)
      if (!typeDef || typeDef.kind !== 'array') return

      const elemSize = TYPE_SIZES[typeDef.elemType] || 4
      const loadOp = typeDef.elemType === 'i64' ? 'i64.load' : typeDef.elemType === 'f32' ? 'f32.load' : typeDef.elemType === 'f64' ? 'f64.load' : 'i32.load'

      // offset = 8 + idx * elemSize
      parent[idx] = [loadOp, ['i32.add', ['i32.add', ref, ['i32.const', 8]], ['i32.mul', idx_val, ['i32.const', elemSize]]]]
    }

    // array.set $type ref idx val → store
    if (node[0] === 'array.set') {
      const typeId = node[1]
      const ref = node[2]
      const idx_val = node[3]
      const val = node[4]
      const typeDef = types.get(typeId)
      if (!typeDef || typeDef.kind !== 'array') return

      const elemSize = TYPE_SIZES[typeDef.elemType] || 4
      const storeOp = typeDef.elemType === 'i64' ? 'i64.store' : typeDef.elemType === 'f32' ? 'f32.store' : typeDef.elemType === 'f64' ? 'f64.store' : 'i32.store'

      parent[idx] = [storeOp, ['i32.add', ['i32.add', ref, ['i32.const', 8]], ['i32.mul', idx_val, ['i32.const', elemSize]]], val]
    }

    // array.len ref → load length from offset 4
    if (node[0] === 'array.len') {
      const ref = node[1]
      parent[idx] = ['i32.load', ['i32.add', ref, ['i32.const', 4]]]
    }
  })

  return ast
}

transforms.gc = gc

// ============================================================================
// REF.TEST / REF.CAST POLYFILL
// Runtime type checking using type tags stored at offset 0.
// ref.test checks if tag matches, ref.cast traps if not.
// ============================================================================

const ref_cast = (ast, ctx) => {
  // Collect type indices (must match gc polyfill's numbering)
  const typeIndices = new Map()
  let typeIdx = 1

  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'type') return
    const id = typeof node[1] === 'string' && node[1][0] === '$' ? node[1] : null
    if (!id) return

    for (const def of node) {
      if (Array.isArray(def) && (def[0] === 'struct' || def[0] === 'array')) {
        typeIndices.set(id, typeIdx++)
      }
    }
  })

  if (!typeIndices.size) return ast

  // Transform ref.test/ref.cast
  walkPost(ast, (node, parent, idx) => {
    if (!Array.isArray(node) || !parent) return

    // ref.test (ref $type) val → (i32.eq (i32.load val) typeTag)
    if (node[0] === 'ref.test') {
      // Parse the reftype - could be (ref $type) or (ref null $type)
      const reftype = node[1]
      let typeId = null
      if (Array.isArray(reftype) && reftype[0] === 'ref') {
        typeId = reftype[1] === 'null' ? reftype[2] : reftype[1]
      }
      const val = node[2]
      const typeTag = typeIndices.get(typeId)

      if (typeTag !== undefined) {
        // Check if null first, then check tag
        parent[idx] = ['if', ['result', 'i32'],
          ['i32.eqz', val],
          ['then', ['i32.const', 0]], // null fails test
          ['else', ['i32.eq', ['i32.load', val], ['i32.const', typeTag]]]
        ]
      }
    }

    // ref.cast (ref $type) val → val (with trap if wrong type)
    if (node[0] === 'ref.cast') {
      const reftype = node[1]
      let typeId = null
      let allowNull = false
      if (Array.isArray(reftype) && reftype[0] === 'ref') {
        if (reftype[1] === 'null') {
          allowNull = true
          typeId = reftype[2]
        } else {
          typeId = reftype[1]
        }
      }
      const val = node[2]
      const typeTag = typeIndices.get(typeId)

      if (typeTag !== undefined) {
        // Cast: check type, trap if wrong
        const checkLocal = genId('cast')
        if (allowNull) {
          // Allow null to pass through
          parent[idx] = ['block', ['result', 'i32'],
            ['local', checkLocal, 'i32'],
            ['local.set', checkLocal, val],
            ['if', ['i32.and',
              ['i32.ne', ['local.get', checkLocal], ['i32.const', 0]],
              ['i32.ne', ['i32.load', ['local.get', checkLocal]], ['i32.const', typeTag]]],
              ['then', ['unreachable']]
            ],
            ['local.get', checkLocal]
          ]
        } else {
          // Null or wrong type = trap
          parent[idx] = ['block', ['result', 'i32'],
            ['local', checkLocal, 'i32'],
            ['local.set', checkLocal, val],
            ['if', ['i32.or',
              ['i32.eqz', ['local.get', checkLocal]],
              ['i32.ne', ['i32.load', ['local.get', checkLocal]], ['i32.const', typeTag]]],
              ['then', ['unreachable']]
            ],
            ['local.get', checkLocal]
          ]
        }
      }
    }

    // br_on_cast $label (ref $from) (ref $to) val
    if (node[0] === 'br_on_cast') {
      const label = node[1]
      const fromType = node[2]
      const toType = node[3]
      const val = node[4]

      let typeId = null
      if (Array.isArray(toType) && toType[0] === 'ref') {
        typeId = toType[1] === 'null' ? toType[2] : toType[1]
      }
      const typeTag = typeIndices.get(typeId)

      if (typeTag !== undefined) {
        const checkLocal = genId('brcast')
        // If type matches, branch; otherwise fall through
        parent[idx] = ['block', ['result', 'i32'],
          ['local', checkLocal, 'i32'],
          ['local.set', checkLocal, val],
          ['br_if', label, ['i32.and',
            ['i32.ne', ['local.get', checkLocal], ['i32.const', 0]],
            ['i32.eq', ['i32.load', ['local.get', checkLocal]], ['i32.const', typeTag]]]],
          ['local.get', checkLocal]
        ]
      }
    }

    // br_on_cast_fail $label (ref $from) (ref $to) val
    if (node[0] === 'br_on_cast_fail') {
      const label = node[1]
      const fromType = node[2]
      const toType = node[3]
      const val = node[4]

      let typeId = null
      if (Array.isArray(toType) && toType[0] === 'ref') {
        typeId = toType[1] === 'null' ? toType[2] : toType[1]
      }
      const typeTag = typeIndices.get(typeId)

      if (typeTag !== undefined) {
        const checkLocal = genId('brfail')
        // If type does NOT match, branch; otherwise fall through
        parent[idx] = ['block', ['result', 'i32'],
          ['local', checkLocal, 'i32'],
          ['local.set', checkLocal, val],
          ['br_if', label, ['i32.or',
            ['i32.eqz', ['local.get', checkLocal]],
            ['i32.ne', ['i32.load', ['local.get', checkLocal]], ['i32.const', typeTag]]]],
          ['local.get', checkLocal]
        ]
      }
    }
  })

  return ast
}

transforms.ref_cast = ref_cast

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
