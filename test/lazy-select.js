// Expensive local initializers used only in exclusive value arms. Compare the
// raw module, this pass alone and the full speed pipeline after every call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import optimize, { lazySelect } from '../src/optimize.js'
import { parse, print, compile } from './runner.js'

const polynomial = (type = 'f64', terms = 6) => {
  let out = `(${type}.const 1)`
  for (let i = 1; i <= terms; i++) out = `(${type}.add (${type}.mul ${out} (local.get $x)) (${type}.const ${i}))`
  return out
}
const choose = (type = 'f64') => `(select (local.get $v)
  (select (${type}.${type[0] === 'f' ? 'neg' : 'sub'} ${type[0] === 'f' ? '' : `(${type}.const 0)`} (local.get $v)) (${type}.const 7) (local.get $b)) (local.get $a))`
const module = (body, { type = 'f64', locals = '', extra = '' } = {}) => `(module
  (memory (export "memory") 1)
  (global $g (export "g") (mut i32) (i32.const 0)) ${extra}
  (func $f (export "f") (param $x ${type}) (param $a i32) (param $b i32) (result ${type})
    (local $v ${type}) ${locals} ${body}))`
const values = {
  f64: [0, -0, 1, -1, 0.2, -0.7, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity, NaN],
  f32: [0, -0, 1, -1, 0.2, 2 ** -149, 2 ** 128, Infinity, -Infinity, NaN],
  i32: [-2147483648, -1, 0, 1, 2147483647],
  i64: [-(1n << 63n), -1n, 0n, 1n, (1n << 63n) - 1n],
}
const calls = type => values[type].flatMap(x => [0, 1, -1].flatMap(a => [0, 1, -1].map(b => [x, a, b])))
const instance = ast => {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compile(ast)))
  new Uint8Array(inst.exports.memory.buffer).set([7, 11, 19, 23, 29, 31, 37, 41])
  return inst.exports
}
const step = (e, args) => {
  let value
  try { value = ['ok', e.f(...args)] } catch (err) { value = ['throws', err.constructor.name] }
  return { value, g: e.g.value, mem: [...new Uint8Array(e.memory.buffer).subarray(0, 64)] }
}
const check = (src, changed, sequence = calls('f64')) => {
  const ast = parse(src), before = print(ast)
  assert.equal(lazySelect(ast), ast)
  assert.equal(print(ast) !== before, changed, 'the expected shape changes or is declined')
  const once = print(ast)
  lazySelect(ast)
  assert.equal(print(ast), once, 'a second pass is stable')
  const engines = [instance(parse(src)), instance(ast), instance(optimize(parse(src), { profile: 'speed', guard: false }))]
  for (const args of sequence) {
    const expected = step(engines[0], args)
    for (const e of engines.slice(1)) assert.deepEqual(step(e, args), expected, `call ${args}`)
  }
  return ast
}

test('lazy select: empty modules and empty functions need no work', () => {
  for (const src of ['(module)', '(module (func))', '(module)']) {
    const ast = parse(src), before = print(ast)
    assert.equal(lazySelect(ast), ast)
    assert.equal(print(ast), before)
    assert.ok(WebAssembly.validate(compile(ast)))
  }
})

test('lazy select: exclusive scalar arms defer a costly local at all four widths', () => {
  for (const type of Object.keys(values)) {
    const ast = check(module(`(local.set $v ${polynomial(type)}) ${choose(type)}`, { type }), true, calls(type))
    const out = print(ast)
    assert.ok(out.includes(`(if (result ${type})`) || new RegExp(`\\(if\\s+\\(result ${type}\\)`).test(out))
    assert.ok(!out.includes('local.set $v'), 'the initializer is removed; copies are inside the arms')
    if (type[0] === 'f') {
      // An odd power produces signed zero, rather than merely accepting it.
      let power = '(local.get $x)'
      for (let i = 0; i < 8; i++) power = `(${type}.mul ${power} (local.get $x))`
      check(module(`(local.set $v ${power}) ${choose(type)}`, { type }), true,
        [[0, 1, 0], [-0, 1, 0], [-0, 0, 1], [0, 0, 1], [-0, 0, 0]])
    }
  }
})

test('lazy select: nested conditions and existing if arms keep their values', () => {
  check(module(`(local.set $v ${polynomial()})
    (select (f64.const 7)
      (f64.convert_i32_s (select (i32.const 1) (i32.const 0) (f64.gt (local.get $v) (f64.const 0))))
      (local.get $a))`), true)
  check(module(`(local.set $v ${polynomial()})
    (if (result f64) (local.get $a) (then (local.get $v)) (else (f64.const 7)))`), true)
})

test('lazy select: independent sets can be crossed, writes and observable effects cannot', () => {
  for (const [middle, changed] of [
    ['(local.set $other (f64.add (local.get $x) (f64.const 1)))', true],
    ['(local.set $x (f64.const 4))', false],
    ['(local.set $x (select (f64.const 4) (local.get $x) (local.get $a)))', false],
    ['(local.set $v (f64.const 4))', false],
    ['(global.set $g (i32.const 1))', false],
    ['(i32.store (i32.const 0) (i32.const 1))', false],
    ['(call $effect)', false],
  ]) check(module(`(local.set $v ${polynomial()}) ${middle} ${choose()}`, {
    locals: '(local $other f64)', extra: '(func $effect (global.set $g (i32.const 2)))',
  }), changed)
})

test('lazy select: simultaneous or external reads and self-updates retain the initializer', () => {
  for (const body of [
    `(local.set $v ${polynomial()}) (f64.add ${choose()} (local.get $v))`,
    `(local.set $v ${polynomial()}) (select (f64.add (local.get $v) (local.get $v)) (f64.const 7) (local.get $a))`,
    `(local.set $v ${polynomial()}) (select (local.get $v) (f64.neg (local.get $v)) (local.get $a))`,
    `(local.set $v ${polynomial().replace('(f64.const 1)', '(local.get $v)')}) ${choose()}`,
    `(local.set $v ${polynomial()}) (select (local.get $v) (f64.const 7) (f64.gt (local.get $v) (f64.const 0)))`,
  ]) check(module(body), false)
})

test('lazy select: traps, memory reads, calls and multi-statement arms keep evaluation order', () => {
  for (const expr of [
    '(f64.load (i32.const 65536))',
    '(f64.convert_i32_s (i32.div_s (i32.const 1) (local.get $a)))',
    '(f64.convert_i32_s (i32.trunc_f64_s (local.get $x)))',
    '(call $effect)',
    '(f64.convert_i32_s (global.get $g))',
  ]) check(module(`(local.set $v (f64.add ${polynomial()} ${expr})) ${choose()}`, {
    extra: '(func $effect (result f64) (global.set $g (i32.add (global.get $g) (i32.const 1))) (f64.const 3))',
  }), false)
  check(module(`(local.set $v (f64.add ${polynomial()} (f64.load (i32.trunc_f64_u (local.get $x))))) ${choose()}`),
    false, [65528, 65529, 65536, 65528, 0, 0, 65528].flatMap(x => [[x, 0, 0], [x, 1, 0]]))
  check(module(`(local.set $v ${polynomial()})
    (if (result f64) (local.get $a) (then (global.set $g (i32.const 5)) (local.get $v)) (else (f64.const 7)))`), false)
  check(module(`(local.set $v ${polynomial()})
    (select (local.get $v) (local.tee $x (f64.const 7)) (local.get $a))`), false)
})

test('lazy select: zero-work and reused loops preserve their exact recurrence', () => {
  for (const n of [0, 1, 3, 3, 0, 3]) {
    const src = module(`(local.set $sum (f64.const 9)) (block $end (loop $again
      (br_if $end (i32.ge_u (local.get $i) (i32.const ${n})))
      (local.set $v ${polynomial()})
      (local.set $sum (f64.add (local.get $sum) ${choose()}))
      (local.set $x (f64.add (local.get $x) (f64.const 0.1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $again))) (local.get $sum)`,
    { locals: '(local $i i32) (local $sum f64)' })
    check(src, true, [[0.2, 1, 0], [0.2, 1, 0], [-0.7, 0, 1], [1, 0, 0], [0.2, 1, 0]])
  }
  // An initializer outside a repeated scope must not be recomputed after x changes.
  check(module(`(local.set $v ${polynomial()}) (block $end (loop $again
    (br_if $end (i32.ge_u (local.get $i) (i32.const 3))) (local.set $sum ${choose()})
    (local.set $x (f64.add (local.get $x) (f64.const 1)))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $again))) (local.get $sum)`,
  { locals: '(local $i i32) (local $sum f64)' }), false)
})

test('lazy select: flat instructions and numeric aliases are declined', () => {
  check(module(`(local.set $v ${polynomial()}) (local.set 0 (f64.const 4)) ${choose()}`), false)
  check(module(`(local.set $v ${polynomial()}) (f64.const 4) (local.set $x) ${choose()}`), false)
  for (const type of Object.keys(values))
    check(module(`(${type}.const 9) (local.set $v (${type}.add ${polynomial(type)})) ${choose(type)}`, { type }), false, calls(type))
})

test('lazy select: size/default stay unchanged; speed opts in and can opt out', () => {
  const src = module(`(local.set $v ${polynomial()}) ${choose()}`)
  for (const opts of [true, { lazySelect: false }, { profile: 'speed', lazySelect: false }]) {
    const on = optimize(parse(src), opts), off = optimize(parse(src), { ...(opts === true ? {} : opts), lazySelect: false })
    assert.equal(print(on), print(off))
  }
  const speed = print(optimize(parse(src), { profile: 'speed', guard: false }))
  assert.notEqual(speed, print(optimize(parse(src), { profile: 'speed', lazySelect: false, guard: false })))
  assert.equal(print(optimize(parse(src), 'lazySelect')), print(lazySelect(parse(src))))
  for (const terms of [1, 17]) check(module(`(local.set $v ${polynomial('f64', terms)}) ${choose()}`), false)
})
