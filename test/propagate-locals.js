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
import optimize, { binarySize } from '../src/optimize.js'
import { parse, print, compile } from './runner.js'

const MEM = '(memory (export "memory") 1)'
const run = (bytes, calls, imports = {}) => {
  const mod = new WebAssembly.Module(bytes)
  const log = []
  const inst = new WebAssembly.Instance(mod, { env: { log: v => { log.push(v); return v }, ...imports } })
  const out = []
  for (const [name, ...args] of calls) {
    try { out.push(['ok', inst.exports[name](...args)]) }
    catch (e) { out.push(['throws', e.constructor.name, e instanceof WebAssembly.RuntimeError ? e.message : '']) }
  }
  // memory is read after the calls: a memory.grow detaches the earlier buffer
  const mem = inst.exports.memory ? [...new Uint8Array(inst.exports.memory.buffer).subarray(0, 64)] : null
  return { out, log, mem, pages: inst.exports.memory?.buffer.byteLength }
}
// Before: the parsed module as is. After: `propagate` alone, then the default pipeline.
const check = (src, calls, expect, imports) => {
  const before = compile(src)
  const ast = parse(src)
  const propagated = optimize(parse(src), 'propagate')
  const after = compile(print(propagated))
  const full = compile(print(optimize(parse(src))))
  const a = run(before, calls, imports), b = run(after, calls, imports), c = run(full, calls, imports)
  assert.deepEqual(b, a, 'propagate alone preserves results, traps, log and memory')
  assert.deepEqual(c, a, 'the default pipeline preserves them too')
  assert.ok(binarySize(propagated) <= binarySize(ast), `propagate never inflates: ${binarySize(ast)} → ${binarySize(propagated)}`)
  if (expect) expect(print(propagated), a)
  return print(propagated)
}

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
