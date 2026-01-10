var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/encode.js
var encode_exports = {};
__export(encode_exports, {
  f32: () => f32,
  f64: () => f64,
  i16: () => i16,
  i32: () => i32,
  i64: () => i64,
  i8: () => i8,
  uleb: () => uleb,
  uleb5: () => uleb5
});

// src/util.js
var err = (text, pos = err.i) => {
  if (pos != null && err.src) {
    let line = 1, col = 1;
    for (let i = 0; i < pos && i < err.src.length; i++) {
      if (err.src[i] === "\n") line++, col = 1;
      else col++;
    }
    text += ` at ${line}:${col}`;
  }
  throw Error(text);
};
var sepRE = /^_|_$|[^\da-f]_|_[^\da-f]/i;
var intRE = /^[+-]?(?:0x[\da-f]+|\d+)$/i;
var tenc = new TextEncoder();
var tdec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
var escape = { n: 10, r: 13, t: 9, '"': 34, "'": 39, "\\": 92 };
var str = (s) => {
  let bytes = [], i = 1, code, c, buf = "";
  const commit = () => (buf && bytes.push(...tenc.encode(buf)), buf = "");
  while (i < s.length - 1) {
    c = s[i++], code = null;
    if (c === "\\") {
      if (s[i] === "u") {
        i++, i++;
        c = String.fromCodePoint(parseInt(s.slice(i, i = s.indexOf("}", i)), 16));
        i++;
      } else if (escape[s[i]]) code = escape[s[i++]];
      else if (!isNaN(code = parseInt(s[i] + s[i + 1], 16))) i++, i++;
      else c += s[i];
    }
    code != null ? (commit(), bytes.push(code)) : buf += c;
  }
  commit();
  bytes.valueOf = () => s;
  return bytes;
};
var unescape = (s) => tdec.decode(new Uint8Array(str(s)));

// src/encode.js
var uleb = (n, buffer = []) => {
  if (n == null) return buffer;
  if (typeof n === "string") n = /[_x]/i.test(n) ? BigInt(n.replaceAll("_", "")) : i32.parse(n);
  if (typeof n === "bigint") {
    while (true) {
      const byte2 = Number(n & 0x7Fn);
      n >>= 7n;
      if (n === 0n) {
        buffer.push(byte2);
        break;
      }
      buffer.push(byte2 | 128);
    }
    return buffer;
  }
  let byte = n & 127;
  n >>>= 7;
  if (n === 0) {
    buffer.push(byte);
    return buffer;
  }
  buffer.push(byte | 128);
  return uleb(n, buffer);
};
function uleb5(value) {
  const result = [];
  for (let i = 0; i < 5; i++) {
    let byte = value & 127;
    value >>>= 7;
    if (i < 4) {
      byte |= 128;
    }
    result.push(byte);
  }
  return result;
}
function i32(n, buffer = []) {
  if (typeof n === "string") n = i32.parse(n);
  while (true) {
    const byte = Number(n & 127);
    n >>= 7;
    if (n === 0 && (byte & 64) === 0 || n === -1 && (byte & 64) !== 0) {
      buffer.push(byte);
      break;
    }
    buffer.push(byte | 128);
  }
  return buffer;
}
var cleanInt = (v) => !sepRE.test(v) && intRE.test(v = v.replaceAll("_", "")) ? v : err(`Bad int ${v}`);
var i8 = i32;
var i16 = i32;
i32.parse = (n) => {
  n = parseInt(cleanInt(n));
  if (n < -2147483648 || n > 4294967295) err(`i32 constant out of range`);
  return n;
};
function i64(n, buffer = []) {
  if (typeof n === "string") n = i64.parse(n);
  while (true) {
    const byte = Number(n & 0x7Fn);
    n >>= 7n;
    if (n === 0n && (byte & 64) === 0 || n === -1n && (byte & 64) !== 0) {
      buffer.push(byte);
      break;
    }
    buffer.push(byte | 128);
  }
  return buffer;
}
i64.parse = (n) => {
  n = cleanInt(n);
  n = n[0] === "-" ? -BigInt(n.slice(1)) : BigInt(n);
  if (n < -0x8000000000000000n || n > 0xffffffffffffffffn) err(`i64 constant out of range`);
  byteView.setBigInt64(0, n);
  return byteView.getBigInt64(0);
};
var byteView = new DataView(new Float64Array(1).buffer);
var F32_SIGN = 2147483648;
var F32_NAN = 2139095040;
function f32(input, value, idx) {
  if (typeof input === "string" && ~(idx = input.indexOf("nan:"))) {
    value = i32.parse(input.slice(idx + 4));
    value |= F32_NAN;
    if (input[0] === "-") value |= F32_SIGN;
    byteView.setInt32(0, value);
  } else {
    value = typeof input === "string" ? f32.parse(input) : input;
    byteView.setFloat32(0, value);
  }
  return [
    byteView.getUint8(3),
    byteView.getUint8(2),
    byteView.getUint8(1),
    byteView.getUint8(0)
  ];
}
var F64_SIGN = 0x8000000000000000n;
var F64_NAN = 0x7ff0000000000000n;
function f64(input, value, idx) {
  if (typeof input === "string" && ~(idx = input.indexOf("nan:"))) {
    value = i64.parse(input.slice(idx + 4));
    value |= F64_NAN;
    if (input[0] === "-") value |= F64_SIGN;
    byteView.setBigInt64(0, value);
  } else {
    value = typeof input === "string" ? f64.parse(input) : input;
    byteView.setFloat64(0, value);
  }
  return [
    byteView.getUint8(7),
    byteView.getUint8(6),
    byteView.getUint8(5),
    byteView.getUint8(4),
    byteView.getUint8(3),
    byteView.getUint8(2),
    byteView.getUint8(1),
    byteView.getUint8(0)
  ];
}
f64.parse = (input, max = Number.MAX_VALUE) => {
  input = input.replaceAll("_", "");
  let sign = 1;
  if (input[0] === "-") sign = -1, input = input.slice(1);
  else if (input[0] === "+") input = input.slice(1);
  if (input[1] === "x") {
    let [sig, exp = "0"] = input.split(/p/i);
    let [int, fract = ""] = sig.split(".");
    let flen = fract.length ?? 0;
    let intVal = parseInt(int);
    isNaN(intVal) && err();
    let fractVal = fract ? parseInt("0x" + fract) / 16 ** flen : 0;
    exp = parseInt(exp, 10);
    let value = sign * (intVal + fractVal) * 2 ** exp;
    value = Math.max(-max, Math.min(max, value));
    return value;
  }
  if (input.includes("nan")) return sign < 0 ? NaN : NaN;
  if (input.includes("inf")) return sign * Infinity;
  return sign * parseFloat(input);
};
f32.parse = (input) => f64.parse(input, 34028234663852886e22);

// src/const.js
var INSTR = [
  // 0x00-0x0a: control
  "unreachable",
  "nop",
  "block block",
  "loop block",
  "if block",
  "else null",
  "then null",
  ,
  "throw tagidx",
  ,
  "throw_ref",
  // 0x0b-0x19: control
  "end end",
  "br labelidx",
  "br_if labelidx",
  "br_table br_table",
  "return",
  "call funcidx",
  "call_indirect call_indirect",
  "return_call funcidx",
  "return_call_indirect call_indirect",
  "call_ref typeidx",
  "return_call_ref typeidx",
  ,
  ,
  ,
  ,
  // 0x1a-0x1f: parametric
  "drop",
  "select select",
  "",
  ,
  ,
  "try_table try_table",
  // 0x20-0x27: variable
  "local.get localidx",
  "local.set localidx",
  "local.tee localidx",
  "global.get globalidx",
  "global.set globalidx",
  "table.get tableidx",
  "table.set tableidx",
  ,
  // 0x28-0x3e: memory
  "i32.load memarg",
  "i64.load memarg",
  "f32.load memarg",
  "f64.load memarg",
  "i32.load8_s memarg",
  "i32.load8_u memarg",
  "i32.load16_s memarg",
  "i32.load16_u memarg",
  "i64.load8_s memarg",
  "i64.load8_u memarg",
  "i64.load16_s memarg",
  "i64.load16_u memarg",
  "i64.load32_s memarg",
  "i64.load32_u memarg",
  "i32.store memarg",
  "i64.store memarg",
  "f32.store memarg",
  "f64.store memarg",
  "i32.store8 memarg",
  "i32.store16 memarg",
  "i64.store8 memarg",
  "i64.store16 memarg",
  "i64.store32 memarg",
  // 0x3f-0x40: memory size/grow
  "memory.size opt_memory",
  "memory.grow opt_memory",
  // 0x41-0x44: const
  "i32.const i32",
  "i64.const i64",
  "f32.const f32",
  "f64.const f64",
  // 0x45-0x4f: i32 comparison
  "i32.eqz",
  "i32.eq",
  "i32.ne",
  "i32.lt_s",
  "i32.lt_u",
  "i32.gt_s",
  "i32.gt_u",
  "i32.le_s",
  "i32.le_u",
  "i32.ge_s",
  "i32.ge_u",
  // 0x50-0x5a: i64 comparison
  "i64.eqz",
  "i64.eq",
  "i64.ne",
  "i64.lt_s",
  "i64.lt_u",
  "i64.gt_s",
  "i64.gt_u",
  "i64.le_s",
  "i64.le_u",
  "i64.ge_s",
  "i64.ge_u",
  // 0x5b-0x60: f32 comparison
  "f32.eq",
  "f32.ne",
  "f32.lt",
  "f32.gt",
  "f32.le",
  "f32.ge",
  // 0x61-0x66: f64 comparison
  "f64.eq",
  "f64.ne",
  "f64.lt",
  "f64.gt",
  "f64.le",
  "f64.ge",
  // 0x67-0x78: i32 arithmetic
  "i32.clz",
  "i32.ctz",
  "i32.popcnt",
  "i32.add",
  "i32.sub",
  "i32.mul",
  "i32.div_s",
  "i32.div_u",
  "i32.rem_s",
  "i32.rem_u",
  "i32.and",
  "i32.or",
  "i32.xor",
  "i32.shl",
  "i32.shr_s",
  "i32.shr_u",
  "i32.rotl",
  "i32.rotr",
  // 0x79-0x8a: i64 arithmetic
  "i64.clz",
  "i64.ctz",
  "i64.popcnt",
  "i64.add",
  "i64.sub",
  "i64.mul",
  "i64.div_s",
  "i64.div_u",
  "i64.rem_s",
  "i64.rem_u",
  "i64.and",
  "i64.or",
  "i64.xor",
  "i64.shl",
  "i64.shr_s",
  "i64.shr_u",
  "i64.rotl",
  "i64.rotr",
  // 0x8b-0x98: f32 arithmetic
  "f32.abs",
  "f32.neg",
  "f32.ceil",
  "f32.floor",
  "f32.trunc",
  "f32.nearest",
  "f32.sqrt",
  "f32.add",
  "f32.sub",
  "f32.mul",
  "f32.div",
  "f32.min",
  "f32.max",
  "f32.copysign",
  // 0x99-0xa6: f64 arithmetic
  "f64.abs",
  "f64.neg",
  "f64.ceil",
  "f64.floor",
  "f64.trunc",
  "f64.nearest",
  "f64.sqrt",
  "f64.add",
  "f64.sub",
  "f64.mul",
  "f64.div",
  "f64.min",
  "f64.max",
  "f64.copysign",
  // 0xa7-0xc4: conversions (no immediates)
  "i32.wrap_i64",
  "i32.trunc_f32_s",
  "i32.trunc_f32_u",
  "i32.trunc_f64_s",
  "i32.trunc_f64_u",
  "i64.extend_i32_s",
  "i64.extend_i32_u",
  "i64.trunc_f32_s",
  "i64.trunc_f32_u",
  "i64.trunc_f64_s",
  "i64.trunc_f64_u",
  "f32.convert_i32_s",
  "f32.convert_i32_u",
  "f32.convert_i64_s",
  "f32.convert_i64_u",
  "f32.demote_f64",
  "f64.convert_i32_s",
  "f64.convert_i32_u",
  "f64.convert_i64_s",
  "f64.convert_i64_u",
  "f64.promote_f32",
  "i32.reinterpret_f32",
  "i64.reinterpret_f64",
  "f32.reinterpret_i32",
  "f64.reinterpret_i64",
  // 0xc0-0xc4: sign extension
  "i32.extend8_s",
  "i32.extend16_s",
  "i64.extend8_s",
  "i64.extend16_s",
  "i64.extend32_s",
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  // 0xd0-0xd6: reference
  "ref.null ref_null",
  "ref.is_null",
  "ref.func funcidx",
  "ref.eq",
  "ref.as_non_null",
  "br_on_null labelidx",
  "br_on_non_null labelidx",
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  // 0xfb: GC instructions (nested array for multi-byte opcodes)
  [
    "struct.new typeidx",
    "struct.new_default typeidx",
    "struct.get typeidx_field",
    "struct.get_s typeidx_field",
    "struct.get_u typeidx_field",
    "struct.set typeidx_field",
    "array.new typeidx",
    "array.new_default typeidx",
    "array.new_fixed typeidx_multi",
    "array.new_data typeidx_dataidx",
    "array.new_elem typeidx_elemidx",
    "array.get typeidx",
    "array.get_s typeidx",
    "array.get_u typeidx",
    "array.set typeidx",
    "array.len",
    "array.fill typeidx",
    "array.copy typeidx_typeidx",
    "array.init_data typeidx_dataidx",
    "array.init_elem typeidx_elemidx",
    "ref.test reftype",
    "",
    "ref.cast reftype",
    "",
    "br_on_cast reftype2",
    "br_on_cast_fail reftype2",
    "any.convert_extern",
    "extern.convert_any",
    "ref.i31",
    "i31.get_s",
    "i31.get_u"
  ],
  // 0xfc: Bulk memory/table operations (nested array)
  [
    "i32.trunc_sat_f32_s",
    "i32.trunc_sat_f32_u",
    "i32.trunc_sat_f64_s",
    "i32.trunc_sat_f64_u",
    "i64.trunc_sat_f32_s",
    "i64.trunc_sat_f32_u",
    "i64.trunc_sat_f64_s",
    "i64.trunc_sat_f64_u",
    "memory.init dataidx_memoryidx",
    "data.drop dataidx",
    "memory.copy memoryidx_memoryidx",
    "memory.fill memoryidx?",
    "table.init reversed",
    "elem.drop elemidx",
    "table.copy tableidx_tableidx",
    "table.grow tableidx",
    "table.size tableidx",
    "table.fill tableidx",
    ,
    "i64.add128",
    "i64.sub128",
    "i64.mul_wide_s",
    "i64.mul_wide_u"
  ],
  // 0xfd: SIMD instructions (nested array)
  [
    "v128.load memarg",
    "v128.load8x8_s memarg",
    "v128.load8x8_u memarg",
    "v128.load16x4_s memarg",
    "v128.load16x4_u memarg",
    "v128.load32x2_s memarg",
    "v128.load32x2_u memarg",
    "v128.load8_splat memarg",
    "v128.load16_splat memarg",
    "v128.load32_splat memarg",
    "v128.load64_splat memarg",
    "v128.store memarg",
    "v128.const v128const",
    "i8x16.shuffle shuffle",
    "i8x16.swizzle",
    "i8x16.splat",
    "i16x8.splat",
    "i32x4.splat",
    "i64x2.splat",
    "f32x4.splat",
    "f64x2.splat",
    "i8x16.extract_lane_s laneidx",
    "i8x16.extract_lane_u laneidx",
    "i8x16.replace_lane laneidx",
    "i16x8.extract_lane_s laneidx",
    "i16x8.extract_lane_u laneidx",
    "i16x8.replace_lane laneidx",
    "i32x4.extract_lane laneidx",
    "i32x4.replace_lane laneidx",
    "i64x2.extract_lane laneidx",
    "i64x2.replace_lane laneidx",
    "f32x4.extract_lane laneidx",
    "f32x4.replace_lane laneidx",
    "f64x2.extract_lane laneidx",
    "f64x2.replace_lane laneidx",
    "i8x16.eq",
    "i8x16.ne",
    "i8x16.lt_s",
    "i8x16.lt_u",
    "i8x16.gt_s",
    "i8x16.gt_u",
    "i8x16.le_s",
    "i8x16.le_u",
    "i8x16.ge_s",
    "i8x16.ge_u",
    "i16x8.eq",
    "i16x8.ne",
    "i16x8.lt_s",
    "i16x8.lt_u",
    "i16x8.gt_s",
    "i16x8.gt_u",
    "i16x8.le_s",
    "i16x8.le_u",
    "i16x8.ge_s",
    "i16x8.ge_u",
    "i32x4.eq",
    "i32x4.ne",
    "i32x4.lt_s",
    "i32x4.lt_u",
    "i32x4.gt_s",
    "i32x4.gt_u",
    "i32x4.le_s",
    "i32x4.le_u",
    "i32x4.ge_s",
    "i32x4.ge_u",
    "f32x4.eq",
    "f32x4.ne",
    "f32x4.lt",
    "f32x4.gt",
    "f32x4.le",
    "f32x4.ge",
    "f64x2.eq",
    "f64x2.ne",
    "f64x2.lt",
    "f64x2.gt",
    "f64x2.le",
    "f64x2.ge",
    "v128.not",
    "v128.and",
    "v128.andnot",
    "v128.or",
    "v128.xor",
    "v128.bitselect",
    "v128.any_true",
    "v128.load8_lane memlane",
    "v128.load16_lane memlane",
    "v128.load32_lane memlane",
    "v128.load64_lane memlane",
    "v128.store8_lane memlane",
    "v128.store16_lane memlane",
    "v128.store32_lane memlane",
    "v128.store64_lane memlane",
    "v128.load32_zero memarg",
    "v128.load64_zero memarg",
    "f32x4.demote_f64x2_zero",
    "f64x2.promote_low_f32x4",
    "i8x16.abs",
    "i8x16.neg",
    "i8x16.popcnt",
    "i8x16.all_true",
    "i8x16.bitmask",
    "i8x16.narrow_i16x8_s",
    "i8x16.narrow_i16x8_u",
    "f32x4.ceil",
    "f32x4.floor",
    "f32x4.trunc",
    "f32x4.nearest",
    "i8x16.shl",
    "i8x16.shr_s",
    "i8x16.shr_u",
    "i8x16.add",
    "i8x16.add_sat_s",
    "i8x16.add_sat_u",
    "i8x16.sub",
    "i8x16.sub_sat_s",
    "i8x16.sub_sat_u",
    "f64x2.ceil",
    "f64x2.floor",
    "i8x16.min_s",
    "i8x16.min_u",
    "i8x16.max_s",
    "i8x16.max_u",
    "f64x2.trunc",
    "i8x16.avgr_u",
    "i16x8.extadd_pairwise_i8x16_s",
    "i16x8.extadd_pairwise_i8x16_u",
    "i32x4.extadd_pairwise_i16x8_s",
    "i32x4.extadd_pairwise_i16x8_u",
    "i16x8.abs",
    "i16x8.neg",
    "i16x8.q15mulr_sat_s",
    "i16x8.all_true",
    "i16x8.bitmask",
    "i16x8.narrow_i32x4_s",
    "i16x8.narrow_i32x4_u",
    "i16x8.extend_low_i8x16_s",
    "i16x8.extend_high_i8x16_s",
    "i16x8.extend_low_i8x16_u",
    "i16x8.extend_high_i8x16_u",
    "i16x8.shl",
    "i16x8.shr_s",
    "i16x8.shr_u",
    "i16x8.add",
    "i16x8.add_sat_s",
    "i16x8.add_sat_u",
    "i16x8.sub",
    "i16x8.sub_sat_s",
    "i16x8.sub_sat_u",
    "f64x2.nearest",
    "i16x8.mul",
    "i16x8.min_s",
    "i16x8.min_u",
    "i16x8.max_s",
    "i16x8.max_u",
    ,
    "i16x8.avgr_u",
    "i16x8.extmul_low_i8x16_s",
    "i16x8.extmul_high_i8x16_s",
    "i16x8.extmul_low_i8x16_u",
    "i16x8.extmul_high_i8x16_u",
    "i32x4.abs",
    "i32x4.neg",
    ,
    "i32x4.all_true",
    "i32x4.bitmask",
    ,
    ,
    "i32x4.extend_low_i16x8_s",
    "i32x4.extend_high_i16x8_s",
    "i32x4.extend_low_i16x8_u",
    "i32x4.extend_high_i16x8_u",
    "i32x4.shl",
    "i32x4.shr_s",
    "i32x4.shr_u",
    "i32x4.add",
    ,
    ,
    "i32x4.sub",
    ,
    ,
    ,
    "i32x4.mul",
    "i32x4.min_s",
    "i32x4.min_u",
    "i32x4.max_s",
    "i32x4.max_u",
    "i32x4.dot_i16x8_s",
    ,
    "i32x4.extmul_low_i16x8_s",
    "i32x4.extmul_high_i16x8_s",
    "i32x4.extmul_low_i16x8_u",
    "i32x4.extmul_high_i16x8_u",
    "i64x2.abs",
    "i64x2.neg",
    ,
    "i64x2.all_true",
    "i64x2.bitmask",
    ,
    ,
    "i64x2.extend_low_i32x4_s",
    "i64x2.extend_high_i32x4_s",
    "i64x2.extend_low_i32x4_u",
    "i64x2.extend_high_i32x4_u",
    "i64x2.shl",
    "i64x2.shr_s",
    "i64x2.shr_u",
    "i64x2.add",
    ,
    ,
    "i64x2.sub",
    ,
    ,
    ,
    "i64x2.mul",
    "i64x2.eq",
    "i64x2.ne",
    "i64x2.lt_s",
    "i64x2.gt_s",
    "i64x2.le_s",
    "i64x2.ge_s",
    "i64x2.extmul_low_i32x4_s",
    "i64x2.extmul_high_i32x4_s",
    "i64x2.extmul_low_i32x4_u",
    "i64x2.extmul_high_i32x4_u",
    "f32x4.abs",
    "f32x4.neg",
    ,
    "f32x4.sqrt",
    "f32x4.add",
    "f32x4.sub",
    "f32x4.mul",
    "f32x4.div",
    "f32x4.min",
    "f32x4.max",
    "f32x4.pmin",
    "f32x4.pmax",
    "f64x2.abs",
    "f64x2.neg",
    ,
    "f64x2.sqrt",
    "f64x2.add",
    "f64x2.sub",
    "f64x2.mul",
    "f64x2.div",
    "f64x2.min",
    "f64x2.max",
    "f64x2.pmin",
    "f64x2.pmax",
    "i32x4.trunc_sat_f32x4_s",
    "i32x4.trunc_sat_f32x4_u",
    "f32x4.convert_i32x4_s",
    "f32x4.convert_i32x4_u",
    "i32x4.trunc_sat_f64x2_s_zero",
    "i32x4.trunc_sat_f64x2_u_zero",
    "f64x2.convert_low_i32x4_s",
    "f64x2.convert_low_i32x4_u",
    "i8x16.relaxed_swizzle",
    "i32x4.relaxed_trunc_f32x4_s",
    "i32x4.relaxed_trunc_f32x4_u",
    "i32x4.relaxed_trunc_f64x2_s_zero",
    "i32x4.relaxed_trunc_f64x2_u_zero",
    "f32x4.relaxed_madd",
    "f32x4.relaxed_nmadd",
    "f64x2.relaxed_madd",
    "f64x2.relaxed_nmadd",
    "i8x16.relaxed_laneselect",
    "i16x8.relaxed_laneselect",
    "i32x4.relaxed_laneselect",
    "i64x2.relaxed_laneselect",
    "f32x4.relaxed_min",
    "f32x4.relaxed_max",
    "f64x2.relaxed_min",
    "f64x2.relaxed_max",
    "i16x8.relaxed_q15mulr_s",
    "i16x8.relaxed_dot_i8x16_i7x16_s",
    "i32x4.relaxed_dot_i8x16_i7x16_add_s"
  ],
  // 0xfe: atomic/thread instructions
  [
    "memory.atomic.notify memarg",
    "memory.atomic.wait32 memarg",
    "memory.atomic.wait64 memarg",
    "atomic.fence opt_memory",
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    "i32.atomic.load memarg",
    "i64.atomic.load memarg",
    "i32.atomic.load8_u memarg",
    "i32.atomic.load16_u memarg",
    "i64.atomic.load8_u memarg",
    "i64.atomic.load16_u memarg",
    "i64.atomic.load32_u memarg",
    "i32.atomic.store memarg",
    "i64.atomic.store memarg",
    "i32.atomic.store8 memarg",
    "i32.atomic.store16 memarg",
    "i64.atomic.store8 memarg",
    "i64.atomic.store16 memarg",
    "i64.atomic.store32 memarg",
    "i32.atomic.rmw.add memarg",
    "i64.atomic.rmw.add memarg",
    "i32.atomic.rmw8.add_u memarg",
    "i32.atomic.rmw16.add_u memarg",
    "i64.atomic.rmw8.add_u memarg",
    "i64.atomic.rmw16.add_u memarg",
    "i64.atomic.rmw32.add_u memarg",
    "i32.atomic.rmw.sub memarg",
    "i64.atomic.rmw.sub memarg",
    "i32.atomic.rmw8.sub_u memarg",
    "i32.atomic.rmw16.sub_u memarg",
    "i64.atomic.rmw8.sub_u memarg",
    "i64.atomic.rmw16.sub_u memarg",
    "i64.atomic.rmw32.sub_u memarg",
    "i32.atomic.rmw.and memarg",
    "i64.atomic.rmw.and memarg",
    "i32.atomic.rmw8.and_u memarg",
    "i32.atomic.rmw16.and_u memarg",
    "i64.atomic.rmw8.and_u memarg",
    "i64.atomic.rmw16.and_u memarg",
    "i64.atomic.rmw32.and_u memarg",
    "i32.atomic.rmw.or memarg",
    "i64.atomic.rmw.or memarg",
    "i32.atomic.rmw8.or_u memarg",
    "i32.atomic.rmw16.or_u memarg",
    "i64.atomic.rmw8.or_u memarg",
    "i64.atomic.rmw16.or_u memarg",
    "i64.atomic.rmw32.or_u memarg",
    "i32.atomic.rmw.xor memarg",
    "i64.atomic.rmw.xor memarg",
    "i32.atomic.rmw8.xor_u memarg",
    "i32.atomic.rmw16.xor_u memarg",
    "i64.atomic.rmw8.xor_u memarg",
    "i64.atomic.rmw16.xor_u memarg",
    "i64.atomic.rmw32.xor_u memarg",
    "i32.atomic.rmw.xchg memarg",
    "i64.atomic.rmw.xchg memarg",
    "i32.atomic.rmw8.xchg_u memarg",
    "i32.atomic.rmw16.xchg_u memarg",
    "i64.atomic.rmw8.xchg_u memarg",
    "i64.atomic.rmw16.xchg_u memarg",
    "i64.atomic.rmw32.xchg_u memarg",
    "i32.atomic.rmw.cmpxchg memarg",
    "i64.atomic.rmw.cmpxchg memarg",
    "i32.atomic.rmw8.cmpxchg_u memarg",
    "i32.atomic.rmw16.cmpxchg_u memarg",
    "i64.atomic.rmw8.cmpxchg_u memarg",
    "i64.atomic.rmw16.cmpxchg_u memarg",
    "i64.atomic.rmw32.cmpxchg_u memarg"
  ]
];
var SECTION = { custom: 0, type: 1, import: 2, func: 3, table: 4, memory: 5, tag: 13, global: 6, export: 7, start: 8, elem: 9, datacount: 12, code: 10, data: 11 };
var TYPE = {
  // Value types
  i8: 120,
  i16: 119,
  i32: 127,
  i64: 126,
  f32: 125,
  f64: 124,
  void: 64,
  v128: 123,
  // Heap types
  exn: 105,
  noexn: 116,
  nofunc: 115,
  noextern: 114,
  none: 113,
  func: 112,
  extern: 111,
  any: 110,
  eq: 109,
  i31: 108,
  struct: 107,
  array: 106,
  // Reference type abbreviations (absheaptype abbrs)
  nullfuncref: 115,
  nullexternref: 114,
  nullexnref: 116,
  nullref: 113,
  funcref: 112,
  externref: 111,
  exnref: 105,
  anyref: 110,
  eqref: 109,
  i31ref: 108,
  structref: 107,
  arrayref: 106,
  // ref, refnull
  ref: 100,
  // -0x1c
  refnull: 99,
  // -0x1d
  // Recursion group / type definition opcodes
  sub: 80,
  subfinal: 79,
  rec: 78
};
var DEFTYPE = { func: 96, struct: 95, array: 94, sub: 80, subfinal: 79, rec: 78 };
var KIND = { func: 0, table: 1, memory: 2, global: 3, tag: 4 };

// src/parse.js
var parse_default = (str2) => {
  let i = 0, level = [], buf = "", q = 0, depth = 0;
  const commit = () => buf && (level.push(buf), buf = "");
  const parseLevel = (pos) => {
    level.i = pos;
    for (let c, root, p; i < str2.length; ) {
      c = str2.charCodeAt(i);
      if (q === 34) buf += str2[i++], c === 92 ? buf += str2[i++] : c === 34 && (commit(), q = 0);
      else if (q > 59) c === 40 && str2.charCodeAt(i + 1) === 59 ? (q++, buf += str2[i++] + str2[i++]) : (
        // nested (;
        c === 59 && str2.charCodeAt(i + 1) === 41 ? (buf += str2[i++] + str2[i++], --q === 59 && (commit(), q = 0)) : (
          // ;)
          buf += str2[i++]
        )
      );
      else if (q < 0) c === 10 || c === 13 ? (buf += str2[i++], commit(), q = 0) : buf += str2[i++];
      else if (c === 34) buf !== "$" && commit(), q = 34, buf += str2[i++];
      else if (c === 40 && str2.charCodeAt(i + 1) === 59) commit(), q = 60, buf = str2[i++] + str2[i++];
      else if (c === 59 && str2.charCodeAt(i + 1) === 59) commit(), q = -1, buf = str2[i++] + str2[i++];
      else if (c === 40 && str2.charCodeAt(i + 1) === 64) commit(), p = i, i += 2, buf = "@", depth++, (root = level).push(level = []), parseLevel(p), level = root;
      else if (c === 40) commit(), p = i++, depth++, (root = level).push(level = []), parseLevel(p), level = root;
      else if (c === 41) return commit(), i++, depth--;
      else if (c <= 32) commit(), i++;
      else buf += str2[i++];
    }
    q < 0 && commit();
    commit();
  };
  parseLevel(0);
  if (q === 34) err(`Unclosed quote`, i);
  if (q > 59) err(`Unclosed block comment`, i);
  if (depth > 0) err(`Unclosed parenthesis`, i);
  if (i < str2.length) err(`Unexpected closing parenthesis`, i);
  return level.length > 1 ? level : level[0] || [];
};

// src/compile.js
var cleanup = (node, result) => !Array.isArray(node) ? typeof node !== "string" ? node : (
  // skip comments: ;; ... or (; ... ;)
  node[0] === ";" || node[1] === ";" ? null : (
    // normalize quoted ids: $"name" -> $name (if no escapes), else $unescaped
    node[0] === "$" && node[1] === '"' ? node.includes("\\") ? "$" + unescape(node.slice(1)) : "$" + node.slice(2, -1) : (
      // convert string literals to byte arrays with valueOf
      node[0] === '"' ? str(node) : node
    )
  )
) : (
  // remove annotations like (@name ...) except @custom and @metadata.code.*
  node[0]?.[0] === "@" && node[0] !== "@custom" && !node[0]?.startsWith?.("@metadata.code.") ? null : (
    // unwrap single-element array containing module (after removing comments), preserve .i
    (result = node.map(cleanup).filter((n) => n != null), result.i = node.i, result.length === 1 && result[0]?.[0] === "module" ? result[0] : result)
  )
);
function compile(nodes) {
  if (typeof nodes === "string") err.src = nodes, nodes = parse_default(nodes) || [];
  else err.src = "";
  err.i = 0;
  nodes = cleanup(nodes) || [];
  let idx = 0;
  if (nodes[0] === "module") idx++, isId(nodes[idx]) && idx++;
  else if (typeof nodes[0] === "string") nodes = [nodes];
  if (nodes[idx] === "binary") return Uint8Array.from(nodes.slice(++idx).flat());
  if (nodes[idx] === "quote") return compile(nodes.slice(++idx).map((v) => v.valueOf().slice(1, -1)).flat().join(""));
  const ctx = [];
  for (let kind in SECTION) (ctx[SECTION[kind]] = ctx[kind] = []).name = kind;
  ctx.metadata = {};
  nodes.slice(idx).filter((n) => {
    if (!Array.isArray(n)) {
      let pos = err.src?.indexOf(n, err.i);
      if (pos >= 0) err.i = pos;
      err(`Unexpected token ${n}`);
    }
    let [kind, ...node] = n;
    err.i = n.i;
    if (kind === "@custom") {
      ctx.custom.push(node);
    } else if (kind === "rec") {
      for (let i = 0; i < node.length; i++) {
        let [, ...subnode] = node[i];
        name(subnode, ctx.type);
        (subnode = typedef(subnode, ctx)).push(i ? true : [ctx.type.length, node.length]);
        ctx.type.push(subnode);
      }
    } else if (kind === "type") {
      name(node, ctx.type);
      ctx.type.push(typedef(node, ctx));
    } else if (kind === "start" || kind === "export") ctx[kind].push(node);
    else return true;
  }).forEach((n) => {
    let [kind, ...node] = n;
    err.i = n.i;
    let imported;
    if (kind === "import") [kind, ...node] = (imported = node).pop();
    let items = ctx[kind];
    if (!items) err(`Unknown section ${kind}`);
    name(node, items);
    while (node[0]?.[0] === "export") ctx.export.push([node.shift()[1], [kind, items?.length]]);
    if (node[0]?.[0] === "import") [, ...imported] = node.shift();
    if (kind === "table") {
      const is64 = node[0] === "i64", idx2 = is64 ? 1 : 0;
      if (node[idx2 + 1]?.[0] === "elem") {
        let [reftype2, [, ...els]] = [node[idx2], node[idx2 + 1]];
        node = is64 ? ["i64", els.length, els.length, reftype2] : [els.length, els.length, reftype2];
        ctx.elem.push([["table", items.length], ["offset", [is64 ? "i64.const" : "i32.const", is64 ? 0n : 0]], reftype2, ...els]);
      }
    } else if (kind === "memory") {
      const is64 = node[0] === "i64", idx2 = is64 ? 1 : 0;
      if (node[idx2]?.[0] === "data") {
        let [, ...data] = node.splice(idx2, 1)[0], m = "" + Math.ceil(data.reduce((s, d) => s + d.length, 0) / 65536);
        ctx.data.push([["memory", items.length], [is64 ? "i64.const" : "i32.const", is64 ? 0n : 0], ...data]);
        node = is64 ? ["i64", m, m] : [m, m];
      }
    } else if (kind === "func") {
      let [idx2, param, result] = typeuse(node, ctx);
      idx2 ??= regtype(param, result, ctx);
      !imported && ctx.code.push([[idx2, param, result], ...normalize(node, ctx)]);
      node = [["type", idx2]];
    } else if (kind === "tag") {
      let [idx2, param] = typeuse(node, ctx);
      idx2 ??= regtype(param, [], ctx);
      node = [["type", idx2]];
    }
    if (imported) ctx.import.push([...imported, [kind, ...node]]), node = null;
    items.push(node);
  });
  const bin = (kind, count = true) => {
    const items = ctx[kind].filter(Boolean).map((item) => build[kind](item, ctx)).filter(Boolean);
    if (kind === SECTION.custom) return items.flatMap((content) => [kind, ...vec(content)]);
    return !items.length ? [] : [kind, ...vec(count ? vec(items) : items)];
  };
  const binMeta = () => {
    const sections = [];
    for (const type in ctx.metadata) {
      const name2 = vec(str(`"metadata.code.${type}"`));
      const content = vec(ctx.metadata[type].map(
        ([funcIdx, instances]) => [...uleb(funcIdx), ...vec(instances.map(([pos, data]) => [...uleb(pos), ...vec(data)]))]
      ));
      sections.push(0, ...vec([...name2, ...content]));
    }
    return sections;
  };
  return Uint8Array.from([
    0,
    97,
    115,
    109,
    // magic
    1,
    0,
    0,
    0,
    // version
    ...bin(SECTION.custom),
    ...bin(SECTION.type),
    ...bin(SECTION.import),
    ...bin(SECTION.func),
    ...bin(SECTION.table),
    ...bin(SECTION.memory),
    ...bin(SECTION.tag),
    ...bin(SECTION.global),
    ...bin(SECTION.export),
    ...bin(SECTION.start, false),
    ...bin(SECTION.elem),
    ...bin(SECTION.datacount, false),
    ...bin(SECTION.code),
    ...binMeta(),
    ...bin(SECTION.data)
  ]);
}
var isIdx = (n) => n?.[0] === "$" || !isNaN(n);
var isId = (n) => n?.[0] === "$";
var isMemParam = (n) => n?.[0] === "a" || n?.[0] === "o";
function normalize(nodes, ctx) {
  const out = [];
  nodes = [...nodes];
  while (nodes.length) {
    let node = nodes.shift();
    if (typeof node === "string") {
      out.push(node);
      if (node === "block" || node === "if" || node === "loop") {
        if (isId(nodes[0])) out.push(nodes.shift());
        out.push(blocktype(nodes, ctx));
      } else if (node === "else" || node === "end") {
        if (isId(nodes[0])) nodes.shift();
      } else if (node === "select") out.push(paramres(nodes)[1]);
      else if (node.endsWith("call_indirect")) {
        let tableidx = isIdx(nodes[0]) ? nodes.shift() : 0, [idx, param, result] = typeuse(nodes, ctx);
        out.push(tableidx, ["type", idx ?? regtype(param, result, ctx)]);
      } else if (node === "table.init") out.push(isIdx(nodes[1]) ? nodes.shift() : 0, nodes.shift());
      else if (node === "table.copy" || node === "memory.copy") out.push(isIdx(nodes[0]) ? nodes.shift() : 0, isIdx(nodes[0]) ? nodes.shift() : 0);
      else if (node.startsWith("table.")) out.push(isIdx(nodes[0]) ? nodes.shift() : 0);
      else if (node === "memory.init") {
        out.push(...isIdx(nodes[1]) ? [nodes.shift(), nodes.shift()].reverse() : [nodes.shift(), 0]);
        ctx.datacount && (ctx.datacount[0] = true);
      } else if (node === "data.drop" || node === "array.new_data" || node === "array.init_data") {
        node === "data.drop" && out.push(nodes.shift());
        ctx.datacount && (ctx.datacount[0] = true);
      } else if ((node.startsWith("memory.") || node.endsWith("load") || node.endsWith("store")) && isIdx(nodes[0])) out.push(nodes.shift());
    } else if (Array.isArray(node)) {
      const op = node[0];
      node.i != null && (err.i = node.i);
      if (op?.startsWith?.("@metadata.code.")) {
        let type = op.slice(15);
        out.push(["@metadata", type, node[1]]);
        continue;
      }
      if (typeof op !== "string" || !Array.isArray(INSTR[op])) {
        out.push(node);
        continue;
      }
      const parts = node.slice(1);
      if (op === "block" || op === "loop") {
        out.push(op);
        if (isId(parts[0])) out.push(parts.shift());
        out.push(blocktype(parts, ctx), ...normalize(parts, ctx), "end");
      } else if (op === "if") {
        let then = [], els = [];
        if (parts.at(-1)?.[0] === "else") els = normalize(parts.pop().slice(1), ctx);
        if (parts.at(-1)?.[0] === "then") then = normalize(parts.pop().slice(1), ctx);
        let immed = [op];
        if (isId(parts[0])) immed.push(parts.shift());
        immed.push(blocktype(parts, ctx));
        out.push(...normalize(parts, ctx), ...immed, ...then);
        els.length && out.push("else", ...els);
        out.push("end");
      } else if (op === "try_table") {
        out.push(op);
        if (isId(parts[0])) out.push(parts.shift());
        out.push(blocktype(parts, ctx));
        while (parts[0]?.[0] === "catch" || parts[0]?.[0] === "catch_ref" || parts[0]?.[0] === "catch_all" || parts[0]?.[0] === "catch_all_ref") {
          out.push(parts.shift());
        }
        out.push(...normalize(parts, ctx), "end");
      } else {
        const imm = [];
        while (parts.length && (!Array.isArray(parts[0]) || "type,param,result,ref".includes(parts[0][0]))) imm.push(parts.shift());
        out.push(...normalize(parts, ctx), op, ...imm);
        nodes.unshift(...out.splice(out.length - 1 - imm.length));
      }
    } else out.push(node);
  }
  return out;
}
var regtype = (param, result, ctx, idx = "$" + param + ">" + result) => (ctx.type[idx] ??= ctx.type.push(["func", [param, result]]) - 1, idx);
var fieldseq = (nodes, field) => {
  let seq = [];
  while (nodes[0]?.[0] === field) {
    let [, ...args] = nodes.shift(), nm = isId(args[0]) && args.shift();
    if (nm) nm in seq ? (() => {
      throw Error(`Duplicate ${field} ${nm}`);
    })() : seq[nm] = seq.length;
    seq.push(...args);
  }
  return seq;
};
var paramres = (nodes) => {
  let param = fieldseq(nodes, "param"), result = fieldseq(nodes, "result");
  if (nodes[0]?.[0] === "param") throw Error("Unexpected param");
  return [param, result];
};
var typeuse = (nodes, ctx) => {
  if (nodes[0]?.[0] !== "type") return [, ...paramres(nodes)];
  let [, idx] = nodes.shift(), [param, result] = paramres(nodes);
  const entry = ctx.type[typeof idx === "string" && isNaN(idx) ? ctx.type[idx] : +idx];
  if (!entry) throw Error(`Unknown type ${idx}`);
  if ((param.length || result.length) && entry[1].join(">") !== param + ">" + result) throw Error(`Type ${idx} mismatch`);
  return [idx, ...entry[1]];
};
var blocktype = (nodes, ctx) => {
  let [idx, param, result] = typeuse(nodes, ctx);
  if (!param.length && !result.length) return;
  if (!param.length && result.length === 1) return ["result", ...result];
  return ["type", idx ?? regtype(param, result, ctx)];
};
var name = (node, list) => {
  let nm = isId(node[0]) && node.shift();
  if (nm) nm in list ? err(`Duplicate ${list.name} ${nm}`) : list[nm] = list.length;
  return nm;
};
var typedef = ([dfn], ctx) => {
  let subkind = "subfinal", supertypes = [], compkind;
  if (dfn[0] === "sub") {
    subkind = dfn.shift(), dfn[0] === "final" && (subkind += dfn.shift());
    dfn = (supertypes = dfn).pop();
  }
  [compkind, ...dfn] = dfn;
  if (compkind === "func") dfn = paramres(dfn), ctx.type["$" + dfn.join(">")] ??= ctx.type.length;
  else if (compkind === "struct") dfn = fieldseq(dfn, "field");
  else if (compkind === "array") [dfn] = dfn;
  return [compkind, dfn, subkind, supertypes];
};
var build = [
  // (@custom "name" placement? data) - custom section builder
  ([name2, ...rest], ctx) => {
    let data = rest;
    if (rest[0]?.[0] === "before" || rest[0]?.[0] === "after") {
      data = rest.slice(1);
    }
    return [...vec(name2), ...data.flat()];
  },
  // type kinds
  // (func params result)
  // (array i8)
  // (struct ...fields)
  ([kind, fields, subkind, supertypes, rec], ctx) => {
    if (rec === true) return;
    let details;
    if (rec) {
      kind = "rec";
      let [from, length] = rec, subtypes = Array.from({ length }, (_, i) => build[SECTION.type](ctx.type[from + i].slice(0, 4), ctx));
      details = vec(subtypes);
    } else if (subkind === "sub" || supertypes?.length) {
      details = [...vec(supertypes.map((n) => id(n, ctx.type))), ...build[SECTION.type]([kind, fields], ctx)];
      kind = subkind;
    } else if (kind === "func") {
      details = [...vec(fields[0].map((t) => reftype(t, ctx))), ...vec(fields[1].map((t) => reftype(t, ctx)))];
    } else if (kind === "array") {
      details = fieldtype(fields, ctx);
    } else if (kind === "struct") {
      details = vec(fields.map((t) => fieldtype(t, ctx)));
    }
    return [DEFTYPE[kind], ...details];
  },
  // (import "math" "add" (func|table|global|memory|tag dfn?))
  ([mod, field, [kind, ...dfn]], ctx) => {
    let details;
    if (kind === "func") {
      let [[, typeidx]] = dfn;
      details = uleb(id(typeidx, ctx.type));
    } else if (kind === "tag") {
      let [[, typeidx]] = dfn;
      details = [0, ...uleb(id(typeidx, ctx.type))];
    } else if (kind === "memory") {
      details = limits(dfn);
    } else if (kind === "global") {
      details = fieldtype(dfn[0], ctx);
    } else if (kind === "table") {
      details = [...reftype(dfn.pop(), ctx), ...limits(dfn)];
    } else err(`Unknown kind ${kind}`);
    return [...vec(mod), ...vec(field), KIND[kind], ...details];
  },
  // (func $name? ...params result ...body)
  ([[, typeidx]], ctx) => uleb(id(typeidx, ctx.type)),
  // (table 1 2 funcref)
  (node, ctx) => {
    let lims = limits(node), t = reftype(node.shift(), ctx), [init] = node;
    return init ? [64, 0, ...t, ...lims, ...expr(init, ctx)] : [...t, ...lims];
  },
  // (memory id? export* min max shared)
  (node, ctx) => limits(node),
  // (global $id? (mut i32) (i32.const 42))
  ([t, init], ctx) => [...fieldtype(t, ctx), ...expr(init, ctx)],
  // (export "name" (func|table|mem $name|idx))
  ([nm, [kind, l]], ctx) => [...vec(nm), KIND[kind], ...uleb(id(l, ctx[kind]))],
  // (start $main)
  ([l], ctx) => uleb(id(l, ctx.func)),
  // (elem elem*) - passive
  // (elem declare elem*) - declarative
  // (elem (table idx)? (offset expr)|(expr) elem*) - active
  // ref: https://webassembly.github.io/spec/core/binary/modules.html#element-section
  (parts, ctx) => {
    let passive = 0, declare = 0, elexpr = 0, nofunc = 0, tabidx, offset, rt;
    if (parts[0] === "declare") parts.shift(), declare = 1;
    if (parts[0]?.[0] === "table") {
      [, tabidx] = parts.shift();
      tabidx = id(tabidx, ctx.table);
    } else if ((typeof parts[0] === "string" || typeof parts[0] === "number") && (parts[1]?.[0] === "offset" || Array.isArray(parts[1]) && parts[1][0] !== "item" && !parts[1][0]?.startsWith("ref"))) {
      tabidx = id(parts.shift(), ctx.table);
    }
    if (parts[0]?.[0] === "offset" || Array.isArray(parts[0]) && parts[0][0] !== "item" && !parts[0][0].startsWith("ref")) {
      offset = parts.shift();
      if (offset[0] === "offset") [, offset] = offset;
      offset = expr(offset, ctx);
    } else if (!declare) passive = 1;
    if (TYPE[parts[0]] || parts[0]?.[0] === "ref") rt = reftype(parts.shift(), ctx);
    else if (parts[0] === "func") rt = [TYPE[parts.shift()]];
    else rt = [TYPE.func];
    parts = parts.map((el) => {
      if (el[0] === "item") el = el.length === 3 && el[1] === "ref.func" ? el[2] : el[1];
      if (el[0] === "ref.func") [, el] = el;
      if (typeof el !== "string") elexpr = 1;
      return el;
    });
    if (rt[0] !== TYPE.funcref) nofunc = 1, elexpr = 1;
    let mode = elexpr << 2 | (passive || declare ? declare : !!tabidx || nofunc) << 1 | (passive || declare);
    return [
      mode,
      ...// 0b000 e:expr y*:vec(funcidx)                     | type=(ref func), init ((ref.func y)end)*, active (table=0,offset=e)
      mode === 0 ? offset : (
        // 0b001 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive
        mode === 1 ? [0] : (
          // 0b010 x:tabidx e:expr et:elkind y*:vec(funcidx)  | type=0x00, init ((ref.func y)end)*, active (table=x,offset=e)
          mode === 2 ? [...uleb(tabidx || 0), ...offset, 0] : (
            // 0b011 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive declare
            mode === 3 ? [0] : (
              // 0b100 e:expr el*:vec(expr)                       | type=(ref null func), init el*, active (table=0, offset=e)
              mode === 4 ? offset : (
                // 0b101 et:reftype el*:vec(expr)                   | type=et, init el*, passive
                mode === 5 ? rt : (
                  // 0b110 x:tabidx e:expr et:reftype el*:vec(expr)   | type=et, init el*, active (table=x, offset=e)
                  mode === 6 ? [...uleb(tabidx || 0), ...offset, ...rt] : (
                    // 0b111 et:reftype el*:vec(expr)                   | type=et, init el*, passive declare
                    rt
                  )
                )
              )
            )
          )
        )
      ),
      ...vec(
        parts.map(
          elexpr ? (
            // ((ref.func y)end)*
            (el) => expr(typeof el === "string" ? ["ref.func", el] : el, ctx)
          ) : (
            // el*
            (el) => uleb(id(el, ctx.func))
          )
        )
      )
    ];
  },
  // (code)
  (body, ctx) => {
    let [typeidx, param] = body.shift();
    if (!param) [, [param]] = ctx.type[id(typeidx, ctx.type)];
    ctx.local = Object.create(param);
    ctx.block = [];
    ctx.local.name = "local";
    ctx.block.name = "block";
    if (ctx._codeIdx === void 0) ctx._codeIdx = 0;
    let codeIdx = ctx._codeIdx++;
    while (body[0]?.[0] === "local") {
      let [, ...types] = body.shift();
      if (isId(types[0])) {
        let nm = types.shift();
        if (nm in ctx.local) err(`Duplicate local ${nm}`);
        else ctx.local[nm] = ctx.local.length;
      }
      ctx.local.push(...types);
    }
    ctx.meta = {};
    const bytes = instr(body, ctx);
    const funcIdx = ctx.import.filter((imp) => imp[2][0] === "func").length + codeIdx;
    for (const type in ctx.meta) ((ctx.metadata ??= {})[type] ??= []).push([funcIdx, ctx.meta[type]]);
    let loctypes = ctx.local.slice(param.length).reduce((a, type) => (type == a[a.length - 1]?.[1] ? a[a.length - 1][0]++ : a.push([1, type]), a), []);
    ctx.local = ctx.block = ctx.meta = null;
    return vec([...vec(loctypes.map(([n, t]) => [...uleb(n), ...reftype(t, ctx)])), ...bytes]);
  },
  // (data (i32.const 0) "\aa" "\bb"?)
  // (data (memory ref) (offset (i32.const 0)) "\aa" "\bb"?)
  // (data (global.get $x) "\aa" "\bb"?)
  (inits, ctx) => {
    let offset, memidx = 0;
    if (inits[0]?.[0] === "memory") {
      [, memidx] = inits.shift();
      memidx = id(memidx, ctx.memory);
    } else if ((typeof inits[0] === "string" || typeof inits[0] === "number") && (inits[1]?.[0] === "offset" || Array.isArray(inits[1]) && typeof inits[1][0] === "string")) {
      memidx = id(inits.shift(), ctx.memory);
    }
    if (Array.isArray(inits[0]) && typeof inits[0]?.[0] === "string") {
      offset = inits.shift();
      if (offset[0] === "offset") [, offset] = offset;
      offset ?? err("Bad offset", offset);
    }
    return [
      ...// active: 2, x=memidx, e=expr
      memidx ? [2, ...uleb(memidx), ...expr(offset, ctx)] : (
        // active: 0, e=expr
        offset ? [0, ...expr(offset, ctx)] : (
          // passive: 1
          [1]
        )
      ),
      ...vec(inits.flat())
    ];
  },
  // datacount
  (nodes, ctx) => uleb(ctx.data.length),
  // (tag $name? (type idx))
  ([[, typeidx]], ctx) => [0, ...uleb(id(typeidx, ctx.type))]
];
var reftype = (t, ctx) => t[0] === "ref" ? t[1] == "null" ? TYPE[t[2]] ? [TYPE[t[2]]] : [TYPE.refnull, ...uleb(id(t[t.length - 1], ctx.type))] : [TYPE.ref, ...uleb(TYPE[t[t.length - 1]] || id(t[t.length - 1], ctx.type))] : (
  // abbrs
  [TYPE[t] ?? err(`Unknown type ${t}`)]
);
var fieldtype = (t, ctx, mut = t[0] === "mut" ? 1 : 0) => [...reftype(mut ? t[1] : t, ctx), mut];
var IMM = {
  null: () => [],
  reversed: (n, c) => {
    let t = n.shift(), e = n.shift();
    return [...uleb(id(e, c.elem)), ...uleb(id(t, c.table))];
  },
  block: (n, c) => {
    c.block.push(1);
    isId(n[0]) && (c.block[n.shift()] = c.block.length);
    let t = n.shift();
    return !t ? [TYPE.void] : t[0] === "result" ? reftype(t[1], c) : uleb(id(t[1], c.type));
  },
  try_table: (n, c) => {
    isId(n[0]) && (c.block[n.shift()] = c.block.length + 1);
    let blocktype2 = n.shift();
    let result = !blocktype2 ? [TYPE.void] : blocktype2[0] === "result" ? reftype(blocktype2[1], c) : uleb(id(blocktype2[1], c.type));
    let catches = [], count = 0;
    while (n[0]?.[0] === "catch" || n[0]?.[0] === "catch_ref" || n[0]?.[0] === "catch_all" || n[0]?.[0] === "catch_all_ref") {
      let clause = n.shift();
      let kind = clause[0] === "catch" ? 0 : clause[0] === "catch_ref" ? 1 : clause[0] === "catch_all" ? 2 : 3;
      if (kind <= 1) catches.push(kind, ...uleb(id(clause[1], c.tag)), ...uleb(blockid(clause[2], c.block)));
      else catches.push(kind, ...uleb(blockid(clause[1], c.block)));
      count++;
    }
    c.block.push(1);
    return [...result, ...uleb(count), ...catches];
  },
  end: (_n, c) => (c.block.pop(), []),
  call_indirect: (n, c) => {
    let t = n.shift(), [, idx] = n.shift();
    return [...uleb(id(idx, c.type)), ...uleb(id(t, c.table))];
  },
  br_table: (n, c) => {
    let labels = [], count = 0;
    while (n[0] && (!isNaN(n[0]) || isId(n[0]))) labels.push(...uleb(blockid(n.shift(), c.block))), count++;
    return [...uleb(count - 1), ...labels];
  },
  select: (n, c) => {
    let r = n.shift() || [];
    return r.length ? vec(r.map((t) => reftype(t, c))) : [];
  },
  ref_null: (n, c) => {
    let t = n.shift();
    return TYPE[t] ? [TYPE[t]] : uleb(id(t, c.type));
  },
  memarg: (n, c, op) => memargEnc(n, op, isIdx(n[0]) && !isMemParam(n[0]) ? id(n.shift(), c.memory) : 0),
  opt_memory: (n, c) => uleb(id(isIdx(n[0]) ? n.shift() : 0, c.memory)),
  reftype: (n, c) => {
    let ht = reftype(n.shift(), c);
    return ht.length > 1 ? ht.slice(1) : ht;
  },
  reftype2: (n, c) => {
    let b = blockid(n.shift(), c.block), h1 = reftype(n.shift(), c), h2 = reftype(n.shift(), c);
    return [(h2[0] !== TYPE.ref) << 1 | h1[0] !== TYPE.ref, ...uleb(b), h1.pop(), h2.pop()];
  },
  v128const: (n) => {
    let [t, num] = n.shift().split("x"), bits = +t.slice(1), stride = bits >>> 3;
    num = +num;
    if (t[0] === "i") {
      let arr2 = num === 16 ? new Uint8Array(16) : num === 8 ? new Uint16Array(8) : num === 4 ? new Uint32Array(4) : new BigUint64Array(2);
      for (let j = 0; j < num; j++) arr2[j] = encode_exports[t].parse(n.shift());
      return [...new Uint8Array(arr2.buffer)];
    }
    let arr = new Uint8Array(16);
    for (let j = 0; j < num; j++) arr.set(encode_exports[t](n.shift()), j * stride);
    return [...arr];
  },
  shuffle: (n) => {
    let result = [];
    for (let j = 0; j < 16; j++) result.push(parseUint(n.shift(), 32));
    if (typeof n[0] === "string" && !isNaN(n[0])) err(`invalid lane length`);
    return result;
  },
  memlane: (n, c, op) => {
    const memIdx = isId(n[0]) || isIdx(n[0]) && (isMemParam(n[1]) || isIdx(n[1])) ? id(n.shift(), c.memory) : 0;
    return [...memargEnc(n, op, memIdx), ...uleb(parseUint(n.shift()))];
  },
  "*": (n) => uleb(n.shift()),
  // *idx types
  labelidx: (n, c) => uleb(blockid(n.shift(), c.block)),
  laneidx: (n) => [parseUint(n.shift(), 255)],
  funcidx: (n, c) => uleb(id(n.shift(), c.func)),
  typeidx: (n, c) => uleb(id(n.shift(), c.type)),
  tableidx: (n, c) => uleb(id(n.shift(), c.table)),
  memoryidx: (n, c) => uleb(id(n.shift(), c.memory)),
  globalidx: (n, c) => uleb(id(n.shift(), c.global)),
  localidx: (n, c) => uleb(id(n.shift(), c.local)),
  dataidx: (n, c) => uleb(id(n.shift(), c.data)),
  elemidx: (n, c) => uleb(id(n.shift(), c.elem)),
  tagidx: (n, c) => uleb(id(n.shift(), c.tag)),
  "memoryidx?": (n, c) => uleb(id(isIdx(n[0]) ? n.shift() : 0, c.memory)),
  // Value type
  i32: (n) => i32(n.shift()),
  i64: (n) => i64(n.shift()),
  f32: (n) => f32(n.shift()),
  f64: (n) => f64(n.shift()),
  v128: (n) => (void 0)(n.shift()),
  // Combinations
  typeidx_field: (n, c) => {
    let typeId = id(n.shift(), c.type);
    return [...uleb(typeId), ...uleb(id(n.shift(), c.type[typeId][1]))];
  },
  typeidx_multi: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(n.shift())],
  typeidx_dataidx: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(id(n.shift(), c.data))],
  typeidx_elemidx: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(id(n.shift(), c.elem))],
  typeidx_typeidx: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(id(n.shift(), c.type))],
  dataidx_memoryidx: (n, c) => [...uleb(id(n.shift(), c.data)), ...uleb(id(n.shift(), c.memory))],
  memoryidx_memoryidx: (n, c) => [...uleb(id(n.shift(), c.memory)), ...uleb(id(n.shift(), c.memory))],
  tableidx_tableidx: (n, c) => [...uleb(id(n.shift(), c.table)), ...uleb(id(n.shift(), c.table))]
};
var HANDLER = {};
(function populate(items, pre) {
  for (let op = 0, item, nm, imm; op < items.length; op++) if (item = items[op]) {
    if (Array.isArray(item)) populate(item, op);
    else [nm, imm] = item.split(" "), INSTR[nm] = pre ? [pre, ...uleb(op)] : [op], imm && (HANDLER[nm] = IMM[imm]);
  }
})(INSTR);
var instr = (nodes, ctx) => {
  let out = [], meta = [];
  while (nodes?.length) {
    let op = nodes.shift();
    if (op?.[0] === "@metadata") {
      meta.push(op.slice(1));
      continue;
    }
    if (Array.isArray(op)) {
      op.i != null && (err.i = op.i);
      err(`Unknown instruction ${op[0]}`);
    }
    let [...bytes] = INSTR[op] || err(`Unknown instruction ${op}`);
    if (HANDLER[op]) {
      if (op === "select" && nodes[0]?.length) bytes[0]++;
      else if (HANDLER[op] === IMM.reftype && (nodes[0][1] === "null" || nodes[0][0] !== "ref")) {
        bytes[bytes.length - 1]++;
      }
      bytes.push(...HANDLER[op](nodes, ctx, op));
    }
    for (const [type, data] of meta) (ctx.meta[type] ??= []).push([out.length, data]);
    out.push(...bytes);
  }
  return out.push(11), out;
};
var expr = (node, ctx) => instr(normalize([node], ctx), ctx);
var id = (nm, list, n) => (n = isId(nm) ? list[nm] : +nm, n in list ? n : err(`Unknown ${list.name} ${nm}`));
var blockid = (nm, block, i) => (i = isId(nm) ? block.length - block[nm] : +nm, isNaN(i) || i > block.length ? err(`Bad label ${nm}`) : i);
var memarg = (args) => {
  let align2, offset, k, v;
  while (isMemParam(args[0])) [k, v] = args.shift().split("="), k === "offset" ? offset = +v : k === "align" ? align2 = +v : err(`Unknown param ${k}=${v}`);
  if (offset < 0 || offset > 4294967295) err(`Bad offset ${offset}`);
  if (align2 <= 0 || align2 > 4294967295) err(`Bad align ${align2}`);
  if (align2) (align2 = Math.log2(align2)) % 1 && err(`Bad align ${align2}`);
  return [align2, offset];
};
var memargEnc = (nodes, op, memIdx = 0) => {
  const [a, o] = memarg(nodes), alignVal = (a ?? align(op)) | (memIdx && 64);
  return memIdx ? [...uleb(alignVal), ...uleb(memIdx), ...uleb(o ?? 0)] : [...uleb(alignVal), ...uleb(o ?? 0)];
};
var align = (op) => {
  let i = op.indexOf(".", 3) + 1, group = op.slice(1, op[0] === "v" ? 4 : 3);
  if (op[i] === "a") i = op.indexOf(".", i) + 1;
  if (op[0] === "m") return op.includes("64") ? 3 : 2;
  if (op[i] === "r") {
    let m2 = op.slice(i, i + 6).match(/\d+/);
    return m2 ? Math.log2(m2[0] / 8) : Math.log2(+group / 8);
  }
  let k = op[i] === "l" ? i + 4 : i + 5, m = op.slice(k).match(/(\d+)(x|_|$)/);
  return Math.log2(m ? m[2] === "x" ? 8 : m[1] / 8 : +group / 8);
};
var limits = (node) => {
  const is64 = node[0] === "i64" && node.shift();
  const shared = node[node.length - 1] === "shared" && node.pop();
  const hasMax = !isNaN(parseInt(node[1]));
  const flag = (is64 ? 4 : 0) | (shared ? 2 : 0) | (hasMax ? 1 : 0);
  const parse = is64 ? (v) => {
    if (typeof v === "bigint") return v;
    const str2 = typeof v === "string" ? v.replaceAll("_", "") : String(v);
    return BigInt(str2);
  } : parseUint;
  return hasMax ? [flag, ...uleb(parse(node.shift())), ...uleb(parse(node.shift()))] : [flag, ...uleb(parse(node.shift()))];
};
var parseUint = (v, max = 4294967295) => {
  const n = typeof v === "string" && v[0] !== "+" ? i32.parse(v) : typeof v === "number" ? v : err(`Bad int ${v}`);
  return n > max ? err(`Value out of range ${v}`) : n;
};
var vec = (a) => [...uleb(a.length), ...a.flat()];

// src/print.js
function print(tree, options = {}) {
  if (typeof tree === "string") tree = parse_default(tree);
  let { indent = "  ", newline = "\n", comments = true } = options;
  indent ||= "", newline ||= "";
  if (typeof tree[0] === "string" && tree[0][0] !== ";") return printNode(tree);
  return tree.filter((node) => comments || !isComment(node)).map((node) => printNode(node)).join(newline);
  function isComment(node) {
    return typeof node === "string" && node[1] === ";";
  }
  function printNode(node, level = 0) {
    if (!Array.isArray(node)) return node;
    let content = node[0];
    if (!content) return "";
    let afterLineComment = false;
    if (content === "try_table") {
      let i = 1;
      if (typeof node[i] === "string" && node[i][0] === "$") content += " " + node[i++];
      if (Array.isArray(node[i]) && (node[i][0] === "result" || node[i][0] === "type")) content += " " + printNode(node[i++], level);
      while (Array.isArray(node[i]) && /^catch/.test(node[i][0])) content += " " + printNode(node[i++], level).trim();
      for (; i < node.length; i++) content += Array.isArray(node[i]) ? newline + indent.repeat(level + 1) + printNode(node[i], level + 1) : " " + node[i];
      return `(${content + newline + indent.repeat(level)})`;
    }
    let flat = !!newline && node.length < 4 && !node.some((n) => typeof n === "string" && n[0] === ";" && n[1] === ";");
    let curIndent = indent.repeat(level + 1);
    for (let i = 1; i < node.length; i++) {
      const sub = node[i].valueOf();
      if (typeof sub === "string" && sub[1] === ";") {
        if (!comments) continue;
        if (sub[0] === ";") {
          if (newline) {
            content += newline + curIndent + sub.trimEnd();
            afterLineComment = true;
          } else {
            const last = content[content.length - 1];
            if (last && last !== " " && last !== "(") content += " ";
            content += sub.trimEnd() + "\n";
          }
        } else {
          const last = content[content.length - 1];
          if (last && last !== " " && last !== "(") content += " ";
          content += sub.trimEnd();
        }
      } else if (Array.isArray(sub)) {
        if (flat) flat = sub.every((sub2) => !Array.isArray(sub2));
        content += newline + curIndent + printNode(sub, level + 1);
        afterLineComment = false;
      } else if (node[0] === "data") {
        flat = false;
        if (newline || content[content.length - 1] !== ")") content += newline || " ";
        content += curIndent + sub;
        afterLineComment = false;
      } else {
        const last = content[content.length - 1];
        if (afterLineComment && newline) content += newline + curIndent;
        else if (last === "\n") content += "";
        else if (last && last !== ")" && last !== " ") content += " ";
        else if (newline || last === ")") content += " ";
        content += sub;
        afterLineComment = false;
      }
    }
    if (flat) return `(${content.replaceAll(newline + curIndent + "(", " (")})`;
    return `(${content + newline + indent.repeat(level)})`;
  }
}

// watr.js
var PUA = "\uE000";
var instrType = (op) => {
  if (!op || typeof op !== "string") return null;
  const prefix = op.split(".")[0];
  if (/^[if](32|64)|v128/.test(prefix)) return prefix;
  if (/\.(eq|ne|[lg][te]|eqz)/.test(op)) return "i32";
  if (op === "memory.size" || op === "memory.grow") return "i32";
  return null;
};
var exprType = (node, ctx = {}) => {
  if (!Array.isArray(node)) {
    if (typeof node === "string" && node[0] === "$" && ctx.locals?.[node]) return ctx.locals[node];
    return null;
  }
  const [op, ...args] = node;
  if (instrType(op)) return instrType(op);
  if (op === "local.get" && ctx.locals?.[args[0]]) return ctx.locals[args[0]];
  if (op === "call" && ctx.funcs?.[args[0]]) return ctx.funcs[args[0]].result?.[0];
  return null;
};
function walk(node, fn) {
  node = fn(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      let child = walk(node[i], fn);
      if (child?._splice) node.splice(i, 1, ...child), i += child.length - 1;
      else node[i] = child;
    }
  }
  return node;
}
function inferImports(ast, funcs) {
  const imports = [];
  const importMap = /* @__PURE__ */ new Map();
  walk(ast, (node) => {
    if (!Array.isArray(node)) return node;
    if (node[0] === "call" && typeof node[1] === "function") {
      const fn = node[1];
      if (!importMap.has(fn)) {
        const params = [];
        for (let i = 2; i < node.length; i++) {
          const t = exprType(node[i]);
          if (t) params.push(t);
        }
        const idx = imports.length;
        const name2 = fn.name || `$fn${idx}`;
        importMap.set(fn, { idx, name: name2.startsWith("$") ? name2 : "$" + name2, params, fn });
        imports.push(importMap.get(fn));
      }
      const imp = importMap.get(fn);
      node[1] = imp.name;
    }
    return node;
  });
  return imports;
}
function genImports(imports) {
  return imports.map(
    ({ name: name2, params }) => ["import", '"env"', `"${name2.slice(1)}"`, ["func", name2, ...params.map((t) => ["param", t])]]
  );
}
function compile2(source, ...values) {
  if (Array.isArray(source) && source.raw) {
    let src = source[0];
    for (let i = 0; i < values.length; i++) {
      src += PUA + source[i + 1];
    }
    let ast = parse_default(src);
    const funcsToImport = [];
    let idx = 0;
    ast = walk(ast, (node) => {
      if (node === PUA) {
        const value = values[idx++];
        if (typeof value === "function") {
          funcsToImport.push(value);
          return value;
        }
        if (typeof value === "string" && (value[0] === "(" || /^\s*\(/.test(value))) {
          const parsed = parse_default(value);
          if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
            parsed._splice = true;
          }
          return parsed;
        }
        if (value instanceof Uint8Array) return [...value];
        return value;
      }
      return node;
    });
    let importObjs = null;
    if (funcsToImport.length) {
      const imports = inferImports(ast, funcsToImport);
      if (imports.length) {
        const importDecls = genImports(imports);
        if (ast[0] === "module") {
          ast.splice(1, 0, ...importDecls);
        } else if (typeof ast[0] === "string") {
          ast = [...importDecls, ast];
        } else {
          ast.unshift(...importDecls);
        }
        importObjs = { env: {} };
        for (const imp of imports) {
          importObjs.env[imp.name.slice(1)] = imp.fn;
        }
      }
    }
    const binary = compile(ast);
    if (importObjs) binary._imports = importObjs;
    return binary;
  }
  return compile(source);
}
function watr(strings, ...values) {
  const binary = compile2(strings, ...values);
  const module = new WebAssembly.Module(binary);
  const instance = new WebAssembly.Instance(module, binary._imports);
  return instance.exports;
}
var watr_default = watr;
export {
  compile2 as compile,
  watr_default as default,
  parse_default as parse,
  print,
  watr
};
