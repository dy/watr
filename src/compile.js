import * as encode from './encode.js'
import { uleb } from './encode.js'
import { SECTION, ALIGN, TYPE, KIND, INSTR } from './const.js'
import parse from './parse.js'

// build instructions index
INSTR.forEach((instr, i) => {
  let [op, ...imm] = instr.split(' '), a, b
  INSTR[i] = op // rewrite original instr

  // TODO
  // // wrap codes
  // const code = i >= 0x10f ? [0xfd, ...uleb(i - 0x10f)] : i >= 0xfc ? [0xfc, ...uleb(i - 0xfc)] : i

  // // handle immediates
  // INSTR[op] = !imm.length ? () => code :
  //   imm.length === 1 ? (a = immedname(imm[0]), nodes => [...code, ...a(nodes)]) :
  //     (imm = imm.map(immedname), nodes => [...code, ...imm.flatMap(imm => imm(nodes))])
})


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

  // (module $a? ...body) -> ...body
  if (nodes[0] === 'module') [, ...nodes] = nodes, typeof nodes[0] == 'string' && nodes.shift()
  // (func) → [(func)]
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  // 1. Group node kinds by "buckets": (import (func)) must be in order, etc
  // FIXME: merge into sections
  const nodeSections = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], elem: [], code: [], data: []
  }
  for (let [kind, ...node] of nodes) {
    let imp

    // import defines section, so we unwrap it
    // (import "a" "b" (memory min max shared)) -> (memory (import "a" "b") min max shared)
    if (kind === 'import') imp = [kind, node.shift(), node.shift()], [kind, ...node] = node.shift();

    // get name reference
    let name = node[0]?.[0] === '$' && node.shift()
    // FIXME: the id can be incorrect: types squoosh on the way
    // if (name[0] === '$') sections[kind][name] = id

    // TODO: squoosh types
    // if (kind === 'type') {
    //   let type = parseParams(node[0].slice(1))
    //   if (types[type.join(':')]) continue
    //   types[type.join(':')] = node = type
    // }

    // TODO: prevent dupe start
    // if (kind === 'start') node = sections.start.length ? null : id

    // normalize exports
    // (func (export "a")(export "b") (type) ... ) -> (export "a" (func 0))(export "b" (func 0))
    while (node[0]?.[0] === 'export') {
      nodeSections.export.push([...node.shift(), [kind, nodeSections[kind].length]])
    }

    // normalize import (comes after exports)
    // (memory (import "a" "b") min max shared) -> (import "a" "b" (memory min max shared))
    // (func (import "a" "b") (type $x)) -> (import "a" "b" (func (type $x)))
    // if (node[0]?.[0] === 'import') {
    //   nodeSections.import.push([...node.shift(), [kind, id]])
    // }

    nodeSections[kind].push([name, ...(imp ? [imp] : []), ...node])


    // TODO: create code nodes, collect types, flatten groups
    // if (kind === 'func') {
    // // collect fn type
    // let type = parseParams(node)
    // if (!types[type.join(':')]) sections.type.push(type), types[type.join(':')] = type

    // // TODO: flatten groups/blocks (add a b) -> a b add

    // // write code section
    // sections.code.push(code)

    // // function is just type idx
    // node =
    // }
  }

  // build sections
  // FIXME: should not be here, shouls be binary right away
  for (let section in nodeSections) {
    let nodes = nodeSections[section]
    for (let node of nodes) {
      build[section](node, sections, nodeSections.code)
    }
  }

  // build binary
  for (let name in sections) {
    let items = sections[name].filter(item => item != null)
    if (!items.length) continue
    let sectionCode = SECTION[name], bytes = []
    if (sectionCode !== 8) bytes.push(...uleb(items.length)) // skip start section count
    for (let item of items) bytes.push(...item)
    binary.push(sectionCode, ...uleb(bytes.length), ...bytes)
  }

  return new Uint8Array(binary)
}

const build = {
  // (type $name? (func (param $x i32) (param i64 i32) (result i32 i64)))
  // signature part is identical to function
  type([name, ...parts], ctx) {
    // type name
    let [kind, ...sig] = parts.shift()

    const [idx] = consumeType(sig, ctx)
    if (name) ctx.type[name] = idx
  },

  // NOTE: we convert import nodes to target nodes with import section
  // (import "math" "add" (func $add (param i32 i32 externref) (result i32)))
  // (import "js" "mem" (memory 1))
  // (import "js" "mem" (memory $name 1))
  // (import "js" "v" (global $name (mut f64)))
  // import([, mod, field, ref], ctx) {
  //   let [kind, ...parts] = ref,
  //     name = parts[0]?.[0] === '$' && parts.shift();
  //   // (import "a" "b" (global $a (mut i32))) -> (global $a (import "a" "b") (mut i32))
  //   ctx[kind].push(null) // inc counter
  //   build[kind]([kind, ...(name ? [name] : []), ['import', mod, field], ...parts], ctx)
  // },

  // (func $name? ...params result ...body)
  func([name, ...body], ctx, nodes) {
    let imp;
    if (name) ctx.func[name] = ctx.func.length

    if (body[0]?.[0] === 'import') imp = body.shift()

    const [typeidx, params] = consumeType(body, ctx)

    if (imp) {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), KIND.func, ...uleb(typeidx)])
      ctx.func.push(null)
    }
    else {
      // create (code body) section
      if (nodes) nodes.push([name, params, ...body])
      // register new function
      ctx.func.push(uleb(typeidx))
    }
  },

  // (table id? 1 2? funcref)
  table([name, ...args], ctx) {
    let imp
    if (name) ctx.table[name] = ctx.table.length

    if (args[0]?.[0] === 'import') imp = args.shift()

    if (imp) {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), KIND.table, TYPE[args.pop()], ...limits(args)])
      ctx.table.push(null)
    }
    else ctx.table.push([TYPE[args.pop()], ...limits(args)])
  },

  // (memory id? export* min max shared)
  memory([name, ...args], ctx) {
    let imp
    if (name) ctx.memory[name] = ctx.memory.length

    if (args[0]?.[0] === 'import') imp = args.shift()

    if (imp) {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), KIND.memory, ...limits(args)])
      ctx.memory.push(null)
    }
    else ctx.memory.push(limits(args))
  },

  // (global id? i32 (i32.const 42))
  // (global $id (mut i32) (i32.const 42))
  global([name, ...args], ctx) {
    let imp
    if (name) ctx.global[name] = ctx.global.length

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
  start([name, id], ctx) {
    if (!ctx.start.length) ctx.start.push(uleb(name ? ctx.func[name] : +id))
  },

  // (elem $name? (i32.const 0) $f1 $f2), (elem (global.get 0) $f1 $f2)
  elem([name, [...offset], ...elems], ctx) {
    // FIXME: it can also have name

    const tableIdx = 0 // FIXME: table index can be defined
    ctx.elem.push([tableIdx, ...consumeConst(offset, ctx), 0x0b, ...uleb(elems.length), ...elems.flatMap(el => uleb(el[0] === '$' ? ctx.func[el] : +el))])
  },

  // artificial section
  // (code params ...body)
  code([name, params, ...body], ctx) {
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
        opCode = INSTR.indexOf(op = args.shift())
      }
      else opCode = INSTR.indexOf(op)

      // NOTE: numeric comparison is faster than generic hash lookup

      // v128s: (v128.load x) etc
      // https://github.com/WebAssembly/simd/blob/master/proposals/simd/BinarySIMD.md
      if (opCode >= 0x10f) {
        opCode -= 0x10f
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
      else if (opCode >= 0xfc) {
        immed = [0xfc, ...uleb(opCode -= 0xfc)]
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
        immed = uleb(args[0]?.[0] === '$' ? params[id = args.shift()] ?? locals[id] : args.shift())
      }

      // (global.get id), (global.set id)
      else if (opCode == 0x23 || opCode == 36) {
        immed = uleb(args[0]?.[0] === '$' ? ctx.global[args.shift()] : args.shift())
      }

      // (call id ...nodes)
      else if (opCode == 16) {
        let fnName = args.shift()
        immed = uleb(id = fnName[0] === '$' ? ctx.func[fnName] : +fnName);
        // FIXME: how to get signature of imported function
      }

      // (call_indirect (type $typeName) (idx) ...nodes)
      else if (opCode == 17) {
        let typeidx = args.shift()[1];
        typeidx = typeidx[0] === '$' ? ctx.type[typeidx] : +typeidx
        immed = uleb(typeidx), immed.push(0) // extra immediate indicates table idx (reserved)
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

        // get type - can be either typeidx or valtype (numtype | reftype)
        // (result i32) - doesn't require registering type
        if (args[0]?.[0] === 'result' && args[0].length < 3) {
          let [, type] = args.shift()
          immed = [TYPE[type]]
        }
        // (result i32 i32)
        else if (args[0]?.[0] === 'result' || args[0]?.[0] === 'param') {
          let [typeidx] = consumeType(args, ctx)
          immed = [typeidx]
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
  data([name, ...inits], ctx) {
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
  if (type === 'ref') return [0xD2, ...uleb(node[0][0] === '$' ? ctx.func[node[0]] : +node[0])]

  // (i32.add a b), (i32.mult a b) etc
  return [
    ...consumeConst(node.shift(), ctx),
    ...consumeConst(node.shift(), ctx),
    INSTR.indexOf(op)
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

  // collect result eg. (result f64 f32)(result i32)
  while (nodes[0]?.[0] === 'result') result.push(...nodes.shift().slice(1).map(t => TYPE[t]))

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

// build limits sequence (non-consuming)
const limits = ([min, max, shared]) => isNaN(parseInt(max)) ? [0, ...uleb(min)] : [shared === 'shared' ? 3 : 1, ...uleb(min), ...uleb(max)]
