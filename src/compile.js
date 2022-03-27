// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section
import {OP, SECTION, RANGE, TYPE, ETYPE, ALIGN} from './const.js'

export default (tree) => new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // magic
  0x01, 0x00, 0x00, 0x00, // version
  ...compile[tree[0]](tree.slice(1))
])

const compile = {
  module(nodes) {
    const section = {
      type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], element: [], code: [], data: []
    }
    // NOTE: formally can be done as name section
    const alias = {func: [], global: []}

    for (let [key, ...parts] of nodes) compile[key](parts, section, alias)

    return Object.keys(section).flatMap((key, items, count) => (
      !(count = (items = section[key]).length) ? [] : (
        (items = items.flat()).unshift(SECTION[key], items.length+1, count), items
      )
    ))
  },

  // (func $name? ...params result ...body)
  func(parts, ctx) {
    let args=[], result=[], body = parts.slice()

    while (body[0] && body[0][0] === 'param') args.push(...body.shift().slice(1).map(t => TYPE[t]))
    if (body[0] && body[0][0] === 'result') result.push(...body.shift().slice(1).map(t => TYPE[t]))

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
        while (params[0] && params[0][0]==='=') { p = params.shift(); o[p[1]] = +p[2] }
        params.unshift(o.align, o.offset)
      }

      return [OP[op], ...params]
    })

    ctx.code.push([body.length+2, vars.length, ...body, 0x0b])
  },

  // (memory min max shared)
  memory(parts, ctx) {
    parts = parts.slice()
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
  global([type, mutable], ctx) { ctx.global.push([]) },

  table([type, limits], ctx) { ctx.table.push([]) },

  //  (export "name" ([type] $name|idx))
  export([name, [type, idx]], ctx) {
    if (typeof idx === 'string') idx = ctx.alias[type][idx]
    ctx.export.push([name.length, ...encoder.encode(name), ETYPE[type], idx])
  },

  // (import mod name ref)
  import([mod, name, ref], ctx) {
    // FIXME: forward here from particular nodes instead: definition for import is same, we should DRY import code
    compile[ref[0]]([['import', mod, name], ...ref.slice(1)])
  },

  // data
  // type
  // elem
  // start
  // offset
}

const encoder = new TextEncoder()
