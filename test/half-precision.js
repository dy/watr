// Half precision proposal: https://github.com/WebAssembly/half-precision
// Opcodes follow V8 (src/wasm/wasm-opcodes.h, --experimental-wasm-fp16):
// f32.load_f16 0xfc30, f32.store_f16 0xfc31, f16x8.* 0xfd120-0xfd14f.
import t, { is, ok } from 'tst'
import { compile } from './runner.js'
import { f16 } from '../src/encode.js'

const OPS1 = ['abs', 'neg', 'sqrt', 'ceil', 'floor', 'trunc', 'nearest',
  'demote_f32x4_zero', 'demote_f64x2_zero', 'convert_i16x8_s', 'convert_i16x8_u']
const OPS2 = ['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'add', 'sub', 'mul', 'div', 'min', 'max', 'pmin', 'pmax']

// fp16 runtime support (V8 behind --experimental-wasm-fp16): (memory 1) (func (result f32) (f32.load_f16 (i32.const 0)))
const hasFp16 = (() => {
  try {
    new WebAssembly.Module(new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7d,
      0x03, 0x02, 0x01, 0x00,
      0x05, 0x03, 0x01, 0x00, 0x01,
      0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfc, 0x30, 0x01, 0x00, 0x0b
    ]))
    return true
  } catch { return false }
})()
const ifFp16 = hasFp16 ? t : t.todo

t('f16: encoder matches native DataView.setFloat16', () => {
  if (typeof DataView.prototype.setFloat16 !== 'function') return
  const ref = v => { const d = new DataView(new ArrayBuffer(2)); d.setFloat16(0, v, true); return d.getUint16(0, true) }
  const cases = [0, -0, 1, -1, 0.5, 65504, 65519.99, 2 ** -24, 2 ** -25, 2 ** -25 * 1.0000001,
    5.96e-8, 1e-10, Infinity, -Infinity, 3.14159, 0.1, 2048.5, 2049.5, 6.10352e-5]
  for (const v of cases) is(f16.bits(v), ref(v), String(v))
  for (let i = 0; i < 10000; i++) {
    const v = (Math.random() - 0.5) * 2 ** (Math.random() * 40 - 30)
    is(f16.bits(v), ref(v), String(v))
  }
})

t('f16: memory ops', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param i32) (result f32) (f32.load_f16 (local.get 0))))`).length)
  ok(compile(`(module (memory 1) (func (export "f") (param i32 f32) (f32.store_f16 (local.get 0) (local.get 1))))`).length)
})

t('f16: lane ops', () => {
  ok(compile(`(module (func (export "f") (param f32) (result v128) (f16x8.splat (local.get 0))))`).length)
  ok(compile(`(module (func (export "f") (param v128) (result f32) (f16x8.extract_lane 7 (local.get 0))))`).length)
  ok(compile(`(module (func (export "f") (param v128 f32) (result v128) (f16x8.replace_lane 0 (local.get 0) (local.get 1))))`).length)
})

t('f16: unary and conversion ops', () => {
  for (const op of OPS1)
    ok(compile(`(module (func (export "f") (param v128) (result v128) (f16x8.${op} (local.get 0))))`).length, op)
  ok(compile(`(module (func (export "f") (param v128) (result v128) (i16x8.trunc_sat_f16x8_s (local.get 0))))`).length)
  ok(compile(`(module (func (export "f") (param v128) (result v128) (i16x8.trunc_sat_f16x8_u (local.get 0))))`).length)
  ok(compile(`(module (func (export "f") (param v128) (result v128) (f32x4.promote_low_f16x8 (local.get 0))))`).length)
})

t('f16: binary and ternary ops', () => {
  for (const op of OPS2)
    ok(compile(`(module (func (export "f") (param v128 v128) (result v128) (f16x8.${op} (local.get 0) (local.get 1))))`).length, op)
  ok(compile(`(module (func (export "f") (param v128 v128 v128) (result v128) (f16x8.madd (local.get 0) (local.get 1) (local.get 2))))`).length)
  ok(compile(`(module (func (export "f") (param v128 v128 v128) (result v128) (f16x8.nmadd (local.get 0) (local.get 1) (local.get 2))))`).length)
})

t('f16: v128.const f16x8 bytes match Float16Array', () => {
  if (typeof Float16Array !== 'function') return
  const vals = [1, 2, 3, 4, 5.5, -0.5, 3.14159, 65504]
  const bytes = compile(`(module (func (result v128) (v128.const f16x8 ${vals.join(' ')})))`)
  const hex = a => [...a].map(x => x.toString(16).padStart(2, '0')).join('')
  ok(hex(bytes).includes(hex(new Uint8Array(new Float16Array(vals).buffer))))
})

t('f16: nan encodings', () => {
  is(f16.bits(NaN) & 0x7c00, 0x7c00)
  is(f16('nan'), [0x00, 0x7e])          // quiet nan 0x7e00
  is(f16('-nan'), [0x00, 0xfe])
  is(f16('nan:0x155'), [0x55, 0x7d])    // payload 0x155 | 0x7c00
})

t('f16: out of range literal throws', () => {
  let threw = false
  try { compile(`(module (func (result v128) (v128.const f16x8 65520 0 0 0 0 0 0 0)))`) } catch { threw = true }
  ok(threw)
})

ifFp16('f16: V8 validates every op', () => {
  const mods = [
    `(module (memory 1) (func (param i32) (result f32) (f32.load_f16 (local.get 0))))`,
    `(module (memory 1) (func (param i32 f32) (f32.store_f16 (local.get 0) (local.get 1))))`,
    `(module (func (param f32) (result v128) (f16x8.splat (local.get 0))))`,
    `(module (func (param v128) (result f32) (f16x8.extract_lane 3 (local.get 0))))`,
    `(module (func (param v128 f32) (result v128) (f16x8.replace_lane 0 (local.get 0) (local.get 1))))`,
    ...OPS1.map(op => `(module (func (param v128) (result v128) (f16x8.${op} (local.get 0))))`),
    ...OPS2.map(op => `(module (func (param v128 v128) (result v128) (f16x8.${op} (local.get 0) (local.get 1))))`),
    `(module (func (param v128 v128 v128) (result v128) (f16x8.madd (local.get 0) (local.get 1) (local.get 2))))`,
    `(module (func (param v128 v128 v128) (result v128) (f16x8.nmadd (local.get 0) (local.get 1) (local.get 2))))`,
    `(module (func (param v128) (result v128) (i16x8.trunc_sat_f16x8_s (local.get 0))))`,
    `(module (func (param v128) (result v128) (i16x8.trunc_sat_f16x8_u (local.get 0))))`,
    `(module (func (param v128) (result v128) (f32x4.promote_low_f16x8 (local.get 0))))`,
  ]
  for (const src of mods) ok(WebAssembly.validate(compile(src)), src.slice(8, 60))
})

ifFp16('f16: arithmetic matches Float16Array', () => {
  const bin = compile(`(module (memory (export "mem") 1)
    (func (export "run")
      (v128.store (i32.const 32) (f16x8.add (v128.load (i32.const 0)) (v128.load (i32.const 16))))))`)
  const { run, mem } = new WebAssembly.Instance(new WebAssembly.Module(bin)).exports
  const lanes = new Float16Array(mem.buffer, 0, 24)
  const a = [1, 2.5, -3, 0.1, 65504, 1e-4, -0.5, 7], b = [0.5, 2, 3, 0.2, 65504, 1e-4, 0.25, -7]
  a.forEach((v, i) => lanes[i] = v); b.forEach((v, i) => lanes[8 + i] = v)
  run()
  for (let i = 0; i < 8; i++) {
    const expect = Math.f16round(Math.f16round(a[i]) + Math.f16round(b[i]))
    if (Number.isNaN(expect)) ok(Number.isNaN(lanes[16 + i]))
    else is(lanes[16 + i], expect, `lane ${i}`)
  }
})
