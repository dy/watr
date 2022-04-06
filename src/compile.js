// ref: https://github.com/stagas/wat-compiler/blob/main/lib/const.js
// NOTE: squashing into a string doesn't save up gzipped size
const OP = [
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
],
SECTION = { type:1, import:2, func:3, table:4, memory:5, global:6, export:7, start:8, elem:9, code:10, data:11 },
TYPE = { i32:0x7f, i64:0x7e, f32:0x7d, f64:0x7c, void:0x40, func:0x60, funcref:0x70 },
KIND = { func: 0, table: 1, memory: 2, global: 3 },
ALIGN = {
  'i32.load': 4, 'i64.load': 8, 'f32.load': 4, 'f64.load': 8,
  'i32.load8_s': 1, 'i32.load8_u': 1, 'i32.load16_s': 2, 'i32.load16_u': 2,
  'i64.load8_s': 1, 'i64.load8_u': 1, 'i64.load16_s': 2, 'i64.load16_u': 2, 'i64.load32_s': 4, 'i64.load32_u': 4,  'i32.store': 4,
  'i64.store': 8, 'f32.store': 4, 'f64.store': 8,
  'i32.store8': 1, 'i32.store16': 2, 'i64.store8': 1, 'i64.store16': 2, 'i64.store32': 4,
}
OP.map((op,i)=>OP[op]=i) // init op names

// convert wat tree to wasm binary
export default (nodes) => {
  // IR. Alias is stored directly to section array by key, eg. section.func.$name = idx
  let sections = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], elem: [], code: [], data: []
  }, binary = [
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
  ]

  // (func) → [(func)]
  if (typeof nodes[0] === 'string' && nodes[0] !== 'module') nodes = [nodes]

  // build nodes in order of sections, to properly initialize indexes/aliases
  // must come separate from binary builder: func can define types etc.
  for (let name in sections) {
    let remaining = []
    for (let node of nodes) node[0] === name ? build[name](node, sections) : remaining.push(node)
    nodes = remaining
  }

  // console.log(sections)
  // build binary sections
  for (let name in sections) {
    let items=sections[name]
    if (items.importc) items = items.slice(items.importc) // discard imported functions
    if (!items.length) continue
    let sectionCode = SECTION[name], bytes = []
    if (sectionCode!==8) bytes.push(items.length) // skip start section count
    for (let item of items) bytes.push(...item)
    binary.push(sectionCode, ...uleb(bytes.length), ...bytes)
  }

  return new Uint8Array(binary)
}

const build = {
  // (type $name? (func (param $x i32) (param i64 i32) (result i32 i64)))
  // signature part is identical to function
  // FIXME: handle non-function types
  type([, typeName, decl], ctx) {
    if (typeName[0]!=='$') decl=typeName, typeName=null
    let params = [], result = [], [kind,...sig] = decl, idx, bytes

    if (kind==='func') {
      // collect params
      while (sig[0]?.[0] === 'param') {
        let [, ...types] = sig.shift()
        if (types[0]?.[0] === '$') params[types.shift()] = params.length
        params.push(...types.map(t => TYPE[t]))
      }

      // collect result type
      if (sig[0]?.[0] === 'result') result = sig.shift().slice(1).map(t => TYPE[t])

      // reuse existing type or register new one
      bytes = [TYPE.func, ...uleb(params.length), ...params, ...uleb(result.length), ...result]

      idx = ctx.type.findIndex((prevType) => prevType.every((byte, i) => byte === bytes[i]))
      if (idx < 0) idx = ctx.type.push(bytes)-1
    }

    if (typeName) ctx.type[typeName] = idx

    return [idx, params, result]
  },

  // (func $name? ...params result ...body)
  func([,...body], ctx) {
    let idx=ctx.func.length, // fn index comes after impoted fns
        locals=[], // list of local variables
        callstack=[]

    // fn name
    if (body[0]?.[0] === '$') ctx.func[body.shift()] = idx

    // export binding
    if (body[0]?.[0] === 'export') build.export([...body.shift(), ['func', idx]], ctx)

    // register type
    let [typeIdx, params, result] = build.type([,['func',...body]], ctx)
    // FIXME: try merging with build.type: it should be able to consume body
    while (body[0]?.[0] === 'param' || body[0]?.[0] === 'result') body.shift()
    ctx.func.push([typeIdx])

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [, ...types] = body.shift(), name
      if (types[0][0]==='$')
        params[name=types.shift()] ? err('Ambiguous name '+name) :
        locals[name] = params.length + locals.length
      locals.push(...types.map(t => TYPE[t]))
    }

    // map code instruction into bytes: [args, opCode, immediates]
    const instr = ([op, ...nodes]) => {
      if (op.length===1) err(`Inline instructions are not supported \`${op+nodes.join('')}\``)

      let opCode = OP[op], argc=0, args=[], imm=[], id

      // NOTE: we could reorganize ops by groups and detect signature as `op in STORE`
      // but numeric comparison is faster than generic hash lookup
      // FIXME: we often use OP.end or alike: what if we had list of global constants?

      // binary/unary
      if (opCode>=69) {
          argc = opCode>=167 ||
          (opCode<=159 && opCode>=153) ||
          (opCode<=145 && opCode>=139) ||
          (opCode<=123 && opCode>=121) ||
          (opCode<=105 && opCode>=103) ||
          opCode==80 || opCode==69 ? 1 : 2
      }
      // instruction
      else {
        // (i32.store align=n offset=m at value)
        if (opCode>=40&&opCode<=62) {
          // FIXME: figure out point in Math.log2 aligns
          let o = {align: ALIGN[op], offset: 0}, p
          while (nodes[0]?.[0] in o) p = nodes.shift(), o[p[0]] = +p[1]
          imm = [Math.log2(o.align), o.offset]
          argc = opCode >= 54 ? 2 : 1
        }

        // (i32.const 123)
        else if (opCode>=65&&opCode<=68) imm = opCode < 67 ? leb(nodes.shift()) : (opCode==67 ? f32 : f64)(nodes.shift())

        // (local.get $id), (local.tee $id x)
        else if (opCode>=32&&opCode<=34) {
          imm = uleb(nodes[0]?.[0]==='$' ? params[id=nodes.shift()] || locals[id] : nodes.shift())
          if (opCode>32) argc = 1
        }

        // (global.get id), (global.set id)
        else if (opCode==35||opCode==36) {
          imm = uleb(nodes[0]?.[0]==='$' ? ctx.global[nodes.shift()] : nodes.shift())
          if (opCode>35) argc = 1
        }

        // (call id ...nodes)
        else if (opCode==16) {
          imm = uleb(id = nodes[0]?.[0]==='$' ? ctx.func[nodes.shift()] : nodes.shift());
          // FIXME: how to get signature of imported function
          [,argc] = ctx.type[ctx.func[id][0]]
        }

        // (call_indirect (type $typeName) (idx) ...nodes)
        else if (opCode==17) {
          let typeId = nodes.shift()[1];
          [,argc] = ctx.type[typeId = typeId[0]==='$'?ctx.type[typeId]:typeId]
          argc++
          imm = uleb(typeId), imm.push(0) // extra immediate indicates table idx (reserved)
        }

        // FIXME (memory.grow $idx?)
        else if (opCode==63||opCode==64) {
          imm = [0]
          argc = 1
        }

        // (if (result i32)? (local.get 0) (then a b) (else a b)?)
        else if (opCode==4) {
          callstack.push(opCode)
          let [,type] = nodes[0][0]==='result' ? nodes.shift() : [,'void']
          imm=[TYPE[type]]
          argc = 0, args.push(...instr(nodes.shift()))
          let body
          if (nodes[0][0]==='then') [,...body] = nodes.shift(); else body = nodes
          while (body.length) imm.push(...instr(body.shift()))

          callstack.pop(), callstack.push(OP.else)
          if (nodes[0]?.[0]==='else') {
            [,...body] = nodes.shift()
            imm.push(OP.else, ...body.flatMap(instr))
          }
          callstack.pop()
          imm.push(OP.end)
        }

        // (drop arg), (return arg), (end arg)
        else if (opCode==0x1a || opCode==0x0f || opCode==0x0b) { argc = 1 }

        // (select a b cond)
        else if (opCode==0x1b) { argc = 3 }

        // (block ...), (loop ...)
        else if (opCode==2||opCode==3) {
          callstack.push(opCode)
          if (nodes[0]?.[0]==='$') (callstack[nodes.shift()] = callstack.length)
          let [,type] = nodes[0]?.[0]==='result' ? nodes.shift() : [,'void']
          imm=[TYPE[type]]
          while (nodes.length) imm.push(...instr(nodes.shift()))
          imm.push(OP.end)
          callstack.pop()
        }

        // (br $label result?)
        // (br_if $label cond result?)
        else if (opCode==0x0c||opCode==0x0d) {
          // br index indicates how many callstack items to pop
          imm = uleb(nodes[0]?.[0]==='$' ? callstack.length-callstack[nodes.shift()] : nodes.shift())
          argc = (opCode==0x0d ? 1 + (nodes.length > 1) : !!nodes.length)
        }

        // (br_table 1 2 3 4  0  selector result?)
        else if (opCode==0x0e) {
          imm = []
          while (!Array.isArray(nodes[0])) id=nodes.shift(), imm.push(...uleb(id[0][0]==='$'?callstack.length-callstack[id]:id))
          imm.unshift(...uleb(imm.length-1))
          argc = 1 + (nodes.length>1)
        }

        else if (opCode==null) err(`Unknown instruction \`${op}\``)
      }

      // consume arguments
      if (nodes.length < argc) err(`Stack arguments are not supported at \`${op}\``)
      while (argc--) args.push(...instr(nodes.shift()))
      if (nodes.length) err(`Too many arguments for \`${op}\`.`)

      return [...args, opCode, ...imm]
    }

    let code = body.flatMap(instr)

    // squash local types
    let locTypes = locals.reduce((a, type) => (type==a[a.length-1] ? a[a.length-2]++ : a.push(1,type), a), [])

    ctx.code.push([...uleb(code.length+2+locTypes.length), ...uleb(locTypes.length>>1), ...locTypes, ...code, OP.end])
  },

  // (memory min max shared)
  // (memory $name min max shared)
  // (memory (import "js" "mem") min max shared)
  memory([, ...parts], ctx) {
    if (parts[0][0]==='$') ctx.memory[parts.shift()] = ctx.memory.length
    if (parts[0][0] === 'import') {
      let [imp, ...limits] = parts
      // (import "js" "mem" (memory 1))
      return build.import([...imp, ['memory', ...limits]], ctx)
    }

    ctx.memory.push(range(parts))
  },

  // (global i32 (i32.const 42))
  // (global $id i32 (i32.const 42))
  // (global $id (mut i32) (i32.const 42))
  // (global $g1 (import "js" "g1") (mut i32))  ;; import from js
  global([, ...args], ctx) {
    let name = args[0][0]==='$' && args.shift()
    if (args[0][0]==='import') {
      let [,mod,field] = args.shift()
      build.import([,mod,field,['global',name,...args]], ctx)
    }
    else {
      if (name) ctx.global[name] = ctx.global.length
      let [type, init] = args, mut = type[0] === 'mut' ? 1 : 0
      ctx.global.push([TYPE[mut ? type[1] : type], mut, ...iinit(init)])
    }
  },

  // (table 1 2? funcref)
  // (table $name 1 2? funcref)
  table([, ...args], ctx) {
    let name = args[0][0]==='$' && args.shift()
    if (name) ctx.table[name] = ctx.table.length

    let lims = range(args)
    ctx.table.push([TYPE[args.pop()], ...lims])
  },

  // (elem (i32.const 0) $f1 $f2), (elem (global.get 0) $f1 $f2)
  elem([, offset, ...elems], ctx) {
    const tableIdx = 0 // FIXME: table index can be defined
    ctx.elem.push([tableIdx, ...iinit(offset, ctx), ...uleb(elems.length), ...elems.flatMap(el => uleb(el[0]==='$' ? ctx.func[el] : el))])
  },

  //  (export "name" (kind $name|idx))
  export([, name, [kind, idx]], ctx) {
    if (idx[0]==='$') idx = ctx[kind][idx]
    ctx.export.push([...str(name), KIND[kind], ...uleb(idx)])
  },

  // (import "math" "add" (func $add (param i32 i32 externref) (result i32)))
  // (import "js" "mem" (memory 1))
  // (import "js" "mem" (memory $name 1))
  // (import "js" "v" (global $name (mut f64)))
  import([, mod, field, ref], ctx) {
    let details, [kind, ...parts] = ref,
        name = parts[0]?.[0]==='$' && parts.shift();

    if (kind==='func') {
      // we track imported funcs in func section to share namespace, and skip them on final build
      if (name) ctx.func[name] = ctx.func.length
      let [typeIdx] = build.type([, ['func', ...parts]], ctx)
      ctx.func.push(details = uleb(typeIdx))
      ctx.func.importc = (ctx.func.importc||0)+1
    }
    else if (kind==='memory') {
      if (name) ctx.memory[name] = ctx.memory.length
      details = range(parts)
    }
    else if (kind==='global') {
      if (name) ctx.global[name] = ctx.global.length
      let [type] = parts, mut = type[0] === 'mut' ? 1 : 0
      details = [TYPE[mut ? type[1] : type], mut]
    }
    else throw Error('Unimplemented ' + kind)

    ctx.import.push([...str(mod), ...str(field), KIND[kind], ...details])
  },

  // (data (i32.const 0) "\2a")
  data([, offset, init], ctx) {
    // FIXME: first is mem index
    ctx.data.push([0, ...iinit(offset,ctx), ...str(init)])
  },

  // (start $main)
  start([, name],ctx) {
    if (!ctx.start.length) ctx.start.push([name[0]==='$' ? ctx.func[name] : name])
  }
}

// (i32.const 0) - instantiation time initializer
const iinit = ([op, literal], ctx) => op[0]==='f' ?
  [OP[op], ...(op=='f32'?f32:f64)(literal), OP.end] :
  [OP[op], ...leb(literal[0] === '$' ? ctx.global[literal] : literal), OP.end]

// build string binary
const str = str => {
  str = str[0]==='"' ? str.slice(1,-1) : str
  let res = [], i = 0, c, BSLASH=92
  // spec https://webassembly.github.io/spec/core/text/values.html#strings
  for (;i < str.length;) c=str.charCodeAt(i++), res.push(...uleb(c===BSLASH ? parseInt(str.slice(i,i+=2), 16) : c))
  res.unshift(...uleb(res.length))
  return res
}

// build range/limits sequence (non-consuming)
const range = ([min, max, shared]) => isNaN(parseInt(max)) ? [0, ...uleb(min)] : [shared==='shared'?3:1, ...uleb(min), ...uleb(max)]


// encoding ref: https://github.com/j-s-n/WebBS/blob/master/compiler/byteCode.js
function leb (number, buffer) {
  if (!buffer) buffer = [], number = parseInt(number)

  let byte = number & 0b01111111;
  let signBit = byte & 0b01000000;
  number = number >> 7;

  if ((number === 0 && signBit === 0) || (number === -1 && signBit !== 0)) {
    buffer.push(byte);
    return buffer;
  } else {
    buffer.push(byte | 0b10000000);
    return leb(number, buffer);
  }
}

const uleb = (number, buffer) => {
  if (!buffer) buffer = [], number = parseInt(number)

  let byte = number & 0b01111111;
  number = number >>> 7;

  if (number === 0) {
    buffer.push(byte);
    return buffer;
  } else {
    buffer.push(byte | 0b10000000);
    return uleb(number, buffer);
  }
}

const byteView = new DataView(new BigInt64Array(1).buffer)

const F32_SIGN = 0x80000000, F32_NAN  = 0x7f800000
function f32 (input, value, idx) {
  if (~(idx=input.indexOf('nan:'))) {
    value = parseInt(input.slice(idx+4))
    value |= F32_NAN
    if (input[0] === '-') value |= F32_SIGN
    byteView.setInt32(0, value)
  }
  else {
    value=input==='nan'||input==='+nan'?NaN:input==='-nan'?-NaN:input==='inf'||input==='+inf'?Infinity:input==='-inf'?-Infinity:parseFloat(input)
    byteView.setFloat32(0, value);
  }

  return [
    byteView.getUint8(3),
    byteView.getUint8(2),
    byteView.getUint8(1),
    byteView.getUint8(0)
  ];
}

const F64_SIGN = 0x8000000000000000n, F64_NAN  = 0x7ff0000000000000n
function f64 (input, value, idx) {
  if (~(idx=input.indexOf('nan:'))) {
    value = BigInt(input.slice(idx+4))
    value |= F64_NAN
    if (input[0] === '-') value |= F64_SIGN
    byteView.setBigInt64(0, value)
  }
  else {
    value=input==='nan'||input==='+nan'?NaN:input==='-nan'?-NaN:input==='inf'||input==='+inf'?Infinity:input==='-inf'?-Infinity:parseFloat(input)
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

const err = text => { throw Error(text) }
