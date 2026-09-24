// Value numbering (src/number.js): one computation per value, through locals.
// Every case runs the module before and after the pass: the bits never change,
// the call count may.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { valueNumber } from '../src/optimize.js'
import { parse, print, compile } from './runner.js'

const instance = ast => new WebAssembly.Instance(new WebAssembly.Module(compile(ast))).exports
const numbered = (src, opts) => { const ast = parse(src); valueNumber(ast, opts); return ast }
const calls = (ast, name) => (print(ast).match(new RegExp(`\\(call \\${name}\\b`, 'g')) || []).length

test('value numbering: branch-only repeats need no capture locals', () => {
  const ast = numbered(`(module
    (func $f (export "f") (param $c i32) (param $x f64) (result f64)
      (if (result f64) (local.get $c)
        (then (f64.sqrt (local.get $x)))
        (else (f64.sqrt (local.get $x))))))`)
  assert.equal(ast[1].filter(n => Array.isArray(n) && n[0] === 'local').length, 0, 'neither branch can reuse the other capture')
  const { f } = instance(ast)
  for (const c of [0, 1]) {
    assert.equal(f(c, 9), 3)
    assert.ok(Object.is(f(c, -0), -0))
    assert.ok(Number.isNaN(f(c, -1)))
  }
})

test('value numbering: a vouched pure callee called twice with one argument runs once', () => {
  const src = `(module
    (func $k (param $x f64) (result f64) (f64.mul (local.get $x) (f64.const 3)))
    (func $f (export "f") (param $x f64) (result f64)
      (f64.div
        (f64.add (f64.const 1) (call $k (f64.div (local.get $x) (f64.const 7))))
        (f64.add (f64.const 2) (call $k (f64.div (local.get $x) (f64.const 7)))))))`
  const plain = numbered(src), vouched = numbered(src, { pure: ['$k'] })
  assert.equal(calls(vouched, '$k'), 1)
  assert.equal(calls(plain, '$k'), 1, 'read-only by its own effects: shared too, in place')
  for (const x of [-4.5, 0, 9]) assert.ok(Object.is(instance(vouched).f(x), instance(parse(src)).f(x)))
})

test('value numbering: a store between two read-only calls keeps both', () => {
  const src = `(module (memory 1)
    (func $read (param $p i32) (result i32) (i32.load (local.get $p)))
    (func $f (export "f") (param $p i32) (result i32) (local $a i32)
      (i32.store (local.get $p) (i32.const 5))
      (local.set $a (call $read (local.get $p)))
      (i32.store (local.get $p) (i32.const 9))
      (i32.add (local.get $a) (call $read (local.get $p)))))`
  const ast = numbered(src)
  assert.equal(calls(ast, '$read'), 2)
  assert.equal(instance(ast).f(8), 14)
})

test('value numbering: a global write invalidates a read-only call', () => {
  const { f } = instance(numbered(`(module (global $g (mut i32) (i32.const 0))
    (func $read (result i32) (global.get $g))
    (func $f (export "f") (result i32) (local $a i32)
      (global.set $g (i32.const 1))
      (local.set $a (call $read))
      (global.set $g (i32.add (call $read) (i32.const 1)))
      (i32.add (local.get $a) (call $read))))`))
  assert.equal(f(), 3); assert.equal(f(), 3)
})

test('value numbering: floating constants preserve the sign of zero', () => {
  for (const type of ['f32', 'f64']) {
    const { f } = instance(numbered(`(module (func $f (export "f") (param $x ${type}) (result ${type}) (local $a ${type})
      (local.set $a (${type}.div (local.get $x) (${type}.const 0)))
      (${type}.div (local.get $x) (${type}.const -0))))`))
    assert.equal(f(1), -Infinity, type)
    assert.equal(f(-1), Infinity, type)
  }
})

test('value numbering: every store width keeps a callee effectful', () => {
  for (const op of ['i32.store', 'i32.store8', 'i32.store16', 'i64.store', 'i64.store8', 'i64.store16', 'i64.store32', 'f32.store', 'f64.store', 'v128.store', 'v128.store8_lane', 'v128.store16_lane', 'v128.store32_lane', 'v128.store64_lane']) {
    const value = op.startsWith('v128') ? '(v128.const i64x2 0 0)' : `(${op.slice(0, 3)}.const 0)`
    const store = op.includes('_lane') ? `(${op} 0 (i32.const 64) ${value})` : `(${op} (i32.const 64) ${value})`
    const ast = numbered(`(module (memory 1)
      (func $write (param $x f64) (result f64) ${store} (local.get $x))
      (func $f (export "f") (param $x f64) (result f64)
        (f64.add (f64.sqrt (call $write (local.get $x))) (f64.sqrt (call $write (local.get $x))))))`)
    assert.equal(calls(ast, '$write'), 2, op)
  }
  const { f } = instance(numbered(`(module (memory 1)
    (func $bump (result i32)
      (i32.store8 (i32.const 0) (i32.add (i32.load8_u (i32.const 0)) (i32.const 1)))
      (i32.load8_u (i32.const 0)))
    (func $f (export "f") (result i32)
      (i32.store8 (i32.const 0) (i32.const 0))
      (i32.add (call $bump) (call $bump))))`))
  assert.equal(f(), 3); assert.equal(f(), 3)
})

test('value numbering: atomic writes and host imports stay effectful', () => {
  const ast = numbered(`(module (import "env" "tick" (func $tick (result f64))) (memory 1 1 shared)
    (func $write (result f64) (drop (i32.atomic.rmw8.add_u (i32.const 0) (i32.const 1))) (f64.const 2))
    (func $f (export "f") (result f64)
      (f64.add (f64.add (f64.sqrt (call $write)) (f64.sqrt (call $write)))
        (f64.add (f64.sqrt (call $tick)) (f64.sqrt (call $tick))))))`)
  assert.equal(calls(ast, '$write'), 2)
  assert.equal(calls(ast, '$tick'), 2)
})

test('value numbering: a callee that writes a global runs every time', () => {
  const { f, count } = instance(numbered(`(module (global $count (export "count") (mut i32) (i32.const 0))
    (func $coerce (param $x f64) (result f64)
      (global.set $count (i32.add (global.get $count) (i32.const 1))) (local.get $x))
    (func $f (export "f") (result f64)
      (f64.add (call $coerce (f64.const 2)) (call $coerce (f64.const 2)))))`))
  assert.equal(f(), 4); assert.equal(count.value, 2)
  assert.equal(f(), 4); assert.equal(count.value, 4)
})

test('value numbering: a shared trapping expression stays after preceding effects', () => {
  const { f, g } = instance(numbered(`(module (global $g (export "g") (mut i32) (i32.const 0))
    (func $f (export "f") (param $d i32) (result i32)
      (i32.add
        (block (result i32) (global.set $g (i32.const 1)) (i32.const 0))
        (i32.add (i32.div_s (i32.const 6) (local.get $d)) (i32.div_s (i32.const 6) (local.get $d))))))`))
  assert.throws(() => f(0), WebAssembly.RuntimeError)
  assert.equal(g.value, 1, 'the write precedes the division trap')
  assert.equal(f(2), 6)
})

test('value numbering: a function in the flat form is left alone', () => {
  const src = `(module (func $f (export "f") (param $x f64) (result f64)
    local.get $x f64.sqrt local.get $x f64.sqrt f64.add))`
  assert.equal(print(numbered(src)), print(parse(src)))
})
