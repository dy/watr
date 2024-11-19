import * as encode from './encode.js'
import { uleb } from './encode.js'
import { OP, SECTION, ALIGN, TYPE, KIND } from './const.js'
import parse from './parse.js'


/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (Wasm).
 *
 * @param {string|Array} nodes - The WAT tree or string to be compiled to Wasm binary.
 * @returns {Uint8Array} The compiled Wasm binary data.
 */
export default (nodes) => {
  if (typeof nodes === 'string') nodes = parse(nodes);

  // IR. Alias is stored directly to section array by key, eg. section.func.$name = idx
  const sections = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], elem: [], code: [], data: []
  }
  const binary = [
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
  ]

  // 1. transform tree
  // (func) → [(func)]
  if (typeof nodes[0] === 'string' && nodes[0] !== 'module') nodes = [nodes]

  // 2. build IR. import must be initialized first, global before func, elem after func
  // FIXME: we can instead sort nodes in order of sections and just run for name in sections once
  for (let name in sections) {
    let remaining = []
    for (let node of nodes) {
      if (node[0] === name) build[name](node, sections, remaining)
      else remaining.push(node)
    }
    nodes = remaining
  }

  // FIXME: this is not necessary, sections can build binary immediately
  // 3. build binary
  for (let name in sections) {
    let items = sections[name].filter(Boolean)
    if (!items.length) continue
    let sectionCode = SECTION[name], bytes = []
    if (sectionCode !== 8) bytes.push(items.length) // skip start section count
    for (let item of items) bytes.push(...item)
    binary.push(sectionCode, ...uleb(bytes.length), ...bytes)
  }

  return new Uint8Array(binary)
}

const build = {
  // (type $name? (func (param $x i32) (param i64 i32) (result i32 i64)))
  // signature part is identical to function
  type([, ...parts], ctx) {
    let typeName

    // type name
    if (parts[0]?.[0] === '$') typeName = parts.shift()
    let [kind, ...sig] = parts.shift()

    if (kind !== 'func') err(`Unknown type kind '${kind}'`)
    const [idx] = consumeType(sig, ctx)
    if (typeName) ctx.type[typeName] = idx
  },

  // (import "math" "add" (func $add (param i32 i32 externref) (result i32)))
  // (import "js" "mem" (memory 1))
  // (import "js" "mem" (memory $name 1))
  // (import "js" "v" (global $name (mut f64)))
  import([, mod, field, ref], ctx) {
    let [kind, ...parts] = ref,
      name = parts[0]?.[0] === '$' && parts.shift();

    // (import "a" "b" (global $a (mut i32))) -> (global $a (import "a" "b") (mut i32))
    build[kind]([kind, ...(name ? [name] : []), ['import', mod, field], ...parts], ctx)
  },

  // (func $name? ...params result ...body)
  func([, ...body], ctx, nodes) {
    let imp;
    const id = ctx.func.length
    if (body[0]?.[0] === '$') ctx.func[body.shift()] = id

    // (func (export "a")(export "b") ) -> (export "a" (func $name))(export "b" (func $name))
    while (body[0]?.[0] === 'export') build.export([...body.shift(), ['func', id]], ctx)
    if (body[0]?.[0] === 'import') imp = body.shift()

    const [typeIdx, params] = consumeType(body, ctx)

    if (imp) {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), KIND.func, ...uleb(typeIdx)])
      ctx.func.push(null)
    }
    else {
      // create (code body) section
      if (nodes) nodes.push(['code', params, ...body])
      // register new function
      ctx.func.push(uleb(typeIdx))
    }
  },

  // (table 1 2? funcref)
  // (table $name 1 2? funcref)
  table([, ...args], ctx) {
    let imp
    const id = ctx.table.length
    if (args[0]?.[0] === '$') ctx.table[args.shift()] = id

    // (table (export "m") ) -> (export "m" (table id))
    while (args[0]?.[0] === 'export') build.export([...args.shift(), ['table', id]], ctx)
    if (args[0]?.[0] === 'import') imp = args.shift()

    if (imp) {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), KIND.table, ...range(args)])
      ctx.table.push(null)
    }
    else ctx.table.push([TYPE[args.pop()], ...range(args)])
  },

  // (memory min max shared)
  // (memory $name min max shared)
  // (memory (export "mem") 5)
  memory([, ...args], ctx) {
    let imp
    const id = ctx.memory.length
    if (args[0]?.[0] === '$') ctx.memory[args.shift()] = id

    // (memory (export "m") ) -> (export "m" (memory id))
    while (args[0]?.[0] === 'export') build.export([...args.shift(), ['memory', id]], ctx)
    if (args[0]?.[0] === 'import') imp = args.shift()

    if (imp) {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), KIND.memory, ...range(args)])
      ctx.memory.push(null)
    }
    else ctx.memory.push(range(args))
  },

  // (global i32 (i32.const 42))
  // (global $id i32 (i32.const 42))
  // (global $id (mut i32) (i32.const 42))
  global([, ...args], ctx) {
    let imp
    let name = args[0][0] === '$' && args.shift()
    if (name) ctx.global[name] = ctx.global.length

    // (global $id (export "a") i32 )
    while (args[0]?.[0] === 'export') build.export([...args.shift(), ['global', name]], ctx);
    if (args[0]?.[0] === 'import') imp = args.shift()

    let [type] = args, mut = type[0] === 'mut' ? 1 : 0

    if (imp) {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), KIND.global, TYPE[mut ? type[1] : type], mut])
      ctx.global.push(null)
    }
    else {
      let [, [...init]] = args
      ctx.global.push([TYPE[mut ? type[1] : type], mut, ...consumeConst(init, ctx), 0x0b])
    }
  },

  //  (export "name" (kind $name|idx))
  export([, name, [kind, idx]], ctx) {
    if (idx[0] === '$') idx = ctx[kind][idx]
    ctx.export.push([...str(name), KIND[kind], ...uleb(idx)])
  },

  // (start $main)
  start([, name], ctx) {
    if (!ctx.start.length) ctx.start.push(uleb(funcId(name, ctx)))
  },

  // (elem (i32.const 0) $f1 $f2), (elem (global.get 0) $f1 $f2)
  elem([, [...offset], ...elems], ctx) {
    // FIXME: it can also have name

    const tableIdx = 0 // FIXME: table index can be defined
    ctx.elem.push([tableIdx, ...consumeConst(offset, ctx), 0x0b, ...uleb(elems.length), ...elems.flatMap(el => uleb(funcId(el, ctx)))])
  },

  // artificial section
  // (code params ...body)
  code([, params, ...body], ctx) {
    let blocks = [] // control instructions / blocks stack
    let locals = [] // list of local variables

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [, ...types] = body.shift(), name
      if (types[0][0] === '$')
        params[name = types.shift()] ? err('Ambiguous name ' + name) :
          locals[name] = params.length + locals.length
      locals.push(...types.map(t => TYPE[t]))
    }

    // squash local types
    let locTypes = locals.reduce((a, type) => (type == a[a.length - 1] ? a[a.length - 2]++ : a.push(1, type), a), [])

    // convert sequence of instructions from input nodes to out bytes
    const consume = (nodes, out = []) => {
      if (!nodes?.length) return out

      let op = nodes.shift(), opCode, args = nodes, immed, id, group

      // groups are flattened, eg. (cmd z w) -> z w cmd
      if (group = Array.isArray(op)) {
        args = [...op] // op is immutable
        opCode = OP.indexOf(op = args.shift())
      }
      else opCode = OP.indexOf(op)

      // NOTE: numeric comparison is faster than generic hash lookup

      // v128s: (v128.load x) etc
      // https://github.com/WebAssembly/simd/blob/master/proposals/simd/BinarySIMD.md
      if (opCode >= 268) {
        opCode -= 268
        immed = [0xfd, ...uleb(opCode)]
        // (v128.load)
        if (opCode <= 0x0b) {
          const o = consumeAlignOffset(args)
          immed.push(Math.log2(o.align ?? ALIGN[op]), ...uleb(o.offset ?? 0))
        }
        // (v128.load_lane offset? align? idx)
        else if (opCode >= 0x54 && opCode <= 0x5d) {
          const o = consumeAlignOffset(args)
          immed.push(Math.log2(o.align ?? ALIGN[op]), ...uleb(o.offset ?? 0))
          // (v128.load_lane_zero)
          if (opCode <= 0x5b) immed.push(...uleb(args.shift()))
        }
        // (i8x16.shuffle 0 1 ... 15 a b)
        else if (opCode === 0x0d) {
          // i8, i16, i32 - bypass the encoding
          for (let i = 0; i < 16; i++) immed.push(encode.i32.parse(args.shift()))
        }
        // (v128.const i32x4)
        else if (opCode === 0x0c) {
          args.unshift(op)
          immed = consumeConst(args, ctx)
        }
        // (i8x16.extract_lane_s 0 ...)
        else if (opCode >= 0x15 && opCode <= 0x22) {
          immed.push(...uleb(args.shift()))
        }
        opCode = null // ignore opcode
      }

      // bulk memory: (memory.init) (memory.copy) etc
      // https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md#instruction-encoding
      else if (opCode >= 252) {
        immed = [0xfc, ...uleb(opCode -= 252)]
        // memory.init idx, memory.drop idx, table.init idx, table.drop idx
        if (!(opCode & 0b10)) immed.push(...uleb(args.shift()))
        else immed.push(0)
        // even opCodes (memory.init, memory.copy, table.init, table.copy) have 2nd predefined immediate
        if (!(opCode & 0b1)) immed.push(0)
        opCode = null // ignore opcode
      }

      // binary/unary (i32.add a b) - no immed
      else if (opCode >= 0x45) { }

      // (i32.store align=n offset=m at value) etc
      else if (opCode >= 40 && opCode <= 62) {
        // FIXME: figure out point in Math.log2 aligns
        let o = consumeAlignOffset(args)
        immed = [Math.log2(o.align ?? ALIGN[op]), ...uleb(o.offset ?? 0)]
      }

      // (i32.const 123), (f32.const 123.45) etc
      else if (opCode >= 0x41 && opCode <= 0x44) {
        immed = encode[op.split('.')[0]](args.shift())
      }

      // (local.get $id), (local.tee $id x)
      else if (opCode >= 32 && opCode <= 34) {
        immed = uleb(args[0]?.[0] === '$' ? params[id = args.shift()] || locals[id] : args.shift())
      }

      // (global.get id), (global.set id)
      else if (opCode == 0x23 || opCode == 36) {
        immed = uleb(args[0]?.[0] === '$' ? ctx.global[args.shift()] : args.shift())
      }

      // (call id ...nodes)
      else if (opCode == 16) {
        let fnName = args.shift()
        immed = uleb(id = funcId(fnName, ctx));
        // FIXME: how to get signature of imported function
      }

      // (call_indirect (type $typeName) (idx) ...nodes)
      else if (opCode == 17) {
        let typeId = args.shift()[1];
        typeId = typeId[0] === '$' ? ctx.type[typeId] : typeId
        immed = uleb(typeId), immed.push(0) // extra immediate indicates table idx (reserved)
      }

      // FIXME multiple memory (memory.grow $idx?)
      else if (opCode == 63 || opCode == 64) {
        immed = [0]
      }

      // (block ...), (loop ...), (if ...)
      else if (opCode === 2 || opCode === 3 || opCode === 4) {
        blocks.push(opCode)

        // (block $x) (loop $y)
        if (opCode < 4 && args[0]?.[0] === '$') (blocks[args.shift()] = blocks.length)

        // get type
        // (result i32) - doesn't require registering type
        if (args[0]?.[0] === 'result' && args[0].length < 3) {
          let [, type] = args.shift()
          immed = [TYPE[type]]
        }
        // (result i32 i32)
        else if (args[0]?.[0] === 'result' || args[0]?.[0] === 'param') {
          let [typeId] = consumeType(args, ctx)
          immed = [typeId]
        }
        else {
          immed = [TYPE.void]
        }

        if (group) {
          // (block xxx) -> block xxx end
          nodes.unshift('end')

          if (opCode < 4) while (args.length) nodes.unshift(args.pop())

          // (if cond a) -> cond if a end
          else if (args.length < 3) nodes.unshift(args.pop())
          // (if cond (then a) (else b)) -> `cond if a else b end`
          else {
            nodes.unshift(args.pop())
            // (if cond a b) -> (if cond a else b)
            if (nodes[0][0] !== 'else') nodes.unshift('else')
            // (if a b (else)) -> (if a b)
            else if (nodes[0].length < 2) nodes.shift()
            nodes.unshift(args.pop())
          }
        }
      }

      // (else)
      else if (opCode === 5) {
        // (else xxx) -> else xxx
        if (group) while (args.length) nodes.unshift(args.pop())
      }
      // (then)
      else if (opCode === 6) {
        opCode = null // ignore opcode
      }

      // (end)
      else if (opCode == 0x0b) blocks.pop()

      // (br $label result?)
      // (br_if $label cond result?)
      else if (opCode == 0x0c || opCode == 0x0d) {
        // br index indicates how many block items to pop
        immed = uleb(args[0]?.[0] === '$' ? blocks.length - blocks[args.shift()] : args.shift())
      }

      // (br_table 1 2 3 4  0  selector result?)
      else if (opCode == 0x0e) {
        immed = []
        while (!Array.isArray(args[0])) id = args.shift(), immed.push(...uleb(id[0][0] === '$' ? blocks.length - blocks[id] : id))
        immed.unshift(...uleb(immed.length - 1))
      }
      else if (opCode < 0) err(`Unknown instruction \`${op}\``)

      // if group (cmd im1 im2 arg1 arg2) - insert any remaining args first: arg1 arg2
      // because inline case has them in stack already
      if (group) {
        while (args.length) consume(args, out)
      }

      if (opCode) out.push(opCode)
      if (immed) out.push(...immed)
    }

    const bytes = []
    while (body.length) consume(body, bytes)

    ctx.code.push([...uleb(bytes.length + 2 + locTypes.length), ...uleb(locTypes.length >> 1), ...locTypes, ...bytes, 0x0b])
  },

  // (data (i32.const 0) "\aa" "\bb"?)
  // (data (offset (i32.const 0)) (memory ref) "\aa" "\bb"?)
  // (data (global.get $x) "\aa" "\bb"?)
  data([, ...inits], ctx) {
    let offset, mem

    // FIXME: it can have name also

    if (inits[0]?.[0] === 'offset') [, offset] = inits.shift()
    if (inits[0]?.[0] === 'memory') [, mem] = inits.shift()
    if (inits[0]?.[0] === 'offset') [, offset] = inits.shift()
    if (!offset && !mem) offset = inits.shift()
    if (!offset) offset = ['i32.const', 0]

    ctx.data.push([0, ...consumeConst([...offset], ctx), 0x0b, ...str(inits.map(i => i[0] === '"' ? i.slice(1, -1) : i).join(''))])
  }
}

// instantiation time const initializer
const consumeConst = (node, ctx) => {
  let op = node.shift(), [type, cmd] = op.split('.')

  // (global.get idx)
  if (type === 'global') return [0x23, ...uleb(node[0][0] === '$' ? ctx.global[node[0]] : node[0])]

  // (v128.const i32x4 1 2 3 4)
  if (type === 'v128') return [0xfd, 0x0c, ...v128(node)]

  // (i32.const 1)
  if (cmd === 'const') return [0x41 + ['i32', 'i64', 'f32', 'f64'].indexOf(type), ...encode[type](node[0])]

  // (ref.func $x)
  if (type === 'ref') return console.log(ctx.func) || [0xD2, ...uleb(funcId(node[0], ctx))]

  // (i32.add a b), (i32.mult a b) etc
  return [
    ...consumeConst(node.shift(), ctx),
    ...consumeConst(node.shift(), ctx),
    OP.indexOf(op)
  ]
}

// (v128.const i32x4 1 2 3 4)
const v128 = (args) => {
  let [t, n] = args.shift().split('x'),
    stride = t.slice(1) >>> 3 // i16 -> 2, f32 -> 4

  n = +n

  // i8, i16, i32 - bypass the encoding
  if (t[0] === 'i') {
    let arr = n === 16 ? new Uint8Array(16) : n === 8 ? new Uint16Array(8) : n === 4 ? new Uint32Array(4) : new BigInt64Array(2)
    for (let i = 0; i < n; i++) {
      arr[i] = encode[t].parse(args.shift())
    }
    return new Uint8Array(arr.buffer)
  }

  // f32, f64 - encode
  let arr = new Uint8Array(16)
  for (let i = 0; i < n; i++) {
    arr.set(encode[t](args.shift()), i * stride)
  }

  return arr
}


// get type info from (params) (result) nodes sequence - consumes nodes
// returns registered (reused) type idx
// eg. (type $return_i32 (func (result i32)))
const consumeType = (nodes, ctx) => {
  let params = [], result = [], idx, bytes

  // existing type (type 0), (type $name) - can repeat params, result after
  if (nodes[0]?.[0] === 'type') {
    idx = nodes.shift()[1]
    if (idx[0] === '$') idx = ctx.type[idx]
    else idx = +idx
  }

  // collect params (param i32 i64) (param $x i32)
  while (nodes[0]?.[0] === 'param') {
    let [, ...types] = nodes.shift()
    // save param by name
    if (types[0]?.[0] === '$') params[types.shift()] = params.length
    params.push(...types.map(t => TYPE[t]))
  }

  // collect result eg. (result f64 f32)
  if (nodes[0]?.[0] === 'result') result = nodes.shift().slice(1).map(t => TYPE[t])

  // if new type, not (type 0) (...)
  if (idx == null) {
    // reuse existing type or register new one
    // FIXME: can be done easier via string comparison
    bytes = [TYPE.func, ...uleb(params.length), ...params, ...uleb(result.length), ...result]
    idx = ctx.type.findIndex((t) => t.every((byte, i) => byte === bytes[i]))

    // register new type, if not found
    if (idx < 0) idx = ctx.type.push(bytes) - 1
  }

  // FIXME: we should not return params here
  return [idx, params]
}

// consume align/offset/etc params
const consumeAlignOffset = (args) => {
  let params = {}, param
  while (args[0]?.includes('=')) param = args.shift().split('='), params[param[0]] = Number(param[1])
  return params
}

// get func id from name
// FIXME: generalize to any-type id
const funcId = (name, ctx) => name[0] === '$' ? ctx.func[name] ?? err('Unknown function `' + name + '`') : name

const err = text => { throw Error(text) }

// escape codes
const escape = { n: 10, r: 13, t: 9, v: 1, '\\': 92 }

// build string binary
const str = str => {
  str = str[0] === '"' ? str.slice(1, -1) : str
  let res = [], i = 0, c, BSLASH = 92
  // spec https://webassembly.github.io/spec/core/text/values.html#strings
  for (; i < str.length;) {
    c = str.charCodeAt(i++)
    res.push(c === BSLASH ? escape[str[i++]] || parseInt(str.slice(i - 1, ++i), 16) : c)
  }

  res.unshift(...uleb(res.length))
  return res
}

// build range/limits sequence (non-consuming)
const range = ([min, max, shared]) => isNaN(parseInt(max)) ? [0, ...uleb(min)] : [shared === 'shared' ? 3 : 1, ...uleb(min), ...uleb(max)]
