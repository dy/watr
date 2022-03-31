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

  compile[tree[0]](tree, section)

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

  // (func $name? ...params result ...body)
  func([_,...body], ctx) {
    let params=[], result=[], idx=ctx.func.length, vars = []

    if (body[0]?.[0] === '$') ctx.func[body.shift()] = idx
    if (body[0]?.[0] === 'export') compile.export([...body.shift(), ['func', idx]], ctx)
    while (body[0]?.[0] === 'param') {
      let [_, ...paramTypes] = body.shift()
      if (paramTypes[0]?.[0] === '$') params[paramTypes.shift()] = params.length
      params.push(...paramTypes.map(t => TYPE[t]))
    }
    if (body[0]?.[0] === 'result') result.push(...body.shift().slice(1).map(t => TYPE[t]))

    ctx.func.push([ctx.type.push([TYPE.func, params.length, ...params, result.length, ...result])-1])

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

      // i32.store align=n offset=m
      if (typeOp === 'store') {
        let o = {align: [ALIGN[op]], offset: [0]}, p
        while (args[0]?.[0] in o) p = args.shift(), o[p[0]] = i32(p[1])
        immediates.push(...o.align, ...o.offset)
      }
      // i32.const 123
      else if (typeOp === 'const') {
        immediates.push(...i32(args.shift()))
      }
      // local.get id
      else if (type === 'local') {
        immediates.push(...i32(args.shift()))
      }
      // other immediates are prev instructions, ie. (i32.add a b) → a b i32.add
      else {
        args = args.map(instr)
      }

      return [...args, OP[op], ...immediates]
    }

    body = body.flatMap(node => Array.isArray(node) ? instr(node) : [OP[node]])

    ctx.code.push([body.length+2, vars.length, ...body, 0x0b])
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
  // type
  // elem
  // start
  // offset
}

const encoder = new TextEncoder()
