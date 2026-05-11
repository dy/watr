import t, { ok } from 'tst'
import { compile } from './runner.js'

t('rounding: f32.ceil', () => {
  ok(compile(`(module (func (export "f") (param f32) (result f32) (f32.ceil (local.get 0))))`).length)
})

t('rounding: f32.floor', () => {
  ok(compile(`(module (func (export "f") (param f32) (result f32) (f32.floor (local.get 0))))`).length)
})

t('rounding: f32.trunc', () => {
  ok(compile(`(module (func (export "f") (param f32) (result f32) (f32.trunc (local.get 0))))`).length)
})

t('rounding: f32.nearest', () => {
  ok(compile(`(module (func (export "f") (param f32) (result f32) (f32.nearest (local.get 0))))`).length)
})

t('rounding: f64.ceil', () => {
  ok(compile(`(module (func (export "f") (param f64) (result f64) (f64.ceil (local.get 0))))`).length)
})

t('rounding: f64.floor', () => {
  ok(compile(`(module (func (export "f") (param f64) (result f64) (f64.floor (local.get 0))))`).length)
})

t('rounding: f64.trunc', () => {
  ok(compile(`(module (func (export "f") (param f64) (result f64) (f64.trunc (local.get 0))))`).length)
})

t('rounding: f64.nearest', () => {
  ok(compile(`(module (func (export "f") (param f64) (result f64) (f64.nearest (local.get 0))))`).length)
})

t('rounding: i32x4.trunc_sat_f32x4_s', () => {
  ok(compile(`(module (func (export "f") (param v128) (result v128) (i32x4.trunc_sat_f32x4_s (local.get 0))))`).length)
})

t('rounding: i32x4.trunc_sat_f64x2_s_zero', () => {
  ok(compile(`(module (func (export "f") (param v128) (result v128) (i32x4.trunc_sat_f64x2_s_zero (local.get 0))))`).length)
})
