/**
 * Statement scheduling for instruction-level parallelism.
 *
 * A straight-line run of statements keeps its data order and nothing else:
 * each statement goes as early as the longest chain of work still depending
 * on it warrants, so independent long computations (kernel calls,
 * divisions) start together and the processor overlaps them. Three color
 * channels each taking an inner and an outer pow, written channel by
 * channel, leave each outer pow waiting for its inner one while the next
 * channel's inner pow, independent of both, sits behind it in program order
 * beyond the processor's window. Scheduled, the three inner pows run first,
 * then the three outer ones.
 *
 * Dependencies: a local's write goes after its earlier reads and writes,
 * its reads after its write; a memory read after a write and a write after
 * a read or a write, globals likewise; statements with an effect (a store,
 * a call with effects, a global write, an operator that can trap) keep
 * their order among themselves. A control statement, or one that branches
 * out of itself or leaves a value, bounds a run. A run is rescheduled only
 * when it holds two computations worth overlapping.
 *
 * Runs after value numbering (number.js), whose holder statements are the
 * shared computations this moves. `call(name)` says what a call is, as there:
 * 'pure', 'read' or null. A function written in the flat form is left alone.
 *
 * @module schedule
 */
import { isMemWrite as writesMemory, mayTrap as mayTrapOp, visit, bodyStart as findBodyStart, seqStart, hasFlat } from './effect.js'

const isArr = Array.isArray
const CONTROL = new Set(['block', 'loop', 'if', 'try_table', 'br', 'br_if', 'br_table', 'return', 'return_call', 'return_call_indirect', 'return_call_ref', 'unreachable', 'throw', 'throw_ref', 'rethrow'])
const BRANCH = new Set(['try_table', 'br', 'br_if', 'br_table', 'return', 'return_call', 'return_call_indirect', 'return_call_ref', 'unreachable', 'throw', 'throw_ref', 'rethrow'])
const VOID = new Set(['local.set', 'global.set', 'drop', 'nop', 'call'])
const HEAVY = /\.(div|div_s|div_u|sqrt)$/
const isLoad = (op) => op.includes('.load')
const intersects = (a, b) => { for (const x of a) if (b.has(x)) return true; return false }

/** A statement that can move: void, and no branch inside it. */
const movable = (s) => {
  if (!isArr(s) || typeof s[0] !== 'string') return false
  if (CONTROL.has(s[0]) || !(VOID.has(s[0]) || writesMemory(s[0]))) return false
  let branch = false
  visit(s, (c) => { if (branch) return false; const op = c[0]; if (BRANCH.has(op) || (typeof op === 'string' && (op.startsWith('table.') || op.includes('atomic') || op === 'memory.size'))) branch = true })
  return !branch
}

/** What a statement reads and writes, whether its order is fixed, and the work it holds. */
const facts = (s, call) => {
  const defs = new Set(), uses = new Set()
  let memR = false, memW = false, globR = false, globW = false, ordered = false, lat = 0, heavy = 0
  visit(s, (c) => {
    const op = c[0]
    if (typeof op !== 'string') return
    if (op === 'local.get') uses.add(c[1])
    else if (op === 'local.set' || op === 'local.tee') defs.add(c[1])
    else if (op === 'global.get') globR = true
    else if (op === 'global.set') { globW = true; ordered = true }
    else if (op === 'call') {
      const kind = call(c[1])
      if (kind === 'pure') { lat += 40; heavy++ }
      else if (kind === 'read') { lat += 40; heavy++; memR = true; globR = true; ordered = true }
      else { ordered = true; memR = memW = globR = globW = true; lat += 40 }
    }
    else if (op === 'call_indirect' || op === 'call_ref') { ordered = true; memR = memW = globR = globW = true; lat += 40 }
    else if (writesMemory(op)) { memW = true; ordered = true; lat += 1 }
    else if (isLoad(op)) { memR = true; ordered = true; lat += 4 }
    else if (mayTrapOp(op)) { ordered = true; lat += 12 }
    else if (HEAVY.test(op)) { lat += 12; heavy++ }
    else if (!op.endsWith('.const')) lat += 1
  })
  return { defs, uses, memR, memW, globR, globW, ordered, lat, heavy }
}

/** Whether statement `j` must follow statement `i`. */
const after = (i, j) =>
  intersects(j.uses, i.defs) || intersects(j.defs, i.uses) || intersects(j.defs, i.defs) ||
  (i.memW && (j.memR || j.memW)) || (i.memR && j.memW) ||
  (i.globW && (j.globR || j.globW)) || (i.globR && j.globW) ||
  (i.ordered && j.ordered)

/** Reorder the run seq[start..end) by height; returns whether it changed. */
const scheduleRun = (seq, start, end, call) => {
  const n = end - start
  if (n < 2) return false
  const f = []
  for (let i = start; i < end; i++) f.push(facts(seq[i], call))
  let heavy = 0
  for (const x of f) if (x.heavy) heavy++
  if (heavy < 2) return false
  const preds = f.map(() => []), succs = f.map(() => [])
  for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) if (after(f[i], f[j])) { preds[j].push(i); succs[i].push(j) }
  const height = new Array(n)
  for (let i = n - 1; i >= 0; i--) { let h = 0; for (const j of succs[i]) if (height[j] > h) h = height[j]; height[i] = f[i].lat + h }
  const left = preds.map(p => p.length), order = []
  for (let k = 0; k < n; k++) {
    let pick = -1
    for (let i = 0; i < n; i++) if (left[i] === 0 && (pick < 0 || height[i] > height[pick])) pick = i
    order.push(pick); left[pick] = -1
    for (const j of succs[pick]) left[j]--
  }
  if (order.every((i, k) => i === k)) return false
  const items = order.map(i => seq[start + i])
  for (let k = 0; k < n; k++) seq[start + k] = items[k]
  return true
}

// Integer min/max updates commute. When one input carries this reduction's
// previous result, consume it last so independent comparisons can run first.
// The dependency check chooses an order only; the matcher proves commuting.
const minMaxUpdate = n => {
  if (n?.[0] !== 'if' || n.length !== 3) return null
  const c = n[1], b = n[2], s = b?.[1]
  if (!/^i32\.(lt|le|gt|ge)_[su]$/.test(c?.[0]) ||
      c[1]?.[0] !== 'local.get' || c[2]?.[0] !== 'local.get' ||
      b?.[0] !== 'then' || b.length !== 2 || s?.[0] !== 'local.set' || s[2]?.[0] !== 'local.get') return null
  const acc = s[1], input = s[2][1]
  if (acc === input) return null
  const left = c[1][1] === input && c[2][1] === acc
  if (!left && !(c[1][1] === acc && c[2][1] === input)) return null
  return { acc, input, kind: c[0].slice(-1) + ((c[0][4] === 'l') === left ? 'min' : 'max') }
}

const deferCarriedReduction = (seq, from, i) => {
  const a = minMaxUpdate(seq[i]), b = a && minMaxUpdate(seq[i + 1])
  if (!b || a.acc !== b.acc || a.kind !== b.kind) return
  const carries = new Set([a.acc])
  for (let j = i + 2; j < seq.length; j++) {
    const s = seq[j]
    if (CONTROL.has(s?.[0]) || s?.[0] === 'local.set' && s[1] === a.acc) break
    if (s?.[0] === 'local.set' && s[2]?.[0] === 'local.get' && s[2][1] === a.acc) carries.add(s[1])
  }
  const carried = name => {
    for (let j = i - 1; j >= from; j--) {
      const s = seq[j]
      if (CONTROL.has(s?.[0])) break
      if (s?.[0] !== 'local.set' || s[1] !== name) continue
      let found = false
      visit(s[2], n => { if (n[0] === 'local.get' && carries.has(n[1])) found = true })
      return found
    }
    return carries.has(name)
  }
  if (carried(a.input) && !carried(b.input)) {
    const first = seq[i]; seq[i] = seq[i + 1]; seq[i + 1] = first
  }
}

/** Schedule every run of movable statements in the sequence seq[from..]. */
const scheduleSeq = (seq, from, call) => {
  let start = from
  for (let i = from; i <= seq.length; i++) {
    if (seq[0] === 'loop') deferCarriedReduction(seq, from, i)
    if (i < seq.length && movable(seq[i])) continue
    scheduleRun(seq, start, i, call)
    start = i + 1
  }
}

/**
 * @param fn a `(func …)` node, rewritten in place
 * @param call what a call to a function is: 'pure', 'read' or null
 */
export default function schedule(fn, call) {
  if (!isArr(fn) || fn[0] !== 'func' || hasFlat(fn)) return
  const bodyStart = findBodyStart(fn)
  if (bodyStart < 0) return
  scheduleSeq(fn, bodyStart, call)
  visit(fn, (c) => {
    if (c[0] === 'loop' || c[0] === 'block') scheduleSeq(c, seqStart(c), call)
    else if (c[0] === 'then' || c[0] === 'else') scheduleSeq(c, 1, call)
  })
}
