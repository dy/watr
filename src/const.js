// https://webassembly.github.io/spec/core/appendix/index-instructions.html
export const INSTR = [
  'unreachable', 'nop', 'block b', 'loop b', 'if b', 'else', 'then', , , , ,
  'end', 'br i', 'br_if i', 'br_table i*', 'return', 'call i', 'call_indirect i i', , , , , , , , ,
  'drop', 'select', 'select t', , , ,
  'local.get i', 'local.set i', 'local.tee i', 'global.get i', 'global.set i', 'table.get i', 'table.set i', ,
  'i32.load m', 'i64.load m', 'f32.load m', 'f64.load m',
  'i32.load8_s m', 'i32.load8_u m', 'i32.load16_s m', 'i32.load16_u m',
  'i64.load8_s m', 'i64.load8_u m', 'i64.load16_s m', 'i64.load16_u m', 'i64.load32_s m', 'i64.load32_u m',
  'i32.store m', 'i64.store m', 'f32.store m', 'f64.store m',
  'i32.store8 m', 'i32.store16 m', 'i64.store8 m', 'i64.store16 m', 'i64.store32 m',
  'memory.size', 'memory.grow',
  'i32.const n', 'i64.const n', 'f32.const n', 'f64.const n',
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
  'i32.reinterpret_f32', 'i64.reinterpret_f64', 'f32.reinterpret_i32', 'f64.reinterpret_i64',
  'i32.extend8_s', 'i32.extend16_s', 'i64.extend8_s', 'i64.extend16_s', 'i64.extend32_s', , , , , , , , , , , ,
  'ref.null t', 'ref.is_null', 'ref.func i', , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , ,

  // 0xFC 0xNN (0xfc shift)
  'i32.trunc_sat_f32_u', 'i32.trunc_sat_f32_u', 'i32.trunc_sat_f64_s', 'i32.trunc_sat_f64_u', 'i64.trunc_sat_f32_s', 'i64.trunc_sat_f32_u', 'i64.trunc_sat_f64_s', 'i64.trunc_sat_f64_u',
  'memory.init i', 'data.drop i', 'memory.copy', 'memory.fill', 'table.init i i', 'elem.drop i', 'table.copy i i', 'table.grow i', 'table.size i', 'table.fill i', ,

  // 0xFD 0xNN (0x10f shift)
  "v128.load m", "v128.load8x8_s m", "v128.load8x8_u m", "v128.load16x4_s m", "v128.load16x4_u m", "v128.load32x2_s m", "v128.load32x2_u m", "v128.load8_splat m", "v128.load16_splat m", "v128.load32_splat m", "v128.load64_splat m", "v128.store m", "v128.const n", "i8x16.shuffle n n n n n n n n n n n n n n n n",
  "i8x16.swizzle", "i8x16.splat", "i16x8.splat", "i32x4.splat", "i64x2.splat", "f32x4.splat", "f64x2.splat",
  "i8x16.extract_lane_s n", "i8x16.extract_lane_u n", "i8x16.replace_lane n", "i16x8.extract_lane_s n", "i16x8.extract_lane_u n", "i16x8.replace_lane n", "i32x4.extract_lane n", "i32x4.replace_lane n", "i64x2.extract_lane n", "i64x2.replace_lane n", "f32x4.extract_lane n", "f32x4.replace_lane n", "f64x2.extract_lane n", "f64x2.replace_lane n",
  "i8x16.eq", "i8x16.ne", "i8x16.lt_s", "i8x16.lt_u", "i8x16.gt_s", "i8x16.gt_u", "i8x16.le_s", "i8x16.le_u", "i8x16.ge_s", "i8x16.ge_u", "i16x8.eq", "i16x8.ne", "i16x8.lt_s", "i16x8.lt_u", "i16x8.gt_s", "i16x8.gt_u", "i16x8.le_s", "i16x8.le_u", "i16x8.ge_s", "i16x8.ge_u", "i32x4.eq", "i32x4.ne", "i32x4.lt_s", "i32x4.lt_u", "i32x4.gt_s", "i32x4.gt_u", "i32x4.le_s", "i32x4.le_u", "i32x4.ge_s", "i32x4.ge_u", "f32x4.eq", "f32x4.ne", "f32x4.lt", "f32x4.gt", "f32x4.le", "f32x4.ge", "f64x2.eq", "f64x2.ne", "f64x2.lt", "f64x2.gt", "f64x2.le", "f64x2.ge", "v128.not", "v128.and", "v128.andnot", "v128.or", "v128.xor", "v128.bitselect", "v128.any_true",
  "v128.load8_lane m l", "v128.load16_lane m l", "v128.load32_lane m l", "v128.load64_lane m l", "v128.store8_lane", "v128.store16_lane", "v128.store32_lane", "v128.store64_lane", "v128.load32_zero m", "v128.load64_zero m", "f32x4.demote_f64x2_zero", "f64x2.promote_low_f32x4",
  "i8x16.abs", "i8x16.neg", "i8x16.popcnt", "i8x16.all_true", "i8x16.bitmask", "i8x16.narrow_i16x8_s", "i8x16.narrow_i16x8_u", "f32x4.ceil", "f32x4.floor", "f32x4.trunc", "f32x4.nearest", "i8x16.shl", "i8x16.shr_s", "i8x16.shr_u", "i8x16.add", "i8x16.add_sat_s", "i8x16.add_sat_u", "i8x16.sub", "i8x16.sub_sat_s", "i8x16.sub_sat_u", "f64x2.ceil", "f64x2.floor", "i8x16.min_s", "i8x16.min_u", "i8x16.max_s", "i8x16.max_u", "f64x2.trunc", "i8x16.avgr_u",
  "i16x8.extadd_pairwise_i8x16_s", "i16x8.extadd_pairwise_i8x16_u", "i32x4.extadd_pairwise_i16x8_s", "i32x4.extadd_pairwise_i16x8_u", "i16x8.abs", "i16x8.neg", "i16x8.q15mulr_sat_s", "i16x8.all_true", "i16x8.bitmask", "i16x8.narrow_i32x4_s", "i16x8.narrow_i32x4_u", "i16x8.extend_low_i8x16_s", "i16x8.extend_high_i8x16_s", "i16x8.extend_low_i8x16_u", "i16x8.extend_high_i8x16_u",
  "i16x8.shl", "i16x8.shr_s", "i16x8.shr_u", "i16x8.add", "i16x8.add_sat_s", "i16x8.add_sat_u", "i16x8.sub", "i16x8.sub_sat_s", "i16x8.sub_sat_u", "f64x2.nearest", "i16x8.mul", "i16x8.min_s", "i16x8.min_u", "i16x8.max_s", "i16x8.max_u", , "i16x8.avgr_u",
  "i16x8.extmul_low_i8x16_s", "i16x8.extmul_high_i8x16_s", "i16x8.extmul_low_i8x16_u", "i16x8.extmul_high_i8x16_u", "i32x4.abs", "i32x4.neg", , "i32x4.all_true", "i32x4.bitmask", , , "i32x4.extend_low_i16x8_s", "i32x4.extend_high_i16x8_s", "i32x4.extend_low_i16x8_u", "i32x4.extend_high_i16x8_u", "i32x4.shl", "i32x4.shr_s", "i32x4.shr_u", "i32x4.add", , , "i32x4.sub", , , , "i32x4.mul", "i32x4.min_s", "i32x4.min_u", "i32x4.max_s", "i32x4.max_u", "i32x4.dot_i16x8_s", , "i32x4.extmul_low_i16x8_s", "i32x4.extmul_high_i16x8_s", "i32x4.extmul_low_i16x8_u", "i32x4.extmul_high_i16x8_u", "i64x2.abs", "i64x2.neg", , "i64x2.all_true", "i64x2.bitmask", , , "i64x2.extend_low_i32x4_s", "i64x2.extend_high_i32x4_s", "i64x2.extend_low_i32x4_u", "i64x2.extend_high_i32x4_u", "i64x2.shl", "i64x2.shr_s", "i64x2.shr_u", "i64x2.add", , , "i64x2.sub", , , , "i64x2.mul", "i64x2.eq", "i64x2.ne", "i64x2.lt_s", "i64x2.gt_s", "i64x2.le_s", "i64x2.ge_s", "i64x2.extmul_low_i32x4_s", "i64x2.extmul_high_i32x4_s", "i64x2.extmul_low_i32x4_u", "i64x2.extmul_high_i32x4_u", "f32x4.abs", "f32x4.neg", , "f32x4.sqrt", "f32x4.add", "f32x4.sub", "f32x4.mul", "f32x4.div", "f32x4.min", "f32x4.max", "f32x4.pmin", "f32x4.pmax", "f64x2.abs", "f64x2.neg", , "f64x2.sqrt", "f64x2.add", "f64x2.sub", "f64x2.mul", "f64x2.div", "f64x2.min", "f64x2.max", "f64x2.pmin", "f64x2.pmax", "i32x4.trunc_sat_f32x4_s", "i32x4.trunc_sat_f32x4_u", "f32x4.convert_i32x4_s", "f32x4.convert_i32x4_u", "i32x4.trunc_sat_f64x2_s_zero", "i32x4.trunc_sat_f64x2_u_zero", "f64x2.convert_low_i32x4_s", "f64x2.convert_low_i32x4_u"
],
  SECTION = { custom: 0, type: 1, import: 2, func: 3, table: 4, memory: 5, global: 6, export: 7, start: 8, elem: 9, code: 10, data: 11, datacount: 12 },
  TYPE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, void: 0x40, v128: 0x7B, func: 0x60, funcref: 0x70, externref: 0x6F },
  KIND = { func: 0, table: 1, memory: 2, global: 3 },
  // FIXME: replace with formula
  ALIGN = {
    'i32.load': 4, 'i64.load': 8, 'f32.load': 4, 'f64.load': 8,
    'i32.load8_s': 1, 'i32.load8_u': 1, 'i32.load16_s': 2, 'i32.load16_u': 2,
    'i64.load8_s': 1, 'i64.load8_u': 1, 'i64.load16_s': 2, 'i64.load16_u': 2, 'i64.load32_s': 4, 'i64.load32_u': 4, 'i32.store': 4,
    'i64.store': 8, 'f32.store': 4, 'f64.store': 8,
    'i32.store8': 1, 'i32.store16': 2, 'i64.store8': 1, 'i64.store16': 2, 'i64.store32': 4,

    'v128.load': 16, 'v128.load8x8_s': 8, 'v128.load8x8_u': 8, 'v128.load16x4_s': 8, 'v128.load16x4_u': 8, 'v128.load32x2_s': 8, 'v128.load32x2_u': 8, 'v128.load8_splat': 1, 'v128.load16_splat': 2, 'v128.load32_splat': 4, 'v128.load64_splat': 8, 'v128.store': 16,
    'v128.load': 16,

    "v128.load8_lane": 1, "v128.load16_lane": 2, "v128.load32_lane": 4, "v128.load64_lane": 8, "v128.store8_lane": 1, "v128.store16_lane": 2, "v128.store32_lane": 4, "v128.store64_lane": 8, "v128.load32_zero": 4, "v128.load64_zero": 8
  }
