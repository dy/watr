// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section
import {OP, SECTION, TYPE, ETYPE, ALIGN, END} from './const.js'
import { i32 } from './leb128.js'

export default (nodes) => {
  // NOTE: alias is stored directly to section array by key, eg. section.func.$name = idx
  let sections = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], elem: [], code: [], data: []
  },
  binary = [
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
    let items=sections[name], count=items.length
    if (!count) continue
    let sizePtr = binary.length+1
    binary.push(SECTION[name], 0, count)
    for (let item of items) binary.push(...item)
    binary[sizePtr] = binary.length - sizePtr - 1
  }

  return new Uint8Array(binary)
}

const build = {
  // (type $name? (func (param $x i32) (param i64 i32) (result i32 i64)))
  // signature part is identical to function
  // FIXME: handle non-function types
  type([_, ...args], ctx) {
    let name = args[0]?.[0]==='$' && args.shift(),
        params = [],
        result = [],
        decl = args[0],
        kind = decl.shift()

    if (kind==='func') {
      // collect params
      while (decl[0]?.[0] === 'param') {
        let [_, ...types] = decl.shift()
        if (types[0]?.[0] === '$') params[types.shift()] = params.length
        params.push(...types.map(t => TYPE[t]))
      }

      // collect result type
      if (decl[0]?.[0] === 'result') result = decl.shift().slice(1).map(t => TYPE[t])

      // reuse existing type or register new one
      let bytes = [TYPE.func, params.length, ...params, result.length, ...result]

      let idx = ctx.type.findIndex((prevType) => prevType.every((byte, i) => byte === bytes[i]))
      if (idx < 0) idx = ctx.type.push(bytes)-1
      if (name) ctx.type[name] = idx

      return [idx, params, result]
    }

    err('Unsupported type ' + kind)
  },

  // (func $name? ...params result ...body)
  func([_,...body], ctx) {
    let idx=ctx.func.length, // fn index
        locals=[] // list of local variables

    // fn name
    if (body[0]?.[0] === '$') ctx.func[body.shift()] = idx

    // export binding
    if (body[0]?.[0] === 'export') build.export([...body.shift(), ['func', idx]], ctx)

    // register type
    let [typeIdx, params, result] = build.type([,['func',...body]], ctx)
    while (body[0]?.[0] === 'param' || body[0]?.[0] === 'result') body.shift() // FIXME: is there a way to generalize consuming?
    ctx.func.push([typeIdx])

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [_, ...localTypes] = body.shift(), name
      if (localTypes[0][0]==='$')
        params[name=localTypes.shift()] ? err('Ambiguous name '+name) : name,
        locals[name] = params.length + locals.length
      localTypes.forEach(t => locals.push(TYPE[t]))
    }

    // consume instruction with immediates
    const immediates = (args) => {
      let op = args.shift(), imm = []

      // FIXME: make faster lookup.
      // FIXME: Maybe make use of iinit also
      // i32.const 123
      if (op.endsWith('const')) imm = i32(args.shift())

      // i32.store align=n offset=m
      else if (op.includes('store') || op.includes('load')) {
        let o = {align: [Math.log2(ALIGN[op])], offset: [0]}, p
        while (args[0]?.[0] in o) p = args.shift(), o[p[0]] = i32(p[1])
        imm = [...o.align, ...o.offset]
      }

      // (local.get id), (local.tee id)
      else if (op.startsWith('local')) {
        let id = args.shift()
        imm = i32(id[0]==='$' ? params[id] || locals[id] : id)
      }

      // (global.get id), (global.set id)
      else if (op.startsWith('global')) {
        let id = args.shift()
        imm = i32(id[0]==='$' ? ctx.global[id] : id)
      }

      // (call id)
      else if (op === 'call') {
        let id = args.shift()
        imm = i32(id[0]==='$' ? ctx.func[id] : id)
      }

      // (call_indirect (type i32) idx)
      else if (op === 'call_indirect') {
        let type = args.shift(), [_,id] = type
        imm = i32(id[0]==='$' ? ctx.type[id] : id)
        imm.push(0)
      }

      // memory.grow memoryIdx
      else if (op === 'memory.grow') imm = [0]

      imm.unshift(OP[op])

      return imm
    }

    // consume instruction block
    const instr = (args) => {
      let op = args[0]

      // FIXME: risk of consuming non-inlinable instructions like (local.get id), (call id)
      if (typeof op === 'string' && OP[op]) return immediates(args)

      // (a b (c))
      else if (Array.isArray(op)) {
        op = args.shift()
        let imm = immediates(op)
        let opInstr = op.flatMap(arg => instr(arg))
        opInstr.push(...imm)
        return opInstr
      }

      err('Unknown ' + op)
    }

    let code = []
    while (body.length) code.push(...instr(body))

    // FIXME: smush local type defs
    ctx.code.push([code.length+2+locals.length*2, locals.length, ...locals.flatMap(type => [1, type]), ...code, END])
  },

  // (memory min max shared)
  memory([_, ...parts], ctx) {
    let imp = false
    // (memory (import "js" "mem") 1) → (import "js" "mem" (memory 1))
    if (parts[0][0] === 'import') imp = parts.shift()

    if (!imp) ctx.memory.push(range(parts))
    else {
      ctx.import.push([...str(imp[1]), ...str(imp[2]), ETYPE.memory, ...range(parts)])
    }
  },

  // (global i32 (i32.const 42)), (global $id i32 (i32.const 42)), (global $id (mut i32) (i32.const 42))
  global([_, ...args], ctx) {
    let name = args[0][0]==='$' && args.shift()
    if (name) ctx.global[name] = ctx.global.length

    let [type, init] = args, mut = type[0] === 'mut'

    ctx.global.push([TYPE[mut ? type[1] : type], mut, ...iinit(init)])
  },

  // (table 1 2? funcref)
  table([_, ...args], ctx) {
    let name = args[0][0]==='$' && args.shift()
    if (name) ctx.table[name] = ctx.table.length

    let lims = range(args)
    ctx.table.push([TYPE[args[0]], ...lims])
  },

  // (elem (i32.const 0) $f1 $f2), (elem (global.get 0) $f1 $f2)
  elem([_, offset, ...elems], ctx) {
    const tableIdx = 0 // FIXME: table index can be defined

    ctx.elem.push([tableIdx, ...iinit(offset, ctx), elems.length, ...elems.map(el => el[0]==='$' ? ctx.func[el] : +el)])
  },

  //  (export "name" (kind $name|idx))
  export([_, name, [kind, idx]], ctx) {
    if (idx[0]==='$') idx = ctx[kind][idx]
    ctx.export.push([...str(name), ETYPE[kind], idx])
  },

  // (import "mod" "name" ref)
  import([_, mod, name, ref], ctx) {
    // FIXME: forward here from particular nodes instead: definition for import is same, we should DRY import code
    build[ref[0]]([ref[0], ['import', mod, name], ...ref.slice(1)])
  },

  // (data (i32.const 0) "\2a")
  data([_, offset, init], ctx) {
    // FIXME: first is mem index
    ctx.data.push([0, ...iinit(offset,ctx), ...str(init)])
  },

  start() {

  }
}

// (i32.const 0) - instantiation time initializer
const iinit = ([op, literal], ctx) =>
  [OP[op], ...i32(literal[0] === '$' ? ctx.global[literal] : literal), END]

// build string binary
const str = str => {
  str = str[0]==='"' ? str.slice(1,-1) : str
  let res = [0], i = 0
  // spec https://webassembly.github.io/spec/core/text/values.html#strings
  for (; i < str.length;) res.push(str[i]==='\\' ? parseInt(str.slice(++i,i+=2), 16) : str.charCodeAt(i++))
  res[0]=res.length-1
  return res
}

// build range/limits sequence
const range = (args, min=args.shift()) => isNaN(parseInt(args[0])) ? [0, +min] : [1, +min, +args.shift()]

const err = text => { throw Error(text) }
