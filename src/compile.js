import { uleb, leb, bigleb, f64, f32 } from './util.js'
import { OP, SECTION, ALIGN, TYPE, KIND } from './const.js'
import parse from './parse.js'

const OP_END = 0xb, OP_I32_CONST = 0x41, OP_I64_CONST = 0x42, OP_F32_CONST = 0x43, OP_F64_CONST = 0x44, OP_SKIP = 0x6, OP_GLOBAL_GET = 35, OP_GLOBAL_SET = 36

/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (Wasm).
 *
 * @param {string|Array} nodes - The WAT tree or string to be compiled to Wasm binary.
 * @returns {Uint8Array} The compiled Wasm binary data.
 */
export default (nodes) => {
  if (typeof nodes === 'string') nodes = parse(nodes);

  // IR. Alias is stored directly to section array by key, eg. section.func.$name = idx
  let sections = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], elem: [], code: [], data: []
  }, binary = [
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
  ]

  // 1. transform tree
  // (func) → [(func)]
  if (typeof nodes[0] === 'string' && nodes[0] !== 'module') nodes = [nodes]

  // (global $a (import "a" "b") (mut i32)) → (import "a" "b" (global $a (mut i32)))
  // (memory (import "a" "b") min max shared) → (import "a" "b" (memory min max shared))
  nodes = nodes.map(node => {
    if (node[2]?.[0] === 'import') {
      let [kind, name, imp, ...args] = node
      return [...imp, [kind, name, ...args]]
    }
    else if (node[1]?.[0] === 'import') {
      let [kind, imp, ...args] = node
      return [...imp, [kind, ...args]]
    }
    return node
  })

  // 2. build IR. import must be initialized first, global before func, elem after func
  let order = ['type', 'import', 'table', 'memory', 'global', 'func', 'export', 'start', 'elem', 'data'], postcall = []

  for (let name of order) {
    let remaining = []
    for (let node of nodes) {
      node[0] === name ? postcall.push(build[name](node, sections)) : remaining.push(node)
    }
    nodes = remaining
  }

  // code must be compiled after all definitions
  for (let cb of postcall) cb?.()

  // 3. build binary
  for (let name in sections) {
    let items = sections[name]
    if (items.importc) items = items.slice(items.importc) // discard imported functions/globals
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
  // FIXME: handle non-function types
  type([, typeName, [kind, ...sig]], ctx) {
    if (kind !== 'func') err(`Unknown type kind '${kind}'`)
    const [idx] = consumeType(sig, ctx)
    if (typeName) ctx.type[typeName] = idx
  },

  // (func $name? ...params result ...body)
  func([, ...body], ctx) {
    let locals = [], // list of local variables
      blocks = [] // control instructions / blocks stack

    // fn name
    if (body[0]?.[0] === '$') ctx.func[body.shift()] = ctx.func.length

    // export binding
    if (body[0]?.[0] === 'export') build.export([...body.shift(), ['func', ctx.func.length]], ctx)

    // register/consume type info
    let [typeIdx, params, result] = consumeType(body, ctx)

    // register new function
    ctx.func.push([typeIdx])

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
        immed = [0xfb, opCode %= 268]
        console.log(immed, opCode)
        if (!opCode) immed.push(...uleb(args.shift()))
      }

      // bulk memory: (memory.init) (memory.copy) etc
      // https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md#instruction-encoding
      else if (opCode >= 252) {
        immed = [0xfc, opCode %= 252]
        // memory.init idx, memory.drop idx, table.init idx, table.drop idx
        if (!(opCode & 0b10)) immed.push(...uleb(args.shift()))
        else immed.push(0)
        // even opCodes (memory.init, memory.copy, table.init, table.copy) have 2nd predefined immediate
        if (!(opCode & 0b1)) immed.push(0)
        opCode = null // ignore opcode
      }

      // binary/unary - just consume immed
      else if (opCode >= 69) { }

      // (i32.store align=n offset=m at value) etc
      else if (opCode >= 40 && opCode <= 62) {
        // FIXME: figure out point in Math.log2 aligns
        let o = { align: ALIGN[op], offset: 0 }, param
        while (args[0]?.includes('=')) param = args.shift().split('='), o[param[0]] = Number(param[1])
        immed = [Math.log2(o.align), ...uleb(o.offset)]
      }

      // (i32.const 123)
      else if (opCode >= 65 && opCode <= 68) {
        immed = (opCode == 65 ? leb : opCode == 66 ? bigleb : opCode == 67 ? f32 : f64)(args.shift())
      }

      // (local.get $id), (local.tee $id x)
      else if (opCode >= 32 && opCode <= 34) {
        immed = uleb(args[0]?.[0] === '$' ? params[id = args.shift()] || locals[id] : args.shift())
      }

      // (global.get id), (global.set id)
      else if (opCode == OP_GLOBAL_GET || opCode == OP_GLOBAL_SET) {
        immed = uleb(args[0]?.[0] === '$' ? ctx.global[args.shift()] : args.shift())
      }

      // (call id ...nodes)
      else if (opCode == 16) {
        let fnName = args.shift()
        immed = uleb(id = fnName[0] === '$' ? ctx.func[fnName] ?? err('Unknown function `' + fnName + '`') : fnName);
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

    // evaluates after all definitions (need globals, elements, data etc.)
    // FIXME: get rid of this postcall
    return () => {
      const bytes = []
      while (body.length) consume(body, bytes)
      ctx.code.push([...uleb(bytes.length + 2 + locTypes.length), ...uleb(locTypes.length >> 1), ...locTypes, ...bytes, OP_END])
    }
  },

  // (memory min max shared)
  // (memory $name min max shared)
  // (memory (export "mem") 5)
  memory([, ...parts], ctx) {
    if (parts[0][0] === '$') ctx.memory[parts.shift()] = ctx.memory.length
    if (parts[0][0] === 'export') build.export([...parts.shift(), ['memory', ctx.memory.length]], ctx)
    ctx.memory.push(range(parts))
  },

  // (global i32 (i32.const 42))
  // (global $id i32 (i32.const 42))
  // (global $id (mut i32) (i32.const 42))
  global([, ...args], ctx) {
    let name = args[0][0] === '$' && args.shift()
    if (name) ctx.global[name] = ctx.global.length
    let [type, init] = args, mut = type[0] === 'mut' ? 1 : 0
    ctx.global.push([TYPE[mut ? type[1] : type], mut, ...iinit(init)])
  },

  // (table 1 2? funcref)
  // (table $name 1 2? funcref)
  table([, ...args], ctx) {
    let name = args[0][0] === '$' && args.shift()
    if (name) ctx.table[name] = ctx.table.length
    let lims = range(args)
    ctx.table.push([TYPE[args.pop()], ...lims])
  },

  // (elem (i32.const 0) $f1 $f2), (elem (global.get 0) $f1 $f2)
  elem([, offset, ...elems], ctx) {
    const tableIdx = 0 // FIXME: table index can be defined
    ctx.elem.push([tableIdx, ...iinit(offset, ctx), ...uleb(elems.length), ...elems.flatMap(el => uleb(el[0] === '$' ? ctx.func[el] : el))])
  },

  //  (export "name" (kind $name|idx))
  export([, name, [kind, idx]], ctx) {
    if (idx[0] === '$') idx = ctx[kind][idx]
    ctx.export.push([...str(name), KIND[kind], ...uleb(idx)])
  },

  // (import "math" "add" (func $add (param i32 i32 externref) (result i32)))
  // (import "js" "mem" (memory 1))
  // (import "js" "mem" (memory $name 1))
  // (import "js" "v" (global $name (mut f64)))
  import([, mod, field, ref], ctx) {
    let details, [kind, ...parts] = ref,
      name = parts[0]?.[0] === '$' && parts.shift();

    if (kind === 'func') {
      // we track imported funcs in func section to share namespace, and skip them on final build
      if (name) ctx.func[name] = ctx.func.length
      let [typeIdx] = consumeType(parts, ctx)
      ctx.func.push(details = uleb(typeIdx))
      ctx.func.importc = (ctx.func.importc || 0) + 1
    }
    else if (kind === 'memory') {
      if (name) ctx.memory[name] = ctx.memory.length
      details = range(parts)
    }
    else if (kind === 'global') {
      // imported globals share namespace with internal globals - we skip them in final build
      if (name) ctx.global[name] = ctx.global.length
      let [type] = parts, mut = type[0] === 'mut' ? 1 : 0
      details = [TYPE[mut ? type[1] : type], mut]
      ctx.global.push(details)
      ctx.global.importc = (ctx.global.importc || 0) + 1
    }
    else throw Error('Unimplemented ' + kind)

    ctx.import.push([...str(mod), ...str(field), KIND[kind], ...details])
  },

  // (data (i32.const 0) "\aa" "\bb"?)
  // (data (offset (i32.const 0)) (memory ref) "\aa" "\bb"?)
  // (data (global.get $x) "\aa" "\bb"?)
  data([, ...inits], ctx) {
    let offset, mem

    if (inits[0]?.[0] === 'offset') [, offset] = inits.shift()
    if (inits[0]?.[0] === 'memory') [, mem] = inits.shift()
    if (inits[0]?.[0] === 'offset') [, offset] = inits.shift()
    if (!offset && !mem) offset = inits.shift()
    if (!offset) offset = ['i32.const', 0]

    ctx.data.push([0, ...iinit(offset, ctx), ...str(inits.map(i => i[0] === '"' ? i.slice(1, -1) : i).join(''))])
  },

  // (start $main)
  start([, name], ctx) {
    if (!ctx.start.length) ctx.start.push([name[0] === '$' ? ctx.func[name] : name])
  }
}

// (i32.const 0), (global.get idx) - instantiation time initializer
const iinit = ([op, literal], ctx) =>
  op === 'f32.const' ? [OP_F32_CONST, ...f32(literal), OP_END] :
    op === 'f64.const' ? [OP_F64_CONST, ...f64(literal), OP_END] :
      op === 'i32.const' ? [OP_I32_CONST, ...leb(literal), OP_END] :
        op === 'i64.const' ? [OP_I64_CONST, ...bigleb(literal), OP_END] :
          op === 'global.get' ? [OP_GLOBAL_GET, ...uleb(literal[0] === '$' ? ctx.global[literal] : literal), OP_END] :
            err(`Unknown init ${op} ${literal}`)

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

// get type info from (params) (result) nodes sequence (consumes nodes)
// returns registered (reused) type idx, params bytes, result bytes
// eg. (type $return_i32 (func (result i32)))
const consumeType = (nodes, ctx) => {
  let params = [], result = [], idx, bytes

  // collect params
  while (nodes[0]?.[0] === 'param') {
    let [, ...types] = nodes.shift()
    if (types[0]?.[0] === '$') params[types.shift()] = params.length
    params.push(...types.map(t => TYPE[t]))
  }

  // collect result type
  if (nodes[0]?.[0] === 'result') result = nodes.shift().slice(1).map(t => TYPE[t])

  // reuse existing type or register new one
  bytes = [TYPE.func, ...uleb(params.length), ...params, ...uleb(result.length), ...result]
  idx = ctx.type.findIndex((t) => t.every((byte, i) => byte === bytes[i]))

  // register new type, if not found
  if (idx < 0) idx = ctx.type.push(bytes) - 1

  return [idx, params, result]
}

const err = text => { throw Error(text) }
