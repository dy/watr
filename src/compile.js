import * as encode from './encode.js'
import { uleb } from './encode.js'
import { SECTION, ALIGN, TYPE, KIND, INSTR } from './const.js'
import parse from './parse.js'

// build instructions index
INSTR.forEach((instr, i) => {
  let [op, ...imm] = instr.split(':'), a, b

  // TODO
  // wrap codes
  // const code = i >= 0x10f ? [0xfd, i - 0x10f] : i >= 0xfc ? [0xfc, i - 0xfc] : i
  INSTR[op] = i

  // // handle immediates
  // INSTR[op] = !imm.length ? () => code :
  //   imm.length === 1 ? (a = immedname(imm[0]), nodes => [...code, ...a(nodes)]) :
  //     (imm = imm.map(immedname), nodes => [...code, ...imm.flatMap(imm => imm(nodes))])
})


/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (WASM).
 *
 * @param {string|Array} nodes - The WAT tree or string to be compiled to WASM binary.
 * @returns {Uint8Array} The compiled WASM binary data.
 */
export default (nodes) => {
  // normalize to (module ...) form
  if (typeof nodes === 'string') nodes = parse(nodes); else nodes = [...nodes]
  if (nodes[0] === 'module') nodes.shift()
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  // (module $id? ...)
  nodes[0]?.[0] === '$' && nodes.shift();

  // Scopes are stored directly on section array by key, eg. section.func.$name = idx
  // FIXME: make direct binary instead
  const sections = {
    type: [], import: [], func: [], table: [], memory: [], global: [], export: [], start: [], elem: [], code: [], data: []
  }
  const binary = [
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
  ]

  // directly map nodes to binary sections
  while (nodes.length) {
    let [kind, ...node] = nodes.shift()

    // get name reference
    let name = node[0]?.[0] === '$' && node.shift()

    // export abbr
    // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
    // NOTE: we unshift to keep order on par with wabt
    while (node[0]?.[0] === 'export') nodes.unshift([...node.shift(), [kind, sections[kind].length]])

    // import abbr
    // (table|memory|global|func id? (import m n) type) -> (import m n (table|memory|global|func id? type))
    if (node[0]?.[0] === 'import') {
      node = [...node.shift(), [kind, ...(name ? [name] : []), ...node]], kind = node.shift()
    }

    // table abbr
    // (table id? reftype (elem ...{n})) -> (table id? n n reftype) (elem (table id) (i32.const 0) reftype ...)
    if (node[1]?.[0] === 'elem') {
      let [reftype, [, ...els]] = node
      node = [els.length, els.length, reftype]
      nodes.unshift(['elem', ['table', name || idx], ['i32.const', '0'], reftype, ...els])
    }

    // duplicate func as code section
    // FIXME: func can buid binary right away if we insert refs properly
    if (kind === 'func') nodes.push(['code', ...node])

    // workaround start
    else if (name && kind === 'start') node.push(sections.func[name]);

    // type may not have return and name can already be defined indirectly via typeuse
    if (kind === 'type') {
      let [, ...sig] = node[0]
      let [idx] = typeuse(sig, sections)
      if (name) sections.type[name] = idx
    }
    else {
      // figure out section id
      let idx = sections[kind].length

      // if section name was referenced before - use existing id, else assign idx to name
      if (name) {
        name in sections[kind] ? idx = sections[kind][name] : sections[kind][name] = idx
      }

      // build into corresponding idx
      sections[kind][idx] = build[kind](node, sections)
    }
  }

  // build binary
  for (let name in sections) {
    let items = sections[name], secCode = SECTION[name], bytes = [], count = 0
    for (let item of items) {
      if (!item) continue // ignore empty items (like import placeholders)
      count++ // count number of items in section
      bytes.push(...item)
    }
    // ignore empty sections
    if (!bytes.length) continue
    // skip start section count - write length
    if (secCode !== 8) bytes.unshift(...uleb(count))
    binary.push(secCode, ...vec(bytes))
  }

  return new Uint8Array(binary)
}

// build section binary (non consuming)
const build = {
  // (import "math" "add" (func|table|global|memory $name? typedef?))
  import([mod, field, [kind, ...parts]], ctx) {
    let nm = parts[0]?.[0] === '$' && parts.shift(), details

    // create stub
    if (nm[0] === '$') ctx[kind][nm] = ctx[kind].length
    ctx[kind].length++ // inc counter

    if (kind === 'func') {
      // we track imported funcs in func section to share namespace, and skip them on final build
      let [typeIdx] = typeuse(parts, ctx)
      details = uleb(typeIdx)
    }
    else if (kind === 'memory') {
      details = limits(parts)
    }
    else if (kind === 'global') {
      let [type] = parts, mut = type[0] === 'mut' ? 1 : 0
      details = [TYPE[mut ? type[1] : type], mut]
    }
    else if (kind === 'table') {
      details = [TYPE[parts.pop()], ...limits(parts)]
    }

    return ([...str(mod), ...str(field), KIND[kind], ...details])
  },

  // (func $name? ...params result ...body)
  func(body, ctx) {
    const [typeidx] = typeuse(body, ctx)

    // register new function
    return uleb(typeidx)
  },

  // (table id? 1 2? funcref)
  table(args, ctx) {
    return [TYPE[args.pop()], ...limits(args)]
  },

  // (memory id? export* min max shared)
  memory(args, ctx) {
    return limits(args)
  },

  // (global id? i32 (i32.const 42))
  // (global $id (mut i32) (i32.const 42))
  global(args, ctx) {
    let [type] = args, mut = type[0] === 'mut' ? 1 : 0

    let [, [...init]] = args
    return [TYPE[mut ? type[1] : type], mut, ...expr(init, ctx), 0x0b]
  },

  //  (export "name" (func|table|mem $name|idx))
  export([s, [kind, nm]], ctx) {
    // put placeholder to future-init
    let idx = nm[0] === '$' ? ctx[kind][nm] ??= ctx[kind].length++ : +nm
    return [...str(s), KIND[kind], ...uleb(idx)]
  },

  // (start $main)
  start([id], ctx) {
    // FIXME: can be resolved later
    // FIXME: do away with name
    return uleb(+id)
  },

  // ref: https://webassembly.github.io/spec/core/binary/modules.html#element-section
  // passive
  // (elem elem*)
  // declarative
  // (elem declare elem*)
  // active
  // (elem (table idx)? (offset expr)|(expr) elem*)
  // elems
  // funcref|externref (item expr)|expr (item expr)|expr
  // func? $id0 $id1
  elem(parts, ctx) {
    let tabidx, offset, mode = 0b000, reftype

    // declare?
    if (parts[0] === 'declare') parts.shift(), mode |= 0b010

    // table?
    if (parts[0][0] === 'table') {
      [, tabidx] = parts.shift()
      tabidx = tabidx[0] === '$' ? (ctx.table[tabidx] ??= ctx.table.length++) : +tabidx
      // ignore table=0
      if (tabidx) mode |= 0b010
    }

    // (offset expr)|expr
    if (parts[0]?.[0] === 'offset' || (Array.isArray(parts[0]) && parts[0][0] !== 'item' && !parts[0][0].startsWith('ref'))) {
      [...offset] = parts.shift()
      if (offset[0] === 'offset') [, [...offset]] = offset
    }
    else mode |= 0b001 // passive

    // funcref|externref|func
    if (parts[0] === 'func') parts.shift()
    else if (parts[0] === 'funcref') reftype = parts.shift(), mode |= 0b100
    // FIXME: externref makes explicit table index (in wabt, but not in standard)
    else if (parts[0] === 'externref') reftype = parts.shift(), offset ||= ['i32.const', 0], mode = 0b110

    // reset to simplest mode if no actual elements
    if (!parts.length) mode &= 0b011

    return ([
      mode,
      ...(
        // 0b000 e:expr y*:vec(funcidx)                     | type=funcref, init ((ref.func y)end)*, active (table=0,offset=e)
        mode === 0b000 ? [...expr(offset, ctx), 0x0b] :
          // 0b001 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive
          mode === 0b001 ? [0x00] :
            // 0b010 x:tabidx e:expr et:elkind y*:vec(funcidx)  | type=0x00, init ((ref.func y)end)*, active (table=x,offset=e)
            mode === 0b010 ? [...uleb(tabidx || 0), ...expr(offset), 0x0b, 0x00] :
              // 0b011 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive declare
              mode === 0b011 ? [0x00] :
                // 0b100 e:expr el*:vec(expr)                       | type=funcref, init el*, active (table=0, offset=e)
                mode === 0b100 ? [...expr(offset, ctx), 0x0b] :
                  // 0b101 et:reftype el*:vec(expr)                   | type=et, init el*, passive
                  mode === 0b101 ? [TYPE[reftype]] :
                    // 0b110 x:tabidx e:expr et:reftype el*:vec(expr)   | type=et, init el*, active (table=x, offset=e)
                    mode === 0b110 ? [...uleb(tabidx || 0), ...expr(offset), 0x0b, TYPE[reftype]] :
                      // 0b111 et:reftype el*:vec(expr)                   | type=et, init el*, passive declare
                      [TYPE[reftype]]
      ),
      ...uleb(parts.length),
      ...parts.flatMap(el => (
        typeof el === 'string' ?
          // $id0 1 2
          uleb(el[0] === '$' ? (ctx.func[el] ??= ctx.func.length++) : +el) :
          // (ref.func a) (item (ref.func 2)) (item ref.func 2)
          [...expr(el[0] === 'item' ? (el.length > 2 ? el.slice(1) : [...el[1]]) : [...el], ctx), 0x0b]
      ))
    ])
  },

  // FIXME: artificial section, can be handled via func
  // (code params ...body)
  code(body, ctx) {
    const [, params] = typeuse(body, ctx)
    let blocks = [] // control instructions / blocks stack
    let locals = [] // list of local variables

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [, ...types] = body.shift(), name
      if (types[0][0] === '$')
        params[name = types.shift()] ? err('Ambiguous name ' + name) : // FIXME: not supposed to happen
          locals[name] = params.length + locals.length
      locals.push(...types.map(t => TYPE[t]))
    }

    // convert sequence of instructions from input nodes to out bytes
    const consume = (nodes, out = []) => {
      if (!nodes?.length) return out

      let op = nodes.shift(), opCode, args = nodes, immed, id, group

      // flatten groups, eg. (cmd z w) -> z w cmd
      if (group = Array.isArray(op)) {
        args = [...op] // op is immutable
        opCode = INSTR[op = args.shift()]
      }
      else opCode = INSTR[op]

      // v128s: (v128.load x) etc
      // https://github.com/WebAssembly/simd/blob/master/proposals/simd/BinarySIMD.md
      if (opCode >= 0x10f) {
        opCode -= 0x10f
        immed = [0xfd, ...uleb(opCode)]
        // (v128.load)
        if (opCode <= 0x0b) {
          const o = memarg(args)
          immed.push(Math.log2(o.align ?? ALIGN[op]), ...uleb(o.offset ?? 0))
        }
        // (v128.load_lane offset? align? idx)
        else if (opCode >= 0x54 && opCode <= 0x5d) {
          const o = memarg(args)
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
          immed = expr(args, ctx)
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

      // ref.func $id
      else if (opCode == 0xd2) {
        immed = uleb(args[0][0] === '$' ? (ctx.func[args.shift()] ??= ctx.func.length++) : +args.shift())
      }
      // ref.null
      else if (opCode == 0xd0) {
        immed = [TYPE[args.shift() + 'ref']] // func->funcref, extern->externref
      }

      // binary/unary (i32.add a b) - no immed
      else if (opCode >= 0x45) { }

      // (i32.store align=n offset=m at value) etc
      else if (opCode >= 0x28 && opCode <= 0x3e) {
        // FIXME: figure out point in Math.log2 aligns
        let o = memarg(args)
        immed = [Math.log2(o.align ?? ALIGN[op]), ...uleb(o.offset ?? 0)]
      }

      // (i32.const 123), (f32.const 123.45) etc
      else if (opCode >= 0x41 && opCode <= 0x44) {
        immed = encode[op.split('.')[0]](args.shift())
      }

      // (local.get $id), (local.tee $id x)
      else if (opCode >= 0x20 && opCode <= 0x22) {
        immed = uleb(args[0]?.[0] === '$' ? params[id = args.shift()] ?? locals[id] ?? err('Unknown local ' + id) : +args.shift())
      }

      // (global.get $id), (global.set $id)
      else if (opCode == 0x23 || opCode == 0x24) {
        immed = uleb(args[0]?.[0] === '$' ? ctx.global[args.shift()] ??= ctx.global.length++ : +args.shift())
      }

      // (call id ...nodes)
      else if (opCode == 0x10) {
        let fnName = args.shift()
        immed = uleb(id = fnName[0] === '$' ? ctx.func[fnName] ?? err('Unknown func ' + fnName) : +fnName);
        // FIXME: how to get signature of imported function
      }

      // (call_indirect tableIdx? (type $typeName) (idx) ...nodes)
      else if (opCode == 0x11) {
        let tableidx = args[0]?.[0] === '$' ? ctx.table[args.shift()] ??= ctx.table.length++ : 0
        let [typeidx] = typeuse(args, ctx)
        // let typeidx = args.shift()[1];
        // typeidx = typeidx[0] === '$' ? ctx.type[typeidx] ?? err('Unknown type ' + typeidx) : +typeidx
        immed = [...uleb(typeidx), ...uleb(tableidx)]
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
          let [typeidx] = typeuse(args, ctx)
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

      // FIXME multiple memory (memory.grow $idx?)
      else if (opCode == 0x3f || opCode == 0x40) {
        immed = [0]
      }

      // (table.get $id)
      else if (opCode == 0x25 || opCode == 0x26) {
        immed = uleb(args[0]?.[0] === '$' ? ctx.table[args.shift()] ??= ctx.table.length++ : +args.shift())
      }

      // table.grow id, table.size id, table.fill id
      else if (opCode >= 0x0f && opCode <= 0x11) {
        immed = []
      }

      else if (opCode == null) err(`Unknown instruction \`${op}\``)

      // if group (cmd im1 im2 arg1 arg2) - insert any remaining args first: arg1 arg2
      // because inline case has them in stack already
      if (group) while (args.length) consume(args, out)

      if (opCode) out.push(opCode)
      if (immed) out.push(...immed)
    }

    const bytes = []
    while (body.length) consume(body, bytes)
    bytes.push(0x0b)

    // squash locals into (n:u32 t:valtype)*, n is number and t is type
    let loctypes = locals.reduce((a, type) => (type == a[a.length - 1]?.[1] ? a[a.length - 1][0]++ : a.push([1, type]), a), [])

    // https://webassembly.github.io/spec/core/binary/modules.html#code-section
    return vec([...uleb(loctypes.length), ...loctypes.flatMap(([n, t]) => [...uleb(n), t]), ...bytes])
  },

  // (data (i32.const 0) "\aa" "\bb"?)
  // (data (offset (i32.const 0)) (memory ref) "\aa" "\bb"?)
  // (data (global.get $x) "\aa" "\bb"?)
  data(inits, ctx) {
    let offset, mem

    if (inits[0]?.[0] === 'offset') [, offset] = inits.shift()
    if (inits[0]?.[0] === 'memory') [, mem] = inits.shift()
    if (inits[0]?.[0] === 'offset') [, offset] = inits.shift()
    if (!offset && !mem) offset = inits.shift()
    if (!offset) offset = ['i32.const', 0]

    return [0, ...expr([...offset], ctx), 0x0b, ...str(inits.map(i => i[0] === '"' ? i.slice(1, -1) : i).join(''))]
  }
}

// serialize binary array
const vec = a => [...uleb(a.length), ...a]

// instantiation time const initializer (consuming)
const expr = (node, ctx) => {
  let op = node.shift(), [type, cmd] = op.split('.')

  // (global.get idx)
  if (type === 'global') return [0x23, ...uleb(node[0][0] === '$' ? ctx.global[node[0]] ??= ctx.global.length++ : +node)]

  // (v128.const i32x4 1 2 3 4)
  if (type === 'v128') return [0xfd, 0x0c, ...v128(node)]

  // (i32.const 1)
  if (cmd === 'const') return [0x41 + ['i32', 'i64', 'f32', 'f64'].indexOf(type), ...encode[type](node[0])]

  // (ref.func $x) or (ref.null func|extern)
  if (type === 'ref') {
    return cmd === 'func' ?
      [0xd2, ...uleb(node[0][0] === '$' ? (ctx.func[node[0]] ??= ctx.func.length++) : +node)] :
      // heaptype
      [0xd0, TYPE[node[0] + 'ref']] // func->funcref, extern->externref
  }

  // (i32.add a b), (i32.mult a b) etc
  return [
    ...expr(node.shift(), ctx),
    ...expr(node.shift(), ctx),
    INSTR[op]
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

// https://webassembly.github.io/spec/core/text/modules.html#type-uses
// consume (type id)(param t+)* (result t+)*
const typeuse = (nodes, ctx) => {
  let idx

  // existing type (type 0), (type $name) - can repeat params, result after
  if (nodes[0]?.[0] === 'type') {
    [, idx] = nodes.shift()
    idx = idx[0] === '$' ? ctx.type[idx] : +idx
  }

  let params = [], result = []
  // collect params (param i32 i64) (param $x? i32)
  while (nodes[0]?.[0] === 'param') {
    let [, ...args] = nodes.shift()
    let name = args[0]?.[0] === '$' && args.shift()
    if (name) params[name] = params.length // expose name refs
    params.push(...args)
  }

  // collect result eg. (result f64 f32)(result i32)
  while (nodes[0]?.[0] === 'result') {
    let [, ...args] = nodes.shift()
    result.push(...args)
  }

  // if new type, not (type 0) (...)
  if (idx == null) {
    // for simplicity of search we fabricate type name
    let pr = params + '>' + result
    // reuse existing type or register new one
    idx = ctx.type[pr] ??=
      ctx.type.push([TYPE.func, ...vec(params.map(t => TYPE[t])), ...vec(result.map(t => TYPE[t]))]) - 1
  }

  return [idx, params, result]
}

// consume align/offset/etc params
const memarg = (args) => {
  let params = {}, param
  while (args[0]?.includes('=')) param = args.shift().split('='), params[param[0]] = Number(param[1])
  return params
}

// escape codes
const escape = { n: 10, r: 13, t: 9, v: 1, '\\': 92 }

// build string binary
const str = str => {
  str = str[0] === '"' ? str.slice(1, -1) : str
  let res = [], i = 0, c, BSLASH = 92
  // https://webassembly.github.io/spec/core/text/values.html#strings
  for (; i < str.length;) {
    c = str.charCodeAt(i++)
    res.push(c === BSLASH ? escape[str[i++]] || parseInt(str.slice(i - 1, ++i), 16) : c)
  }

  return vec(res)
}

// build limits sequence (non-consuming)
const limits = ([min, max, shared]) => isNaN(parseInt(max)) ? [0, ...uleb(min)] : [shared === 'shared' ? 3 : 1, ...uleb(min), ...uleb(max)]

const err = text => { throw Error(text) }
