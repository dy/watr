// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section
import {OP, SECTION, RANGE, TYPE, ETYPE, ALIGN} from './const.js'
import { i32 } from './leb128.js'

export default (tree) => {
  // NOTE: alias is stored directly to section array by key, eg. section.func.$name = idx
  const section = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], element: [], code: [], data: []
  }

  if (typeof tree[0] === 'string') tree = [tree]
  for (let node of tree) compile[node[0]](node, section)

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    ...Object.keys(section).flatMap((key) => {
      let items=section[key], count=items.length, binary
      if (!count) return []

      binary = items.flat()

      binary.unshift(SECTION[key], binary.length+1, count)
      return binary
    })
  ])
}

const compile = {
  module([_,...nodes], section) {
    for (let node of nodes) compile[node[0]](node, section)
  },

  // (type $name? (func (param $x i32) (param i64 i32) (result i32 i64)))
  // signature part is identical to function
  // FIXME: handle non-function types
  type([_, [kind, ...args]], ctx) {
    let name = args[0]?.[0]==='$' && args.shift(),
        params = [],
        result = []

    // collect params
    while (args[0]?.[0] === 'param') {
      let [_, ...types] = args.shift()
      if (types[0]?.[0] === '$') params[types.shift()] = params.length
      params.push(...types.map(t => TYPE[t]))
    }

    // collect result type
    if (args[0]?.[0] === 'result') result = args.shift().slice(1).map(t => TYPE[t])

    // reuse existing type or register new one
    let bytes = [TYPE.func, params.length, ...params, result.length, ...result]
    let idx = ctx.type.findIndex((prevType) => prevType.every((byte, i) => byte === bytes[i]))

    if (idx < 0) idx = ctx.type.push(bytes)-1
    return [idx, params, result]
  },

  // (func $name? ...params result ...body)
  func([_,...body], ctx) {
    let idx=ctx.func.length, // fn index
        locals=[] // list of local variables

    // fn name
    if (body[0]?.[0] === '$') ctx.func[body.shift()] = idx

    // export binding
    if (body[0]?.[0] === 'export') compile.export([...body.shift(), ['func', idx]], ctx)

    // register type
    let [typeIdx, params, result] = compile.type([,['func',...body]], ctx)
    while (body[0]?.[0] === 'param' || body[0]?.[0] === 'result') body.shift()
    ctx.func.push([typeIdx])

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [_, ...localTypes] = body.shift(), name
      if (localTypes[0][0]==='$')
        params[name=localTypes.shift()] ? err('Ambiguous name '+name) : name,
        locals[name] = params.length + locals.length
      localTypes.forEach(t => locals.push(TYPE[t]))
    }

    // parse instruction block
    const instr = (node) => {
      // FIXME: instructions may have optional immediates
      // some immediates examples:
      // call_indirect (type $name)
      // if (result type) instr end
      // (if (result type) (then instr))
      // (i32.add a b)
      let [op, ...args] = node, immediates = []
      let [type, typeOp] = op.split('.')

      // FIXME: figure out how to generalize this case
      // i32.store align=n offset=m
      // console.group(op)
      if (typeOp === 'store') {
        let o = {align: [ALIGN[op]], offset: [0]}, p
        while (args[0]?.[0] in o) p = args.shift(), o[p[0]] = i32(p[1])
        immediates.push(...o.align, ...o.offset)
      }
      // i32.const 123
      else if (typeOp === 'const') {
        immediates.push(...i32(args.shift()))
      }
      // local.get id, local.tee id
      else if (type === 'local') {
        let id = args.shift()
        immediates.push(...i32(id[0]==='$' ? params[id] || locals[id] : id))
      }
      // call id arg1 argN
      else if (op === 'call') {
        let id = args.shift()
        immediates.push(...i32(id[0]==='$' in ctx.func ? ctx.func[id] : id))
      }

      // other immediates are prev instructions, ie. (i32.add a b) → a b i32.add
      args = args.flatMap(instr)
      // console.log(args, op, immediates)
      // console.groupEnd()

      return [...args, OP[op], ...immediates]
    }

    body = body.flatMap(node => Array.isArray(node) ? instr(node) : [OP[node]])

    ctx.code.push([body.length+2+locals.length*2, locals.length, ...locals.flatMap(type => [1, type]), ...body, 0x0b])
  },

  // (memory min max shared)
  memory([_, ...parts], ctx) {
    let imp = false
    // (memory (import "js" "mem") 1) → (import "js" "mem" (memory 1))
    if (parts[0][0] === 'import') imp = parts.shift()

    let [min, max, shared] = parts,
        dfn = max ? [RANGE.minmax, min, max] : [RANGE.min, min]

    if (!imp) ctx.memory.push(dfn)
    else {
      let [_, mod, name] = imp
      ctx.import.push([mod.length, ...encoder.encode(mod), name.length, ...encoder.encode(name), ETYPE.memory, ...dfn])
    }
  },

  // mut
  global([_, type, mutable], ctx) { ctx.global.push([]) },

  table([_, type, limits], ctx) { ctx.table.push([]) },

  //  (export "name" ([type] $name|idx))
  export([_, name, [type, idx]], ctx) {
    if (name[0]==='"') name = name.slice(1,-1)
    if (typeof idx === 'string') idx = ctx.alias[type][idx]
    ctx.export.push([name.length, ...encoder.encode(name), ETYPE[type], idx])
  },

  // (import "mod" "name" ref)
  import([_, mod, name, ref], ctx) {
    // FIXME: forward here from particular nodes instead: definition for import is same, we should DRY import code
    compile[ref[0]]([ref[0], ['import', mod, name], ...ref.slice(1)])
  },

  // data
  // elem
  // start
  // offset
}

const encoder = new TextEncoder()

const err = text => { throw Error(text) }
