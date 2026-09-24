// Instruction effects the optimizer's reordering passes share.

/** Writes memory or a table. */
export const isMemWrite = (op) => op.includes('.store') || op === 'memory.copy' || op === 'memory.fill' || op === 'memory.init' || op === 'memory.grow' ||
  (op.includes('.atomic.') && !op.endsWith('.load')) || op === 'table.set' || op === 'table.grow' || op === 'table.fill' || op === 'table.copy' || op === 'table.init'

const TRAPS = new Set(['unreachable', 'ref.as_non_null', 'ref.cast', 'table.get',
  'struct.get', 'struct.get_s', 'struct.get_u', 'array.get', 'array.get_s', 'array.get_u', 'array.len'])

/** May trap: a read, integer division, a non-saturating truncation, a checked reference. Stores
 *  trap too, and are ordered as writes; a call's traps are its callee's. */
export const mayTrap = (op) => typeof op === 'string' && (op.includes('.load') || TRAPS.has(op) ||
  /^(i32|i64)\.(div_s|div_u|rem_s|rem_u)$|\.trunc_f(32|64)_[su]$/.test(op))

/** Pre-order over the array nodes under `node`: `enter` returns false to skip a node's children. */
export const visit = (node, enter, parent = null, idx = -1) => {
  if (!Array.isArray(node) || enter(node, parent, idx) === false) return
  for (let i = 1; i < node.length; i++) visit(node[i], enter, node, i)
}

/** The index of a function's first instruction, past its name and header. */
export const bodyStart = (fn) => {
  let i = typeof fn[1] === 'string' && fn[1][0] === '$' ? 2 : 1
  while (i < fn.length && Array.isArray(fn[i]) && HEADER.has(fn[i][0])) i++
  return i
}
const HEADER = new Set(['export', 'import', 'type', 'param', 'result', 'local'])

/** The first child of a block, loop or arm past its label and signature. */
export const seqStart = (n) => {
  let i = typeof n[1] === 'string' && n[1][0] === '$' ? 2 : 1
  while (i < n.length && Array.isArray(n[i]) && SIGNATURE.has(n[i][0])) i++
  return i
}
const SIGNATURE = new Set(['type', 'param', 'result'])

const SEQ = { block: seqStart, loop: seqStart, try_table: seqStart, then: () => 1, else: () => 1 }

// Operands a node takes; a folded node carries them as children, a flat one pops them.
const OPERANDS = { 'local.set': 1, 'local.tee': 1, 'global.set': 1, drop: 1, select: 3, br_if: 1 }
const TYPED = /^(i32|i64|f32|f64|v128|i8x16|i16x8|i32x4|i64x2|f32x4|f64x2)\./
const takesStack = (n) => {
  let args = 0
  for (let i = 1; i < n.length; i++) if (Array.isArray(n[i]) && !SIGNATURE.has(n[i][0])) args++
  const op = n[0]
  return op in OPERANDS ? args < OPERANDS[op] : typeof op === 'string' && TYPED.test(op) && !op.endsWith('.const') && args === 0
}

/** Whether a function writes an instruction in the flat form: a bare token in an instruction
 *  sequence other than `drop` or `nop`, or a node that pops its operands (the sets that unpack
 *  a multi-value call). A pass that reads effects and data flow off folded nodes skips it. */
export const hasFlat = (fn) => {
  let found = false
  const check = (seq, from) => { for (let i = from; i < seq.length; i++) if (typeof seq[i] === 'string' && seq[i] !== 'drop' && seq[i] !== 'nop') found = true }
  check(fn, bodyStart(fn))
  visit(fn, (n) => {
    if (found) return false
    if (n !== fn && takesStack(n)) { found = true; return false }
    const start = n === fn ? null : SEQ[n[0]]
    if (start) check(n, start(n))
  })
  return found
}
