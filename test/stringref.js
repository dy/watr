import t, { ok } from 'tst'
import { compile } from './runner.js'

t('stringref: string.const', () => {
  ok(compile(`(module (func (export "f") (result stringref) (string.const "hello")))`).length)
})

t('stringref: string.new_utf8', () => {
  ok(compile(`(module (memory 1) (func (export "f") (result stringref) (string.new_utf8 (i32.const 0) (i32.const 5))))`).length)
})

t('stringref: string.new_utf8_array', () => {
  ok(compile(`(module (memory 1) (func (export "f") (result stringref) (string.new_utf8_array (i32.const 0) (i32.const 5))))`).length)
})

t('stringref: string.new_wtf16', () => {
  ok(compile(`(module (memory 1) (func (export "f") (result stringref) (string.new_wtf16 (i32.const 0) (i32.const 5))))`).length)
})

t('stringref: string.new_wtf16_array', () => {
  ok(compile(`(module (memory 1) (func (export "f") (result stringref) (string.new_wtf16_array (i32.const 0) (i32.const 5))))`).length)
})

t('stringref: string.measure_utf8', () => {
  ok(compile(`(module (func (export "f") (param stringref) (result i32) (string.measure_utf8 (local.get 0))))`).length)
})

t('stringref: string.measure_wtf8', () => {
  ok(compile(`(module (func (export "f") (param stringref) (result i32) (string.measure_wtf8 (local.get 0))))`).length)
})

t('stringref: string.measure_wtf16', () => {
  ok(compile(`(module (func (export "f") (param stringref) (result i32) (string.measure_wtf16 (local.get 0))))`).length)
})

t('stringref: string.encode_utf8', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringref) (result i32) (string.encode_utf8 (local.get 0) (i32.const 0))))`).length)
})

t('stringref: string.encode_utf8_array', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringref) (result i32 i32) (string.encode_utf8_array (local.get 0) (i32.const 0) (i32.const 100))))`).length)
})

t('stringref: string.encode_wtf16', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringref) (result i32) (string.encode_wtf16 (local.get 0) (i32.const 0))))`).length)
})

t('stringref: string.encode_wtf16_array', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringref) (result i32 i32) (string.encode_wtf16_array (local.get 0) (i32.const 0) (i32.const 100))))`).length)
})

t('stringref: string.concat', () => {
  ok(compile(`(module (func (export "f") (param stringref stringref) (result stringref) (string.concat (local.get 0) (local.get 1))))`).length)
})

t('stringref: string.eq', () => {
  ok(compile(`(module (func (export "f") (param stringref stringref) (result i32) (string.eq (local.get 0) (local.get 1))))`).length)
})

t('stringref: string.is_usv_sequence', () => {
  ok(compile(`(module (func (export "f") (param stringref) (result i32) (string.is_usv_sequence (local.get 0))))`).length)
})

t('stringref: string.as_wtf8', () => {
  ok(compile(`(module (func (export "f") (param stringref) (result stringview_wtf8) (string.as_wtf8 (local.get 0))))`).length)
})

t('stringref: string.as_wtf16', () => {
  ok(compile(`(module (func (export "f") (param stringref) (result stringview_wtf16) (string.as_wtf16 (local.get 0))))`).length)
})

t('stringref: string.as_iter', () => {
  ok(compile(`(module (func (export "f") (param stringref) (result stringview_iter) (string.as_iter (local.get 0))))`).length)
})

t('stringref: stringview_iter.advance', () => {
  ok(compile(`(module (func (export "f") (param stringview_iter) (result stringref stringview_iter) (stringview_iter.advance (local.get 0) (i32.const 1))))`).length)
})

t('stringref: stringview_iter.rewind', () => {
  ok(compile(`(module (func (export "f") (param stringview_iter) (result stringref stringview_iter) (stringview_iter.rewind (local.get 0) (i32.const 1))))`).length)
})

t('stringref: stringview_wtf8.advance', () => {
  ok(compile(`(module (func (export "f") (param stringview_wtf8) (result i32) (stringview_wtf8.advance (local.get 0) (i32.const 0) (i32.const 4))))`).length)
})

t('stringref: stringview_wtf8.encode_utf8', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringview_wtf8) (result i32) (stringview_wtf8.encode_utf8 (local.get 0))))`).length)
})

t('stringref: stringview_wtf8.slice', () => {
  ok(compile(`(module (func (export "f") (param stringview_wtf8) (result stringview_wtf8) (stringview_wtf8.slice (local.get 0) (i32.const 0) (i32.const 5))))`).length)
})

t('stringref: string.encode_utf8_array', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringref) (result i32 i32) (string.encode_utf8_array (local.get 0) (i32.const 0) (i32.const 100))))`).length)
})

t('stringref: stringview_wtf16.length', () => {
  ok(compile(`(module (func (export "f") (param stringview_wtf16) (result i32) (stringview_wtf16.length (local.get 0))))`).length)
})

t('stringref: stringview_wtf16.encode', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringview_wtf16) (result i32) (stringview_wtf16.encode (local.get 0))))`).length)
})

t('stringref: stringview_wtf16.slice', () => {
  ok(compile(`(module (func (export "f") (param stringview_wtf16) (result stringview_wtf16) (stringview_wtf16.slice (local.get 0) (i32.const 0) (i32.const 5))))`).length)
})

t('stringref: string.encode_wtf16_array', () => {
  ok(compile(`(module (memory 1) (func (export "f") (param stringref) (result i32 i32) (string.encode_wtf16_array (local.get 0) (i32.const 0) (i32.const 100))))`).length)
})

t('stringref: stringview_iter.next', () => {
  ok(compile(`(module (func (export "f") (param stringview_iter) (result i32 i32 stringview_iter) (stringview_iter.next (local.get 0))))`).length)
})

t('stringref: stringview_iter.advance', () => {
  ok(compile(`(module (func (export "f") (param stringview_iter) (result i32 stringview_iter) (stringview_iter.advance (local.get 0) (i32.const 1))))`).length)
})

t('stringref: stringview_iter.rewind', () => {
  ok(compile(`(module (func (export "f") (param stringview_iter) (result i32 stringview_iter) (stringview_iter.rewind (local.get 0) (i32.const 1))))`).length)
})

t('stringref: stringview_iter.slice', () => {
  ok(compile(`(module (func (export "f") (param stringview_iter) (result stringref) (stringview_iter.slice (local.get 0))))`).length)
})

t('stringref: global type', () => {
  ok(compile(`(module (global (export "g") (mut stringref) (ref.null stringref)))`).length)
})

t('stringref: param type', () => {
  ok(compile(`(module (func (export "f") (param stringref)))`).length)
})

t('stringref: result type', () => {
  ok(compile(`(module (func (export "f") (result stringref) (ref.null stringref)))`).length)
})

t('stringref: local type', () => {
  ok(compile(`(module (func (export "f") (local stringref)))`).length)
})
