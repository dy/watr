// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section
import {OP, SECTION, RANGE, TYPE, ETYPE, ALIGN} from './const.js'
import { i32 } from './leb128.js'

const END = 0x0b

export default (tree) => {
  // NOTE: alias is stored directly to section array by key, eg. section.func.$name = idx
  let section = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], elem: [], code: [], data: []
  }

  // (func ...args) → (module (func ...args))
  if (typeof tree[0] === 'string') { if (tree[0] !== 'module') tree = ['module', tree] }
  // [(func), (func)] → (module (func) (func))
  else tree = ['module', ...tree]

  // build nodes in order of sections
  for (let name in section)
    for (let node of tree)
      if (node[0] === name) build[name](node, section)

  let binary = new Uint8Array([
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

  binary.section = section

  return binary
}

const build = {
  // (type $name? (func (param $x i32) (param i64 i32) (result i32 i64)))
  // signature part is identical to function
  // FIXME: handle non-function types
  type([_, ...args], ctx) {
    let name = args[0]?.[0]==='$' && args.shift(),
        params = [],
        result = [],
        decl = args[0]

    if (decl[0]==='func') {
      decl.shift()

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
    // TODO: handle non-func other types
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

      // i32.store align=n offset=m
      if (op.endsWith('store')) {
        let o = {align: [ALIGN[op]], offset: [0]}, p
        while (args[0]?.[0] in o) p = args.shift(), o[p[0]] = i32(p[1])
        imm = [...o.align, ...o.offset]
      }

      // i32.const 123
      else if (op.endsWith('const')) imm = i32(args.shift())

      // (local.get id), (local.tee id)
      else if (op.startsWith('local')) {
        let id = args.shift()
        imm = i32(id[0]==='$' ? params[id] || locals[id] : id)
      }

      // (call id)
      else if (op === 'call') {
        let id = args.shift()
        imm = i32(id[0]==='$' ? ctx.func[id] : id)
      }

      // (call_indirect (type i32) tableId)
      else if (op === 'call_indirect') {
        let type = args.shift(), [_,id] = type
        imm = i32(id[0]==='$' ? ctx.type[id] : id)
        imm.push(0)
      }

      imm.unshift(OP[op])

      return imm
    }

    // consume instruction block
    const instr = (args) => {
      if (typeof args[0] === 'string') return immediates(args)

      // (a b (c))
      if (Array.isArray(args[0])) {
        let op = args.shift()
        let imm = immediates(op)
        return [...op.flatMap(arg => instr(arg)), ...imm]
      }

      throw Error('Unknown ' + op)
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

    let [min, max, shared] = parts, dfn = max ? [RANGE.minmax, +min, +max] : [RANGE.min, +min]

    if (!imp) ctx.memory.push(dfn)
    else {
      let [_, mod, name] = imp
      ctx.import.push([mod.length, ...encoder.encode(mod), name.length, ...encoder.encode(name), ETYPE.memory, ...dfn])
    }
  },

  // mut
  global([_, type, mutable], ctx) { ctx.global.push([]) },

  // (table 1 2? funcref)
  table([_, ...args], ctx) {
    let name = args[0][0]==='$' && args.shift()

    let [min, max, kind] = args,
        dfn = kind ? [TYPE[kind], RANGE.minmax, +min, +max] : [TYPE[max], RANGE.min, +min]

    if (name) ctx.table[name] = ctx.table.length
    ctx.table.push(dfn)
  },

  // (elem (i32.const 0) $f1 $f2), (elem (global.get 0) $f1 $f2)
  elem([_, offset, ...elems], ctx) {
    const tableIdx = 0

    // FIXME: offset calc can be generalized as instantiation-time initializer
    let [op, ref] = offset
    if (op === 'global.get') ref = ref[0]==='$' ? ctx.global[ref] : ref

    ctx.elem.push([tableIdx, OP[op], ...i32(ref), END, elems.length, ...elems.map(el => el[0]==='$' ? ctx.func[el] : +el)])
  },

  //  (export "name" ([type] $name|idx))
  export([_, name, [kind, idx]], ctx) {
    if (name[0]==='"') name = name.slice(1,-1)
    if (idx[0]==='$') idx = ctx[kind][idx]
    ctx.export.push([name.length, ...encoder.encode(name), ETYPE[kind], idx])
  },

  // (import "mod" "name" ref)
  import([_, mod, name, ref], ctx) {
    // FIXME: forward here from particular nodes instead: definition for import is same, we should DRY import code
    build[ref[0]]([ref[0], ['import', mod, name], ...ref.slice(1)])
  },

  // data
  // start
  // offset
}

const encoder = new TextEncoder()

const err = text => { throw Error(text) }
