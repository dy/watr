// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section
import {OP, SECTION, RANGE, TYPE, ETYPE, ALIGN} from './const.js'

export default (tree) => {
  const section = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], element: [], code: [], data: []
  }
  // NOTE: formally can be done as name section
  const alias = {func: [], global: []}

  compile[tree[0]](tree, section, alias)

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
  module([_,...nodes], section, alias) {
    for (let node of nodes) compile[node[0]](node, section, alias)
  },

  // (func $name? ...params result ...body)
  func([_,...body], ctx) {
    let args=[], result=[], name, idx=ctx.func.length

    while (body[0]?.[0] === 'param') args.push(...body.shift().slice(1).map(t => TYPE[t]))
    if (body[0]?.[0] === 'export') compile.export([...body.shift(), ['func', name || idx]], ctx)
    if (body[0]?.[0] === 'result') result.push(...body.shift().slice(1).map(t => TYPE[t]))

    ctx.func.push(ctx.type.push([TYPE.func, args.length, ...args, result.length, ...result])-1)

    // FIXME: detect fn name and save alias pointing to fn index

    const vars = []
    body = body.flatMap(instr => {
      // FIXME: instructions may have optional immediates
      // some immediates examples:
      // align=n offset=m
      // call_indirect (type $name)
      // if (result type) instr end
      // (if (result type) (then instr))
      let op, params = []

      if (!Array.isArray(instr)) {
        op = instr
      }
      else {
        [op, ...params] = instr
      }

      // store may have optional immediates
      if (op === 'i32.store') {
        let o = {align: ALIGN[instr], offset: 0}, p
        while (params[0] && params[0][0] in o) { p = params.shift(); o[p[0]] = +p[1] }
        params.unshift(o.align, o.offset)
      }

      return [OP[op], ...params]
    })

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
