// ref: https://github.com/stagas/wat-compiler/blob/main/lib/const.js
const OP = Object.fromEntries([
  'unreachable', 'nop', 'block', 'loop', 'if', 'else', ,,,,,

  'end', 'br', 'br_if', 'br_table', 'return', 'call', 'call_indirect', ,,,,,,,,

  'drop', 'select', ,,,,

  'local.get', 'local.set', 'local.tee', 'global.get', 'global.set', ,,,

  'i32.load', 'i64.load', 'f32.load', 'f64.load',
  'i32.load8_s', 'i32.load8_u', 'i32.load16_s', 'i32.load16_u',
  'i64.load8_s', 'i64.load8_u', 'i64.load16_s', 'i64.load16_u', 'i64.load32_s', 'i64.load32_u',

  'i32.store', 'i64.store', 'f32.store', 'f64.store',
  'i32.store8', 'i32.store16', 'i64.store8', 'i64.store16', 'i64.store32',

  'memory.size', 'memory.grow',

  'i32.const', 'i64.const', 'f32.const', 'f64.const',
  'i32.eqz', 'i32.eq', 'i32.ne', 'i32.lt_s', 'i32.lt_u', 'i32.gt_s', 'i32.gt_u', 'i32.le_s', 'i32.le_u', 'i32.ge_s', 'i32.ge_u',
  'i64.eqz', 'i64.eq', 'i64.ne', 'i64.lt_s', 'i64.lt_u', 'i64.gt_s', 'i64.gt_u', 'i64.le_s', 'i64.le_u', 'i64.ge_s', 'i64.ge_u',
             'f32.eq', 'f32.ne', 'f32.lt',               'f32.gt',               'f32.le',               'f32.ge',
             'f64.eq', 'f64.ne', 'f64.lt',               'f64.gt',               'f64.le',               'f64.ge',

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
].flatMap((key,i)=>key && [[key,i]])),

RANGE = {min:0, minmax:1, shared:3},
SECTION = {type:1, import:2, func:3, table:4, memory:5, global:6, export:7, start:8, element:9, code:10, data:11},
TYPE = {i32:0x7f, i64:0x7e, f32:0x7d, f64:0x7c, void:0x40, func:0x60, funcref:0x70},
ETYPE = {func: 0, table: 1, memory: 2, global: 3},

ALIGN = {
  'i32.load': 4,
  'i64.load': 8,
  'f32.load': 4,
  'f64.load': 8,

  'i32.load8_s': 1,
  'i32.load8_u': 1,
  'i32.load16_s': 2,
  'i32.load16_u': 2,

  'i64.load8_s': 1,
  'i64.load8_u': 1,
  'i64.load16_s': 2,
  'i64.load16_u': 2,
  'i64.load32_s': 4,
  'i64.load32_u': 4,

  'i32.store': 4,
  'i64.store': 8,
  'f32.store': 4,
  'f64.store': 8,

  'i32.store8': 1,
  'i32.store16': 2,
  'i64.store8': 1,
  'i64.store16': 2,
  'i64.store32': 4,
};

// direct wiki examples https://en.wikipedia.org/wiki/LEB128#Signed_LEB128

const i32 = (value) => {
  value |= 0;
  const result = [];
  while (true) {
    const byte_ = value & 0x7f;
    value >>= 7;
    if (
      (value === 0 && (byte_ & 0x40) === 0) ||
      (value === -1 && (byte_ & 0x40) !== 0)
    ) {
      result.push(byte_);
      return result;
    }
    result.push(byte_ | 0x80);
  }
};

// convert wat tree to wasm binary

var compile = (tree) => {
  // NOTE: alias is stored directly to section array by key, eg. section.func.$name = idx
  let section = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], element: [], code: [], data: []
  }, binary;

  if (typeof tree[0] === 'string') tree = [tree];
  for (let node of tree) compile$1[node[0]]?.(node, section);

  binary = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    ...Object.keys(section).flatMap((key) => {
      let items=section[key], count=items.length, binary;
      if (!count) return []

      binary = items.flat();

      binary.unshift(SECTION[key], binary.length+1, count);
      return binary
    })
  ]);
console.log(section);
  binary.section = section;

  return binary
};

const compile$1 = {
  module([_,...nodes], section) {
    for (let node of nodes) compile$1[node[0]](node, section);
  },

  // (type $name? (func (param $x i32) (param i64 i32) (result i32 i64)))
  // signature part is identical to function
  // FIXME: handle non-function types
  type([_, ...args], ctx) {
    let name = args[0]?.[0]==='$' && args.shift(),
        params = [],
        result = [],
        decl = args[0];

    if (decl[0]==='func') {
      decl.shift();

      // collect params
      while (decl[0]?.[0] === 'param') {
        let [_, ...types] = decl.shift();
        if (types[0]?.[0] === '$') params[types.shift()] = params.length;
        params.push(...types.map(t => TYPE[t]));
      }

      // collect result type
      if (decl[0]?.[0] === 'result') result = decl.shift().slice(1).map(t => TYPE[t]);

      // reuse existing type or register new one
      let bytes = [TYPE.func, params.length, ...params, result.length, ...result];

      let idx = ctx.type.findIndex((prevType) => prevType.every((byte, i) => byte === bytes[i]));
      if (idx < 0) idx = ctx.type.push(bytes)-1;
      if (name) ctx.type[name] = idx;

      return [idx, params, result]
    }
    // TODO: handle non-func other types
  },

  // (func $name? ...params result ...body)
  func([_,...body], ctx) {
    let idx=ctx.func.length, // fn index
        locals=[]; // list of local variables

    // fn name
    if (body[0]?.[0] === '$') ctx.func[body.shift()] = idx;

    // export binding
    if (body[0]?.[0] === 'export') compile$1.export([...body.shift(), ['func', idx]], ctx);

    // register type
    let [typeIdx, params, result] = compile$1.type([,['func',...body]], ctx);
    while (body[0]?.[0] === 'param' || body[0]?.[0] === 'result') body.shift(); // FIXME: is there a way to generalize consuming?
    ctx.func.push([typeIdx]);

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [_, ...localTypes] = body.shift(), name;
      if (localTypes[0][0]==='$')
        params[name=localTypes.shift()] ? err('Ambiguous name '+name) : name,
        locals[name] = params.length + locals.length;
      localTypes.forEach(t => locals.push(TYPE[t]));
    }

    // parse instruction block
    const instr = (node) => {
      // some immediates examples:
      // call_indirect (type $name)
      // if (result type) instr end
      // (if (result type) (then instr))
      // (i32.add a b)
      let [op, ...args] = node, immediates = [];
      let [type, typeOp] = op.split('.');

      // FIXME: figure out how to generalize this case
      // i32.store align=n offset=m
      // console.group(op)
      if (typeOp === 'store') {
        let o = {align: [ALIGN[op]], offset: [0]}, p;
        while (args[0]?.[0] in o) p = args.shift(), o[p[0]] = i32(p[1]);
        immediates.push(...o.align, ...o.offset);
      }
      // i32.const 123
      else if (typeOp === 'const') {
        immediates.push(...i32(args.shift()));
      }
      // local.get id, local.tee id
      else if (type === 'local') {
        let id = args.shift();
        immediates.push(...i32(id[0]==='$' ? params[id] || locals[id] : id));
      }
      // call id arg1 argN
      else if (op === 'call') {
        let id = args.shift();
        immediates.push(...i32(id[0]==='$' ? ctx.func[id] : id));
      }
      else if (op === 'call_indirect') {
        let type = args.shift(), [_,id] = type;
        immediates.push(...i32(id[0]==='$' ? ctx.type[id] : id), 0);
      }

      // other immediates are prev instructions, ie. (i32.add a b) → a b i32.add
      args = args.flatMap(instr);
      // console.log(args, op, immediates)
      // console.groupEnd()

      return [...args, OP[op], ...immediates]
    };

    // FIXME: some instructions may have flat ungrouped immediates, like i32.const 12, i32.store align=a offset=b
    // so this is going to be a different loop
    body = body.flatMap(node => Array.isArray(node) ? instr(node) : [OP[node]]);

    ctx.code.push([body.length+2+locals.length*2, locals.length, ...locals.flatMap(type => [1, type]), ...body, 0x0b]);
  },

  // (memory min max shared)
  memory([_, ...parts], ctx) {
    let imp = false;
    // (memory (import "js" "mem") 1) → (import "js" "mem" (memory 1))
    if (parts[0][0] === 'import') imp = parts.shift();

    let [min, max, shared] = parts, dfn = max ? [RANGE.minmax, +min, +max] : [RANGE.min, +min];

    if (!imp) ctx.memory.push(dfn);
    else {
      let [_, mod, name] = imp;
      ctx.import.push([mod.length, ...encoder.encode(mod), name.length, ...encoder.encode(name), ETYPE.memory, ...dfn]);
    }
  },

  // mut
  global([_, type, mutable], ctx) { ctx.global.push([]); },

  // (table 1 2? funcref)
  table([_, ...args], ctx) {
    let name = args[0][0]==='$' && args.shift();

    let [min, max, kind] = args,
        dfn = kind ? [RANGE.minmax, +min, +max, TYPE[kind]] : [RANGE.min, +min, TYPE[max]];

    if (name) ctx.table[name] = ctx.table.length;
    ctx.table.push(dfn);
  },

  //  (export "name" ([type] $name|idx))
  export([_, name, [kind, idx]], ctx) {
    if (name[0]==='"') name = name.slice(1,-1);
    if (idx[0]==='$') idx = ctx[kind][idx];
    ctx.export.push([name.length, ...encoder.encode(name), ETYPE[kind], idx]);
  },

  // (import "mod" "name" ref)
  import([_, mod, name, ref], ctx) {
    // FIXME: forward here from particular nodes instead: definition for import is same, we should DRY import code
    compile$1[ref[0]]([ref[0], ['import', mod, name], ...ref.slice(1)]);
  },

  // data
  // elem
  // start
  // offset
};

const encoder = new TextEncoder();

const err = text => { throw Error(text) };

const OPAREN=40, CPAREN=41, SPACE=32, SEMIC=59;

var parse = (str) => {
  let i = 0, level = [], buf='';

  const commit = (k,v) => buf && (
    [k, v] = buf.split('='),
    level.push(v ? [k,v] : k),
    buf = ''
  );

  const parseLevel = () => {
    for (let c, root; i < str.length; ) {
      c = str.charCodeAt(i);
      if (c === OPAREN) {
        if (str.charCodeAt(i+1) === SEMIC) i=str.indexOf(';)', i)+2; // (; ... ;)
        else i++, (root=level).push(level=[]), parseLevel(), level=root;
      }
      else if (c === SEMIC) i=str.indexOf('\n', i)+1;  // ; ...
      else if (c <= SPACE) commit(), i++;
      else if (c === CPAREN) return commit(), i++
      else buf+=str[i++];
    }

    commit();
  };

  parseLevel();

  return level.length>1 ? level : level[0]
};

var watr = src => (
  src = typeof src === 'string' ? parse(src) : src,
  compile(src)
);

export { compile, watr as default, parse };
