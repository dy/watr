// ref: https://github.com/stagas/wat-compiler/blob/main/lib/const.js
// NOTE: squashing into a string doesn't save up gzipped size
export const OP = [
  'unreachable', 'nop', 'block', 'loop', 'if', 'else', 'then', , , , ,
  'end', 'br', 'br_if', 'br_table', 'return', 'call', 'call_indirect', , , , , , , , ,
  'drop', 'select', , , , ,
  'local.get', 'local.set', 'local.tee', 'global.get', 'global.set', , , ,
  'i32.load', 'i64.load', 'f32.load', 'f64.load',
  'i32.load8_s', 'i32.load8_u', 'i32.load16_s', 'i32.load16_u',
  'i64.load8_s', 'i64.load8_u', 'i64.load16_s', 'i64.load16_u', 'i64.load32_s', 'i64.load32_u',
  'i32.store', 'i64.store', 'f32.store', 'f64.store',
  'i32.store8', 'i32.store16', 'i64.store8', 'i64.store16', 'i64.store32',
  'memory.size', 'memory.grow',
  'i32.const', 'i64.const', 'f32.const', 'f64.const',
  'i32.eqz', 'i32.eq', 'i32.ne', 'i32.lt_s', 'i32.lt_u', 'i32.gt_s', 'i32.gt_u', 'i32.le_s', 'i32.le_u', 'i32.ge_s', 'i32.ge_u',
  'i64.eqz', 'i64.eq', 'i64.ne', 'i64.lt_s', 'i64.lt_u', 'i64.gt_s', 'i64.gt_u', 'i64.le_s', 'i64.le_u', 'i64.ge_s', 'i64.ge_u',
  'f32.eq', 'f32.ne', 'f32.lt', 'f32.gt', 'f32.le', 'f32.ge',
  'f64.eq', 'f64.ne', 'f64.lt', 'f64.gt', 'f64.le', 'f64.ge',
  'i32.clz', 'i32.ctz', 'i32.popcnt', 'i32.add', 'i32.sub', 'i32.mul', 'i32.div_s', 'i32.div_u', 'i32.rem_s', 'i32.rem_u', 'i32.and', 'i32.or', 'i32.xor', 'i32.shl', 'i32.shr_s', 'i32.shr_u', 'i32.rotl', 'i32.rotr',
  'i64.clz', 'i64.ctz', 'i64.popcnt', 'i64.add', 'i64.sub', 'i64.mul', 'i64.div_s', 'i64.div_u', 'i64.rem_s', 'i64.rem_u', 'i64.and', 'i64.or', 'i64.xor', 'i64.shl', 'i64.shr_s', 'i64.shr_u', 'i64.rotl', 'i64.rotr',
  'f32.abs', 'f32.neg', 'f32.ceil', 'f32.floor', 'f32.trunc', 'f32.nearest', 'f32.sqrt', 'f32.add', 'f32.sub', 'f32.mul', 'f32.div', 'f32.min', 'f32.max', 'f32.copysign',
  'f64.abs', 'f64.neg', 'f64.ceil', 'f64.floor', 'f64.trunc', 'f64.nearest', 'f64.sqrt', 'f64.add', 'f64.sub', 'f64.mul', 'f64.div', 'f64.min', 'f64.max', 'f64.copysign',
  'i32.wrap_i64',
  'i32.trunc_f32_s', 'i32.trunc_f32_u', 'i32.trunc_f64_s', 'i32.trunc_f64_u', 'i64.extend_i32_s', 'i64.extend_i32_u',
  'i64.trunc_f32_s', 'i64.trunc_f32_u', 'i64.trunc_f64_s', 'i64.trunc_f64_u',
  'f32.convert_i32_s', 'f32.convert_i32_u', 'f32.convert_i64_s', 'f32.convert_i64_u', 'f32.demote_f64',
  'f64.convert_i32_s', 'f64.convert_i32_u', 'f64.convert_i64_s', 'f64.convert_i64_u', 'f64.promote_f32',
  'i32.reinterpret_f32', 'i64.reinterpret_f64', 'f32.reinterpret_i32', 'f64.reinterpret_i64', , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , ,
  'memory.init', 'data.drop', 'memory.copy', 'memory.fill', 'table.init', 'elem.drop', 'table.copy', ,
  'v128.load', 'v128.load8x8_s', 'v128.load8x8_u', 'v128.load16x4_s', 'v128.load16x4_u', 'v128.load32x2_s', 'v128.load32x2_u', 'v128.load8_splat', 'v128.load16_splat', 'v128.load32_splat', 'v128.load64_splat',
  'v128.store', 'v128.const'
],
  SECTION = { type: 1, import: 2, func: 3, table: 4, memory: 5, global: 6, export: 7, start: 8, elem: 9, code: 10, data: 11 },
  TYPE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, void: 0x40, func: 0x60, funcref: 0x70, v128: 0x7B },
  KIND = { func: 0, table: 1, memory: 2, global: 3 },
  ALIGN = {
    'i32.load': 4, 'i64.load': 8, 'f32.load': 4, 'f64.load': 8,
    'i32.load8_s': 1, 'i32.load8_u': 1, 'i32.load16_s': 2, 'i32.load16_u': 2,
    'i64.load8_s': 1, 'i64.load8_u': 1, 'i64.load16_s': 2, 'i64.load16_u': 2, 'i64.load32_s': 4, 'i64.load32_u': 4, 'i32.store': 4,
    'i64.store': 8, 'f32.store': 4, 'f64.store': 8,
    'i32.store8': 1, 'i32.store16': 2, 'i64.store8': 1, 'i64.store16': 2, 'i64.store32': 4,

    'v128.load': 16, 'v128.load8x8_s': 8, 'v128.load8x8_u': 8, 'v128.load16x4_s': 8, 'v128.load16x4_u': 8, 'v128.load32x2_s': 8, 'v128.load32x2_u': 8, 'v128.load8_splat': 1, 'v128.load16_splat': 2, 'v128.load32_splat': 4, 'v128.load64_splat': 8, 'v128.store': 16
  },
  BLOCK = {
    loop: 1, block: 1, if: 1, end: -1, return: -1
  }
