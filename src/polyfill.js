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
    const helper = ['func', id, ['param', '$v', ftype], ['result', itype],
      // NaN check: if v != v return 0
      ['if', ['result', itype],
        [`${ftype}.ne`, ['local.get', '$v'], ['local.get', '$v']],
        ['then', [`${itype}.const`, 0]],
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
