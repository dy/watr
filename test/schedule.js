// Statement scheduling (src/optimize.js): within a straight-line run, statements
// go by the longest chain of work still depending on them, so independent long
// computations start together. Every case runs the module before and after.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { schedule } from '../src/optimize.js'
import { parse, print, compile } from './runner.js'

const instance = ast => new WebAssembly.Instance(new WebAssembly.Module(compile(ast))).exports

test('scheduling: independent chains start together', () => {
  const src = `(module
    (func $k (param $x f64) (result f64) (f64.sqrt (f64.add (local.get $x) (f64.const 1))))
    (func $f (export "f") (param $a f64) (param $b f64) (result f64) (local $p f64) (local $q f64) (local $r f64) (local $s f64)
      (local.set $p (call $k (local.get $a)))
      (local.set $q (call $k (local.get $p)))
      (local.set $r (call $k (local.get $b)))
      (local.set $s (call $k (local.get $r)))
      (f64.mul (local.get $q) (local.get $s))))`
  const ast = parse(src)
  schedule(ast, { pure: ['$k'] })
  const order = ast.find(n => n[1] === '$f').filter(n => n[0] === 'local.set').map(n => n[1])
  assert.deepEqual(order, ['$p', '$r', '$q', '$s'])
  for (const [a, b] of [[0.3, 0.9], [4, 16]]) assert.ok(Object.is(instance(ast).f(a, b), instance(parse(src)).f(a, b)))
})

test('scheduling: direct and read-only callee loads retain their trap order', () => {
  for (const indirect of [false, true]) for (const before of [false, true]) {
    const load = indirect ? '(call $read (local.get $p))' : '(f64.load (local.get $p))'
    const write = '(global.set $g (i32.const 1))'
    const ast = parse(`(module (memory 1)
      (global $g (export "g") (mut i32) (i32.const 0))
      (func $read (param $p i32) (result f64) (f64.load (local.get $p)))
      (func $sqrt (param $x f64) (result f64) (f64.sqrt (local.get $x)))
      (func $f (export "f") (param $p i32) (param $skip i32) (result f64) (local $a f64) (local $b f64)
        (if (local.get $skip) (then (return (f64.const 7))))
        ${before ? write : ''}
        (local.set $a (call $sqrt (call $sqrt ${load})))
        ${before ? '' : write}
        (local.set $b (call $sqrt (f64.const 4)))
        (f64.add (local.get $a) (local.get $b))))`)
    schedule(ast, { pure: ['$sqrt'] })
    const { f, g } = instance(ast)
    assert.equal(f(65536, 1), 7, 'zero-work path does not load'); assert.equal(g.value, 0)
    assert.throws(() => f(65536, 0), WebAssembly.RuntimeError)
    assert.equal(g.value, before ? 1 : 0, `write ${before ? 'before' : 'after'} ${indirect ? 'callee' : 'direct'} load`)
    assert.equal(f(65528, 0), 2, 'last valid f64 load'); assert.equal(g.value, 1)
    assert.equal(f(0, 0), 2, 'reuse with a different address')
  }
})

// The same integer recurrence with each comparison spelling. The evolving
// input must join the independent minimum/maximum last, without a new guard.
const reductionModule = (op, reverse = false, effect = '', second = op, type = 'i32') => {
  const get = n => `(local.get $${n})`, c = n => `(${type}.const ${n})`
  const cmp = input => `(${op} ${get(reverse ? 'm' : input)} ${get(reverse ? input : 'm')})`
  const update = (input, relation = op) => `(if ${cmp(input).replace(op, relation)}
    (then ${effect} (local.set $m ${get(input)})))`
  return parse(`(module (global $calls (export "calls") (mut i32) (i32.const 0))
    (func $f (export "f") (param $n i32) (param $carry ${type}) (param $bound ${type}) (result ${type})
      (local $i i32) (local $next ${type}) (local $other ${type}) (local $m ${type})
      (block $done (loop $again
        (br_if $done (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $next (${type}.add ${get('carry')} ${c(3)}))
        (local.set $other ${get('bound')})
        (local.set $m ${c(7)})
        ${update('next')}
        ${update('other', second)}
        (local.set $carry ${get('m')})
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $again)))
      ${get('carry')}))`)
}
const loopOf = ast => ast.find(n => n?.[0] === 'func').find(n => n?.[0] === 'block')[2]

test('scheduling: integer min/max chains consume recurrence inputs last', () => {
  for (const sign of ['s', 'u']) for (const rel of ['lt', 'le', 'gt', 'ge']) for (const reverse of [false, true]) {
    const op = `i32.${rel}_${sign}`, ast = reductionModule(op, reverse), original = instance(ast)
    const loop = loopOf(ast), i = loop.findIndex(n => n?.[0] === 'if'), first = loop[i], second = loop[i + 1]
    schedule(ast)
    assert.ok(loop[i] === second && loop[i + 1] === first, `${op}, reverse=${reverse}: independent update first`)
    const once = print(ast)
    schedule(ast)
    assert.equal(print(ast), once, 'scheduling is stable when repeated')
    const changed = instance(ast)
    for (const n of [0, 1, 2, 7]) for (const seed of [-2147483648, -1, 0, 2147483647]) for (const bound of [-2147483648, -1, 0, 7, 2147483647])
      assert.equal(changed.f(n, seed, bound), original.f(n, seed, bound), `${op}/${reverse}: n=${n}, seed=${seed}, bound=${bound}`)
  }
})

test('scheduling: float, mixed reductions and observable updates retain their order', () => {
  for (const [op, second, type, effect] of [
    ['i32.lt_s', 'i32.gt_s', 'i32', ''],
    ['i32.lt_s', 'i32.lt_u', 'i32', ''],
    ['f64.lt', 'f64.lt', 'f64', ''],
    ['i32.lt_s', 'i32.lt_s', 'i32', '(global.set $calls (i32.add (global.get $calls) (i32.const 1)))'],
  ]) {
    const ast = reductionModule(op, false, effect, second, type), original = instance(ast), before = print(ast)
    schedule(ast)
    assert.equal(print(ast), before, `${op}/${second}: leave the noncommuting sequence intact`)
    const changed = instance(ast)
    for (const n of [0, 1, 4]) for (const seed of (type === 'f64' ? [NaN, -0, 0, Infinity, -Infinity] : [-2147483648, -1, 0, 2147483647])) {
      assert.ok(Object.is(changed.f(n, seed, -1), original.f(n, seed, -1)))
      assert.equal(changed.calls.value, original.calls.value, 'same observable updates across repeated calls')
    }
  }
})

test('scheduling: a function that unpacks a multi-value call is left alone', () => {
  // The sets pop the call's results in order: moving either would swap the values.
  const src = `(module
    (func $two (result i32 i32) (i32.const 7) (i32.const 1))
    (func $k (param $x f64) (result f64) (f64.sqrt (local.get $x)))
    (func $f (export "f") (result i32) (local $a i32) (local $b i32) (local $p f64) (local $q f64)
      (call $two)
      (local.set $b)
      (local.set $a)
      (local.set $p (call $k (f64.const 16)))
      (local.set $q (call $k (local.get $p)))
      (i32.add (i32.mul (i32.sub (local.get $a) (local.get $b)) (i32.const 10)) (i32.trunc_f64_s (local.get $q)))))`
  const ast = parse(src)
  schedule(ast, { pure: ['$k'] })
  assert.equal(print(ast), print(parse(src)))
  assert.equal(instance(ast).f(), 62)
})


test('scheduling: partially folded expressions keep their stack inputs', () => {
  const src = `(module
    (func $k (param $x f64) (result f64) (f64.sqrt (local.get $x)))
    (func $f (export "f") (result f64) (local $a f64) (local $b f64) (local $p f64) (local $q f64)
      (f64.const 9) (f64.const 16)
      (local.set $a (f64.add (f64.const 0)))
      (local.set $p (call $k (local.get $a)))
      (local.set $b (f64.add (f64.const 0)))
      (local.set $q (call $k (call $k (local.get $b))))
      (f64.sub (local.get $p) (local.get $q))))`
  const ast = parse(src)
  schedule(ast, { pure: ['$k'] })
  assert.equal(print(ast), print(parse(src)))
  const { f } = instance(ast)
  for (let i = 0; i < 2; i++) assert.equal(f(), 4 - Math.sqrt(3))
})

test('scheduling: result-producing calls remain sequence boundaries', () => {
  const src = `(module
    (func $k (param $x f64) (result f64) (f64.sqrt (local.get $x)))
    (func $f (export "f") (param $x f64) (result f64 f64)
      (call $k (local.get $x))
      (call $k (call $k (local.get $x)))))`
  const ast = parse(src), original = instance(ast)
  schedule(ast, { pure: ['$k'] })
  assert.equal(print(ast), print(parse(src)), 'result order is stack order')
  const changed = instance(ast)
  for (const x of [16, 16, 81, 0, -0, Infinity, NaN, 16])
    assert.deepEqual(changed.f(x), original.f(x), `f(${x}) keeps both results in order`)
})

test('scheduling: memory.grow results remain sequence boundaries', () => {
  const src = `(module (memory 1 2)
    (func $k (param $x f64) (result f64) (f64.sqrt (local.get $x)))
    (func $f (export "f") (param $pages i32) (result i32)
      (local $a f64) (local $b f64)
      (memory.grow (local.get $pages))
      (local.set $a (call $k (f64.const 16)))
      (local.set $b (call $k (local.get $a)))))`
  const ast = parse(src), original = instance(ast)
  schedule(ast, { pure: ['$k'] })
  assert.equal(print(ast), print(parse(src)), 'growth leaves a live operand-stack result')
  const changed = instance(ast)
  for (const pages of [0, 0, 1, 1, -1, 0])
    assert.equal(changed.f(pages), original.f(pages), `grow(${pages}) preserves success and failure results`)
})
