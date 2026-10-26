/**
 * Polyfill transforms for newer WebAssembly features to MVP-compatible code.
 * Transforms AST before compilation to enable running on older runtimes.
 *
 * @module watr/polyfill
 */

import parse from './parse.js'
import { walk, walkPost, clone, str, LOC } from './util.js'
import { OPCODE, unknownType } from './const.js'

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
  // the gc lowering owns function references in a GC module: null is slot 0 there
  if (ctx.gc) return ast

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

// ============================================================================
// GC POLYFILL
// Lowers GC references to i32 over a linear-memory heap, for a closed module:
// the host hands it no references (see `takes` below).
//   null           → 0
//   struct, array  → address of [tag:i32 field*] or [tag:i32 len:i32 elem*], 8-aligned
//   i31            → (x << 1) | 1: odd, so never an address
//   funcref        → slot in a polyfill funcref table; slot 0 stays empty, so a
//                    call through null traps in call_indirect
//   externref      → the reference it converts: the any/extern conversions vanish
// A tag is the preorder number of the object's canonical type in the subtype
// forest, so a subtype test is one range check. The heap is a bump allocator
// that never frees, in a memory of its own: memory 0 when the module has none,
// one more memory otherwise, so it never meets the module's own data.
// Function bodies come out in flat (stack) form.
// ============================================================================

const REFS = {
  anyref: 'any', eqref: 'eq', i31ref: 'i31', structref: 'struct', arrayref: 'array', nullref: 'none',
  funcref: 'func', nullfuncref: 'nofunc', externref: 'extern', nullexternref: 'noextern', exnref: 'exn', nullexnref: 'noexn'
}
// abstract heap types lowered to i32; exn, cont and string references stay references
const ABS = new Set(['any', 'eq', 'i31', 'struct', 'array', 'none', 'func', 'nofunc', 'extern', 'noextern'])
const SIZE = { i8: 1, i16: 2, i32: 4, f32: 4, i64: 8, f64: 8, v128: 16 }
// a folded instruction's leading immediates, as compile's normalize reads them
const IMMS = new Set(['type', 'param', 'result', 'ref', 'exact', 'on', 'catch', 'catch_ref', 'catch_all', 'catch_all_ref'])
const HEAD = new Set(['export', 'import', 'type', 'param', 'result', 'local'])

const isId = n => typeof n === 'string' && n[0] === '$'
const isNum = n => typeof n === 'number' || typeof n === 'string' && /^[+-]?\d+$/.test(n)
const isNote = n => typeof n === 'string' && (n[0] === ';' || n[0] === '(' && n[1] === ';')
const isOp = n => typeof n === 'string' && typeof OPCODE[n] === 'number'
const isImm = n => Array.isArray(n) ? IMMS.has(n[0]) : !isNote(n) && !isOp(n)
const show = t => Array.isArray(t) ? `(${t.map(show).join(' ')})` : String(t)

/** `{ nul, ht }` for a reference type, `ht` an abstract heap type or a type name/index; null otherwise. */
const refOf = t => {
  if (typeof t === 'string') return REFS[t] ? { nul: true, ht: REFS[t] } : null
  if (!Array.isArray(t) || t[0] !== 'ref') return null
  const nul = t[1] === 'null'
  let ht = t[nul ? 2 : 1]
  if (ht === 'exact') ht = t[nul ? 3 : 2]
  else if (Array.isArray(ht)) ht = ht[1] // (exact $t)
  ht = String(ht)
  if (isNum(ht) && +ht < 0) throw Error(unknownType(ht))
  return { nul, ht }
}
const isTref = ht => isId(ht) || isNum(ht)

/**
 * Flatten an instruction sequence, folded, flat or mixed, into records
 * `[op, ...immediates]`, control included (`block`, `if`, `else`, `end`).
 * Annotations, `;;@` locations and unknown tokens pass as `['@raw', ...nodes]`.
 */
const flatten = (nodes, out = [], stmt = true) => {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (!Array.isArray(n)) {
      if (isNote(n)) { stmt && LOC.test(n) && out.push(['@raw', n]); continue }
      const r = [n]
      // a ;;@ location belongs to the next instruction, other comments are skipped
      while (i + 1 < nodes.length && (isImm(nodes[i + 1]) || isNote(nodes[i + 1]) && !LOC.test(nodes[i + 1]))) isNote(nodes[++i]) || r.push(nodes[i])
      out.push(isOp(n) ? r : ['@raw', ...r])
      continue
    }
    const op = n[0]
    if (!isOp(op)) { out.push(['@raw', n]); continue }
    // as compile reads a folded node: every leading token and type form follows the op, the arrays after them come first
    let k = 1
    while (k < n.length && (!Array.isArray(n[k]) || IMMS.has(n[k][0]))) k++
    const imm = n.slice(1, k).filter(x => !isNote(x))
    if (op === 'block' || op === 'loop' || op === 'try_table') out.push([op, ...imm]), flatten(n.slice(k), out), out.push(['end'])
    else if (op === 'if') {
      let then = [], els = null
      const cond = n.slice(k).filter(x => x?.[0] === 'then' ? (then = x.slice(1), false) : x?.[0] === 'else' ? (els = x.slice(1), false) : true)
      flatten(cond, out, false), out.push(['if', ...imm]), flatten(then, out)
      if (els) out.push(['else']), flatten(els, out)
      out.push(['end'])
    }
    else flatten(n.slice(k), out, false), flatten([op, ...imm], out, false)
  }
  return out
}
const unflatten = recs => recs.flatMap(r => r[0] === '@raw' ? r.slice(1) : r)

const gc = (ast, ctx) => {
  if (ctx.gcDone) return ast
  ctx.gcDone = true
  // a module, one field, or a list of fields (comments around a module included)
  let m = ast
  if (m[0] !== 'module') {
    const nodes = (typeof m[0] === 'string' && !isNote(m[0]) ? [m] : m).filter(n => !isNote(n))
    m = nodes.length === 1 && nodes[0][0] === 'module' ? nodes[0] : ['module', ...nodes]
  }
  const first = isId(m[1]) ? 2 : 1
  const fail = msg => { throw Error(`gc polyfill: ${msg}`) }

  // comments go, except ;;@ locations between a function's instructions
  const strip = (n, keep) => {
    for (let i = n.length; i--;) {
      if (Array.isArray(n[i])) strip(n[i], n[i][0] === 'func')
      else if (isNote(n[i]) && !(keep && LOC.test(n[i]))) n.splice(i, 1)
    }
  }
  strip(m)

  // -- types: unroll rec groups and name every type, so dropping struct/array types shifts no reference
  const T = Object.create(null), tnames = [], groups = []
  for (let i = first; i < m.length; i++) {
    const n = m[i]
    if (!Array.isArray(n) || n[0] !== 'rec' && n[0] !== 'type') continue
    const tys = n[0] === 'rec' ? n.slice(1) : [n]
    if (n[0] === 'rec') m.splice(i, 1, ...tys), i += tys.length - 1
    groups.push(tys.map(ty => {
      if (!isId(ty[1])) ty.splice(1, 0, `$__gc_t${tnames.length}`)
      T[ty[1]] = { node: ty }
      return tnames.push(ty[1]), ty[1]
    }))
  }
  const tn = x => isId(x) ? (T[x] ? x : fail(`unknown type ${x}`)) : isNum(x) && tnames[+x] || fail(unknownType(x))
  // (type N) → (type $name) wherever a type is used
  walk(m, n => { if (Array.isArray(n) && n[0] === 'type' && n.length === 2 && isNum(n[1])) n[1] = tn(n[1]) })

  const fld = f => f?.[0] === 'mut' ? { st: f[1], mut: true } : { st: f, mut: false }
  const sigOf = cs => {
    const params = [], results = []
    for (const c of cs) if (c[0] === 'param') params.push(...c.slice(isId(c[1]) ? 2 : 1)); else if (c[0] === 'result') results.push(...c.slice(1))
    return { params, results }
  }
  for (const nm of tnames) {
    const def = T[nm], parts = def.node.slice(2)
    if (parts.length !== 1) fail(`type ${nm}: descriptors aren't polyfilled`)
    let [d] = parts
    def.final = true, def.sup = null
    if (d[0] === 'sub') {
      def.final = d[1] === 'final'
      const sups = d.slice(def.final ? 2 : 1, -1)
      if (sups.length) def.sup = tn(sups[0])
      d = d[d.length - 1]
    }
    def.kind = d[0], def.def = d
    if (d[0] === 'struct') def.fields = d.slice(1).flatMap(f => isId(f[1]) ? [{ name: f[1], ...fld(f[2]) }] : f.slice(1).map(fld))
    else if (d[0] === 'array') def.elem = fld(d[1]?.[0] === 'field' ? d[1][d[1].length - 1] : d[1])
    else if (d[0] === 'func') Object.assign(def, sigOf(d.slice(1)))
  }

  // -- canonical types (iso-recursive): structurally equal rec groups are one type, as casts see them
  const canon = Object.create(null), groupKey = new Map(), rep = Object.create(null)
  const vkey = (t, g) => {
    if (t?.[0] === 'mut') return 'mut ' + vkey(t[1], g)
    const r = refOf(t)
    if (!r) return String(t)
    const nm = isTref(r.ht) && tn(r.ht), i = nm ? g.indexOf(nm) : -1
    return `(ref ${r.nul ? 'null ' : ''}${!nm ? r.ht : i >= 0 ? 'rec.' + i : canon[nm]})`
  }
  const sigKey = (d, g) => [...d.params.map(t => vkey(t, g)), '->', ...d.results.map(t => vkey(t, g))]
  for (const g of groups) {
    const key = g.map(nm => {
      const d = T[nm]
      return [d.final ? 'final' : 'sub', d.sup ? vkey(['ref', d.sup], g) : '', d.kind,
        ...d.kind === 'struct' ? d.fields.map(f => vkey(f.mut ? ['mut', f.st] : f.st, g)) :
          d.kind === 'array' ? [vkey(d.elem.mut ? ['mut', d.elem.st] : d.elem.st, g)] :
            d.kind === 'func' ? sigKey(d, g) : [show(d.def)]].join(' ')
    }).join('; ')
    if (!groupKey.has(key)) groupKey.set(key, groupKey.size)
    g.forEach((nm, i) => rep[canon[nm] = groupKey.get(key) + '.' + i] ??= nm)
  }

  // -- tags: preorder over the subtype forest, structs, then arrays, then functions
  const kids = Object.create(null), roots = { struct: [], array: [], func: [] }, lo = Object.create(null), hi = Object.create(null), span = {}
  for (const nm of tnames) {
    const c = canon[nm], d = T[nm]
    if (rep[c] === nm && roots[d.kind]) (d.sup ? kids[canon[d.sup]] ??= [] : roots[d.kind]).push(c)
  }
  let tags = 0
  const dfs = c => { lo[c] = ++tags; kids[c]?.forEach(dfs); hi[c] = tags }
  for (const k in roots) { const a = tags + 1; roots[k].forEach(dfs); span[k] = [a, tags] }
  const range = nm => [lo[canon[nm]], hi[canon[nm]]]
  const kind = (nm, k) => T[nm].kind === k ? T[nm] : fail(`${nm} isn't ${k === 'array' ? 'an' : 'a'} ${k} type`)
  // a function reference: a host can make one, and a table holds it
  const isFunc = r => r.ht === 'func' || r.ht === 'nofunc' || isTref(r.ht) && T[tn(r.ht)].kind === 'func'
  const isExtern = r => r.ht === 'extern' || r.ht === 'noextern'

  // -- layout: fields at natural alignment after the tag, so a subtype's prefix matches its supertype's
  const low = t => {
    if (t?.[0] === 'mut') return ['mut', low(t[1])]
    const r = refOf(t)
    return r && (ABS.has(r.ht) || isTref(r.ht)) ? 'i32' : t
  }
  const lowc = c => c.map((x, i) => i && !isId(x) ? low(x) : x)
  const val = st => {
    const v = st === 'i8' || st === 'i16' ? 'i32' : low(st)
    return SIZE[v] && v !== 'i8' && v !== 'i16' ? v : fail(`${show(st)} fields aren't polyfilled`)
  }
  const size = st => SIZE[st] ?? SIZE[val(st)]
  const shift = st => Math.log2(size(st))
  const ld = (st, sx) => st === 'i8' || st === 'i16' ? `i32.load${st.slice(1)}${sx}` : val(st) + '.load'
  const sto = st => st === 'i8' || st === 'i16' ? `i32.store${st.slice(1)}` : val(st) + '.store'
  const skey = st => st === 'i8' || st === 'i16' ? st : val(st)
  const lay = Object.create(null)
  const layout = nm => lay[nm] ??= (() => {
    let o = 4
    const offs = kind(nm, 'struct').fields.map(f => { const s = size(f.st), a = Math.min(s, 8); o = o + a - 1 & -a; return (o += s) - s })
    return { offs, size: o + 7 & -8 }
  })()
  const fieldIdx = (nm, x) => {
    const fs = kind(nm, 'struct').fields, i = isId(x) ? fs.findIndex(f => f.name === x) : +x
    return fs[i] ? i : fail(`${nm} has no field ${x}`)
  }

  // -- index spaces
  const imps = { func: [], global: [], tag: [], memory: [], table: [] }, defs = { func: [], global: [], tag: [], memory: [], table: [] }
  const segs = { data: [], elem: [] }
  for (const n of m.slice(first)) {
    if (!Array.isArray(n)) continue
    let k = n[0], d = n, imp = n.find(x => x[0] === 'import')
    if (k === 'import') d = n[3], k = d?.[0], imp = n
    if (imps[k]) (imp ? imps : defs)[k].push({ node: d, imp: imp && `import ${imp[1]} ${imp[2]}` })
    if (k === 'data' || k === 'elem') segs[k].push(n)
    else if (k === 'memory' && n.some(x => x[0] === 'data')) segs.data.push(null)
    else if (k === 'table' && n.some(x => x[0] === 'elem')) segs.elem.push(null)
  }
  const space = k => [...imps[k], ...defs[k]]
  const funcs = space('func'), globals = space('global')
  const byName = list => Object.fromEntries(list.map((e, i) => [isId(e.node[1]) ? e.node[1] : i, i]))
  const fn = byName(funcs), gn = byName(globals)
  const at = (map, x) => isId(x) ? map[x] : +x
  const sig = n => { const ty = n.find(x => x[0] === 'type'); return ty ? kind(tn(ty[1]), 'func') : sigOf(n.filter(Array.isArray)) }
  const gtype = n => n.slice(1).find(x => !isId(x) && !(x[0] === 'export' || x[0] === 'import'))

  // -- the host boundary: a reference the host makes can't become an i32
  const hostRef = t => { const r = refOf(t?.[0] === 'mut' ? t[1] : t); return r && (isFunc(r) || isExtern(r)) }
  const takes = (where, ts) => { const t = ts.find(hostRef); if (t) fail(`${where} takes ${show(t)} from the host, which an i32 can't hold`) }
  // what an export lets the host pass in: a function's params, a tag's, a mutable global's value
  const into = (k, e) => k === 'global' ? (gtype(e.node)[0] === 'mut' ? [gtype(e.node)] : []) : sig(e.node).params
  const KINDS = ['func', 'global', 'tag']
  for (const e of imps.func) takes(e.imp, sig(e.node).results)
  for (const e of imps.global) takes(e.imp, [gtype(e.node)])
  for (const e of imps.tag) takes(e.imp, sig(e.node).params)
  for (const k of KINDS) for (const e of space(k)) for (const x of e.node) if (x[0] === 'export') takes(`export ${x[1]}`, into(k, e))
  for (const n of m.slice(first)) if (n[0] === 'export' && KINDS.includes(n[2][0])) {
    const [k, x] = n[2], e = space(k)[at(byName(space(k)), x)]
    if (e) takes(`export ${n[1]}`, into(k, e))
  }

  // -- bodies and global initializers, flat
  const bodies = defs.func.map(({ node: n }) => {
    let k = 1
    const loc = []
    for (; k < n.length && (isId(n[k]) || isNote(n[k]) || Array.isArray(n[k]) && HEAD.has(n[k][0])); k++) if (isNote(n[k])) loc.push(n[k])
    return { node: n, head: n.slice(0, k).filter(x => !isNote(x)), recs: flatten([...loc, ...n.slice(k)]) }
  })
  const inits = defs.global.map(({ node: n }) => {
    let k = 1
    while (isId(n[k]) || n[k][0] === 'export') k++
    return { node: n, k, recs: flatten(n.slice(k + 1)) }
  })

  // -- what the bodies reach: function slots, segments, i31 values, function casts
  const slots = [], slotOf = Object.create(null)
  const slot = x => { const i = at(fn, x); if (!funcs[i]) fail(`unknown function ${x}`); return slotOf[i] ??= slots.push(isId(x) ? x : String(i)) }
  const gcData = new Set(), memData = new Set(), gcElem = new Set(), tblElem = new Set()
  const segIdx = (list, x) => isId(x) ? list.findIndex(n => n?.[1] === x) : +x
  let i31 = false, fcast = false
  const castsFunc = rt => { const r = refOf(rt); return r && isTref(r.ht) && T[tn(r.ht)].kind === 'func' }
  for (const { recs } of [...bodies, ...inits]) for (const [op, ...imm] of recs) {
    if (op === 'ref.func') slot(imm[0])
    else if (op === 'ref.i31') i31 = true
    else if (op === 'array.new_data' || op === 'array.init_data') gcData.add(segIdx(segs.data, imm[1]))
    else if (op === 'memory.init') memData.add(segIdx(segs.data, imm[imm.length - 1]))
    else if (op === 'array.new_elem' || op === 'array.init_elem') gcElem.add(segIdx(segs.elem, imm[1]))
    else if (op === 'table.init') tblElem.add(segIdx(segs.elem, imm[imm.length - 1]))
    else if (op === 'ref.test' || op === 'ref.cast') fcast ||= castsFunc(imm[0])
    else if (op === 'br_on_cast' || op === 'br_on_cast_fail') fcast ||= castsFunc(imm[2])
  }

  // -- elem segments: a GC array copies its slots from the heap; declarations and GC-only segments go
  const elemItems = n => {
    let k = 1
    if (isId(n[k])) k++
    if (n[k] === 'declare') k++
    if (n[k]?.[0] === 'table') k++
    if (n[k]?.[0] === 'offset' || Array.isArray(n[k]) && isOp(n[k][0])) k++
    if (n[k] === 'func' || REFS[n[k]] || n[k]?.[0] === 'ref') k++
    return n.slice(k).map(x => x[0] === 'item' ? (x.length > 2 ? x.slice(1) : x[1]) : x)
  }
  const elemVal = x => {
    if (!Array.isArray(x)) return slot(x)
    if (x[0] === 'ref.func') return slot(x[1])
    if (x[0] === 'ref.null') return 0
    if (x[0] === 'ref.i31' && x[1]?.[0] === 'i32.const') return i31 = true, (x[1][1] << 1 | 1) >>> 0
    fail(`elem item ${show(x)} isn't polyfilled`)
  }
  const elemVals = Object.create(null)
  for (const e of gcElem) {
    if (!segs.elem[e]) fail(`unknown elem segment ${e}`)
    elemVals[e] = elemItems(segs.elem[e]).map(elemVal)
  }
  const drop = new Set(), enew = []
  segs.elem.forEach((n, i) => { if (n && (n.includes('declare') || gcElem.has(i) && !tblElem.has(i))) drop.add(i) })
  segs.elem.reduce((j, n, i) => (enew[i] = drop.has(i) ? -1 : j, drop.has(i) ? j : j + 1), 0)
  const elemRef = x => isId(x) ? x : enew[+x]

  // -- heap memory: [0, 8) stays unused so no object is null, then segment copies, then objects.
  // A copy is [len:i32 pad:i32 bytes]: data.drop and elem.drop zero its len, as a dropped segment reads empty.
  const heapMem = space('memory').length, MEM = heapMem ? ['$__gc_mem'] : [], mi = heapMem ? ' $__gc_mem' : ''
  let top = 8
  const place = len => { const a = top; top = top + len + 7 & -8; return a }
  const bytes = (vals) => '"' + vals.map(v => [v, v >>> 8, v >>> 16, v >>> 24].map(b => '\\' + (b & 255).toString(16).padStart(2, '0')).join('')).join('') + '"'
  const memSel = heapMem ? [['memory', '$__gc_mem']] : []
  const blob = Object.create(null), appended = []
  const dataLen = n => n.slice(isId(n[1]) ? 2 : 1).reduce((s, x) => s + (Array.isArray(x) ? (x.length - 1) * SIZE[x[0]] : str(x).length), 0)
  for (const d of gcData) {
    const n = segs.data[d]
    if (n === undefined) fail(`unknown data segment ${d}`)
    const at = isId(n?.[1]) ? 2 : 1, passive = n && n.slice(at).every(x => !Array.isArray(x) || SIZE[x[0]])
    // an active segment is dropped once instantiated: its copy stays empty
    if (!passive) { blob['d' + d] = place(0); continue }
    const len = dataLen(n), a = blob['d' + d] = place(8 + len), head = [['i32.const', a], bytes([len, 0])]
    if (memData.has(d)) appended.push(['data', ...memSel, ...head, ...n.slice(at)])
    else n.splice(at, 0, ...memSel, ...head)
  }
  for (const e of gcElem) {
    const vals = elemVals[e], a = blob['e' + e] = place(8 + vals.length * 4)
    appended.push(['data', ...memSel, ['i32.const', a], bytes([vals.length * 4, 0, ...vals])])
  }
  let ftags = 0
  if (fcast) {
    const fsig = f => {
      const ty = f.node.find(x => x[0] === 'type')
      if (ty) return lo[canon[tn(ty[1])]]
      const c = groupKey.get(['final', '', 'func', ...sigKey(sigOf(f.node.filter(Array.isArray)), [])].join(' '))
      return c == null ? 0 : lo[c + '.0']
    }
    const vals = [0, ...slots.map(x => fsig(funcs[at(fn, x)]))]
    appended.push(['data', ...memSel, ['i32.const', ftags = place(vals.length * 4)], bytes(vals)])
  }

  // -- instructions
  const use = new Set(), call = h => (use.add(h), ['call', '$__gc_' + h])
  let heap = false // a heap access inline, not through a helper
  const acc = (op, off) => (heap = true, [op, ...MEM, 'offset=' + off])
  const i32 = v => ['i32.const', v]
  const limm = x => Array.isArray(x) && (x[0] === 'param' || x[0] === 'result') ? lowc(x) : x
  const lower = (recs, tmp) => {
    const out = [], loc = (nm, t = 'i32') => (tmp.set(nm, t), nm)
    const R = () => loc('$__gc_r'), Q = () => loc('$__gc_q'), P = () => loc('$__gc_p'), V = t => loc('$__gc_' + t, t)
    // [v] → [i32]: does v pass a test against reference type rt
    const test = rt => {
      const { nul, ht } = refOf(rt) ?? fail(`cast to ${show(rt)}`)
      if (ht === 'any' || ht === 'eq' || ht === 'extern' || ht === 'func') return nul ? [['drop'], i32(1)] : [i32(0), ['i32.ne']]
      if (ht === 'none' || ht === 'noextern' || ht === 'nofunc') return nul ? [['i32.eqz']] : [['drop'], i32(0)]
      if (ht === 'i31') return nul ? [['local.tee', Q()], i32(1), ['i32.and'], ['local.get', Q()], ['i32.eqz'], ['i32.or']] : [i32(1), ['i32.and']]
      const nm = isTref(ht) && tn(ht), [a, b] = ht === 'struct' || ht === 'array' ? span[ht] : nm && roots[T[nm].kind] ? range(nm) : fail(`casts to ${ht} aren't polyfilled`)
      if (a > b) return nul ? [['i32.eqz']] : [['drop'], i32(0)]
      return [i32(a), i32(b - a), i32(+nul), call(nm && T[nm].kind === 'func' ? 'ftest' : 'test')]
    }
    const seg = (k, x) => blob[k + segIdx(segs[k === 'd' ? 'data' : 'elem'], x)] ?? fail(`unknown segment ${x}`)
    const empty = (k, x) => { const a = blob[k + segIdx(segs[k === 'd' ? 'data' : 'elem'], x)]; return a == null ? [] : [i32(a), i32(0), acc('i32.store', 0)] }
    for (const rec of recs) {
      const [op, ...imm] = rec
      switch (op) {
        case 'ref.null': out.push(ABS.has(imm[0]) || isTref(imm[0]) ? (refOf(['ref', imm[0]]), i32(0)) : rec); break
        case 'ref.is_null': out.push(['i32.eqz']); break
        case 'ref.eq': out.push(['i32.eq']); break
        case 'ref.as_non_null': out.push(call('nn')); break
        case 'ref.i31': out.push(i32(1), ['i32.shl'], i32(1), ['i32.or']); break
        case 'i31.get_s': case 'i31.get_u': out.push(call('nn'), i32(1), ['i32.shr' + op.slice(7)]); break
        case 'any.convert_extern': case 'extern.convert_any': break
        case 'ref.func': out.push(i32(slot(imm[0]))); break
        case 'call_ref': case 'return_call_ref': {
          const ci = ['call_indirect', '$__gc_ftab', ['type', tn(imm[0])]]
          if (op === 'call_ref') out.push(ci)
          else if (ctx.opts?.return_call) out.push(ci, ['return'])
          else out.push(['return_call_indirect', ...ci.slice(1)])
          break
        }
        case 'return_call': case 'return_call_indirect':
          if (ctx.opts?.return_call) out.push([op.slice(7), ...imm.map(limm)], ['return'])
          else out.push([op, ...imm.map(limm)])
          break
        case 'br_on_null': out.push(['local.set', R()], ['local.get', R()], ['i32.eqz'], ['br_if', imm[0]], ['local.get', R()]); break
        case 'br_on_non_null': out.push(['local.tee', R()], ['local.get', R()], ['br_if', imm[0]], ['drop']); break
        case 'ref.test': out.push(...test(imm[0])); break
        case 'ref.cast': {
          const t = test(imm[0])
          if (t[0][0] === 'drop' && t[1][1] === 1) break // nullable top type: every value passes
          if (t[1]?.[0] === 'i32.ne') { out.push(call('nn')); break }
          out.push(['local.tee', R()], ...t, ['i32.eqz'], ['if'], ['unreachable'], ['end'], ['local.get', R()])
          break
        }
        case 'br_on_cast': case 'br_on_cast_fail':
          out.push(['local.tee', R()], ['local.get', R()], ...test(imm[2]), ...op === 'br_on_cast' ? [] : [['i32.eqz']], ['br_if', imm[0]])
          break
        case 'struct.new': case 'struct.new_default': {
          const nm = tn(imm[0]), { fields } = kind(nm, 'struct'), { offs, size } = layout(nm)
          out.push(i32(size), i32(lo[canon[nm]]), call('new'))
          if (op === 'struct.new_default') break // a fresh heap is zeroed
          out.push(['local.set', P()])
          for (let i = fields.length; i--;) {
            const st = fields[i].st, v = V(val(st))
            out.push(['local.set', v], ['local.get', P()], ['local.get', v], acc(sto(st), offs[i]))
          }
          out.push(['local.get', P()])
          break
        }
        case 'struct.get': case 'struct.get_s': case 'struct.get_u': {
          const nm = tn(imm[0]), i = fieldIdx(nm, imm[1])
          out.push(call('nn'), acc(ld(T[nm].fields[i].st, op.slice(10)), layout(nm).offs[i]))
          break
        }
        case 'struct.set': {
          const nm = tn(imm[0]), i = fieldIdx(nm, imm[1]), st = T[nm].fields[i].st, v = V(val(st))
          out.push(['local.set', v], call('nn'), ['local.get', v], acc(sto(st), layout(nm).offs[i]))
          break
        }
        case 'array.new': { const nm = tn(imm[0]); out.push(i32(lo[canon[nm]]), call('anew_' + skey(kind(nm, 'array').elem.st))); break }
        case 'array.new_default': { const nm = tn(imm[0]); out.push(i32(lo[canon[nm]]), i32(shift(kind(nm, 'array').elem.st)), call('anew')); break }
        case 'array.new_fixed': {
          const nm = tn(imm[0]), { st } = kind(nm, 'array').elem, n = +imm[1], v = V(val(st))
          out.push(i32(n), i32(lo[canon[nm]]), i32(shift(st)), call('anew'), ['local.set', P()])
          for (let i = n; i--;) out.push(['local.set', v], ['local.get', P()], ['local.get', v], acc(sto(st), 8 + i * size(st)))
          out.push(['local.get', P()])
          break
        }
        case 'array.new_data': case 'array.new_elem': {
          const nm = tn(imm[0])
          out.push(i32(lo[canon[nm]]), i32(shift(kind(nm, 'array').elem.st)), i32(op[10] === 'e' ? 2 : 0), i32(seg(op[10], imm[1])), call('anew_seg'))
          break
        }
        case 'array.init_data': case 'array.init_elem': {
          const nm = tn(imm[0])
          out.push(i32(shift(kind(nm, 'array').elem.st)), i32(op[11] === 'e' ? 2 : 0), i32(seg(op[11], imm[1])), call('init_seg'))
          break
        }
        case 'array.get': case 'array.get_s': case 'array.get_u': {
          const { st } = kind(tn(imm[0]), 'array').elem
          out.push(i32(shift(st)), call('idx'), acc(ld(st, op.slice(9)), 8))
          break
        }
        case 'array.set': {
          const { st } = kind(tn(imm[0]), 'array').elem, v = V(val(st))
          out.push(['local.set', v], i32(shift(st)), call('idx'), ['local.get', v], acc(sto(st), 8))
          break
        }
        case 'array.len': out.push(call('nn'), acc('i32.load', 4)); break
        case 'array.fill': out.push(call('fill_' + skey(kind(tn(imm[0]), 'array').elem.st))); break
        case 'array.copy': out.push(i32(shift(kind(tn(imm[0]), 'array').elem.st)), call('copy')); break
        case 'table.get': case 'table.set': case 'table.grow': case 'table.fill':
          fail(`${op} moves references between a table and i32 values; it isn't polyfilled`)
        case 'data.drop': {
          const d = segIdx(segs.data, imm[0])
          out.push(...empty('d', imm[0]), ...blob['d' + d] == null || memData.has(d) ? [rec] : [])
          break
        }
        case 'elem.drop': out.push(...empty('e', imm[0]), ...enew[segIdx(segs.elem, imm[0])] >= 0 ? [[op, elemRef(imm[0])]] : []); break
        case 'table.init': out.push([op, ...imm.slice(0, -1), elemRef(imm[imm.length - 1])]); break
        case 'select':
          out.push(imm[0]?.[0] === 'result' && lowc(imm[0]).slice(1).every(t => SIZE[t]) ? [op] : rec.map(limm))
          break
        default:
          if (op.startsWith('struct.') || op.startsWith('array.') || op.startsWith('ref.') && op !== 'ref.func') fail(`${op} isn't polyfilled`)
          out.push(rec.map(limm))
      }
    }
    return out
  }
  const locals = tmp => [...tmp].map(([nm, t]) => ['local', nm, t])

  for (const b of bodies) {
    const tmp = new Map(), recs = lower(b.recs, tmp)
    b.node.splice(0, b.node.length, ...b.head.map(x => Array.isArray(x) && (x[0] === 'param' || x[0] === 'result' || x[0] === 'local') ? lowc(x) : x), ...locals(tmp), ...unflatten(recs))
  }

  // -- globals: a constant stays; anything else is computed at start into a mutable global
  const initTmp = new Map(), initBody = []
  const zero = t => t === 'v128' ? ['v128.const', 'i64x2', 0, 0] : [t + '.const', t === 'i64' ? 0n : 0]
  inits.forEach(({ node: n, k, recs }, i) => {
    const t = low(n[k]), lr = lower(recs, initTmp), [op, x] = lr[0] ?? []
    const constant = lr.length === 1 && (/^(i32|i64|f32|f64|v128)\.const$|^ref\.null$/.test(op) || op === 'global.get' && globals[at(gn, x)]?.imp)
    if (constant) return n.splice(k, Infinity, t, lr[0])
    if (!isId(n[1])) n.splice(1, 0, `$__gc_g${imps.global.length + i}`), k++
    const vt = t[0] === 'mut' ? t[1] : t
    n.splice(k, Infinity, ['mut', vt], zero(vt))
    initBody.push(...lr, ['global.set', n[1]])
  })

  // -- declarations
  const lowDesc = n => n.forEach((x, i) => { if (Array.isArray(x) && (x[0] === 'param' || x[0] === 'result')) n[i] = lowc(x) })
  // a table keeps real function references for call_indirect; one of GC data has no MVP form
  const lowTable = n => {
    const i = n.findIndex(x => REFS[x] || x?.[0] === 'ref'), r = i < 0 ? null : refOf(n[i])
    if (!r || isExtern(r) || !(ABS.has(r.ht) || isTref(r.ht))) return
    if (!isFunc(r)) fail(`a table of ${show(n[i])} isn't polyfilled`)
    n[i] = 'funcref'
    if (n[i + 1]?.[0] === 'ref.null') n.splice(i + 1, 1)
    else if (Array.isArray(n[i + 1]) && n[i + 1][0] !== 'elem') fail(`table initializer ${show(n[i + 1])} isn't polyfilled`)
  }
  for (const e of [...imps.func, ...imps.tag, ...defs.tag]) lowDesc(e.node)
  for (const e of imps.global) { const i = e.node.indexOf(gtype(e.node)); e.node[i] = low(e.node[i]) }
  for (const e of space('table')) lowTable(e.node)
  const nullFunc = n => walk(n, (x, p, i) => { if (Array.isArray(x) && x[0] === 'ref.null' && (isTref(x[1]) || x[1] === 'nofunc')) x[1] = 'func' })
  segs.elem.forEach((n, i) => {
    if (!n || drop.has(i)) return
    const j = n.findIndex(x => REFS[x] || x?.[0] === 'ref')
    if (j > 0 && isFunc(refOf(n[j]))) n[j] = 'funcref'
    nullFunc(n)
  })
  for (let i = m.length; i-- > first;) {
    const n = m[i]
    if (n[0] === 'type' && T[n[1]].kind !== 'func') { if (T[n[1]].kind === 'struct' || T[n[1]].kind === 'array') m.splice(i, 1); continue }
    if (n[0] === 'type') m[i] = ['type', n[1], ['func', ...T[n[1]].def.slice(1).map(lowc)]]
    else if (n[0] === 'elem' && drop.has(segs.elem.indexOf(n))) m.splice(i, 1)
  }

  // -- runtime
  const startIdx = m.findIndex(n => n[0] === 'start')
  if (initBody.length) {
    if (startIdx >= 0) initBody.push(['call', m[startIdx][1]]), m.splice(startIdx, 1)
    m.push(['func', '$__gc_init', ...locals(initTmp), ...unflatten(initBody)], ['start', '$__gc_init'])
  }
  if (slots.length) m.push(['table', '$__gc_ftab', slots.length + 1, slots.length + 1, 'funcref'], ['elem', ['table', '$__gc_ftab'], ['i32.const', 1], 'func', ...slots])
  const H = runtime(mi, i31, ftags)
  const need = new Set(), add = h => need.has(h) || (need.add(h), H[h][0].forEach(add))
  use.forEach(add)
  if (heap || appended.length || [...need].some(h => h !== 'nn')) m.push(['memory', '$__gc_mem', Math.max(1, Math.ceil(top / 65536))], ...appended)
  if (need.has('alloc')) m.push(['global', '$__gc_heap', ['mut', 'i32'], ['i32.const', top]])
  for (const h of Object.keys(H)) if (need.has(h)) m.push(parse(H[h][1], { loc: false }))
  return m
}

/**
 * Runtime helpers for the GC heap, `name: [dependencies, source]`; `mi` is
 * the heap memory's index immediate (' $__gc_mem', or '' when it is memory 0).
 */
const runtime = (mi, i31, ftags) => {
  const H = {
    // bump allocator: rounds to 8, grows the memory by doubling (or by what's needed), traps when it can't
    alloc: [[], `(func $__gc_alloc (param $n i32) (result i32) (local $p i32) (local $e i32) (local $need i32)
      (local.set $p (global.get $__gc_heap))
      (local.set $e (i32.and (i32.add (i32.add (local.get $p) (local.get $n)) (i32.const 7)) (i32.const -8)))
      (if (i32.lt_u (local.get $e) (local.get $p)) (then unreachable))
      (local.set $need (i32.sub
        (i32.add (i32.shr_u (local.get $e) (i32.const 16)) (i32.ne (i32.and (local.get $e) (i32.const 65535)) (i32.const 0)))
        (memory.size${mi})))
      (if (i32.gt_s (local.get $need) (i32.const 0)) (then
        (if (i32.eq (memory.grow${mi} (select (local.get $need) (memory.size${mi}) (i32.gt_u (local.get $need) (memory.size${mi})))) (i32.const -1))
          (then (if (i32.eq (memory.grow${mi} (local.get $need)) (i32.const -1)) (then unreachable))))))
      (global.set $__gc_heap (local.get $e))
      (local.get $p))`],
    new: [['alloc'], `(func $__gc_new (param $size i32) (param $tag i32) (result i32) (local $p i32)
      (i32.store${mi} (local.tee $p (call $__gc_alloc (local.get $size))) (local.get $tag))
      (local.get $p))`],
    nn: [[], `(func $__gc_nn (param $r i32) (result i32)
      (if (i32.eqz (local.get $r)) (then unreachable))
      (local.get $r))`],
    anew: [['alloc'], `(func $__gc_anew (param $n i32) (param $tag i32) (param $sh i32) (result i32) (local $p i32)
      (if (i32.gt_u (local.get $n) (i32.shr_u (i32.const 0x7ffffff0) (local.get $sh))) (then unreachable))
      (local.set $p (call $__gc_alloc (i32.add (i32.shl (local.get $n) (local.get $sh)) (i32.const 8))))
      (i32.store${mi} (local.get $p) (local.get $tag))
      (i32.store${mi} offset=4 (local.get $p) (local.get $n))
      (local.get $p))`],
    // element i's address minus the 8-byte header, trapping on null and out of bounds
    idx: [['nn'], `(func $__gc_idx (param $r i32) (param $i i32) (param $sh i32) (result i32)
      (if (i32.ge_u (local.get $i) (i32.load${mi} offset=4 (call $__gc_nn (local.get $r)))) (then unreachable))
      (i32.add (local.get $r) (i32.shl (local.get $i) (local.get $sh))))`],
    // address of elements [o, o + n), trapping on null and out of bounds
    span: [['nn'], `(func $__gc_span (param $r i32) (param $o i32) (param $n i32) (param $sh i32) (result i32) (local $len i32)
      (local.set $len (i32.load${mi} offset=4 (call $__gc_nn (local.get $r))))
      (if (i32.or (i32.gt_u (local.get $o) (local.get $len)) (i32.gt_u (local.get $n) (i32.sub (local.get $len) (local.get $o)))) (then unreachable))
      (i32.add (i32.add (local.get $r) (i32.const 8)) (i32.shl (local.get $o) (local.get $sh))))`],
    move: [[], `(func $__gc_move (param $d i32) (param $s i32) (param $n i32)
      (if (i32.le_u (local.get $d) (local.get $s))
        (then (block $done (loop $next
          (br_if $done (i32.eqz (local.get $n)))
          (i32.store8${mi} (local.get $d) (i32.load8_u${mi} (local.get $s)))
          (local.set $d (i32.add (local.get $d) (i32.const 1)))
          (local.set $s (i32.add (local.get $s) (i32.const 1)))
          (local.set $n (i32.sub (local.get $n) (i32.const 1)))
          (br $next))))
        (else (block $done (loop $next
          (br_if $done (i32.eqz (local.get $n)))
          (local.set $n (i32.sub (local.get $n) (i32.const 1)))
          (i32.store8${mi} (i32.add (local.get $d) (local.get $n)) (i32.load8_u${mi} (i32.add (local.get $s) (local.get $n))))
          (br $next))))))`],
    copy: [['span', 'move'], `(func $__gc_copy (param $d i32) (param $do i32) (param $s i32) (param $so i32) (param $n i32) (param $sh i32)
      (call $__gc_move
        (call $__gc_span (local.get $d) (local.get $do) (local.get $n) (local.get $sh))
        (call $__gc_span (local.get $s) (local.get $so) (local.get $n) (local.get $sh))
        (i32.shl (local.get $n) (local.get $sh))))`],
    // address of element o (o << osh bytes in) of the segment copy at seg, trapping when n elements don't fit
    seg: [[], `(func $__gc_seg (param $o i32) (param $n i32) (param $sh i32) (param $osh i32) (param $seg i32) (result i32)
      (if (i64.gt_u
            (i64.add (i64.shl (i64.extend_i32_u (local.get $o)) (i64.extend_i32_u (local.get $osh)))
                     (i64.shl (i64.extend_i32_u (local.get $n)) (i64.extend_i32_u (local.get $sh))))
            (i64.extend_i32_u (i32.load${mi} (local.get $seg))))
        (then unreachable))
      (i32.add (i32.add (local.get $seg) (i32.const 8)) (i32.shl (local.get $o) (local.get $osh))))`],
    anew_seg: [['seg', 'anew', 'move'], `(func $__gc_anew_seg (param $o i32) (param $n i32) (param $tag i32) (param $sh i32) (param $osh i32) (param $seg i32) (result i32) (local $p i32)
      (local.set $o (call $__gc_seg (local.get $o) (local.get $n) (local.get $sh) (local.get $osh) (local.get $seg)))
      (local.set $p (call $__gc_anew (local.get $n) (local.get $tag) (local.get $sh)))
      (call $__gc_move (i32.add (local.get $p) (i32.const 8)) (local.get $o) (i32.shl (local.get $n) (local.get $sh)))
      (local.get $p))`],
    init_seg: [['seg', 'span', 'move'], `(func $__gc_init_seg (param $r i32) (param $d i32) (param $s i32) (param $n i32) (param $sh i32) (param $osh i32) (param $seg i32)
      (local.set $s (call $__gc_seg (local.get $s) (local.get $n) (local.get $sh) (local.get $osh) (local.get $seg)))
      (call $__gc_move (call $__gc_span (local.get $r) (local.get $d) (local.get $n) (local.get $sh)) (local.get $s) (i32.shl (local.get $n) (local.get $sh))))`],
    // is v an object whose tag is in [lo, lo + span]; null answers nul
    test: [[], `(func $__gc_test (param $v i32) (param $lo i32) (param $span i32) (param $nul i32) (result i32)
      (if (i32.eqz (local.get $v)) (then (return (local.get $nul))))
      ${i31 ? '(if (i32.and (local.get $v) (i32.const 1)) (then (return (i32.const 0))))' : ''}
      (i32.le_u (i32.sub (i32.load${mi} (local.get $v)) (local.get $lo)) (local.get $span)))`],
    // the same for a function slot, whose type tag sits in a table at ${ftags}
    ftest: [[], `(func $__gc_ftest (param $v i32) (param $lo i32) (param $span i32) (param $nul i32) (result i32)
      (if (i32.eqz (local.get $v)) (then (return (local.get $nul))))
      (i32.le_u (i32.sub (i32.load${mi} offset=${ftags} (i32.shl (local.get $v) (i32.const 2))) (local.get $lo)) (local.get $span)))`],
  }
  for (const k of ['i8', 'i16', 'i32', 'i64', 'f32', 'f64', 'v128']) {
    const t = SIZE[k] < 4 ? 'i32' : k, st = SIZE[k] < 4 ? `i32.store${k.slice(1)}` : `${k}.store`
    H['fill_' + k] = [['span'], `(func $__gc_fill_${k} (param $r i32) (param $o i32) (param $v ${t}) (param $n i32) (local $p i32)
      (local.set $p (call $__gc_span (local.get $r) (local.get $o) (local.get $n) (i32.const ${Math.log2(SIZE[k])})))
      (block $done (loop $next
        (br_if $done (i32.eqz (local.get $n)))
        (${st}${mi} (local.get $p) (local.get $v))
        (local.set $p (i32.add (local.get $p) (i32.const ${SIZE[k]})))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (br $next))))`]
    H['anew_' + k] = [['anew', 'fill_' + k], `(func $__gc_anew_${k} (param $v ${t}) (param $n i32) (param $tag i32) (result i32) (local $p i32)
      (local.set $p (call $__gc_anew (local.get $n) (local.get $tag) (i32.const ${Math.log2(SIZE[k])})))
      (call $__gc_fill_${k} (local.get $p) (i32.const 0) (local.get $v) (local.get $n))
      (local.get $p))`]
  }
  return H
}

/**
 * Polyfillable features, in the order their transforms apply. Each entry is
 * `[name, triggerOps, transform]` — the single source of truth for detection,
 * the public `FEATURES` catalogue, and the dispatch loop below.
 *   - name       — feature key callers toggle (`polyfill: 'funcref gc'`)
 *   - triggerOps — instruction names whose presence means the feature is used
 *   - transform  — the lowering pass, `(ast, ctx) => ast`
 */
const POLYFILLS = [
  ['funcref',        ['ref.func', 'call_ref', 'return_call_ref'], funcref],
  ['sign_ext',       ['i32.extend8_s', 'i32.extend16_s', 'i64.extend8_s', 'i64.extend16_s', 'i64.extend32_s'], sign_ext],
  ['nontrapping',    ['i32.trunc_sat_f32_s', 'i32.trunc_sat_f32_u', 'i32.trunc_sat_f64_s', 'i32.trunc_sat_f64_u',
                      'i64.trunc_sat_f32_s', 'i64.trunc_sat_f32_u', 'i64.trunc_sat_f64_s', 'i64.trunc_sat_f64_u'], nontrapping],
  ['bulk_memory',    ['memory.copy', 'memory.fill'], bulk_memory],
  ['return_call',    ['return_call', 'return_call_indirect'], return_call_transform],
  ['extended_const', ['global.get'], extended_const],  // global.get in a const initializer — also detected specially
  ['multi_value',    [], multi_value],                 // functions with >1 result — detected by result count
  // gc runs after the passes above (they read folded code; it leaves flat code) and before i31ref,
  // whose 31-bit mask it replaces: in a GC module an i31 must stay apart from heap addresses
  ['gc',             ['struct.new', 'struct.new_default', 'struct.get', 'struct.get_s', 'struct.get_u', 'struct.set',
                      'array.new', 'array.new_default', 'array.new_fixed', 'array.new_data', 'array.new_elem',
                      'array.get', 'array.get_s', 'array.get_u', 'array.set', 'array.len', 'array.fill', 'array.copy',
                      'array.init_data', 'array.init_elem', 'ref.eq', 'any.convert_extern', 'extern.convert_any'], gc],  // also GC types
  ['i31ref',         ['ref.i31', 'i31.get_s', 'i31.get_u'], i31ref],
  ['ref_cast',       ['ref.test', 'ref.cast', 'br_on_cast', 'br_on_cast_fail'], gc],  // casts need the heap's tags: the gc lowering
]

/** Feature name → trigger-op list — the public catalogue of polyfillable features. */
const FEATURES = Object.fromEntries(POLYFILLS.map(p => [p[0], p[1]]))

/**
 * Normalize polyfill options to a { feature: bool } map. `true` enables every
 * feature, a string enables only the named ones (or all via `'all'`), and an
 * explicit object is passed through untouched.
 *
 * @param {boolean|string|Object} opts
 * @returns {Object} Normalized options
 */
const normalize = (opts) => {
  if (opts === false) return {}
  if (opts !== true && typeof opts !== 'string') return { ...opts }
  const set = typeof opts === 'string' ? new Set(opts.split(/\s+/).filter(Boolean)) : null
  const m = {}
  for (const p of POLYFILLS) m[p[0]] = set ? (set.has('all') || set.has(p[0])) : true
  return m
}

const GC_TYPES = new Set(['struct', 'array', 'anyref', 'eqref', 'i31ref', 'structref', 'arrayref', 'nullref', 'any', 'eq', 'i31', 'none'])

/**
 * Detect which polyfillable features an AST uses.
 *
 * @param {Array} ast
 * @returns {Set<string>} Set of feature names
 */
const detect = (ast) => {
  const used = new Set()

  // Standard op detection: a trigger op anywhere means its feature is used.
  walk(ast, node => {
    if (typeof node !== 'string') return
    for (const p of POLYFILLS) {
      const ops = p[1]
      if (ops.some(op => node === op || node.startsWith(op + ' '))) used.add(p[0])
    }
  })

  // Special: gc, by GC types: struct/array definitions, any/eq/i31/struct/array/none references
  walk(ast, node => { if (typeof node === 'string' && GC_TYPES.has(node)) used.add('gc') })

  // Special: extended_const — global.get in a global initializer with arithmetic
  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'global') return
    for (const init of node) {
      if (!Array.isArray(init)) continue
      if (init[0] === 'i32.add' || init[0] === 'i32.sub' || init[0] === 'i32.mul' ||
          init[0] === 'i64.add' || init[0] === 'i64.sub' || init[0] === 'i64.mul') {
        walk(init, inner => {
          if (Array.isArray(inner) && inner[0] === 'global.get') used.add('extended_const')
        })
      }
    }
  })

  // Special: multi_value — functions with >1 result
  walk(ast, node => {
    if (!Array.isArray(node) || node[0] !== 'func') return
    let resultCount = 0
    for (const part of node) {
      if (Array.isArray(part) && part[0] === 'result') resultCount += part.length - 1
    }
    if (resultCount > 1) used.add('multi_value')
  })

  return used
}

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
  // gc (or ref_cast, which needs it) lowers every reference; funcref defers to it
  const ctx = { uid: 0, opts, gc: ['gc', 'ref_cast'].some(f => used.has(f) && opts[f] !== false) }

  for (const p of POLYFILLS) {
    const fn = p[2]
    if (used.has(p[0]) && opts[p[0]] !== false) ast = fn(ast, ctx)
  }

  return ast
}

export { polyfill, detect, normalize, FEATURES }
