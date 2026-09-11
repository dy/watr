// The local propagation family (`propagate`: forward substitution, set→tee sinking,
// copy merging, dead-store elimination) as a differential: every module below is
// run before and after the pass, and after the whole default pipeline, with the
// same inputs; results, traps and the memory left behind must agree, and the pass
// never inflates. Where a shape must transform, the structure is asserted too.
// The shapes are the ones a host compiler's own local passes handled before this
// family absorbed them (jz's propagateSingleUse/foldSetToTee): numeric and named
// locals, reads and writes inside the use expression, tees, nested control,
// zero-trip loops, branch exits, trapping operations, try_table catch operands,
// calls and indirect calls, memory.size/grow, loads and stores, v128 lanes.
import { test } from 'node:test'
import assert from 'node:assert'
import optimize, { binarySize, cse } from '../src/optimize.js'
import { parse, print, compile } from './runner.js'

const MEM = '(memory (export "memory") 1)'
// A run: the calls in order, and after EVERY call the result or trap, the host log so far,
// every exported global and the first 64 bytes of memory, so a wrong write early in the
// sequence cannot be hidden by a later call. `init` fills memory before the first call
// (nonzero bytes make a misplaced read or write visible where zeros would not).
const run = (bytes, calls, imports = {}, init = null) => {
  const mod = new WebAssembly.Module(bytes)
  const log = []
  const inst = new WebAssembly.Instance(mod, { env: { log: v => { log.push(v); return v }, ...imports } })
  if (init && inst.exports.memory) new Uint8Array(inst.exports.memory.buffer).set(init)
  const snapshot = () => ({
    log: [...log],
    globals: Object.fromEntries(Object.entries(inst.exports).filter(([, v]) => v instanceof WebAssembly.Global).map(([k, v]) => [k, v.value])),
    mem: inst.exports.memory ? [...new Uint8Array(inst.exports.memory.buffer).subarray(0, 64)] : null,
    pages: inst.exports.memory?.buffer.byteLength,
  })
  const steps = []
  for (const [name, ...args] of calls) {
    let out
    try { out = ['ok', inst.exports[name](...args)] }
    catch (e) { out = ['throws', e.constructor.name, e instanceof WebAssembly.RuntimeError ? e.message : ''] }
    steps.push({ call: `${name}(${args.join(', ')})`, out, ...snapshot() })
  }
  return { out: steps.map(s => s.out), steps, ...snapshot() }
}
// Before: the parsed module as is. After: `propagate` alone, then the default pipeline.
const check = (src, calls, expect, imports, init) => {
  const before = compile(src)
  const ast = parse(src)
  const propagated = optimize(parse(src), 'propagate')
  const after = compile(print(propagated))
  const full = compile(print(optimize(parse(src))))
  const a = run(before, calls, imports, init), b = run(after, calls, imports, init), c = run(full, calls, imports, init)
  assert.deepEqual(b.steps, a.steps, 'propagate alone preserves results, traps, log, globals and memory after every call')
  assert.deepEqual(c.steps, a.steps, 'the default pipeline preserves them too')
  assert.ok(binarySize(propagated) <= binarySize(ast), `propagate never inflates: ${binarySize(ast)} → ${binarySize(propagated)}`)
  if (expect) expect(print(propagated), a)
  return print(propagated)
}
const PATTERN = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 255)
const P0 = PATTERN[0] | PATTERN[1] << 8 | PATTERN[2] << 16 | PATTERN[3] << 24   // the i32 at address 0 under the pattern

test('propagate-locals: a pure single-use temp is forwarded, named or numeric', () => {
  const named = `(module ${MEM} (func (export "f") (param $a i32) (param $i i32) (result i32) (local $t i32)
    (local.set $t (i32.mul (i32.add (local.get $i) (i32.const 1)) (i32.const 4)))
    (i32.load (i32.add (local.get $a) (local.get $t)))))`
  check(named, [['f', 0, 0], ['f', 0, 3]], src => assert.ok(!src.includes('local.set') && !src.includes('$t'), 'the temp, its set and its get are gone'))
  const numeric = `(module (func (export "f") (param i32) (result i32) (local i32)
    (local.set 1 (i32.add (local.get 0) (i32.const 1)))
    (i32.mul (local.get 1) (i32.const 2))))`
  check(numeric, [['f', 5], ['f', -1]], src => assert.ok(!src.includes('local.set'), 'the numeric temp is forwarded'))
})

test('propagate-locals: a multi-use single-def sinks to its first use as a tee; a later conditional use still reads it', () => {
  const src = `(module ${MEM} (func (export "f") (param $a i32) (param $c i32) (result i32) (local $p i32) (local $r i32)
    (local.set $p (i32.add (i32.load (local.get $a)) (i32.load offset=4 (local.get $a))))
    (local.set $r (local.get $p))
    (if (local.get $c) (then (local.set $r (i32.mul (local.get $p) (i32.const 2)))))
    (local.get $r)))`
  const init = m => { new Uint32Array(m.buffer).set([3, 4]) }
  const out = check(src, [['f', 0, 0], ['f', 0, 1]], (s, a) => assert.deepEqual(a.out.map(o => o[1]), [0, 0]))
  // with values in memory the results must be 7 and 14 (init after instantiate: exercise through a second module state)
  const before = compile(src), after = compile(out)
  for (const bytes of [before, after]) {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes))
    init(inst.exports.memory)
    assert.deepEqual([inst.exports.f(0, 0), inst.exports.f(0, 1)], [7, 14])
  }
})

test('propagate-locals: an effectful single-use (call, load) is forwarded only where its effect stays in order', () => {
  const call = `(module (import "env" "log" (func $log (param i32) (result i32))) (func (export "f") (result i32) (local $t i32)
    (local.set $t (call $log (i32.const 1)))
    (drop (call $log (i32.const 2)))
    (i32.add (local.get $t) (i32.const 10))))`
  check(call, [['f']], (s, a) => { assert.deepEqual(a.log, [1, 2], 'the calls run in source order'); assert.ok(/local\.set \$t/.test(s), 'a call cannot cross another call') })
  const alone = `(module (import "env" "log" (func $log (param i32) (result i32))) (func (export "f") (result i32) (local $t i32)
    (local.set $t (call $log (i32.const 1)))
    (i32.add (local.get $t) (i32.const 10))))`
  check(alone, [['f']], s => assert.ok(!s.includes('local.set'), 'with nothing between, the call moves into its use'))
  const loadAcrossStore = `(module ${MEM} (func (export "f") (result i32) (local $v i32)
    (local.set $v (i32.load (i32.const 0)))
    (i32.store (i32.const 0) (i32.const 99))
    (i32.add (local.get $v) (i32.load (i32.const 0)))))`
  check(loadAcrossStore, [['f'], ['f']], (s, a) => { assert.deepEqual(a.out, [['ok', 99], ['ok', 198]]); assert.ok(/local\.set \$v/.test(s), 'a load does not cross a store') })
})

test('propagate-locals: reads and writes inside the use expression, and a tee in the definition', () => {
  const writeInUse = `(module (func (export "f") (param $a i32) (result i32) (local $t i32) (local $u i32)
    (local.set $t (i32.add (local.get $a) (i32.const 1)))
    (i32.add (local.tee $a (i32.const 100)) (local.get $t))))`
  check(writeInUse, [['f', 1], ['f', 7]], (s, a) => assert.deepEqual(a.out.map(o => o[1]), [102, 108], 'the use writes $a before reading $t: $t keeps the old $a'))
  const teeDef = `(module ${MEM} (func (export "f") (param $i i32) (result i32) (local $t i32) (local $j i32)
    (local.set $t (i32.load (local.tee $j (i32.shl (local.get $i) (i32.const 2)))))
    (i32.store (local.get $j) (i32.const 5))
    (i32.add (local.get $t) (local.get $j))))`
  check(teeDef, [['f', 0], ['f', 1], ['f', 0]], (s, a) => assert.deepEqual(a.out.map(o => o[1]), [0, 4, 5]))
})

test('propagate-locals: nested control, a zero-trip loop and a branch exit keep the value alive', () => {
  const nested = `(module (func (export "f") (param $c i32) (param $x i32) (result i32) (local $t i32)
    (local.set $t (i32.mul (local.get $x) (i32.const 3)))
    (if (result i32) (local.get $c)
      (then (block (result i32) (i32.add (local.get $t) (i32.const 1))))
      (else (i32.sub (i32.const 0) (local.get $t))))))`
  check(nested, [['f', 1, 2], ['f', 0, 2]], (s, a) => assert.deepEqual(a.out.map(o => o[1]), [7, -6]))
  const zeroTrip = `(module ${MEM} (func (export "f") (param $n i32) (result i32) (local $k i32) (local $s i32) (local $i i32)
    (local.set $k (i32.mul (i32.load (i32.const 0)) (i32.const 2)))
    (block $b (loop $l
      (br_if $b (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $s (i32.add (local.get $s) (local.get $k)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $l)))
    (i32.add (local.get $s) (local.get $k))))`
  check(zeroTrip, [['f', 0], ['f', 3]], s => assert.ok(/local\.set \$k/.test(s) && !/loop[\s\S]*i32\.load/.test(s), 'the load is not sunk into the loop'))
  const branchExit = `(module (func (export "f") (param $c i32) (result i32) (local $t i32) (local $r i32)
    (local.set $t (i32.add (local.get $c) (i32.const 40)))
    (local.set $r (i32.const -1))
    (block $out
      (br_if $out (local.get $c))
      (local.set $r (local.get $t)))
    (i32.add (local.get $r) (local.get $t))))`
  check(branchExit, [['f', 0], ['f', 1]], (s, a) => assert.deepEqual(a.out.map(o => o[1]), [80, 40]))
})

test('propagate-locals: a trapping definition keeps its place relative to stores, and the trap is the same', () => {
  const divTrap = `(module ${MEM} (func (export "f") (param $d i32) (result i32) (local $q i32)
    (local.set $q (i32.div_s (i32.const 100) (local.get $d)))
    (i32.store (i32.const 0) (i32.const 7))
    (i32.add (local.get $q) (i32.load (i32.const 0)))))`
  check(divTrap, [['f', 0]], (s, a) => {
    assert.deepEqual(a.out[0].slice(0, 2), ['throws', 'RuntimeError'], 'division by zero traps')
    assert.deepEqual(a.mem.slice(0, 4), [0, 0, 0, 0], 'and the store after it did not run')
  })
  check(divTrap, [['f', 5]], (s, a) => assert.deepEqual(a.out[0], ['ok', 27]))
  const oob = `(module ${MEM} (func (export "f") (param $p i32) (result i32) (local $v i32)
    (local.set $v (i32.load (local.get $p)))
    (i32.store (i32.const 0) (i32.const 1))
    (local.get $v)))`
  check(oob, [['f', 0x10000]], (s, a) => { assert.equal(a.out[0][0], 'throws'); assert.deepEqual(a.mem.slice(0, 4), [0, 0, 0, 0], 'an out-of-bounds load traps before the store') })
  check(oob, [['f', 0]], (s, a) => assert.deepEqual(a.out[0], ['ok', 0]))
  const truncTrap = `(module (func (export "f") (param $x f64) (result i32) (local $t i32)
    (local.set $t (i32.trunc_f64_s (local.get $x)))
    (i32.add (local.get $t) (i32.const 1))))`
  check(truncTrap, [['f', 2.5], ['f', NaN], ['f', 1e300]], (s, a) => assert.deepEqual(a.out.map(o => o[0]), ['ok', 'throws', 'throws']))
})

test('propagate-locals: a try_table catch operand set without a value, then read', () => {
  const src = `(module (tag $e (param i32)) (func (export "f") (param $c i32) (result i32) (local $v i32) (local $x i32)
    (local.set $x (i32.add (local.get $c) (i32.const 5)))
    (block $h (result i32)
      (try_table (result i32) (catch $e $h)
        (if (local.get $c) (then (throw $e (local.get $x))))
        (i32.const -1)))
    (local.set $v)
    (i32.add (local.get $v) (local.get $x))))`
  check(src, [['f', 0], ['f', 3]], (s, a) => assert.deepEqual(a.out.map(o => o[1]), [4, 16]))
})

test('propagate-locals: memory.size across memory.grow, and a call_indirect', () => {
  const grow = `(module ${MEM} (func (export "f") (result i32) (local $t i32)
    (local.set $t (memory.size))
    (drop (memory.grow (i32.const 1)))
    (i32.add (i32.mul (local.get $t) (i32.const 100)) (memory.size))))`
  check(grow, [['f'], ['f']], (s, a) => { assert.deepEqual(a.out.map(o => o[1]), [102, 203]); assert.ok(/local\.set \$t \(memory\.size\)/.test(s), 'memory.size is a read that memory.grow invalidates') })
  const indirect = `(module ${MEM} (type $fn (func (result i32))) (table 2 funcref) (elem (i32.const 0) $a $b)
    (func $a (result i32) (i32.store (i32.const 0) (i32.const 1)) (i32.const 10))
    (func $b (result i32) (i32.const 20))
    (func (export "f") (param $i i32) (result i32) (local $v i32) (local $m i32)
      (local.set $m (i32.load (i32.const 0)))
      (local.set $v (call_indirect (type $fn) (local.get $i)))
      (i32.add (i32.add (local.get $v) (local.get $m)) (i32.load (i32.const 0)))))`
  check(indirect, [['f', 1], ['f', 0], ['f', 1]], (s, a) => assert.deepEqual(a.out.map(o => o[1]), [20, 11, 22], 'the load before the indirect call keeps its old value'))
})

test('propagate-locals: v128 lanes propagate like any value and the function stays right', () => {
  const src = `(module ${MEM} (func (export "f") (param $p i32) (result f64) (local $v v128) (local $w v128)
    (local.set $v (v128.load (local.get $p)))
    (local.set $w (f64x2.mul (local.get $v) (f64x2.splat (f64.const 2))))
    (v128.store (local.get $p) (local.get $w))
    (f64.add (f64x2.extract_lane 0 (local.get $w)) (f64x2.extract_lane 1 (local.get $v)))))`
  const before = compile(src), after = compile(check(src, [['f', 0]]))
  for (const bytes of [before, after]) {
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes))
    new Float64Array(inst.exports.memory.buffer).set([1.5, 2.5])
    assert.equal(inst.exports.f(0), 3 + 2.5)
    assert.deepEqual([...new Float64Array(inst.exports.memory.buffer).subarray(0, 2)], [3, 5])
  }
})

// ── evaluation order inside one statement ────────────────────────────────────
// A tracked load, global read, call result or trapping value must not be
// substituted after an effect that follows its definition, wherever that effect
// sits: as the RHS of a set or tee, under a drop, a return, a store operand, and
// whether it is the first, second or a repeated effect of its kind in the
// statement. Where no effect intervenes, the forwarding must happen.
const HELPERS = `(func $id (param i32) (result i32) (local.get 0))
  (func $write (result i32) (i32.store (i32.const 0) (i32.const 7)) (i32.const 1))
  (func $write2 (result i32) (i32.store (i32.const 0) (i32.const 9)) (i32.const 2))
  (func $pure (result i32) (i32.const 3))`
const ORDER = (body, extra = '') => `(module ${MEM} ${HELPERS} ${extra} (func (export "f") (result i32) (local $v i32) (local $r i32) ${body}))`
const forwarded = (s, name) => !new RegExp(`\\(local\\.set \\$${name}`).test(s) && !new RegExp(`\\(local\\.get \\$${name}`).test(s)

test('propagate-locals: a load defined before a call nested in a later set stays before it (the reviewer\'s case)', () => {
  const src = ORDER(`(local.set $v (i32.load (i32.const 0)))
    (local.set $r (call $id (i32.add (call $write) (local.get $v))))
    (local.get $r)`)
  check(src, [['f'], ['f']], (s, a) => { assert.deepEqual(a.out, [['ok', P0 + 1], ['ok', 8]], 'the first call reads the pattern before the write'); assert.ok(/local\.set \$v/.test(s), 'the load keeps its place') }, {}, PATTERN)
})

test('propagate-locals: the same load past effects under a tee, a drop, a return and a store operand', () => {
  for (const [name, body] of [
    ['tee', `(local.set $v (i32.load (i32.const 0))) (drop (local.tee $r (call $id (i32.add (call $write) (local.get $v))))) (local.get $r)`],
    ['drop', `(local.set $v (i32.load (i32.const 0))) (drop (call $id (i32.add (call $write) (local.get $v)))) (local.get $v)`],
    ['return', `(local.set $v (i32.load (i32.const 0))) (return (call $id (i32.add (call $write) (local.get $v))))`],
    ['store operand', `(local.set $v (i32.load (i32.const 0))) (i32.store (i32.const 8) (i32.add (call $write) (local.get $v))) (i32.load (i32.const 8))`],
    ['store address', `(local.set $v (i32.load (i32.const 0))) (i32.store (i32.add (call $write) (local.get $v)) (i32.const 5)) (i32.load (i32.const 8))`],
  ]) check(ORDER(body), [['f'], ['f']], (s, a) => assert.ok(/local\.set \$v/.test(s), `${name}: the load keeps its place`), {}, PATTERN)
})

test('propagate-locals: first, second and repeated effects of one kind in one statement', () => {
  const twice = ORDER(`(local.set $v (i32.load (i32.const 0)))
    (local.set $r (call $id (i32.add (i32.add (call $write) (call $write2)) (local.get $v))))
    (local.get $r)`)
  check(twice, [['f']], (s, a) => { assert.deepEqual(a.out, [['ok', P0 + 3]]); assert.ok(/local\.set \$v/.test(s)) }, {}, PATTERN)
  // the effect after an earlier one of the same kind: the first store is not the last
  const afterFirst = ORDER(`(local.set $v (i32.load (i32.const 0)))
    (local.set $r (i32.add (i32.add (call $pure) (block (result i32) (i32.store (i32.const 4) (i32.const 1)) (i32.const 0))) (i32.add (block (result i32) (i32.store (i32.const 0) (i32.const 7)) (i32.const 0)) (local.get $v))))
    (local.get $r)`)
  check(afterFirst, [['f']], (s, a) => { assert.deepEqual(a.out, [['ok', P0 + 3]]); assert.ok(/local\.set \$v/.test(s), 'the second store, not the first, precedes the use') }, {}, PATTERN)
  // no effect before the use: forwarded, with the effect after it
  const before = ORDER(`(local.set $v (i32.load (i32.const 0)))
    (local.set $r (call $id (i32.add (local.get $v) (call $write))))
    (local.get $r)`)
  check(before, [['f'], ['f']], (s, a) => { assert.deepEqual(a.out, [['ok', P0 + 1], ['ok', 8]]); assert.ok(forwarded(s, 'v'), 'the load is forwarded into the use evaluated before the call') }, {}, PATTERN)
})

test('propagate-locals: indirect calls, memory.grow, global writes, table writes and throws are effects too', () => {
  const indirect = `(module ${MEM} (type $t (func (result i32))) (table $tb 1 funcref) (elem (i32.const 0) $write) ${HELPERS}
    (func (export "f") (result i32) (local $v i32) (local.set $v (i32.load (i32.const 0))) (call $id (i32.add (call_indirect (type $t) (i32.const 0)) (local.get $v)))))`
  check(indirect, [['f']], (s, a) => { assert.deepEqual(a.out, [['ok', P0 + 1]]); assert.ok(/local\.set \$v/.test(s)) }, {}, PATTERN)
  const grow = `(module ${MEM} ${HELPERS} (func (export "f") (result i32) (local $v i32)
    (local.set $v (memory.size)) (call $id (i32.add (memory.grow (i32.const 1)) (local.get $v)))))`
  check(grow, [['f'], ['f']], (s, a) => { assert.deepEqual(a.out, [['ok', 2], ['ok', 4]]); assert.ok(/local\.set \$v/.test(s)) })
  const global = `(module ${MEM} (global $g (export "g") (mut i32) (i32.const 5)) ${HELPERS} (func (export "f") (result i32) (local $v i32)
    (local.set $v (global.get $g)) (call $id (i32.add (block (result i32) (global.set $g (i32.const 100)) (i32.const 1)) (local.get $v)))))`
  check(global, [['f'], ['f']], (s, a) => { assert.deepEqual(a.out, [['ok', 6], ['ok', 101]]); assert.ok(/local\.set \$v/.test(s)) })
  const tableWrite = `(module ${MEM} (type $t (func (result i32))) (table $tb 2 funcref) (elem (i32.const 0) $pure $write) ${HELPERS}
    (func (export "f") (result i32) (local $v i32) (local.set $v (call_indirect (type $t) (i32.const 0)))
      (call $id (i32.add (block (result i32) (table.set $tb (i32.const 0) (ref.func $write)) (i32.const 10)) (i32.add (local.get $v) (call_indirect (type $t) (i32.const 0)))))))`
  check(tableWrite, [['f'], ['f']], (s, a) => { assert.deepEqual(a.out, [['ok', 14], ['ok', 12]]); assert.ok(/local\.set \$v/.test(s), 'a call result stays before the table write') }, {}, PATTERN)
  const thrown = `(module ${MEM} (tag $e (param i32)) ${HELPERS} (func (export "f") (param $c i32) (result i32) (local $v i32)
    (local.set $v (i32.load (i32.const 0)))
    (block $h (result i32) (try_table (result i32) (catch $e $h)
      (call $id (i32.add (if (result i32) (local.get $c) (then (i32.store (i32.const 0) (i32.const 7)) (throw $e (i32.const 50))) (else (i32.const 1))) (local.get $v)))))))`
  check(thrown, [['f', 0], ['f', 1], ['f', 0]], (s, a) => { assert.deepEqual(a.out, [['ok', P0 + 1], ['ok', 50], ['ok', 8]]); assert.ok(/local\.set \$v/.test(s)) }, {}, PATTERN)
})

test('propagate-locals: a trapping value keeps its place before a nested effect; numeric and aliased locals', () => {
  const trap = `(module ${MEM} ${HELPERS} (func (export "f") (param $d i32) (result i32) (local $q i32)
    (local.set $q (i32.div_s (i32.const 100) (local.get $d)))
    (call $id (i32.add (call $write) (local.get $q)))))`
  check(trap, [['f', 0]], (s, a) => { assert.equal(a.out[0][0], 'throws'); assert.equal(a.mem[0], 3, 'the trap came before the write: memory keeps its pattern'); assert.ok(/local\.set \$q/.test(s)) }, {}, PATTERN)
  check(trap, [['f', 4]], (s, a) => assert.deepEqual(a.out, [['ok', 26]]), {}, PATTERN)
  const numeric = `(module ${MEM} ${HELPERS} (func (export "f") (result i32) (local i32) (local i32)
    (local.set 0 (i32.load (i32.const 0)))
    (local.set 1 (call $id (i32.add (call $write) (local.get 0))))
    (local.get 1)))`
  check(numeric, [['f'], ['f']], (s, a) => assert.deepEqual(a.out, [['ok', P0 + 1], ['ok', 8]]), {}, PATTERN)
  const aliased = `(module ${MEM} ${HELPERS} (func (export "f") (param $p i32) (result i32) (local $c i32)
    (local.set $c (local.get $p))
    (call $id (i32.add (local.tee $p (i32.const 100)) (local.get $c)))))`
  check(aliased, [['f', 5]], (s, a) => assert.deepEqual(a.out, [['ok', 105]], 'the copy keeps the value from before the parameter is rewritten'))
})

test('propagate-locals: nested control, a zero-trip loop, an early exit and a handler operand around a nested effect', () => {
  const nested = ORDER(`(local.set $v (i32.load (i32.const 0)))
    (if (i32.const 1) (then (local.set $r (call $id (i32.add (call $write) (local.get $v))))))
    (local.get $r)`)
  check(nested, [['f']], (s, a) => assert.deepEqual(a.out, [['ok', P0 + 1]]), {}, PATTERN)
  const zeroTrip = ORDER(`(local.set $v (i32.load (i32.const 0)))
    (block $b (loop $l (br_if $b (i32.const 1)) (local.set $v (i32.const 99)) (br $l)))
    (local.set $r (call $id (i32.add (call $write) (local.get $v))))
    (local.get $r)`)
  check(zeroTrip, [['f']], (s, a) => assert.deepEqual(a.out, [['ok', P0 + 1]]), {}, PATTERN)
  const exit = ORDER(`(local.set $v (i32.load (i32.const 0)))
    (block $out (br_if $out (i32.eqz (local.get $v))) (local.set $r (call $id (i32.add (call $write) (local.get $v)))))
    (local.get $r)`)
  check(exit, [['f'], ['f']], (s, a) => assert.deepEqual(a.out, [['ok', P0 + 1], ['ok', 8]]), {}, PATTERN)
  const handler = `(module ${MEM} (tag $e (param i32)) ${HELPERS} (func (export "f") (result i32) (local $v i32) (local $r i32)
    (local.set $v (i32.load (i32.const 0)))
    (block $h (result i32) (try_table (result i32) (catch $e $h) (throw $e (i32.add (call $write) (local.get $v)))))
    (local.set $r) (local.get $r)))`
  check(handler, [['f'], ['f']], (s, a) => assert.deepEqual(a.out, [['ok', P0 + 1], ['ok', 8]], 'the handler receives the pre-write value'), {}, PATTERN)
})

test('propagate-locals: a dead if with discardable arms retains only its condition', () => {
  for (const condition of ['(local.get $x)', '(call $log (local.get $x))']) {
    const src = `(module (import "env" "log" (func $log (param i32) (result i32)))
      (func (export "f") (param $x i32) (result i32) (local $c i32) (local $dead i32)
        (local.set $dead (if (result i32) (local.tee $c ${condition})
          (then (i32.const 100)) (else (i32.const 200))))
        (local.get $c)))`
    check(src, [['f', 0], ['f', 7], ['f', -1]], (s, a) => {
      assert.deepEqual(a.out, [['ok', 0], ['ok', 7], ['ok', -1]])
      assert.ok(!/\(if\b/.test(s), 'no dead branch calculation survives')
      assert.ok(!s.includes('$dead'), 'the dead local is removed too')
      if (condition.includes('call')) assert.deepEqual(a.log, [0, 7, -1], 'the condition runs exactly once')
    })
  }
})

test('propagate-locals: a dead if retains conditional traps and effects, including flat instructions', () => {
  for (const arm of [
    '(i32.load (i32.const 65536))',
    '(i32.div_s (i32.const 7) (i32.const 0))',
    '(block (result i32) (i32.store (i32.const 0) (i32.const 99)) (i32.const 1))',
    '(call $log (i32.const 7))',
    '(i32.const 7) global.set $g (i32.const 1)',
    '(i32.const 7) call $log',
    '(throw $e (i32.const 7))',
  ]) {
    const src = `(module (import "env" "log" (func $log (param i32) (result i32))) ${MEM}
      (global $g (export "g") (mut i32) (i32.const 3)) (tag $e (param i32))
      (func (export "f") (param $x i32) (result i32) (local $dead i32) (local $c i32)
        (local.set $dead (if (result i32) (local.tee $c (local.get $x))
          (then ${arm}) (else (i32.const 2))))
        (local.get $c)))`
    check(src, [['f', 0], ['f', 1], ['f', 0]], null, {}, PATTERN)
  }
})

test('propagate-locals: dead loads and trapping operations over tees retain their traps', () => {
  for (const value of [
    '(i32.load (local.get $x))', '(f64.load (local.get $x))', '(v128.load (local.get $x))',
    '(i32.load (local.tee $c (local.get $x)))',
    '(i32.div_s (i32.const 7) (local.tee $c (local.get $x)))',
  ]) {
    const src = `(module ${MEM} (func (export "f") (param $x i32) (result i32) (local $c i32)
      (drop ${value}) (i32.store (i32.const 0) (i32.const 99)) (local.get $c)))`
    check(src, [['f', 65536], ['f', 0], ['f', 65536]], null, {}, PATTERN)
  }
})

test('propagate-locals: a dead destination leaves a live trapping tee as a set', () => {
  const src = `(module ${MEM} (func (export "f") (param $x i32) (result i32)
    (local $dead i32) (local $live i32)
    (local.set $dead (local.tee $live (i32.load (local.get $x))))
    (i32.store (i32.const 8) (local.get $live)) (local.get $live)))`
  check(src, [['f', 0], ['f', 65536], ['f', 0]], s => {
    assert.ok(!s.includes('$dead'), 'the unused destination has no surviving set or declaration')
    assert.equal((s.match(/i32\.load/g) || []).length, 1, 'the trapping load still runs once')
  }, {}, PATTERN)
})

test('propagate-locals: a set consuming the previous set sinks before its next operand read', () => {
  const src = `(module ${MEM} (func (export "f") (param $h i32) (result i32) (local $w i32)
    (local.set $w (i32.load (i32.const 0)))
    (local.set $h (i32.mul (i32.xor (local.get $h) (local.get $w)) (i32.const 33)))
    (local.set $h (i32.mul (i32.xor (local.get $h) (local.get $w)) (i32.const 33)))
    (local.get $h)))`
  check(src, [['f', 0], ['f', 17], ['f', -1]], (s, a) => {
    assert.deepEqual(a.out, [0, 17, -1].map(x => ['ok', Math.imul(Math.imul(x ^ P0, 33) ^ P0, 33)]))
    assert.ok(!/local\.set/.test(s), 'both sets sink into their uses')
    assert.ok(/local\.tee \$w/.test(s), 'the load is captured once for both reads')
  }, {}, PATTERN)
})

test('propagate-locals: a discarded if does not lose its stack parameters', () => {
  const src = `(module (func (export "f") (param $x i32) (result i32) (local $c i32) (local $d i32)
    (i32.const 10)
    (local.set $d (if (param i32) (result i32) (local.tee $c (local.get $x))
      (then i32.const 1 i32.add) (else i32.const 2 i32.add)))
    (local.get $c)))`
  check(src, [['f', 0], ['f', 7]])
  check(`(module (table $t (export "table") 1 funcref) (func (export "f") (param $x i32) (result i32)
    (drop (table.get $t (local.get $x))) (local.get $x)))`, [['f', 0], ['f', 1], ['f', 0]])
})

test('propagate-locals: independent sets still commute into source-order calls', () => {
  check(`(module (import "env" "log" (func $log (param i32) (result i32)))
    (func (export "f") (result i32) (local $a i32) (local $b i32)
      (local.set $a (call $log (i32.const 1))) (local.set $b (call $log (i32.const 2)))
      (i32.add (local.get $b) (local.get $a))))`, [['f']], (s, a) => {
        assert.deepEqual(a.log, [1, 2])
        assert.ok(!s.includes('local.set'), 'both independent sets sink too')
      })
})

test('standalone passes cannot borrow another optimization\'s callee effects, even after an error', () => {
  const prime = '(module (func $next (export "n") (param i32) (result i32) (i32.const 1)))'
  const call = '(call $next (i32.mul (local.get $x) (i32.const 7)))'
  const src = `(module (global $g (export "g") (mut i32) (i32.const 0))
    (func $next (param i32) (result i32)
      (global.set $g (i32.add (global.get $g) (i32.const 1))) (global.get $g))
    (func (export "f") (param $x i32) (result i32) (i32.add ${call} ${call})))`
  const calls = [['f', 1], ['f', 2]]
  const expected = run(compile(src), calls).steps
  for (const fail of [false, true]) {
    if (fail) assert.throws(() => optimize(parse(prime), { log() { throw Error('stop') } }), /stop/)
    else optimize(parse(prime))
    assert.deepEqual(run(compile(cse(parse(src))), calls).steps, expected,
      'the current $next mutates its global; the earlier same-named function did not')
  }
})

// ── traps are never discarded ────────────────────────────────────────────────
test('propagate-locals: a dead trapping value, a self-cancelling trapping operand and a dropped trap keep trapping', () => {
  const dead = `(module (func (export "f") (param $d i32) (result i32) (local $t i32)
    (local.set $t (i32.div_s (i32.const 100) (local.get $d))) (i32.const 1)))`
  check(dead, [['f', 0], ['f', 5]], (s, a) => { assert.deepEqual(a.out.map(o => o[0]), ['throws', 'ok']); assert.ok(/i32\.div_s/.test(s), 'the dead store keeps its division') })
  const cancel = `(module (func (export "f") (param $d i32) (result i32)
    (i32.sub (i32.div_s (i32.const 100) (local.get $d)) (i32.div_s (i32.const 100) (local.get $d)))))`
  check(cancel, [['f', 0], ['f', 5]], (s, a) => assert.ok(/i32\.div_s/.test(s), 'x - x keeps a trapping x'))
  const dropped = `(module (func (export "f") (param $x f64) (result i32) (drop (i32.trunc_f64_s (local.get $x))) (i32.const 1)))`
  check(dropped, [['f', NaN], ['f', 1]], (s, a) => { assert.deepEqual(a.out.map(o => o[0]), ['throws', 'ok']); assert.ok(/trunc_f64_s/.test(s)) })
  const zeroed = `(module (func (export "f") (param $d i32) (result i32) (i32.mul (i32.rem_u (i32.const 7) (local.get $d)) (i32.const 0))))`
  check(zeroed, [['f', 0], ['f', 5]], (s, a) => assert.ok(/i32\.rem_u/.test(s), 'x * 0 keeps a trapping x'))
  const singleUse = `(module (func (export "f") (param $x f64) (result i32) (local $t i32)
    (local.set $t (i32.trunc_f64_s (local.get $x))) (i32.add (local.get $t) (i32.const 1))))`
  check(singleUse, [['f', 2.5], ['f', NaN]], (s, a) => assert.equal((s.match(/trunc_f64_s/g) || []).length, 1, 'a moved trapping value evaluates once, at its use'))
})


test('propagate-locals: fold wide constants through known locals without expanding reads', () => {
  check(`(module (import "env" "log" (func $log (param f64) (result f64)))
    (func (export "f") (result f64) (local $x f64)
      (local.set $x (f64.const 3.25))
      (drop (call $log (local.get $x)))
      (f64.add (f64.mul (local.get $x) (local.get $x)) (f64.const 2))))`, [['f']],
    (s, a) => { assert.equal(a.out[0][1], 12.5625); assert.ok(!s.includes('f64.mul')) })
  check(`(module (func (export "f") (param $c i32) (result f64) (local $x f64)
    (local.set $x (f64.const 3.25))
    (if (local.get $c) (then (local.set $x (f64.const 7.5))))
    (f64.add (f64.mul (local.get $x) (local.get $x)) (f64.const 2))))`, [['f', 0], ['f', 1]])
  check(`(module (func (export "f") (result i32) (local $x i32)
    (local.set $x (i32.const 0))
    (i32.div_s (i32.const 7) (local.get $x))))`, [['f']])
})

test('propagate-locals: sign operations retain NaN payloads through known locals', () => {
  for (const op of ['neg', 'abs']) check(`(module ${MEM}
    (func (export "f") (local $x f64)
      (local.set $x (f64.const -nan:0x8000000000001))
      (f64.store (i32.const 0) (f64.${op} (local.get $x)))
      (f64.store (i32.const 8) (local.get $x))))`, [['f']])
})


test('propagate-locals: dominating small constants reach nested control and zero-trip loops', () => {
  for (const type of ['i32', 'i64']) {
    const src = `(module (func (export "f") (param $n i32) (result ${type})
      (local $bound ${type}) (local $i i32) (local $sum ${type})
      (local.set $bound (${type}.const 64))
      (block $done (loop $l
        (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $sum (${type}.add (local.get $sum) (local.get $bound)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
      (local.get $sum)))`
    check(src, [['f', 0], ['f', 1], ['f', 1], ['f', 3], ['f', -1], ['f', 0]], (s, a) => {
      assert.ok(!s.includes('$bound'), 'single-definition constant needs no storage across control')
      assert.deepEqual(a.out.map(x => x[1]), [0, 64, 64, 192, 0, 0].map(x => type === 'i64' ? BigInt(x) : x))
    })
  }
})

test('propagate-locals: control propagation preserves writes, conditional initialization and costly constants', () => {
  const changing = `(module (func (export "f") (param $n i32) (result i32)
    (local $v i32) (local $i i32) (local $sum i32)
    (local.set $v (i32.const 7))
    (block $done (loop $l
      (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $sum (i32.add (local.get $sum) (local.get $v)))
      (local.set $v (i32.add (local.get $v) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $l)))
    (local.get $sum)))`
  for (const src of [changing, changing.replace('(local.set $v (i32.add', '(local.set 1 (i32.add'),
    changing.replace('(local.set $v (i32.add (local.get $v) (i32.const 1)))', '(i32.add (local.get $v) (i32.const 1)) local.set 1')])
    check(src, [['f', 0], ['f', 1], ['f', 3], ['f', 1]], (s, a) =>
      assert.deepEqual(a.out.map(x => x[1]), [0, 7, 24, 7]))
  const conditional = `(module (func (export "f") (param $c i32) (result i32) (local $v i32)
    (if (local.get $c) (then (local.set $v (i32.const 7))))
    (block $b (br_if $b (local.get $c)) (return (local.get $v)))
    (local.get $v)))`
  check(conditional, [['f', 0], ['f', 1], ['f', 0]], (s, a) =>
    assert.deepEqual(a.out.map(x => x[1]), [0, 7, 0]))
  const large = changing.replace('(i32.const 7)', '(i32.const 305419896)')
    .replace('(local.set $v (i32.add (local.get $v) (i32.const 1)))', '')
  check(large, [['f', 0], ['f', 1], ['f', 2]], (s, a) => {
    assert.ok(s.includes('$v'), 'wide constants stay available for loop reuse')
    assert.deepEqual(a.out.map(x => x[1]), [0, 305419896, 610839792])
  })
})
