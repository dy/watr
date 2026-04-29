import t, { is, throws } from 'tst'
import { inline } from './util.js'

t('js-string: cast', () => {
  let { test } = inline(`(import "wasm:js-string" "cast" (func $cast (param externref) (result (ref extern))))
    (func (export "test") (param externref) (result externref) (call $cast (local.get 0)))`, {
    'wasm:js-string': { cast: s => { if (typeof s !== 'string') throw Error(); return s } }
  }).exports
  is(test('hello'), 'hello')
  throws(() => test(null))
  throws(() => test(123))
})

t('js-string: test', () => {
  let { isString } = inline(`(import "wasm:js-string" "test" (func $test (param externref) (result i32)))
    (func (export "isString") (param externref) (result i32) (call $test (local.get 0)))`, {
    'wasm:js-string': { test: s => +(typeof s === 'string') }
  }).exports
  is(isString('hello'), 1)
  is(isString(null), 0)
  is(isString(123), 0)
})

t('js-string: fromCharCode', () => {
  let { charToString } = inline(`(import "wasm:js-string" "fromCharCode" (func $fromCharCode (param i32) (result (ref extern))))
    (func (export "charToString") (param i32) (result externref) (call $fromCharCode (local.get 0)))`, {
    'wasm:js-string': { fromCharCode: String.fromCharCode }
  }).exports
  is(charToString(65), 'A')
  is(charToString(97), 'a')
  is(charToString(48), '0')
})

t('js-string: fromCodePoint', () => {
  let { cpToString } = inline(`(import "wasm:js-string" "fromCodePoint" (func $fromCodePoint (param i32) (result (ref extern))))
    (func (export "cpToString") (param i32) (result externref) (call $fromCodePoint (local.get 0)))`, {
    'wasm:js-string': { fromCodePoint: cp => { if (cp < 0 || cp > 0x10FFFF) throw Error(); return String.fromCodePoint(cp) } }
  }).exports
  is(cpToString(0x1F600), '😀')
  is(cpToString(65), 'A')
  throws(() => cpToString(-1))
  throws(() => cpToString(0x110000))
})

t('js-string: charCodeAt', () => {
  let { getCharCode } = inline(`(import "wasm:js-string" "charCodeAt" (func $charCodeAt (param externref i32) (result i32)))
    (func (export "getCharCode") (param externref i32) (result i32) (call $charCodeAt (local.get 0) (local.get 1)))`, {
    'wasm:js-string': { charCodeAt: (s, i) => s.charCodeAt(i) }
  }).exports
  is(getCharCode('ABC', 0), 65)
  is(getCharCode('ABC', 1), 66)
  is(getCharCode('ABC', 2), 67)
})

t('js-string: codePointAt', () => {
  let { getCodePoint } = inline(`(import "wasm:js-string" "codePointAt" (func $codePointAt (param externref i32) (result i32)))
    (func (export "getCodePoint") (param externref i32) (result i32) (call $codePointAt (local.get 0) (local.get 1)))`, {
    'wasm:js-string': { codePointAt: (s, i) => s.codePointAt(i) }
  }).exports
  is(getCodePoint('😀A', 0), 0x1F600)
  is(getCodePoint('A😀', 1), 0x1F600)
})

t('js-string: length', () => {
  let { getLength } = inline(`(import "wasm:js-string" "length" (func $length (param externref) (result i32)))
    (func (export "getLength") (param externref) (result i32) (call $length (local.get 0)))`, {
    'wasm:js-string': { length: s => s.length }
  }).exports
  is(getLength('hello'), 5)
  is(getLength(''), 0)
  is(getLength('😀'), 2)
})

t('js-string: concat', () => {
  let { joinStrings } = inline(`(import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern))))
    (func (export "joinStrings") (param externref externref) (result externref) (call $concat (local.get 0) (local.get 1)))`, {
    'wasm:js-string': { concat: (a, b) => a + b }
  }).exports
  is(joinStrings('hello', ' world'), 'hello world')
  is(joinStrings('foo', 'bar'), 'foobar')
  is(joinStrings('', 'test'), 'test')
})

t('js-string: substring', () => {
  let { substr } = inline(`(import "wasm:js-string" "substring" (func $substring (param externref i32 i32) (result (ref extern))))
    (func (export "substr") (param externref i32 i32) (result externref) (call $substring (local.get 0) (local.get 1) (local.get 2)))`, {
    'wasm:js-string': { substring: (s, a, b) => s.substring(a, b) }
  }).exports
  is(substr('hello world', 0, 5), 'hello')
  is(substr('hello world', 6, 11), 'world')
  is(substr('test', 1, 3), 'es')
})

t('js-string: equals', () => {
  let { isEqual } = inline(`(import "wasm:js-string" "equals" (func $equals (param externref externref) (result i32)))
    (func (export "isEqual") (param externref externref) (result i32) (call $equals (local.get 0) (local.get 1)))`, {
    'wasm:js-string': { equals: (a, b) => +(a === b) }
  }).exports
  is(isEqual('hello', 'hello'), 1)
  is(isEqual('hello', 'world'), 0)
  is(isEqual('', ''), 1)
})

t('js-string: compare', () => {
  let { cmp } = inline(`(import "wasm:js-string" "compare" (func $compare (param externref externref) (result i32)))
    (func (export "cmp") (param externref externref) (result i32) (call $compare (local.get 0) (local.get 1)))`, {
    'wasm:js-string': { compare: (a, b) => a < b ? -1 : a > b ? 1 : 0 }
  }).exports
  is(cmp('apple', 'banana'), -1)
  is(cmp('zebra', 'apple'), 1)
  is(cmp('test', 'test'), 0)
})

t('js-string: fromCharCodeArray', () => {
  let memRef
  let { arrayToString, writeChars, mem } = inline(`(memory (export "mem") 1)
    (import "wasm:js-string" "fromCharCodeArray" (func $fromCharCodeArray (param i32 i32 i32) (result (ref extern))))
    (func (export "arrayToString") (param i32 i32 i32) (result externref) (call $fromCharCodeArray (local.get 0) (local.get 1) (local.get 2)))
    (func (export "writeChars") (param i32 i32 i32)
      (i32.store16 (i32.const 0) (local.get 0))
      (i32.store16 (i32.const 2) (local.get 1))
      (i32.store16 (i32.const 4) (local.get 2)))`, {
    'wasm:js-string': { fromCharCodeArray: (arr, start, end) => {
      const mem = new Uint16Array(memRef.buffer)
      let r = ''
      for (let i = start; i < end; i++) r += String.fromCharCode(mem[arr / 2 + i])
      return r
    }}
  }).exports
  memRef = mem
  writeChars(65, 66, 67)
  is(arrayToString(0, 0, 3), 'ABC')
})

t('js-string: intoCharCodeArray', () => {
  let memRef
  let { stringToArray, readChar, mem } = inline(`(memory (export "mem") 1)
    (import "wasm:js-string" "intoCharCodeArray" (func $intoCharCodeArray (param externref i32 i32) (result i32)))
    (func (export "stringToArray") (param externref i32) (result i32) (call $intoCharCodeArray (local.get 0) (local.get 1) (i32.const 0)))
    (func (export "readChar") (param i32) (result i32) (i32.load16_u (local.get 0)))`, {
    'wasm:js-string': { intoCharCodeArray: (s, arr, start) => {
      const mem = new Uint16Array(memRef.buffer)
      for (let i = 0; i < s.length; i++) mem[arr / 2 + start + i] = s.charCodeAt(i)
      return s.length
    }}
  }).exports
  memRef = mem
  is(stringToArray('Hi', 0), 2)
  is(readChar(0), 72)
  is(readChar(2), 105)
})

t('js-string: string reversal', () => {
  let { reverse } = inline(`(import "wasm:js-string" "length" (func $length (param externref) (result i32)))
    (import "wasm:js-string" "charCodeAt" (func $charCodeAt (param externref i32) (result i32)))
    (import "wasm:js-string" "fromCharCode" (func $fromCharCode (param i32) (result (ref extern))))
    (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern))))
    (import "wasm:js-string" "substring" (func $substring (param externref i32 i32) (result (ref extern))))
    (func (export "reverse") (param $str externref) (result externref)
      (local $len i32) (local $i i32) (local $result externref) (local $char externref)
      (local.set $len (call $length (local.get $str)))
      (local.set $result (call $substring (local.get $str) (i32.const 0) (i32.const 0)))
      (local.set $i (local.get $len))
      (block $break (loop $continue
        (br_if $break (i32.eqz (local.get $i)))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (local.set $char (call $fromCharCode (call $charCodeAt (local.get $str) (local.get $i))))
        (local.set $result (call $concat (local.get $result) (local.get $char)))
        (br $continue)))
      (local.get $result))`, {
    'wasm:js-string': {
      length: s => s.length,
      charCodeAt: (s, i) => s.charCodeAt(i),
      fromCharCode: String.fromCharCode,
      substring: (s, a, b) => s.substring(a, b),
      concat: (a, b) => a + b
    }
  }).exports
  is(reverse('hello'), 'olleh')
  is(reverse('WASM'), 'MSAW')
  is(reverse('a'), 'a')
})
