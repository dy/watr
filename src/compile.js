import { uleb, leb, bigleb, f64, f32 } from './util.js'
import { OP, SECTION, ALIGN, TYPE, KIND } from './const.js'


// some inlinable instructions
const INLINE = { loop: 1, block: 1, if: 1, end: -1, return: -1 }

// convert wat tree to wasm binary
export default (nodes) => {
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
  for (let cb of postcall) cb && cb.call && cb()


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
  type([, typeName, decl], ctx) {
    if (typeName[0] !== '$') decl = typeName, typeName = null
    let params = [], result = [], [kind, ...sig] = decl, idx, bytes

    if (kind === 'func') {
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
      if (idx < 0) idx = ctx.type.push(bytes) - 1
    }

    if (typeName) ctx.type[typeName] = idx

    return [idx, params, result]
  },

  // (func $name? ...params result ...body)
  func([, ...body], ctx) {
    let locals = [], // list of local variables
      callstack = []

    // fn name
    if (body[0]?.[0] === '$') ctx.func[body.shift()] = ctx.func.length

    // export binding
    if (body[0]?.[0] === 'export') build.export([...body.shift(), ['func', ctx.func.length]], ctx)

    // register type
    let [typeIdx, params, result] = build.type([, ['func', ...body]], ctx)
    // FIXME: try merging with build.type: it should be able to consume body
    while (body[0]?.[0] === 'param' || body[0]?.[0] === 'result') body.shift()
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

    // map code instruction into bytes: [args, opCode, immediates]
    const instr = (group) => {
      let [op, ...nodes] = group
      let opCode = OP[op], argc = 0, before = [], after = [], id

      // NOTE: we could reorganize ops by groups and detect signature as `op in STORE`
      // but numeric comparison is faster than generic hash lookup
      // FIXME: we often use OP.end or alike: what if we had list of global constants?

      // binary/unary
      if (opCode >= 69) {
        argc = opCode >= 167 ||
          (opCode <= 159 && opCode >= 153) ||
          (opCode <= 145 && opCode >= 139) ||
          (opCode <= 123 && opCode >= 121) ||
          (opCode <= 105 && opCode >= 103) ||
          opCode == 80 || opCode == 69 ? 1 : 2
      }
      // instruction
      else {
        // (i32.store align=n offset=m at value)
        if (opCode >= 40 && opCode <= 62) {
          // FIXME: figure out point in Math.log2 aligns
          let o = { align: ALIGN[op], offset: 0 }, p
          while (nodes[0]?.includes('=')) p = nodes.shift().split('='), o[p[0]] = Number(p[1])
          after = [Math.log2(o.align), ...uleb(o.offset)]
          argc = opCode >= 54 ? 2 : 1
        }

        // (i32.const 123)
        else if (opCode >= 65 && opCode <= 68) {
          after = (opCode == 65 ? leb : opCode == 66 ? bigleb : opCode == 67 ? f32 : f64)(nodes.shift())
        }

        // (local.get $id), (local.tee $id x)
        else if (opCode >= 32 && opCode <= 34) {
          after = uleb(nodes[0]?.[0] === '$' ? params[id = nodes.shift()] || locals[id] : nodes.shift())
          if (opCode > 32) argc = 1
        }

        // (global.get id), (global.set id)
        else if (opCode == 35 || opCode == 36) {
          after = uleb(nodes[0]?.[0] === '$' ? ctx.global[nodes.shift()] : nodes.shift())
          if (opCode > 35) argc = 1
        }

        // (call id ...nodes)
        else if (opCode == 16) {
          let fnName = nodes.shift()
          after = uleb(id = fnName[0] === '$' ? ctx.func[fnName] ?? err('Unknown function `' + fnName + '`') : fnName);
          // FIXME: how to get signature of imported function
          [, argc] = ctx.type[ctx.func[id][0]]
        }

        // (call_indirect (type $typeName) (idx) ...nodes)
        else if (opCode == 17) {
          let typeId = nodes.shift()[1];
          [, argc] = ctx.type[typeId = typeId[0] === '$' ? ctx.type[typeId] : typeId]
          argc++
          after = uleb(typeId), after.push(0) // extra afterediate indicates table idx (reserved)
        }

        // FIXME (memory.grow $idx?)
        else if (opCode == 63 || opCode == 64) {
          after = [0]
          argc = 1
        }

        // (if (result i32)? (local.get 0) (then a b) (else a b)?)
        else if (opCode == 4) {
          callstack.push(opCode)
          let [, type] = nodes[0][0] === 'result' ? nodes.shift() : [, 'void']
          after = [TYPE[type]]

          argc = 0, before.push(...instr(nodes.shift()))
          let body
          if (nodes[0]?.[0] === 'then') [, ...body] = nodes.shift(); else body = nodes
          after.push(...consume(body))

          callstack.pop(), callstack.push(OP.else)
          if (nodes[0]?.[0] === 'else') {
            [, ...body] = nodes.shift()
            if (body.length) after.push(OP.else, ...consume(body))
          }
          callstack.pop()
          after.push(OP.end)
        }

        // (drop arg?), (return arg?)
        else if (opCode == 0x1a || opCode == 0x0f) { argc = nodes.length ? 1 : 0 }

        // (select a b cond)
        else if (opCode == 0x1b) { argc = 3 }

        // (block ...), (loop ...)
        else if (opCode == 2 || opCode == 3) {
          callstack.push(opCode)
          if (nodes[0]?.[0] === '$') (callstack[nodes.shift()] = callstack.length)
          let [, type] = nodes[0]?.[0] === 'result' ? nodes.shift() : [, 'void']
          after = [TYPE[type], ...consume(nodes)]

          if (!group.inline) callstack.pop(), after.push(OP.end) // inline loop/block expects end to be separately provided
        }

        // (end)
        else if (opCode == 0x0b) callstack.pop()

        // (br $label result?)
        // (br_if $label cond result?)
        else if (opCode == 0x0c || opCode == 0x0d) {
          // br index indicates how many callstack items to pop
          after = uleb(nodes[0]?.[0] === '$' ? callstack.length - callstack[nodes.shift()] : nodes.shift())
          argc = (opCode == 0x0d ? 1 + (nodes.length > 1) : !!nodes.length)
        }

        // (br_table 1 2 3 4  0  selector result?)
        else if (opCode == 0x0e) {
          after = []
          while (!Array.isArray(nodes[0])) id = nodes.shift(), after.push(...uleb(id[0][0] === '$' ? callstack.length - callstack[id] : id))
          after.unshift(...uleb(after.length - 1))
          argc = 1 + (nodes.length > 1)
        }

        else if (opCode == null) err(`Unknown instruction \`${op}\``)
      }

      // consume arguments
      if (nodes.length < argc) err(`Stack arguments are not supported at \`${op}\``)
      while (argc--) before.push(...instr(nodes.shift()))
      if (nodes.length) err(`Too many arguments for \`${op}\`.`)

      return [...before, opCode, ...after]
    }

    // consume sequence of nodes
    const consume = nodes => {
      let result = []
      while (nodes.length) {
        let node = nodes.shift(), c

        if (typeof node === 'string') {
          // permit some inline instructions: loop $label ... end,  br $label,  arg return
          if (c = INLINE[node]) {
            node = [node], node.inline = true
            if (c > 0) nodes[0]?.[0] === '$' && node.push(nodes.shift())
          }
          else err(`Inline instruction \`${node}\` is not supported`)
        }

        node && result.push(...instr(node))
      }
      return result
    }

    // evaluates after all definitions
    return () => {
      let code = consume(body)
      ctx.code.push([...uleb(code.length + 2 + locTypes.length), ...uleb(locTypes.length >> 1), ...locTypes, ...code, OP.end])
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
      let [typeIdx] = build.type([, ['func', ...parts]], ctx)
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
  data([, offset, ...inits], ctx) {
    // FIXME: first is mem index
    ctx.data.push([0, ...iinit(offset, ctx), ...str(inits.map(i => i[0] === '"' ? i.slice(1, -1) : i).join(''))])
  },

  // (start $main)
  start([, name], ctx) {
    if (!ctx.start.length) ctx.start.push([name[0] === '$' ? ctx.func[name] : name])
  }
}

// (i32.const 0) - instantiation time initializer
const iinit = ([op, literal], ctx) => op[0] === 'f' ?
  [OP[op], ...(op[1] === '3' ? f32 : f64)(literal), OP.end] :
  [OP[op], ...(op[1] === '3' ? leb : bigleb)(literal[0] === '$' ? ctx.global[literal] : literal), OP.end]

const escape = { n: 10, r: 13, t: 9, v: 1 }

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

const err = text => { throw Error(text) }
