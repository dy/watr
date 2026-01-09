import t, { is, ok, same, throws } from 'tst'
import watr, { compile } from '../watr.js'

// Basic functionality
t('watr: basic export', () => {
  const { add } = watr`(func (export "add") (param i32 i32) (result i32)
    (i32.add (local.get 0) (local.get 1))
  )`
  is(add(2, 3), 5)
})

t('watr: multiple exports', () => {
  const { add, sub } = watr`
    (func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
    (func (export "sub") (param i32 i32) (result i32) (i32.sub (local.get 0) (local.get 1)))
  `
  is(add(5, 3), 8)
  is(sub(5, 3), 2)
})

t('watr: no exports returns empty object', () => {
  const exports = watr`(func (param i32))`
  is(typeof exports, 'object')
  is(Object.keys(exports).length, 0)
})

t('watr: memory export', () => {
  const { mem } = watr`(memory (export "mem") 1)`
  ok(mem instanceof WebAssembly.Memory)
  ok(mem.buffer.byteLength >= 65536)
})

t('watr: global export', () => {
  const { g } = watr`(global (export "g") i32 (i32.const 42))`
  is(g.value, 42)
})

// Integer interpolation
t('watr: interpolate integer', () => {
  const val = 42
  const { get } = watr`(func (export "get") (result i32) (i32.const ${val}))`
  is(get(), 42)
})

t('watr: interpolate negative integer', () => {
  const val = -100
  const { get } = watr`(func (export "get") (result i32) (i32.const ${val}))`
  is(get(), -100)
})

// Float interpolation - precise values
t('watr: interpolate f64 precise', () => {
  const { get } = watr`(func (export "get") (result f64) (f64.const ${Math.PI}))`
  is(get(), Math.PI)
})

t('watr: interpolate f32', () => {
  const val = 1.5
  const { get } = watr`(func (export "get") (result f32) (f32.const ${val}))`
  is(get(), 1.5)
})

t('watr: interpolate float edge cases', () => {
  const { inf, ninf, zero, nzero } = watr`
    (func (export "inf") (result f64) (f64.const ${Infinity}))
    (func (export "ninf") (result f64) (f64.const ${-Infinity}))
    (func (export "zero") (result f64) (f64.const ${0}))
    (func (export "nzero") (result f64) (f64.const ${-0}))
  `
  is(inf(), Infinity)
  is(ninf(), -Infinity)
  is(zero(), 0)
  is(Object.is(nzero(), -0), true)
})

// BigInt interpolation
t('watr: interpolate BigInt', () => {
  const val = 9007199254740993n  // larger than Number.MAX_SAFE_INTEGER
  const { get } = watr`(func (export "get") (result i64) (i64.const ${val}))`
  is(get(), val)
})

// Array interpolation (for SIMD, shuffle patterns, etc)
t('watr: interpolate array as space-separated', () => {
  const pattern = [0, 1, 2, 3]
  const { get } = watr`(func (export "get") (result i32) (i32.const ${pattern[0]}))`
  is(get(), 0)
})

// String interpolation - inside quotes requires the string value directly
t('watr: interpolate string in export', () => {
  const name = 'myFunc'
  // Note: placeholder outside quotes, value is the full quoted string
  const exports = watr`(func (export ${'"' + name + '"'}) (result i32) (i32.const 1))`
  is(exports.myFunc(), 1)
})

// Dynamic index interpolation
t('watr: interpolate function index', () => {
  const idx = 0
  const { call } = watr`
    (func (result i32) (i32.const 42))
    (func (export "call") (result i32) (call ${idx}))
  `
  is(call(), 42)
})

// Uint8Array interpolation for data segments
t('watr: interpolate Uint8Array as data', () => {
  const data = new Uint8Array([1, 2, 3, 4])
  const { mem } = watr`
    (memory (export "mem") 1)
    (data (i32.const 0) ${data})
  `
  const view = new Uint8Array(mem.buffer)
  is(view[0], 1)
  is(view[1], 2)
  is(view[2], 3)
  is(view[3], 4)
})

// Uint8Array inline in memory abbreviation (as documented in docs.md)
t('watr: interpolate Uint8Array in memory inline data', () => {
  const data = new Uint8Array([10, 20, 30])
  const { mem } = watr`(memory (export "mem") (data ${data}))`
  const view = new Uint8Array(mem.buffer)
  is(view[0], 10)
  is(view[1], 20)
  is(view[2], 30)
})

// Code generation - strings containing WAT code get parsed
t('watr: generated code via string', () => {
  // String values containing WAT get parsed as code
  const ops = '(i32.const 0) (i32.const 1) (i32.const 2) (i32.const 3)'
  const exports = watr`(func (export "f") ${ops} drop drop drop drop)`
  ok(exports.f)
})

// compile template literal
t('compile: template literal basic', () => {
  const binary = compile`(func (export "f") (result i32) (i32.const 42))`
  ok(binary instanceof Uint8Array)
  const { f } = new WebAssembly.Instance(new WebAssembly.Module(binary)).exports
  is(f(), 42)
})

t('compile: template literal with interpolation', () => {
  const val = Math.E
  const binary = compile`(func (export "f") (result f64) (f64.const ${val}))`
  const { f } = new WebAssembly.Instance(new WebAssembly.Module(binary)).exports
  is(f(), Math.E)
})

t('compile: regular string still works', () => {
  const binary = compile('(func (export "f") (result i32) (i32.const 1))')
  ok(binary instanceof Uint8Array)
})

// Module wrapping
t('watr: auto-wraps in module', () => {
  const { f } = watr`(func (export "f") (result i32) (i32.const 1))`
  is(f(), 1)
})

t('watr: explicit module works', () => {
  const { f } = watr`(module (func (export "f") (result i32) (i32.const 2)))`
  is(f(), 2)
})

// Multiple interpolations
t('watr: multiple interpolations', () => {
  const a = 10, b = 20
  const { get } = watr`(func (export "get") (result i32)
    (i32.add (i32.const ${a}) (i32.const ${b}))
  )`
  is(get(), 30)
})

// Config injection
t('watr: interpolate memory pages', () => {
  const pages = 2
  const { mem } = watr`(memory (export "mem") ${pages})`
  is(mem.buffer.byteLength, pages * 65536)
})
