/**
 * Binary encoding utilities for WebAssembly.
 * @module encode
 * @see https://webassembly.github.io/spec/core/binary/values.html
 */

import { err, intRE, sepRE } from './util.js'

/**
 * Encode unsigned LEB128. Handles both 32-bit numbers and 64-bit BigInts.
 *
 * @param {number|bigint|string|null} n - Value to encode
 * @param {number[]} [buffer=[]] - Output buffer
 * @returns {number[]} Encoded bytes
 */
export const uleb = (n, buffer = []) => {
  if (n == null) return buffer
  if (typeof n === 'string') n = /[_x]/i.test(n) ? BigInt(n.replaceAll('_', '')) : i32.parse(n)

  // Handle BigInt for 64-bit values
  if (typeof n === 'bigint') {
    while (true) {
      const byte = Number(n & 0x7Fn)
      n >>= 7n
      if (n === 0n) {
        buffer.push(byte)
        break
      }
      buffer.push(byte | 0x80)
    }
    return buffer
  }

  // Handle regular numbers for 32-bit values
  let byte = n & 0x7f
  n >>>= 7

  if (n === 0) {
    buffer.push(byte)
    return buffer
  }
  buffer.push(byte | 0x80)
  return uleb(n, buffer)
}

/**
 * Encode as fixed-width 5-byte ULEB128 (canonical form).
 * Used by some tools for predictable binary layout.
 *
 * @param {number} value - 32-bit unsigned value
 * @returns {number[]} 5-byte array
 */
export function uleb5(value) {
  const result = [];
  for (let i = 0; i < 5; i++) {
    let byte = value & 0x7f;
    value >>>= 7;
    if (i < 4) {
      byte |= 0x80; // Set continuation bit for first 4 bytes
    }
    result.push(byte);
  }
  return result;
}

/**
 * Encode signed LEB128 for i32 values.
 *
 * @param {number|string} n - Signed 32-bit value
 * @param {number[]} [buffer=[]] - Output buffer
 * @returns {number[]} Encoded bytes
 */
export function i32(n, buffer = []) {
  if (typeof n === 'string') n = i32.parse(n)

  while (true) {
    const byte = Number(n & 0x7F)
    n >>= 7
    if ((n === 0 && (byte & 0x40) === 0) || (n === -1 && (byte & 0x40) !== 0)) {
      buffer.push(byte)
      break
    }
    buffer.push((byte | 0x80))
  }
  return buffer
}

// for tests complacency we check format
const cleanInt = (v) => (!sepRE.test(v) && intRE.test(v=v.replaceAll('_',''))) ? v : err(`Bad int ${v}`)

// alias
export const i8 = i32, i16 = i32

i32.parse = n => {
  n = parseInt(cleanInt(n))
  if (n < -0x80000000 || n > 0xffffffff) err(`i32 constant out of range`)
  return n
}

/**
 * Encode signed LEB128 for i64 values (BigInt).
 *
 * @param {bigint|string} n - Signed 64-bit value
 * @param {number[]} [buffer=[]] - Output buffer
 * @returns {number[]} Encoded bytes
 */
export function i64(n, buffer = []) {
  if (typeof n === 'string') n = i64.parse(n)
  else if (typeof n === 'number') n = BigInt(n)
  // Normalize unsigned to signed: values > MAX_INT64 become negative
  if (typeof n === 'bigint' && n > 0x7fffffffffffffffn) {
    n = n - 0x10000000000000000n
  }

  while (true) {
    const byte = Number(n & 0x7Fn)
    n >>= 7n
    if ((n === 0n && (byte & 0x40) === 0) || (n === -1n && (byte & 0x40) !== 0)) {
      buffer.push(byte)
      break
    }
    buffer.push((byte | 0x80))
  }
  return buffer
}
const _buf = new ArrayBuffer(8)
const _u8 = new Uint8Array(_buf), _i32 = new Int32Array(_buf), _f32 = new Float32Array(_buf), _f64 = new Float64Array(_buf), _i64 = new BigInt64Array(_buf)

i64.parse = n => {
  n = cleanInt(n)
  const neg = n[0] === '-'
  const body = neg || n[0] === '+' ? n.slice(1) : n
  // Range check on the literal string before BigInt conversion (lexicographic compare on clean digits).
  let max
  if (body[0] === '0' && (body[1] === 'x' || body[1] === 'X')) {
    const hex = body.slice(2).replace(/^0+/, '') || '0'
    max = neg ? '8000000000000000' : 'ffffffffffffffff'
    if (hex.length > 16 || (hex.length === 16 && hex.toLowerCase() > max)) err(`i64 constant out of range`)
  } else {
    const dec = body.replace(/^0+/, '') || '0'
    max = neg ? '9223372036854775808' : '18446744073709551615'
    if (dec.length > max.length || (dec.length === max.length && dec > max)) err(`i64 constant out of range`)
  }
  let bi = BigInt(body)
  if (neg) bi = 0n - bi
  _i64[0] = bi
  return _i64[0]
}

const F32_SIGN = 0x80000000, F32_NAN = 0x7f800000, F32_QUIET = 0x400000
export function f32(input, out, value, idx) {
  // Plain `nan` / `-nan` (with optional `:0xPAYLOAD`) — set the bit pattern explicitly.
  if (typeof input === 'string' && (idx = input.indexOf('nan')) >= 0) {
    if (input[idx + 3] === ':') {
      const tail = input.slice(idx + 4)
      value = (tail === 'canonical' || tail === 'arithmetic') ? F32_QUIET : i32.parse(tail)
    } else value = F32_QUIET
    value = (value | F32_NAN) >>> 0
    if (input[0] === '-') value = (value | F32_SIGN) >>> 0
    _i32[0] = value | 0
  }
  else {
    value = typeof input === 'string' ? f32.parse(input) : input
    _f32[0] = value
  }

  if (out) { out.push(_u8[0], _u8[1], _u8[2], _u8[3]); return }
  return [_u8[0], _u8[1], _u8[2], _u8[3]]
}

const F64_SIGN = 0x8000000000000000n, F64_NAN = 0x7ff0000000000000n, F64_QUIET = 0x8000000000000n
export function f64(input, out, value, idx) {
  // Plain `nan` / `-nan` (with optional `:0xPAYLOAD`) — set the bit pattern explicitly.
  if (typeof input === 'string' && (idx = input.indexOf('nan')) >= 0) {
    if (input[idx + 3] === ':') {
      const tail = input.slice(idx + 4)
      value = (tail === 'canonical' || tail === 'arithmetic') ? F64_QUIET : i64.parse(tail)
    } else value = F64_QUIET
    value |= F64_NAN
    if (input[0] === '-') value |= F64_SIGN
    _i64[0] = value
  }
  else {
    value = typeof input === 'string' ? f64.parse(input) : input
    _f64[0] = value
  }

  if (out) { out.push(_u8[0], _u8[1], _u8[2], _u8[3], _u8[4], _u8[5], _u8[6], _u8[7]); return }
  return [_u8[0], _u8[1], _u8[2], _u8[3], _u8[4], _u8[5], _u8[6], _u8[7]]
}

f64.parse = (input, max=Number.MAX_VALUE) => {
  input = input.replaceAll('_', '')
  let sign = 1;
  if (input[0] === '-') sign = -1, input = input.slice(1);
  else if (input[0] === '+') input = input.slice(1);

  // ref: https://github.com/WebAssembly/wabt/blob/ea193b40d6d4a1a697d68ae855b2b3b3e263b377/src/literal.cc#L253
  // 0x1.5p3
  if (input[1] === 'x') {
    let [sig, exp='0'] = input.split(/p/i); // significand and exponent
    let [int, fract=''] = sig.split('.'); // integer and fractional parts
    let flen = fract.length ?? 0;

    // Parse integer part — accumulate from least-significant digit to preserve precision.
    // parseInt loses low bits for values > 2^53 because left-to-right
    // accumulation rounds at each step; right-to-left keeps intermediates
    // small so the final large+small addition rounds correctly.
    let intVal = 0;
    for (let i = int.length - 1; i >= 2; i--) {
      let digit = parseInt(int[i], 16);
      intVal += digit * (16 ** (int.length - 1 - i));
    }

    // 0x10a.fbc = 0x10afbc * 16⁻³ = 266.9833984375
    // Parse fractional part: fract / 16^flen
    // For better precision, parse as (int + fract) / 16^flen then multiply by 16^flen for int part
    // Equivalent to: intVal + parseInt('0x' + fract) / 16^flen
    let fractVal = fract ? parseInt('0x' + fract) / (16 ** flen) : 0;

    exp = parseInt(exp, 10);

    // Combine: (int + fract) * 2^exp
    let value = sign * (intVal + fractVal) * (2 ** exp);

    // make sure it is not Infinity
    value = Math.max(-max, Math.min(max, value))

    return value
  }

  if (input.includes('nan')) return sign < 0 ? -NaN : NaN;
  if (input.includes('inf')) return sign * Infinity;

  return sign * parseFloat(input)
}

f32.parse = input => f64.parse(input, 3.4028234663852886e+38)

export const v128 = (input) => {
  let n = typeof input === 'string' ? BigInt(input.replaceAll('_', '')) : BigInt(input)
  let arr = new Uint8Array(16)
  for (let i = 0; i < 16; i++) arr[i] = Number(n & 0xffn), n >>= 8n
  return [...arr]
}
