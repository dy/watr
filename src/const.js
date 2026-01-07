// https://webassembly.github.io/spec/core/appendix/index-instructions.html
// Format: 'name', 'name imm', 'name handler' or 'name *'
// Immediate types: blocktype, labelidx, funcidx, typeidx, tableidx, memoryidx, globalidx, localidx, dataidx, elemidx
// Value types: i32, i64, f32, f64, v128
export const INSTR = [
  // 0x00-0x1a: control
  'unreachable', 'nop', 'block block', 'loop block', 'if block', 'else null', 'then null', , , , ,
  'end end', 'br labelidx', 'br_if labelidx', 'br_table br_table', 'return', 'call funcidx', 'call_indirect call_indirect', 'return_call funcidx', 'return_call_indirect call_indirect', 'call_ref typeidx', 'return_call_ref typeidx', , , , ,
  // 0x1a-0x1f: parametric
  'drop', 'select select', '', , , ,
  // 0x20-0x27: variable
  'local.get localidx', 'local.set localidx', 'local.tee localidx', 'global.get globalidx', 'global.set globalidx', 'table.get tableidx', 'table.set tableidx', ,
  // 0x28-0x3e: memory
  'i32.load memarg', 'i64.load memarg', 'f32.load memarg', 'f64.load memarg',
  'i32.load8_s memarg', 'i32.load8_u memarg', 'i32.load16_s memarg', 'i32.load16_u memarg',
  'i64.load8_s memarg', 'i64.load8_u memarg', 'i64.load16_s memarg', 'i64.load16_u memarg', 'i64.load32_s memarg', 'i64.load32_u memarg',
  'i32.store memarg', 'i64.store memarg', 'f32.store memarg', 'f64.store memarg',
  'i32.store8 memarg', 'i32.store16 memarg', 'i64.store8 memarg', 'i64.store16 memarg', 'i64.store32 memarg',
  // 0x3f-0x40: memory size/grow
  'memory.size opt_memory', 'memory.grow opt_memory',
  // 0x41-0x44: const
  'i32.const i32', 'i64.const i64', 'f32.const f32', 'f64.const f64',
  // 0x45-0x4f: i32 comparison
  'i32.eqz', 'i32.eq', 'i32.ne', 'i32.lt_s', 'i32.lt_u', 'i32.gt_s', 'i32.gt_u', 'i32.le_s', 'i32.le_u', 'i32.ge_s', 'i32.ge_u',
  // 0x50-0x5a: i64 comparison
  'i64.eqz', 'i64.eq', 'i64.ne', 'i64.lt_s', 'i64.lt_u', 'i64.gt_s', 'i64.gt_u', 'i64.le_s', 'i64.le_u', 'i64.ge_s', 'i64.ge_u',
  // 0x5b-0x60: f32 comparison
  'f32.eq', 'f32.ne', 'f32.lt', 'f32.gt', 'f32.le', 'f32.ge',
  // 0x61-0x66: f64 comparison
  'f64.eq', 'f64.ne', 'f64.lt', 'f64.gt', 'f64.le', 'f64.ge',
  // 0x67-0x78: i32 arithmetic
  'i32.clz', 'i32.ctz', 'i32.popcnt', 'i32.add', 'i32.sub', 'i32.mul', 'i32.div_s', 'i32.div_u', 'i32.rem_s', 'i32.rem_u', 'i32.and', 'i32.or', 'i32.xor', 'i32.shl', 'i32.shr_s', 'i32.shr_u', 'i32.rotl', 'i32.rotr',
  // 0x79-0x8a: i64 arithmetic
  'i64.clz', 'i64.ctz', 'i64.popcnt', 'i64.add', 'i64.sub', 'i64.mul', 'i64.div_s', 'i64.div_u', 'i64.rem_s', 'i64.rem_u', 'i64.and', 'i64.or', 'i64.xor', 'i64.shl', 'i64.shr_s', 'i64.shr_u', 'i64.rotl', 'i64.rotr',
  // 0x8b-0x98: f32 arithmetic
  'f32.abs', 'f32.neg', 'f32.ceil', 'f32.floor', 'f32.trunc', 'f32.nearest', 'f32.sqrt', 'f32.add', 'f32.sub', 'f32.mul', 'f32.div', 'f32.min', 'f32.max', 'f32.copysign',
  // 0x99-0xa6: f64 arithmetic
  'f64.abs', 'f64.neg', 'f64.ceil', 'f64.floor', 'f64.trunc', 'f64.nearest', 'f64.sqrt', 'f64.add', 'f64.sub', 'f64.mul', 'f64.div', 'f64.min', 'f64.max', 'f64.copysign',
  // 0xa7-0xc4: conversions (no immediates)
  'i32.wrap_i64',
  'i32.trunc_f32_s', 'i32.trunc_f32_u', 'i32.trunc_f64_s', 'i32.trunc_f64_u', 'i64.extend_i32_s', 'i64.extend_i32_u',
  'i64.trunc_f32_s', 'i64.trunc_f32_u', 'i64.trunc_f64_s', 'i64.trunc_f64_u',
  'f32.convert_i32_s', 'f32.convert_i32_u', 'f32.convert_i64_s', 'f32.convert_i64_u', 'f32.demote_f64',
  'f64.convert_i32_s', 'f64.convert_i32_u', 'f64.convert_i64_s', 'f64.convert_i64_u', 'f64.promote_f32',
  'i32.reinterpret_f32', 'i64.reinterpret_f64', 'f32.reinterpret_i32', 'f64.reinterpret_i64',
  // 0xc0-0xc4: sign extension
  'i32.extend8_s', 'i32.extend16_s', 'i64.extend8_s', 'i64.extend16_s', 'i64.extend32_s', , , , , , , , , , , ,
  // 0xd0-0xd6: reference
  'ref.null ref_null', 'ref.is_null', 'ref.func funcidx', 'ref.eq', 'ref.as_non_null', 'br_on_null labelidx', 'br_on_non_null labelidx',
  // 0xd7-0xfa: padding to 0xfb (36 empty slots)
  , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , ,
  // 0xfb: GC instructions (nested array for multi-byte opcodes)
  [
    'struct.new typeidx', 'struct.new_default typeidx', 'struct.get typeidx field', 'struct.get_s typeidx field', 'struct.get_u typeidx field', 'struct.set typeidx field',
    'array.new typeidx', 'array.new_default typeidx', 'array.new_fixed typeidx *', 'array.new_data typeidx dataidx', 'array.new_elem typeidx elemidx',
    'array.get typeidx', 'array.get_s typeidx', 'array.get_u typeidx', 'array.set typeidx', 'array.len', 'array.fill typeidx', 'array.copy typeidx typeidx',
    'array.init_data typeidx dataidx', 'array.init_elem typeidx elemidx', 'ref.test reftype', '', 'ref.cast reftype', '', 'br_on_cast reftype2', 'br_on_cast_fail reftype2',
    'any.convert_extern', 'extern.convert_any', 'ref.i31', 'i31.get_s', 'i31.get_u'
  ],

  // 0xfc: Bulk memory/table operations (nested array)
  [
    'i32.trunc_sat_f32_s', 'i32.trunc_sat_f32_u', 'i32.trunc_sat_f64_s', 'i32.trunc_sat_f64_u',
    'i64.trunc_sat_f32_s', 'i64.trunc_sat_f32_u', 'i64.trunc_sat_f64_s', 'i64.trunc_sat_f64_u',
    'memory.init dataidx memoryidx', 'data.drop dataidx', 'memory.copy memoryidx memoryidx', 'memory.fill ?memoryidx',
    'table.init reversed', 'elem.drop elemidx', 'table.copy tableidx tableidx', 'table.grow tableidx', 'table.size tableidx', 'table.fill tableidx', ,
    'i64.add128', 'i64.sub128', 'i64.mul_wide_s', 'i64.mul_wide_u'
  ],

  // 0xfd: SIMD instructions (nested array)
  [
    'v128.load memarg', 'v128.load8x8_s memarg', 'v128.load8x8_u memarg', 'v128.load16x4_s memarg', 'v128.load16x4_u memarg',
    'v128.load32x2_s memarg', 'v128.load32x2_u memarg', 'v128.load8_splat memarg', 'v128.load16_splat memarg', 'v128.load32_splat memarg',
    'v128.load64_splat memarg', 'v128.store memarg', 'v128.const v128const', 'i8x16.shuffle shuffle',
    'i8x16.swizzle', 'i8x16.splat', 'i16x8.splat', 'i32x4.splat', 'i64x2.splat', 'f32x4.splat', 'f64x2.splat',
    'i8x16.extract_lane_s laneidx', 'i8x16.extract_lane_u laneidx', 'i8x16.replace_lane laneidx',
    'i16x8.extract_lane_s laneidx', 'i16x8.extract_lane_u laneidx', 'i16x8.replace_lane laneidx',
    'i32x4.extract_lane laneidx', 'i32x4.replace_lane laneidx', 'i64x2.extract_lane laneidx', 'i64x2.replace_lane laneidx',
    'f32x4.extract_lane laneidx', 'f32x4.replace_lane laneidx', 'f64x2.extract_lane laneidx', 'f64x2.replace_lane laneidx',
    'i8x16.eq', 'i8x16.ne', 'i8x16.lt_s', 'i8x16.lt_u', 'i8x16.gt_s', 'i8x16.gt_u', 'i8x16.le_s', 'i8x16.le_u', 'i8x16.ge_s', 'i8x16.ge_u',
    'i16x8.eq', 'i16x8.ne', 'i16x8.lt_s', 'i16x8.lt_u', 'i16x8.gt_s', 'i16x8.gt_u', 'i16x8.le_s', 'i16x8.le_u', 'i16x8.ge_s', 'i16x8.ge_u',
    'i32x4.eq', 'i32x4.ne', 'i32x4.lt_s', 'i32x4.lt_u', 'i32x4.gt_s', 'i32x4.gt_u', 'i32x4.le_s', 'i32x4.le_u', 'i32x4.ge_s', 'i32x4.ge_u',
    'f32x4.eq', 'f32x4.ne', 'f32x4.lt', 'f32x4.gt', 'f32x4.le', 'f32x4.ge', 'f64x2.eq', 'f64x2.ne', 'f64x2.lt', 'f64x2.gt', 'f64x2.le', 'f64x2.ge',
    'v128.not', 'v128.and', 'v128.andnot', 'v128.or', 'v128.xor', 'v128.bitselect', 'v128.any_true',
    'v128.load8_lane memlane', 'v128.load16_lane memlane', 'v128.load32_lane memlane', 'v128.load64_lane memlane',
    'v128.store8_lane memlane', 'v128.store16_lane memlane', 'v128.store32_lane memlane', 'v128.store64_lane memlane',
    'v128.load32_zero memarg', 'v128.load64_zero memarg', 'f32x4.demote_f64x2_zero', 'f64x2.promote_low_f32x4',
    'i8x16.abs', 'i8x16.neg', 'i8x16.popcnt', 'i8x16.all_true', 'i8x16.bitmask', 'i8x16.narrow_i16x8_s', 'i8x16.narrow_i16x8_u',
    'f32x4.ceil', 'f32x4.floor', 'f32x4.trunc', 'f32x4.nearest', 'i8x16.shl', 'i8x16.shr_s', 'i8x16.shr_u',
    'i8x16.add', 'i8x16.add_sat_s', 'i8x16.add_sat_u', 'i8x16.sub', 'i8x16.sub_sat_s', 'i8x16.sub_sat_u',
    'f64x2.ceil', 'f64x2.floor', 'i8x16.min_s', 'i8x16.min_u', 'i8x16.max_s', 'i8x16.max_u', 'f64x2.trunc', 'i8x16.avgr_u',
    'i16x8.extadd_pairwise_i8x16_s', 'i16x8.extadd_pairwise_i8x16_u', 'i32x4.extadd_pairwise_i16x8_s', 'i32x4.extadd_pairwise_i16x8_u',
    'i16x8.abs', 'i16x8.neg', 'i16x8.q15mulr_sat_s', 'i16x8.all_true', 'i16x8.bitmask', 'i16x8.narrow_i32x4_s', 'i16x8.narrow_i32x4_u',
    'i16x8.extend_low_i8x16_s', 'i16x8.extend_high_i8x16_s', 'i16x8.extend_low_i8x16_u', 'i16x8.extend_high_i8x16_u',
    'i16x8.shl', 'i16x8.shr_s', 'i16x8.shr_u', 'i16x8.add', 'i16x8.add_sat_s', 'i16x8.add_sat_u', 'i16x8.sub', 'i16x8.sub_sat_s', 'i16x8.sub_sat_u',
    'f64x2.nearest', 'i16x8.mul', 'i16x8.min_s', 'i16x8.min_u', 'i16x8.max_s', 'i16x8.max_u', , 'i16x8.avgr_u',
    'i16x8.extmul_low_i8x16_s', 'i16x8.extmul_high_i8x16_s', 'i16x8.extmul_low_i8x16_u', 'i16x8.extmul_high_i8x16_u',
    'i32x4.abs', 'i32x4.neg', , 'i32x4.all_true', 'i32x4.bitmask', , , 'i32x4.extend_low_i16x8_s', 'i32x4.extend_high_i16x8_s',
    'i32x4.extend_low_i16x8_u', 'i32x4.extend_high_i16x8_u', 'i32x4.shl', 'i32x4.shr_s', 'i32x4.shr_u', 'i32x4.add', , , 'i32x4.sub', , , ,
    'i32x4.mul', 'i32x4.min_s', 'i32x4.min_u', 'i32x4.max_s', 'i32x4.max_u', 'i32x4.dot_i16x8_s', ,
    'i32x4.extmul_low_i16x8_s', 'i32x4.extmul_high_i16x8_s', 'i32x4.extmul_low_i16x8_u', 'i32x4.extmul_high_i16x8_u',
    'i64x2.abs', 'i64x2.neg', , 'i64x2.all_true', 'i64x2.bitmask', , , 'i64x2.extend_low_i32x4_s', 'i64x2.extend_high_i32x4_s',
    'i64x2.extend_low_i32x4_u', 'i64x2.extend_high_i32x4_u', 'i64x2.shl', 'i64x2.shr_s', 'i64x2.shr_u', 'i64x2.add', , , 'i64x2.sub', , , ,
    'i64x2.mul', 'i64x2.eq', 'i64x2.ne', 'i64x2.lt_s', 'i64x2.gt_s', 'i64x2.le_s', 'i64x2.ge_s',
    'i64x2.extmul_low_i32x4_s', 'i64x2.extmul_high_i32x4_s', 'i64x2.extmul_low_i32x4_u', 'i64x2.extmul_high_i32x4_u',
    'f32x4.abs', 'f32x4.neg', , 'f32x4.sqrt', 'f32x4.add', 'f32x4.sub', 'f32x4.mul', 'f32x4.div', 'f32x4.min', 'f32x4.max', 'f32x4.pmin', 'f32x4.pmax',
    'f64x2.abs', 'f64x2.neg', , 'f64x2.sqrt', 'f64x2.add', 'f64x2.sub', 'f64x2.mul', 'f64x2.div', 'f64x2.min', 'f64x2.max', 'f64x2.pmin', 'f64x2.pmax',
    'i32x4.trunc_sat_f32x4_s', 'i32x4.trunc_sat_f32x4_u', 'f32x4.convert_i32x4_s', 'f32x4.convert_i32x4_u',
    'i32x4.trunc_sat_f64x2_s_zero', 'i32x4.trunc_sat_f64x2_u_zero', 'f64x2.convert_low_i32x4_s', 'f64x2.convert_low_i32x4_u',
    'i8x16.relaxed_swizzle', 'i32x4.relaxed_trunc_f32x4_s', 'i32x4.relaxed_trunc_f32x4_u', 'i32x4.relaxed_trunc_f64x2_s_zero',
    'i32x4.relaxed_trunc_f64x2_u_zero', 'f32x4.relaxed_madd', 'f32x4.relaxed_nmadd', 'f64x2.relaxed_madd', 'f64x2.relaxed_nmadd',
    'i8x16.relaxed_laneselect', 'i16x8.relaxed_laneselect', 'i32x4.relaxed_laneselect', 'i64x2.relaxed_laneselect',
    'f32x4.relaxed_min', 'f32x4.relaxed_max', 'f64x2.relaxed_min', 'f64x2.relaxed_max',
    'i16x8.relaxed_q15mulr_s', 'i16x8.relaxed_dot_i8x16_i7x16_s', 'i32x4.relaxed_dot_i8x16_i7x16_add_s'
  ]
]

// Binary section type codes
export const SECTION = { custom: 0, type: 1, import: 2, func: 3, table: 4, memory: 5, tag: 13, global: 6, export: 7, start: 8, elem: 9, datacount: 12, code: 10, data: 11 }

// Recursion group opcodes
export const RECTYPE = { sub: 0x50, subfinal: 0x4F, rec: 0x4E }

// Type definition opcodes
export const DEFTYPE = { func: 0x60, struct: 0x5F, array: 0x5E, ...RECTYPE }

// Heap type codes for GC
export const HEAPTYPE = { exn: 0x75, noexn: 0x74, nofunc: 0x73, noextern: 0x72, none: 0x71, func: 0x70, extern: 0x6F, any: 0x6E, eq: 0x6D, i31: 0x6C, struct: 0x6B, array: 0x6A }

// Reference type codes and abbreviations
export const REFTYPE = {
    // absheaptype abbrs
    nullfuncref: HEAPTYPE.nofunc,
    nullexternref: HEAPTYPE.noextern,
    nullexnref: HEAPTYPE.noexn,
    nullref: HEAPTYPE.none,
    funcref: HEAPTYPE.func,
    externref: HEAPTYPE.extern,
    exnref: HEAPTYPE.exn,
    anyref: HEAPTYPE.any,
    eqref: HEAPTYPE.eq,
    i31ref: HEAPTYPE.i31,
    structref: HEAPTYPE.struct,
    arrayref: HEAPTYPE.array,

    // ref, refnull
    ref: 0x64 /* -0x1c */, refnull: 0x63 /* -0x1d */
  }

// Value type codes (primitives + references)
export const TYPE = { i8: 0x78, i16: 0x77, i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, void: 0x40, v128: 0x7B, ...HEAPTYPE, ...REFTYPE }

// Import/export kind codes
export const KIND = { func: 0, table: 1, memory: 2, global: 3, tag: 4 }
