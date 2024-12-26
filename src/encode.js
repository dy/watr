// encoding ref: https://github.com/j-s-n/WebBS/blob/master/compiler/byteCode.js

// uleb
export const uleb = (n, buffer = []) => {
  if (n == null) return buffer
  if (typeof n === 'string') n = i32.parse(n)

  let byte = n & 0b01111111;
  n = n >>> 7;

  if (n === 0) {
    buffer.push(byte);
    return buffer;
  } else {
    buffer.push(byte | 0b10000000);
    return uleb(n, buffer);
  }
}

// leb
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
// alias
export const i8 = i32, i16 = i32

i32.parse = n => parseInt(n.replaceAll('_', ''))

// bigleb
export function i64(n, buffer = []) {
  if (typeof n === 'string') n = i64.parse(n)

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
i64.parse = n => {
  n = n.replaceAll('_', '')
  n = n[0] === '-' ? -BigInt(n.slice(1)) : BigInt(n)
  byteView.setBigInt64(0, n)
  return n = byteView.getBigInt64(0)
}

const byteView = new DataView(new BigInt64Array(1).buffer)

const F32_SIGN = 0x80000000, F32_NAN = 0x7f800000
export function f32(input, value, idx) {
  if (~(idx = input.indexOf('nan:'))) {
    value = i32.parse(input.slice(idx + 4))
    value |= F32_NAN
    if (input[0] === '-') value |= F32_SIGN
    byteView.setInt32(0, value)
  }
  else {
    value = typeof input === 'string' ? f32.parse(input) : input
    byteView.setFloat32(0, value);
  }

  return [
    byteView.getUint8(3),
    byteView.getUint8(2),
    byteView.getUint8(1),
    byteView.getUint8(0)
  ];
}

const F64_SIGN = 0x8000000000000000n, F64_NAN = 0x7ff0000000000000n
export function f64(input, value, idx) {
  if (~(idx = input.indexOf('nan:'))) {
    value = i64.parse(input.slice(idx + 4))
    value |= F64_NAN
    if (input[0] === '-') value |= F64_SIGN
    byteView.setBigInt64(0, value)
  }
  else {
    value = typeof input === 'string' ? f64.parse(input) : input
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

f64.parse = (input, max=Number.MAX_VALUE) => {
  input = input.replaceAll('_', '')

  let sign = 1;
  if (input[0] === '-' || input[0] === '+') sign = Number(input[0]+1), input = input.slice(1);

  // ref: https://github.com/WebAssembly/wabt/blob/ea193b40d6d4a1a697d68ae855b2b3b3e263b377/src/literal.cc#L253
  // 0x1.5p3
  if (input[1] === 'x') {
    let [sig, exp='0'] = input.split(/p/i); // significand and exponent
    let [int, fract] = sig.split('.'); // integer and fractional parts
    let flen = fract?.length ?? 0;

    sig = parseInt(int + fract); // 0x is included in int
    exp = parseInt(exp, 10);

    // 0x10a.fbc = 0x10afbc * 16⁻³ = 266.9833984375
    // let value = (sig * (16 ** -flen)) * (2 ** exp);
    let value = sig * (2 ** (exp - 4 * flen));

    // make sure it is not Infinity
    value = Math.max(-max, Math.min(max, value))

    return sign * value
  }

  if (input.includes('nan')) return sign < 0 ? -NaN : NaN;
  if (input.includes('inf')) return sign * Infinity;

  return sign * parseFloat(input)
}

f32.parse = input => f64.parse(input, 3.4028234663852886e+38)
