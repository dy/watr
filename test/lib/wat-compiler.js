// https://www.npmjs.com/package/wat-compiler

// lib/const.js
var BYTE = {
  "type.i32": 127,
  "type.i64": 126,
  "type.f32": 125,
  "type.f64": 124,
  "type.void": 64,
  "type.func": 96,
  "type.funcref": 112,
  "section.custom": 0,
  "section.type": 1,
  "section.import": 2,
  "section.function": 3,
  "section.table": 4,
  "section.memory": 5,
  "section.global": 6,
  "section.export": 7,
  "section.start": 8,
  "section.element": 9,
  "section.code": 10,
  "section.data": 11,
  "import.func": 0,
  "import.table": 1,
  "import.memory": 2,
  "import.global": 3,
  "export.function": 0,
  "export.table": 1,
  "export.memory": 2,
  "export.global": 3,
  "global.const": 0,
  "global.var": 1,
  "global.mut": 1,
  "limits.min": 0,
  "limits.minmax": 1,
  "limits.shared": 3
};
var opCodes = [
  "unreachable",
  "nop",
  "block",
  "loop",
  "if",
  "else",
  ,
  ,
  ,
  ,
  ,
  "end",
  "br",
  "br_if",
  "br_table",
  "return",
  "call",
  "call_indirect",
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  ,
  "drop",
  "select",
  ,
  ,
  ,
  ,
  "local.get",
  "local.set",
  "local.tee",
  "global.get",
  "global.set",
  ,
  ,
  ,
  "i32.load",
  "i64.load",
  "f32.load",
  "f64.load",
  "i32.load8_s",
  "i32.load8_u",
  "i32.load16_s",
  "i32.load16_u",
  "i64.load8_s",
  "i64.load8_u",
  "i64.load16_s",
  "i64.load16_u",
  "i64.load32_s",
  "i64.load32_u",
  "i32.store",
  "i64.store",
  "f32.store",
  "f64.store",
  "i32.store8",
  "i32.store16",
  "i64.store8",
  "i64.store16",
  "i64.store32",
  "memory.size",
  "memory.grow",
  "i32.const",
  "i64.const",
  "f32.const",
  "f64.const",
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
  "f32.eq",
  "f32.ne",
  "f32.lt",
  "f32.gt",
  "f32.le",
  "f32.ge",
  "f64.eq",
  "f64.ne",
  "f64.lt",
  "f64.gt",
  "f64.le",
  "f64.ge",
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
  "f64.reinterpret_i64"
];
var alias = {
  "get_local": "local.get",
  "set_local": "local.set",
  "tee_local": "local.tee",
  "get_global": "global.get",
  "set_global": "global.set",
  "i32.trunc_s/f32": "i32.trunc_f32_s",
  "i32.trunc_u/f32": "i32.trunc_f32_u",
  "i32.trunc_s/f64": "i32.trunc_f64_s",
  "i32.trunc_u/f64": "i32.trunc_f64_u",
  "i64.extend_s/i32": "i64.extend_i32_s",
  "i64.extend_u/i32": "i64.extend_i32_u",
  "i64.trunc_s/f32": "i64.trunc_f32_s",
  "i64.trunc_u/f32": "i64.trunc_f32_u",
  "i64.trunc_s/f64": "i64.trunc_f64_s",
  "i64.trunc_u/f64": "i64.trunc_f64_u",
  "f32.convert_s/i32": "f32.convert_i32_s",
  "f32.convert_u/i32": "f32.convert_i32_u",
  "f32.convert_s/i64": "f32.convert_i64_s",
  "f32.convert_u/i64": "f32.convert_i64_u",
  "f32.demote/f64": "f32.demote_f64",
  "f64.convert_s/i32": "f64.convert_i32_s",
  "f64.convert_u/i32": "f64.convert_i32_u",
  "f64.convert_s/i64": "f64.convert_i64_s",
  "f64.convert_u/i64": "f64.convert_i64_u",
  "f64.promote/f32": "f64.promote_f32"
};
for (const [i, op] of opCodes.entries()) {
  if (op != null) {
    BYTE[op] = i;
  }
}
BYTE["i32.trunc_sat_f64_s"] = [252, 2];
for (const name in alias) {
  const i = opCodes.indexOf(alias[name]);
  BYTE[name] = i;
}
var INSTR = {};
for (const op in BYTE) {
  INSTR[op] = wrap_instr(op);
  const [group, method] = op.split(".");
  if (method != null) {
    BYTE[group] = BYTE[group] ?? {};
    BYTE[group][method] = BYTE[op];
    INSTR[group] = INSTR[group] ?? {};
    INSTR[group][method] = wrap_instr(op);
  }
}
var ALIGN = {
  "i32.load": 4,
  "i64.load": 8,
  "f32.load": 4,
  "f64.load": 8,
  "i32.load8_s": 1,
  "i32.load8_u": 1,
  "i32.load16_s": 2,
  "i32.load16_u": 2,
  "i64.load8_s": 1,
  "i64.load8_u": 1,
  "i64.load16_s": 2,
  "i64.load16_u": 2,
  "i64.load32_s": 4,
  "i64.load32_u": 4,
  "i32.store": 4,
  "i64.store": 8,
  "f32.store": 4,
  "f64.store": 8,
  "i32.store8": 1,
  "i32.store16": 2,
  "i64.store8": 1,
  "i64.store16": 2,
  "i64.store32": 4
};

// lib/leb128.js
function* bigint(n) {
  n = to_int64(n);
  while (true) {
    const byte = Number(n & 0x7Fn);
    n >>= 7n;
    if (n === 0n && (byte & 64) === 0 || n === -1n && (byte & 64) !== 0) {
      yield byte;
      break;
    }
    yield byte | 128;
  }
}
function* int(value) {
  let byte = 0;
  const size = Math.ceil(Math.log2(Math.abs(value)));
  const negative = value < 0;
  let more = true;
  while (more) {
    byte = value & 127;
    value = value >> 7;
    if (negative) {
      value = value | -(1 << size - 7);
    }
    if (value == 0 && (byte & 64) == 0 || value == -1 && (byte & 64) == 64) {
      more = false;
    } else {
      byte = byte | 128;
    }
    yield byte;
  }
}
function* uint(value, pad = 0) {
  if (value < 0)
    throw new TypeError("uint value must be positive, received: " + value);
  let byte = 0;
  do {
    byte = value & 127;
    value = value >> 7;
    if (value != 0 || pad > 0) {
      byte = byte | 128;
    }
    yield byte;
    pad--;
  } while (value != 0 || pad > -1);
}
var byteView = new DataView(new BigInt64Array(1).buffer);
function to_int64(value) {
  byteView.setBigInt64(0, value);
  return byteView.getBigInt64(0);
}
function* f32(value) {
  byteView.setFloat32(0, value);
  for (let i = 4; i--; )
    yield byteView.getUint8(i);
}
function* f64(value) {
  byteView.setFloat64(0, value);
  for (let i = 8; i--; )
    yield byteView.getUint8(i);
}
function hex2float(input) {
  input = input.toUpperCase();
  const splitIndex = input.indexOf("P");
  let mantissa, exponent;
  if (splitIndex !== -1) {
    mantissa = input.substring(0, splitIndex);
    exponent = parseInt(input.substring(splitIndex + 1));
  } else {
    mantissa = input;
    exponent = 0;
  }
  const dotIndex = mantissa.indexOf(".");
  if (dotIndex !== -1) {
    let integerPart = parseInt(mantissa.substring(0, dotIndex), 16);
    const sign = Math.sign(integerPart);
    integerPart = sign * integerPart;
    const fractionLength = mantissa.length - dotIndex - 1;
    const fractionalPart = parseInt(mantissa.substring(dotIndex + 1), 16);
    const fraction = fractionLength > 0 ? fractionalPart / Math.pow(16, fractionLength) : 0;
    if (sign === 0) {
      if (fraction === 0) {
        mantissa = sign;
      } else {
        if (Object.is(sign, -0)) {
          mantissa = -fraction;
        } else {
          mantissa = fraction;
        }
      }
    } else {
      mantissa = sign * (integerPart + fraction);
    }
  } else {
    mantissa = parseInt(mantissa, 16);
  }
  return mantissa * (splitIndex !== -1 ? Math.pow(2, exponent) : 1);
}
var F32_SIGN = 2147483648;
var F32_NAN = 2139095040;
function* nanbox32(input) {
  let value = parseInt(input.split("nan:")[1]);
  value |= F32_NAN;
  if (input[0] === "-")
    value |= F32_SIGN;
  byteView.setInt32(0, value);
  for (let i = 4; i--; )
    yield byteView.getUint8(i);
}
var F64_SIGN = 0x8000000000000000n;
var F64_NAN = 0x7ff0000000000000n;
function* nanbox64(input) {
  let value = BigInt(input.split("nan:")[1]);
  value |= F64_NAN;
  if (input[0] === "-")
    value |= F64_SIGN;
  byteView.setBigInt64(0, value);
  for (let i = 8; i--; )
    yield byteView.getUint8(i);
}

// lib/binary.js
(function(l) {
  function m() {
  }
  function k(a, c) {
    a = a === void 0 ? "utf-8" : a;
    c = c === void 0 ? { fatal: false } : c;
    if (r.indexOf(a.toLowerCase()) === -1)
      throw new RangeError("Failed to construct 'TextDecoder': The encoding label provided ('" + a + "') is invalid.");
    if (c.fatal)
      throw Error("Failed to construct 'TextDecoder': the 'fatal' option is unsupported.");
  }
  function t(a) {
    return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("utf-8");
  }
  function u(a) {
    var c = URL.createObjectURL(new Blob([a], { type: "text/plain;charset=UTF-8" }));
    try {
      var f = new XMLHttpRequest();
      f.open("GET", c, false);
      f.send();
      return f.responseText;
    } catch (e) {
      return q(a);
    } finally {
      URL.revokeObjectURL(c);
    }
  }
  function q(a) {
    for (var c = 0, f = Math.min(65536, a.length + 1), e = new Uint16Array(f), h = [], d = 0; ; ) {
      var b = c < a.length;
      if (!b || d >= f - 1) {
        h.push(String.fromCharCode.apply(null, e.subarray(0, d)));
        if (!b)
          return h.join("");
        a = a.subarray(c);
        d = c = 0;
      }
      b = a[c++];
      if ((b & 128) === 0)
        e[d++] = b;
      else if ((b & 224) === 192) {
        var g = a[c++] & 63;
        e[d++] = (b & 31) << 6 | g;
      } else if ((b & 240) === 224) {
        g = a[c++] & 63;
        var n = a[c++] & 63;
        e[d++] = (b & 31) << 12 | g << 6 | n;
      } else if ((b & 248) === 240) {
        g = a[c++] & 63;
        n = a[c++] & 63;
        var v = a[c++] & 63;
        b = (b & 7) << 18 | g << 12 | n << 6 | v;
        65535 < b && (b -= 65536, e[d++] = b >>> 10 & 1023 | 55296, b = 56320 | b & 1023);
        e[d++] = b;
      }
    }
  }
  if (l.TextEncoder && l.TextDecoder)
    return false;
  var r = ["utf-8", "utf8", "unicode-1-1-utf-8"];
  Object.defineProperty(m.prototype, "encoding", { value: "utf-8" });
  m.prototype.encode = function(a, c) {
    c = c === void 0 ? { stream: false } : c;
    if (c.stream)
      throw Error("Failed to encode: the 'stream' option is unsupported.");
    c = 0;
    for (var f = a.length, e = 0, h = Math.max(32, f + (f >>> 1) + 7), d = new Uint8Array(h >>> 3 << 3); c < f; ) {
      var b = a.charCodeAt(c++);
      if (55296 <= b && 56319 >= b) {
        if (c < f) {
          var g = a.charCodeAt(c);
          (g & 64512) === 56320 && (++c, b = ((b & 1023) << 10) + (g & 1023) + 65536);
        }
        if (55296 <= b && 56319 >= b)
          continue;
      }
      e + 4 > d.length && (h += 8, h *= 1 + c / a.length * 2, h = h >>> 3 << 3, g = new Uint8Array(h), g.set(d), d = g);
      if ((b & 4294967168) === 0)
        d[e++] = b;
      else {
        if ((b & 4294965248) === 0)
          d[e++] = b >>> 6 & 31 | 192;
        else if ((b & 4294901760) === 0)
          d[e++] = b >>> 12 & 15 | 224, d[e++] = b >>> 6 & 63 | 128;
        else if ((b & 4292870144) === 0)
          d[e++] = b >>> 18 & 7 | 240, d[e++] = b >>> 12 & 63 | 128, d[e++] = b >>> 6 & 63 | 128;
        else
          continue;
        d[e++] = b & 63 | 128;
      }
    }
    return d.slice ? d.slice(0, e) : d.subarray(0, e);
  };
  Object.defineProperty(k.prototype, "encoding", { value: "utf-8" });
  Object.defineProperty(k.prototype, "fatal", { value: false });
  Object.defineProperty(k.prototype, "ignoreBOM", { value: false });
  var p = q;
  typeof Buffer === "function" && Buffer.from ? p = t : typeof Blob === "function" && typeof URL === "function" && typeof URL.createObjectURL === "function" && (p = u);
  k.prototype.decode = function(a, c) {
    c = c === void 0 ? { stream: false } : c;
    if (c.stream)
      throw Error("Failed to decode: the 'stream' option is unsupported.");
    a = a instanceof Uint8Array ? a : a.buffer instanceof ArrayBuffer ? new Uint8Array(a.buffer) : new Uint8Array(a);
    return p(a);
  };
  l.TextEncoder = m;
  l.TextDecoder = k;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : globalThis);
function wrap_instr(code) {
  return function(args, exprs) {
    return instr(code, args != null && !Array.isArray(args) ? [args] : args, exprs != null && !Array.isArray(exprs) ? [exprs] : exprs);
  };
}
var encoding = {
  "f64.const": f64,
  "f32.const": f32
};
function* instr(code, args = [], exprs = []) {
  for (let expr of exprs) {
    switch (typeof expr) {
      case "number":
        yield expr;
        break;
      default:
        yield* expr;
        break;
    }
  }
  yield* Array.isArray(BYTE[code]) ? BYTE[code] : [BYTE[code]];
  for (let arg of args) {
    switch (typeof arg) {
      case "bigint":
        yield* bigint(arg);
        break;
      case "number":
        yield* (encoding[code] ?? int)(arg);
        break;
      default:
        yield* arg;
    }
  }
}
var encoder = new TextEncoder("utf-8");
function utf8(s) {
  return [...encoder.encode(s)];
}
function header() {
  return [...utf8("\0asm"), 1, 0, 0, 0];
}
function section(type, data) {
  return [BYTE.section[type], ...uint(data.length), ...data];
}
function vector(items) {
  return [...uint(items.length), ...items.flat()];
}
function locals(items) {
  const out = [];
  let curr = [];
  let prev;
  for (const type of items) {
    if (type !== prev && curr.length) {
      out.push([...uint(curr.length), BYTE.type[curr[0]]]);
      curr = [];
    }
    curr.push(type);
    prev = type;
  }
  if (curr.length)
    out.push([...uint(curr.length), BYTE.type[curr[0]]]);
  return out;
}
function limits(min, max, shared) {
  if (shared != null) {
    return [BYTE.limits.shared, ...uint(min), ...uint(max)];
  } else if (max != null) {
    return [BYTE.limits.minmax, ...uint(min), ...uint(max)];
  } else {
    return [BYTE.limits.min, ...uint(min)];
  }
}
section.type = function(types) {
  return section("type", vector(types.map(([params, results]) => [
    BYTE.type.func,
    ...vector(params.map((x) => BYTE.type[x])),
    ...vector(results.map((x) => BYTE.type[x]))
  ])));
};
section.import = function(imported) {
  return section("import", vector(imported.map(([mod, field, type, desc]) => [
    ...vector(utf8(mod)),
    ...vector(utf8(field)),
    BYTE.import[type],
    ...{
      "func": () => desc.map((idx) => [...uint(idx)]),
      "memory": () => limits(...desc)
    }[type]()
  ])));
};
section.function = function(funcs) {
  return section("function", vector(funcs.map((func) => [...uint(func)])));
};
section.table = function(tables) {
  return section("table", vector(tables.map(([type, min, max]) => [BYTE.type[type], ...limits(min, max)])));
};
section.memory = function(memories) {
  return section("memory", vector(memories.map(([min, max]) => limits(min, max))));
};
section.global = function(globals) {
  return section("global", vector(globals.map(([mut, valtype, expr]) => [BYTE.type[valtype], BYTE.global[mut], ...expr, BYTE.end])));
};
section.export = function(exports) {
  return section("export", vector(exports.map(([name, type, idx]) => [...vector(utf8(name)), BYTE.export[type], ...uint(idx)])));
};
section.start = function(func_idx) {
  return section("start", [...uint(func_idx)]);
};
section.element = function(elements) {
  return section("element", vector(elements.map(([table_idx, offset_idx_expr, funcs]) => [...uint(table_idx), ...offset_idx_expr, BYTE.end, ...vector(funcs)])));
};
section.code = function(funcs) {
  return section("code", vector(funcs.map(([func_locals, func_body]) => vector([...vector(locals(func_locals)), ...func_body, BYTE.end]))));
};
section.data = function(data) {
  return section("data", vector(data.map(([mem_idx, offset_idx_expr, bytes]) => [...uint(mem_idx), ...offset_idx_expr, BYTE.end, ...vector(bytes)])));
};

// lib/builder.js
var ByteArray = class extends Array {
  log = [];
  write(array, annotation) {
    this.log.push(array, annotation);
    this.push(...array);
    return this;
  }
  get buffer() {
    return new Uint8Array(this);
  }
};
var ModuleBuilder = class {
  types = [];
  imports = [];
  tables = [];
  memories = [];
  globals = [];
  exports = [];
  starts = "";
  elements = [];
  codes = [];
  datas = [];
  constructor(data) {
    if (data)
      Object.assign(this, data);
  }
  get funcs() {
    return this.codes.filter((func) => !func.imported);
  }
  ensureType(params, results) {
    const type_sig = [params.join(" "), results.join(" ")].join();
    const idx = this.types.indexOf(type_sig);
    if (idx >= 0)
      return idx;
    return this.types.push(type_sig) - 1;
  }
  getGlobalIndexOf(name) {
    return this.globals.find((glob) => glob.name === name).idx;
  }
  getFunc(name) {
    return this.codes.find((func) => func.name === name);
  }
  getMemory(name) {
    return this.memories.find((mem) => mem.name === name);
  }
  getType(name) {
    return this.types[name];
  }
  type(name, params, results) {
    this.types[name] = this.ensureType(params, results);
    return this;
  }
  import(type, name, mod, field, params, results) {
    if (type === "func") {
      const func = this._func(name, params, results, [], [], false, true);
      this.imports.push({ mod, field, type, desc: [func.type_idx] });
    } else if (type === "memory") {
      this.imports.push({ mod, field, type, desc: params });
    }
    return this;
  }
  table(type, min, max) {
    this.tables.push({ type, min, max });
    return this;
  }
  memory(name, min, max) {
    this.memories.push({ name, min, max });
    return this;
  }
  global(name, mut, valtype, expr) {
    const global_idx = this.globals.length;
    this.globals.push({ idx: global_idx, name, valtype, mut, expr });
    return this;
  }
  export(type, name, export_name) {
    this.exports.push({ type, name, export_name });
    return this;
  }
  start(name) {
    this.starts = name;
    return this;
  }
  elem(offset_idx_expr, codes) {
    this.elements.push({ offset_idx_expr, codes });
    return this;
  }
  _func(name, params = [], results = [], locals2 = [], body = [], exported = false, imported = false) {
    const type_idx = this.ensureType(params, results);
    const func_idx = this.codes.length;
    const func = { idx: func_idx, name, type_idx, locals: locals2, body, imported };
    this.codes.push(func);
    if (exported) {
      this.export("func", name, name);
    }
    return func;
  }
  func(...args) {
    this._func(...args);
    return this;
  }
  data(offset_idx_expr, bytes) {
    this.datas.push({ offset_idx_expr, bytes });
    return this;
  }
  build({ metrics = true } = {}) {
    const bytes = new ByteArray();
    bytes.write(header());
    if (this.types.length) {
      bytes.write(section.type(this.types.map((type) => type.split(",").map((x) => x.split(" ").filter(Boolean)))));
    }
    if (this.imports.length) {
      bytes.write(section.import(this.imports.map((imp) => [imp.mod, imp.field, imp.type, imp.desc])));
    }
    if (this.funcs.length) {
      bytes.write(section.function(this.funcs.map((func) => func.type_idx)));
    }
    if (this.elements.length) {
      bytes.write(section.table(this.tables.map((table) => [table.type, table.min, table.max])));
    }
    if (this.memories.length) {
      bytes.write(section.memory(this.memories.map((mem) => [mem.min, mem.max])));
    }
    if (this.globals.length) {
      bytes.write(section.global(this.globals.map((glob) => [glob.mut, glob.valtype, glob.expr])));
    }
    if (this.exports.length) {
      bytes.write(section.export(this.exports.map((exp) => exp.type === "func" ? [exp.export_name, exp.type, this.getFunc(exp.name).idx] : exp.type === "memory" ? [exp.export_name, exp.type, this.getMemory(exp.name).idx] : exp.type === "global" ? [exp.export_name, exp.type, this.getGlobalIndexOf(exp.name)] : [])));
    }
    if (this.starts.length) {
      bytes.write(section.start(this.getFunc(this.starts).idx));
    }
    if (this.elements.length) {
      bytes.write(section.element(this.elements.map((elem) => [
        0,
        elem.offset_idx_expr,
        elem.codes.map((name) => this.getFunc(name).idx)
      ])));
    }
    if (this.funcs.length) {
      bytes.write(section.code(this.funcs.map((func) => [func.locals, func.body])));
    }
    if (this.datas.length) {
      bytes.write(section.data(this.datas.map((data) => [
        0,
        data.offset_idx_expr,
        data.bytes
      ])));
    }
    return bytes;
  }
};

// lib/compiler.js
var GlobalContext = class {
  globals = [];
  types = [];
  funcs = [];
  constructor(data) {
    if (data) {
      Object.assign(this, data);
      this.funcs.forEach((x) => {
        x.context = new FunctionContext(this, x.context);
      });
    }
  }
  lookup(name, instr2) {
    let index;
    switch (instr2) {
      case "call":
        {
          index = this.funcs.map((x) => x.name).lastIndexOf(name);
        }
        break;
      case "type":
        {
          index = this.types.map((x) => x.name).lastIndexOf(name);
        }
        break;
      default: {
        index = this.globals.map((x) => x.name).lastIndexOf(name);
      }
    }
    if (!~index)
      throw new ReferenceError(`lookup failed at: ${instr2} "${name}"`);
    return uint(index);
  }
};
var FunctionContext = class {
  #global = null;
  locals = [];
  depth = [];
  constructor(global2, data) {
    this.#global = global2;
    if (data)
      Object.assign(this, data);
  }
  lookup(name, instr2) {
    let index;
    switch (instr2) {
      case "br":
      case "br_table":
      case "br_if":
        {
          index = this.depth.lastIndexOf(name);
          if (~index)
            index = this.depth.length - 1 - index;
        }
        break;
      default: {
        index = this.locals.lastIndexOf(name);
      }
    }
    if (!~index)
      return this.#global.lookup(name, instr2);
    return uint(index);
  }
};
function compile(node, moduleData, globalData) {
  const m = new ModuleBuilder(moduleData);
  const g = new GlobalContext(globalData);
  const deferred = [];
  function cast(param, context = g, instr2 = "i32") {
    switch (param.kind) {
      case "number": {
        if (param.value === "inf" || param.value === "+inf") {
          return Infinity;
        } else if (param.value === "-inf") {
          return -Infinity;
        } else if (param.value === "nan" || param.value === "+nan") {
          return NaN;
        } else if (param.value === "-nan") {
          return NaN;
        } else if (instr2?.[0] === "f") {
          return parseFloat(param.value);
        }
      }
      case "hex": {
        let value;
        if (instr2.indexOf("i64") === 0) {
          if (param.value[0] === "-") {
            value = -BigInt(param.value.slice(1));
          } else {
            value = BigInt(param.value);
          }
          return value;
        } else if (instr2[0] === "f") {
          if (param.value.indexOf("nan") >= 0) {
            if (instr2.indexOf("f32") === 0) {
              value = nanbox32(param.value);
            } else {
              value = nanbox64(param.value);
            }
          } else {
            value = hex2float(param.value);
          }
          return value;
        } else {
          return parseInt(param.value);
        }
      }
      case "label":
        return context.lookup(param.value, instr2);
      default:
        return param.value;
    }
  }
  function bytes(instr2, args, expr) {
    if (!(instr2 in INSTR) || typeof INSTR[instr2] !== "function") {
      throw new Error("Unknown instruction: " + instr2);
    }
    return [...INSTR[instr2](args, expr)];
  }
  function evaluate(node2, context = g) {
    const address = { offset: 0, align: 0 };
    const instr2 = node2.instr.value;
    switch (instr2) {
      case "type": {
        return m.getType(node2.name.value);
      }
      case "call_indirect": {
        const args = [evaluate(node2.children.shift(), context), 0];
        const expr = node2.children.flatMap((x) => evaluate(x, context));
        return bytes(instr2, args, expr);
      }
      case "memory.grow": {
        const args = [0];
        const expr = node2.children.flatMap((x) => evaluate(x, context));
        return bytes(instr2, args, expr);
      }
      case "i32.load":
      case "i64.load":
      case "f32.load":
      case "f64.load":
      case "i32.load8_s":
      case "i32.load8_u":
      case "i32.load16_s":
      case "i32.load16_u":
      case "i64.load8_s":
      case "i64.load8_u":
      case "i64.load16_s":
      case "i64.load16_u":
      case "i64.load32_s":
      case "i64.load32_u":
      case "i32.store":
      case "i64.store":
      case "f32.store":
      case "f64.store":
      case "i32.store8":
      case "i32.store16":
      case "i64.store8":
      case "i64.store16":
      case "i64.store32": {
        address.align = ALIGN[instr2];
        for (const p of node2.params) {
          address[p.param.value] = cast(p.value);
        }
        const args = [Math.log2(address.align), address.offset].map((x) => {
          if (typeof x === "number")
            return uint(x);
          else if (typeof x === "bigint")
            return bigint(x);
        });
        const expr = node2.children.flatMap((x) => evaluate(x, context));
        return bytes(instr2, args, expr);
      }
      case "func": {
        const func = {
          name: node2.name?.value ?? g.funcs.length,
          params: [],
          results: []
        };
        g.funcs.push(func);
        for (const c of node2.children) {
          switch (c.instr.value) {
            case "param":
              {
                func.params.push(...c.children.map((x) => x.instr.value));
              }
              break;
            case "result":
              {
                func.results.push(...c.children.map((x) => x.instr.value));
              }
              break;
          }
        }
        return [func.name, func.params, func.results];
      }
      case "result": {
        return node2.children.flatMap((x) => INSTR.type[x.instr.value]());
      }
      case "else":
      case "then": {
        return node2.children.flatMap((x) => evaluate(x, context));
      }
      case "if": {
        const name = node2.name?.value ?? context.depth.length;
        const results = [];
        const branches = [];
        let cond, thenbody;
        context.depth.push(name);
        for (const c of node2.children) {
          switch (c.instr.value) {
            case "result":
              {
                results.push(evaluate(c, context));
              }
              break;
            case "else":
              branches.push(...INSTR.else());
            case "then":
              {
                thenbody = evaluate(c, context);
                branches.push(thenbody);
              }
              break;
            default: {
              if (cond) {
                if (thenbody) {
                  branches.push(...INSTR.else());
                  branches.push(evaluate(c, context));
                } else {
                  thenbody = evaluate(c, context);
                  branches.push(thenbody);
                }
              } else {
                cond = evaluate(c, context);
              }
            }
          }
        }
        context.depth.pop();
        if (!results.length) {
          results.push(INSTR.type.void());
        }
        return [
          ...INSTR.if(results.flat(), cond),
          ...branches.flat(),
          ...INSTR.end()
        ];
      }
      case "loop":
      case "block": {
        const name = node2.name?.value ?? context.depth.length;
        const results = [];
        const body = [];
        context.depth.push(name);
        for (const c of node2.children) {
          switch (c.instr.value) {
            case "result":
              {
                results.push(evaluate(c, context));
              }
              break;
            default: {
              body.push(evaluate(c, context));
            }
          }
        }
        context.depth.pop();
        if (!results.length) {
          results.push(INSTR.type.void());
        }
        return [
          ...INSTR[instr2](),
          ...results.flat().map((x) => [...x]),
          ...body.flat(),
          ...INSTR.end()
        ];
      }
      case "br_table": {
        if (node2.name) {
          node2.params.unshift({
            param: {
              value: context.lookup(node2.name.value, instr2)
            }
          });
        }
        const args = node2.params.map((x) => cast(x.param, context, instr2));
        const expr = node2.children.flatMap((x) => evaluate(x, context));
        return bytes(instr2, [args.length - 1, ...args], expr);
      }
      default: {
        if (node2.name) {
          node2.params.unshift({
            param: {
              value: (instr2.startsWith("global") ? g : context).lookup(node2.name.value, instr2)
            }
          });
        }
        const args = node2.params.map((x) => cast(x.param, context, instr2));
        const expr = node2.children.flatMap((x) => evaluate(x, context));
        return bytes(instr2, args, expr);
      }
    }
  }
  function build(node2) {
    switch (node2.instr.value) {
      case "module":
        {
          node2.children.forEach((x) => build(x));
        }
        break;
      case "memory":
        {
          const name = node2.name?.value ?? m.memories.length;
          const args = node2.params.map((x) => cast(x.param)).flat();
          if (node2.children?.[0]?.instr.value === "export") {
            const export_name = node2.children[0].params[0].param.value;
            const internal_name = node2.children[0].name?.value ?? name ?? 0;
            m.export("memory", internal_name, export_name);
          }
          m.memory(name, ...args);
        }
        break;
      case "data":
        {
          const expr = node2.children.shift();
          const data = node2.children.shift().data;
          m.data(evaluate(expr), data);
        }
        break;
      case "start":
        {
          m.start(node2.name.value);
        }
        break;
      case "table":
        {
          const args = node2.params.map((x) => cast(x.param));
          args.unshift(args.pop());
          m.table(...args);
        }
        break;
      case "elem":
        {
          const expr = node2.children.shift();
          const refs = node2.children.map((x) => x.ref.value);
          m.elem(evaluate(expr), refs);
        }
        break;
      case "import":
        {
          if (node2.children[0].instr.value === "func") {
            const args = node2.params.map((x) => cast(x.param));
            const func = evaluate(node2.children[0]);
            const name = func.shift();
            m.import("func", name, ...args, ...func);
          } else if (node2.children[0].instr.value === "memory") {
            const memory = node2.children[0];
            const args = node2.params.map((x) => cast(x.param));
            const name = memory.instr.name;
            const desc = memory.params.map((x) => cast(x.param));
            m.import("memory", name, ...args, desc);
          }
        }
        break;
      case "global":
        {
          const glob = {
            name: node2.name?.value ?? m.globals.length,
            vartype: "const",
            type: node2.children[0].instr.value
          };
          g.globals.push(glob);
          if (glob.type === "export") {
            const export_name = node2.children.shift().params[0].param.value;
            m.export("global", glob.name, export_name);
            glob.type = node2.children[0].instr.value;
          }
          if (glob.type === "mut") {
            glob.vartype = "var";
            glob.type = node2.children[0].children[0].instr.value;
          }
          const expr = node2.children[1];
          m.global(glob.name, glob.vartype, glob.type, evaluate(expr));
        }
        break;
      case "type":
        {
          const type = {
            name: node2.name?.value ?? m.types.length,
            params: [],
            results: []
          };
          g.types.push(type);
          for (const c of node2.children[0].children) {
            switch (c.instr.value) {
              case "param":
                {
                  type.params.push(...c.children.map((x) => x.instr.value));
                }
                break;
              case "result":
                {
                  type.results.push(...c.children.map((x) => x.instr.value));
                }
                break;
            }
          }
          m.type(type.name, type.params, type.results);
        }
        break;
      case "export":
        {
          const exp = {
            name: node2.params[0].param.value
          };
          exp.type = node2.children[0].instr.value;
          exp.internal_name = node2.children[0].name.value;
          m.export(exp.type, exp.internal_name, exp.name);
        }
        break;
      case "func":
        {
          const func = {
            name: node2.name?.value ?? g.funcs.length,
            context: new FunctionContext(g),
            params: [],
            results: [],
            locals: [],
            body: []
          };
          g.funcs.push(func);
          for (const c of node2.children) {
            switch (c.instr.value) {
              case "export":
                {
                  const export_name = c.params[0].param.value;
                  m.export("func", func.name, export_name);
                }
                break;
              case "local":
                {
                  func.locals.push(...c.children.map((x) => x.instr.value));
                  func.context.locals.push(...c.children.map(() => c.name?.value));
                }
                break;
              case "param":
                {
                  func.params.push(...c.children.map((x) => x.instr.value));
                  func.context.locals.push(...c.children.map(() => c.name?.value));
                }
                break;
              case "result":
                {
                  func.results.push(...c.children.map((x) => x.instr.value));
                }
                break;
              default: {
                func.body.push(c);
              }
            }
          }
          deferred.push(() => {
            m.func(func.name, func.params, func.results, func.locals, [...func.body.flatMap((x) => evaluate(x, func.context))]);
          });
        }
        break;
    }
  }
  build(node);
  deferred.forEach((fn) => fn());
  return { module: m, global: g };
}

// lib/lexer.js
var regexp = new RegExp([
  /(?<comment>;;.*|\(;[^]*?;\))/,
  /"(?<string>(?:\\"|[^"])*?)"/,
  /(?<param>offset|align|shared|funcref)=?/,
  /(?<hex>([+-]?nan:)?[+-]?0x[0-9a-f.p+-_]+)/,
  /(?<number>[+-]?inf|[+-]?nan|[+-]?\d[\d.e_+-]*)/,
  /(?<instr>[a-z][a-z0-9!#$%&'*+\-./:<=>?@\\^_`|~]+)/,
  /\$(?<label>[a-z0-9!#$%&'*+\-./:<=>?@\\^_`|~]+)/,
  /(?<lparen>\()|(?<rparen>\))|(?<nul>[ \t\n]+)|(?<error>.)/
].map((x) => x.toString().slice(1, -1)).join("|"), "gi");
function tokenize(input) {
  let last = {};
  let curr = {};
  const matches = input.matchAll(regexp);
  function next() {
    const match = matches.next();
    if (match.done)
      return { value: { value: null, kind: "eof", index: input.length }, done: true };
    const [kind, value] = Object.entries(match.value.groups).filter((e) => e[1] != null)[0];
    return { value: { value, kind, index: match.value.index }, done: false };
  }
  function advance() {
    last = curr;
    do {
      curr = next().value;
    } while (curr.kind === "nul" || curr.kind === "comment");
    return last;
  }
  function peek(kind, value) {
    if (kind != null) {
      if (value != null) {
        return value === curr.value;
      } else {
        return kind === curr.kind;
      }
    }
    return curr;
  }
  function accept(kind, value) {
    if (kind === curr.kind) {
      if (value != null) {
        if (value === curr.value) {
          return advance();
        }
      } else {
        return advance();
      }
    }
    return null;
  }
  function expect(kind, value) {
    const token = accept(kind, value);
    if (!token) {
      throw new SyntaxError("Unexpected token: " + curr.value + "\n        expected: " + kind + (value ? ' "' + value + '"' : "") + "\n    but received: " + curr.kind + "\n     at position: " + curr.index);
    }
    return token;
  }
  const iterator = {
    [Symbol.iterator]() {
      return this;
    },
    next,
    advance,
    peek,
    accept,
    expect,
    start: advance
  };
  return iterator;
}

// lib/parser.js
function parse({ start, peek, accept, expect }) {
  const encoder2 = new TextEncoder("utf-8");
  const HEX = /[0-9a-f]/i;
  const stringchar = {
    t: 9,
    n: 10,
    r: 13,
    '"': 34,
    "'": 39,
    "\\": 92
  };
  function parseDataString() {
    const parsed = [];
    while (1) {
      const str = accept("string");
      if (!str)
        break;
      for (let i = 0, ch, next; i < str.value.length; i++) {
        ch = str.value[i];
        if (ch === "\\") {
          next = str.value[i + 1];
          if (next in stringchar) {
            parsed.push(stringchar[next]);
            i++;
            continue;
          } else if (HEX.test(next)) {
            if (HEX.test(str.value[i + 2])) {
              parsed.push(parseInt(`${next}${str.value[i += 2]}`, 16));
            } else {
              parsed.push(parseInt(next, 16));
              i++;
            }
            continue;
          }
        }
        parsed.push(encoder2.encode(ch));
      }
    }
    return parsed;
  }
  function* params() {
    let param;
    while (1) {
      if (param = accept("number")) {
        param.value = param.value.replace(/_/g, "");
        yield { param };
        continue;
      }
      if (param = accept("hex")) {
        param.value = param.value.replace(/_/g, "");
        yield { param };
        continue;
      }
      if (param = accept("string")) {
        yield { param };
        continue;
      }
      if (param = accept("label")) {
        yield { param };
        continue;
      }
      if (param = accept("param")) {
        let value;
        if (value = accept("number")) {
          yield { param, value };
          continue;
        }
        if (value = accept("hex")) {
          yield { param, value };
          continue;
        } else {
          yield { param };
          continue;
        }
      }
      break;
    }
  }
  function expr() {
    const ref = accept("label");
    if (ref)
      return { ref };
    if (peek("string")) {
      return { data: parseDataString() };
    }
    const sexpr = accept("lparen");
    let instr2;
    if (sexpr) {
      instr2 = expect("instr");
    } else {
      instr2 = accept("instr");
      if (!instr2)
        return;
    }
    const node = {
      instr: instr2,
      name: accept("label"),
      params: [...params()],
      children: []
    };
    if (sexpr) {
      let child;
      while (!peek("eof") && (child = expr())) {
        node.children.push(child);
      }
      node.params.push(...params());
      expect("rparen");
    } else if (instr2.value === "block" || instr2.value === "loop") {
      let child;
      while (!peek("eof") && !peek("instr", "end") && (child = expr())) {
        node.children.push(child);
      }
      expect("instr", "end");
    }
    return node;
  }
  start();
  return expr();
}

// index.js
function make(code, options, context = {}) {
  return compile(parse(tokenize("(module " + code + ")")), context.module, context.global).module.build(options).buffer;
}
export {
  GlobalContext,
  ModuleBuilder,
  compile,
  make as default,
  parse,
  tokenize
};
//!time 'module build'
//!timeEnd 'module build'
