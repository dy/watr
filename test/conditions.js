import { test } from 'node:test'
import assert from 'node:assert/strict'
import optimize, { bool, conditions } from '../src/optimize.js'
import { clone } from '../src/util.js'
import { parse, print, compile } from './runner.js'

const instance = ast => new WebAssembly.Instance(new WebAssembly.Module(compile(ast))).exports
const and = (a, b, t = '$t') => `(if (result i32) (local.tee ${t} ${a}) (then ${b}) (else (local.get ${t})))`
const or = (a, b, t = '$u') => `(if (result i32) (local.tee ${t} ${a}) (then (local.get ${t})) (else ${b}))`
const hit = (x, id) => `(call $hit (local.get $${x}) (i32.const ${id}))`
// the boolean forms: a constant arm instead of the reread temporary
const band = (a, b) => `(if (result i32) ${a} (then ${b}) (else (i32.const 0)))`
const bor = (a, b) => `(if (result i32) ${a} (then (i32.const 1)) (else ${b}))`
const nand = (a, b) => `(if (result i32) ${a} (then (i32.const 0)) (else ${b}))`
const nor = (a, b) => `(if (result i32) ${a} (then ${b}) (else (i32.const -1)))`

test('conditions: nested short-circuit effects match for void, value and branch tests', () => {
  const A = hit('a', 1), B = hit('b', 2), C = hit('c', 3)
  for (const cond of [and(A, B), or(A, B), or(and(A, B), C), and(or(A, B), C), `(i32.eqz ${or(and(A, B), C)})`]) {
    for (const body of [
      `(local.set $r (i32.const 7)) (if ${cond} (then (local.set $r (i32.const 11)))) (local.get $r)`,
      `(if (result i32) ${cond} (then (i32.const 11)) (else (i32.const 7)))`,
      `(local.set $r (i32.const 11)) (block $out (br_if $out ${cond}) (local.set $r (i32.const 7))) (local.get $r)`,
    ]) {
      const ast = parse(`(module (global $log (mut i32) (i32.const 0))
        (func $hit (param $x i32) (param $id i32) (result i32)
          (global.set $log (i32.add (i32.mul (global.get $log) (i32.const 10)) (local.get $id))) (local.get $x))
        (func (export "f") (param $a i32) (param $b i32) (param $c i32) (result i32 i32)
          (local $t i32) (local $u i32) (local $r i32)
          (global.set $log (i32.const 0)) ${body} (global.get $log)))`)
      const ref = instance(ast), chained = conditions(clone(ast))
      assert.notDeepEqual(chained, clone(ast), 'branch chains were emitted')
      assert(!print(chained).includes('local.tee'), 'single-use diamond temporaries disappeared')
      for (const out of [chained, optimize(clone(ast), { conditions: true })]) {
        const e = instance(out)
        for (const a of [-2, 0, 3]) for (const b of [-2, 0, 3]) for (const c of [-2, 0, 3])
          assert.deepEqual(e.f(a, b, c), ref.f(a, b, c))
      }
    }
  }
})

test('conditions: boolean diamonds with a constant arm chain like the value forms', () => {
  const A = hit('a', 1), B = hit('b', 2), C = hit('c', 3)
  for (const cond of [band(A, B), bor(A, B), nand(A, B), nor(A, B), band(bor(A, B), C), bor(nand(A, B), C),
    nor(band(A, B), C), `(i32.eqz ${band(A, nor(B, C))})`, and(A, band(B, C)), bor(or(A, B), C)]) {
    for (const body of [
      `(local.set $r (i32.const 7)) (if ${cond} (then (local.set $r (i32.const 11)))) (local.get $r)`,
      `(if (result i32) ${cond} (then (i32.const 11)) (else (i32.const 7)))`,
      `(local.set $r (i32.const 11)) (block $out (br_if $out ${cond}) (local.set $r (i32.const 7))) (local.get $r)`,
    ]) {
      const ast = parse(`(module (global $log (mut i32) (i32.const 0))
        (func $hit (param $x i32) (param $id i32) (result i32)
          (global.set $log (i32.add (i32.mul (global.get $log) (i32.const 10)) (local.get $id))) (local.get $x))
        (func (export "f") (param $a i32) (param $b i32) (param $c i32) (result i32 i32)
          (local $t i32) (local $u i32) (local $r i32)
          (global.set $log (i32.const 0)) ${body} (global.get $log)))`)
      const ref = instance(ast), chained = conditions(clone(ast))
      assert(!/\(if\b/.test(print(chained)), `every diamond became a branch chain: ${cond}`)
      for (const out of [chained, optimize(clone(ast), { conditions: true })]) {
        const e = instance(out)
        for (const a of [-2, 0, 3]) for (const b of [-2, 0, 3]) for (const c of [-2, 0, 3])
          assert.deepEqual(e.f(a, b, c), ref.f(a, b, c))
      }
    }
  }
})

test('conditions: a guarded loop test exits through one branch per conjunct', () => {
  // `while (k < n && v[k] > 0) k++`, its exit and its rotated back edge
  const G = '(i32.lt_s (local.get $k) (local.get $n))', C = '(i32.gt_s (i32.load (i32.shl (local.get $k) (i32.const 2))) (i32.const 0))'
  for (const loop of [
    `(block $brk (loop $L (br_if $brk (i32.eqz ${band(G, C)})) (local.set $k (i32.add (local.get $k) (i32.const 1))) (br $L)))`,
    `(if ${band(G, C)} (then (loop $L (local.set $k (i32.add (local.get $k) (i32.const 1))) (br_if $L ${band(G, C)}))))`,
  ]) {
    const ast = parse(`(module (memory (export "m") 1)
      (func (export "f") (param $n i32) (result i32) (local $k i32) ${loop} (local.get $k)))`)
    const ref = instance(ast), out = conditions(clone(ast)), text = print(out)
    assert(!/\(if\b/.test(text), 'no diamond is left to materialize')
    // the rotated loop's entry test is a guard `if`: two exits, and two on the back edge
    assert.equal(text.match(/br_if/g).length, loop.includes('$brk') ? 2 : 4, 'one branch per conjunct')
    const e = instance(out), m = new Int32Array(e.m.buffer), r = new Int32Array(ref.m.buffer)
    for (const fill of [[], [1, 2, 3], [4, 0, 5], [1, 1, 1, 1, 1, 1]]) {
      m.fill(0); r.fill(0); m.set(fill); r.set(fill)
      for (const n of [0, 2, 3, 9]) assert.equal(e.f(n), ref.f(n), `n=${n} [${fill}]`)
    }
  }
})

test('conditions: live temps, numeric local aliases and generated label collisions', () => {
  for (const read of ['(local.get $t)', '(local.get 2)']) {
    const ast = parse(`(module (func (export "f") (param $a i32) (param $b i32) (result i32 i32)
      (local $t i32) (local $r i32)
      (block $__cc0
        (if ${and('(local.get $a)', '(local.get $b)')}
          (then (local.set $r (i32.const 9)) (br $__cc0)))
        (local.set $r (i32.const 4)))
      (local.get $r) ${read}))`)
    const ref = instance(ast), changed = conditions(clone(ast)), out = instance(changed)
    assert(print(changed).includes('$__cc1'), 'fresh labels avoid existing names')
    for (const a of [0, 3]) for (const b of [0, 5]) assert.deepEqual(out.f(a, b), ref.f(a, b))
  }
})

test('conditions: preserve short-circuit traps and multi-value branches', () => {
  for (const cond of [and, band, nor]) {
    const ast = parse(`(module (func (export "f") (param $a i32) (result i32 i64)
      (local $t i32)
      (if (result i32 i64) ${cond('(local.get $a)', '(i32.div_s (i32.const 1) (local.get $a))')}
        (then (i32.const 11) (i64.const 12)) (else (i32.const 7) (i64.const 8)))))`)
    const ref = instance(ast), out = instance(conditions(clone(ast)))
    for (const a of [0, 1, 2]) {
      let want, got
      try { want = ref.f(a) } catch (err) { want = err.constructor }
      try { got = out.f(a) } catch (err) { got = err.constructor }
      assert.deepEqual(got, want)
    }
  }
})

test('conditions: relative branches and labeled ifs retain their scopes', () => {
  const d = and('(local.get $a)', '(i32.const 1)'), b = band('(local.get $a)', '(i32.const 1)')
  for (const body of [
    `(block (br_if 0 ${d}))`,
    `(if $keep ${d} (then (br $keep)))`,
    `(block (br_if 0 ${b}))`,
    `(if $keep ${b} (then (br $keep)))`,
  ]) {
    const ast = parse(`(module (func (export "f") (param $a i32) (local $t i32) ${body}))`)
    const out = conditions(clone(ast))
    assert.deepEqual(out, clone(ast), 'unsupported scope changes are declined')
    instance(out).f(1)
  }
})

test('bool: strip truthiness wrappers only where zero/nonzero is observed', () => {
  const ast = parse(`(module
    (func (export "f") (param $x i32) (result i32 i32 i32 i32)
      (i32.ne (local.get $x) (i32.const 0))
      (i32.eqz (i32.eqz (local.get $x)))
      (select (result i32) (i32.const 7) (i32.const 8) (i32.ne (i32.const 0) (local.get $x)))
      (block $out (result i32)
        (br_if $out (i32.const 9) (i32.eqz (i32.eqz (local.get $x)))) (drop) (i32.const 10))))`)
  const ref = instance(ast), out = instance(bool(clone(ast)))
  for (const x of [-3, 0, 2]) assert.deepEqual(out.f(x), ref.f(x))
  const text = print(bool(clone(ast)))
  assert(text.includes('(i32.ne (local.get $x)'), 'value comparison remains canonical')
  assert(text.replace(/\s+/g, ' ').includes('(br_if $out (i32.const 9) (local.get $x)'), 'branch value is retained')
})
