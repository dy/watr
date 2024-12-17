import * as encode from './encode.js'
import { uleb } from './encode.js'
import { SECTION, TYPE, KIND, INSTR } from './const.js'
import parse from './parse.js'

// build instructions index
INSTR.forEach((op, i) => INSTR[op] = i >= 0x10f ? [0xfd, i - 0x10f] : i >= 0xfc ? [0xfc, i - 0xfc] : [i])

/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (WASM).
 *
 * @param {string|Array} nodes - The WAT tree or string to be compiled to WASM binary.
 * @returns {Uint8Array} The compiled WASM binary data.
 */
export default (nodes) => {
  // normalize to (module ...) form
  if (typeof nodes === 'string') nodes = parse(nodes); else nodes = [...nodes]

  // module abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') nodes.shift(), typeof nodes[0] === 'string' && nodes.shift()
  // single node, not module
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  // binary abbr "\00" "\0x61" ...
  // FIXME: be slightly smarter here: parse by sections, optimize them in default way
  if (nodes[0] === 'binary') {
    nodes.shift()
    return new Uint8Array(str(nodes.map(i => i.slice(1, -1)).join('')))
  }

  // Scopes are stored directly on section array by key, eg. section.func.$name = idx
  // FIXME: make direct binary instead (faster)
  const sections = []
  for (let kind in SECTION) sections.push(sections[kind] = [])

  const binary = [
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
  ]

  // sort nodes by sections
  // TODO: make this more elegant
  let nodeGroups = []
  for (let kind in SECTION) nodeGroups.push(nodeGroups[kind] = [])

  for (let [kind, ...node] of nodes) {
    // index, alias
    let name = node[0]?.[0] === '$' ? node.shift() : null, idx = nodeGroups[kind].length;
    if (name) sections[kind][name] = idx; // save alias

    // export abbr
    // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
    while (node[0]?.[0] === 'export') nodeGroups.export.push([node.shift()[1], [kind, idx]])

    // import abbr
    // (table|memory|global|func id? (import m n) type) -> (import m n (table|memory|global|func id? type))
    if (node[0]?.[0] === 'import') node = [...node.shift(), [kind, ...(name ? [name] : []), ...node]], kind = node.shift()

    // table abbr
    // (table id? reftype (elem ...{n})) -> (table id? n n reftype) (elem (table id) (i32.const 0) reftype ...)
    if (node[1]?.[0] === 'elem') {
      let [reftype, [, ...els]] = node
      node = [els.length, els.length, reftype]
      nodeGroups.elem.push([['table', name || nodeGroups.table.length], ['i32.const', '0'],  typeof els[0] === 'string' ? 'func' : reftype, ...els])
    }

    // data abbr
    // (memory id? (data str)) -> (memory id? n n) (data (memory id) (i32.const 0) str)
    if (node[0]?.[0] === 'data') {
      let [,...data] = node.shift(), m = ''+Math.ceil(data.map(s => s.slice(1,-1)).join('').length / 65536) // FIXME: figure out actual data size
      nodeGroups.data.push([['memory', idx], ['i32.const',0], ...data])
      node = [m, m]
    }

    // import increments corresponding section index
    // FIXME: can be turned into shallow node
    if (kind === 'import') {
      let [mod, field, [kind, ...dfn]] = node
      if (dfn[0]?.[0] === '$') sections[kind][dfn.shift()] = nodeGroups[kind].length
      nodeGroups[kind].length++
      node[2] = [kind, ...dfn]
    }
    else if (kind === 'start') {name && node.unshift(name);}
    else if (kind === 'func') node = unfold(node) // plainify instructions

    nodeGroups[kind].push(node)
    sections[kind].length++ // predefine spot
  }

  // build sections binaries
  for (let kind in SECTION) {
    nodeGroups[kind].map((node,i) => !node ? [] : build[kind](i, node, sections))
  }

  // build final binary
  for (let kind in SECTION) {
    let secCode = SECTION[kind]
    let items = sections[kind], bytes = [], count = 0
    for (let item of items) {
      if (!item) { continue } // ignore empty items (like import placeholders)
      count++ // count number of items in section
      bytes.push(...item)
    }
    // ignore empty sections
    if (!bytes.length) continue
    // skip start section count - write length
    if (secCode !== SECTION.start && secCode !== SECTION.datacount) bytes.unshift(...uleb(count))
    binary.push(secCode, ...vec(bytes))
  }

  return new Uint8Array(binary)
}

// abbr for blocks, loops, ifs
// https://webassembly.github.io/spec/core/text/instructions.html#folded-instructions
const unfold = nodes => {
  let out = []

  // FIXME: we can collect types here btw and simplify typeuse not to create types on binary stage
  for (let node of nodes) {
    if (Array.isArray(node)) {
      node = unfold(node)

      // (block ...) -> block ... end
      if (node[0] === 'block' || node[0] === 'loop') {
        out.push(node.shift())
        for (let n of node) out.push(n)
        out.push('end')
      }
      // (if ...) -> if ... end
      else if (node[0] === 'if') {
        let thenelse = [], blocktype = [node.shift()]
        // (if label? blocktype? cond*? (then instr*) (else instr*)?) -> cond*? if label? blocktype? instr* else instr*? end
        // https://webassembly.github.io/spec/core/text/instructions.html#control-instructions
        if (node[node.length - 1]?.[0] === 'else') thenelse.unshift(...node.pop())
        if (node[node.length - 1]?.[0] === 'then') thenelse.unshift(...node.pop())

        // label?
        if (node[0]?.[0] === '$') blocktype.push(node.shift())
        // blocktype?
        while (['type', 'param', 'result'].includes(node[0]?.[0])) blocktype.push(node.shift());

        // ignore empty else
        // https://webassembly.github.io/spec/core/text/instructions.html#abbreviations
        if (thenelse[thenelse.length - 1] === 'else') thenelse.pop()

        out.push(...node, ...blocktype, ...thenelse, 'end')
      }
      else out.push(node)
    }
    else out.push(node)
  }

  return out
}

// build section binary (non consuming)
const build = {
  // (type $id? (func params result))
  // we cannot squash types since indices can refer to them
  type(idx, [...node], ctx) {
    let [, ...sig] = node?.[0] || [], [param, result] = paramres(sig)

    ctx.type[idx] = Object.assign(
      [TYPE.func, ...vec(param.map(t => TYPE[t])), ...vec(result.map(t => TYPE[t]))],
      { param, result } // save params for the type name
    )
    ctx.type[param + '>' + result] ??= idx // alias for quick search (don't increment if exists)
  },

  // (import "math" "add" (func|table|global|memory typedef?))
  import(idx, [mod, field, [kind, ...dfn]], ctx) {
    let details

    if (kind === 'func') {
      // we track imported funcs in func section to share namespace, and skip them on final build
      let [typeIdx] = typeuse(dfn, ctx)
      details = uleb(typeIdx)
    }
    else if (kind === 'memory') {
      details = limits(dfn)
    }
    else if (kind === 'global') {
      let [type] = dfn, mut = type[0] === 'mut' ? 1 : 0
      details = [TYPE[mut ? type[1] : type], mut]
    }
    else if (kind === 'table') {
      details = [TYPE[dfn.pop()], ...limits(dfn)]
    }

    ctx.import[idx] = ([...vec(str(mod.slice(1,-1))), ...vec(str(field.slice(1,-1))), KIND[kind], ...details])
  },

  // (func $name? ...params result ...body)
  func(idx, [...node], ctx) {
    const [typeidx, param, result] = typeuse(node, ctx)

    ctx.func[idx] = uleb(typeidx)

    // provide param/local in ctx
    ctx.local = param // list of params + local variables
    ctx.block = [] // control instructions / blocks stack

    let locstart = param.length

    // collect locals
    while (node[0]?.[0] === 'local') {
      let [, ...types] = node.shift()
      if (types[0]?.[0] === '$') ctx.local[types.shift()] = ctx.local.length
      ctx.local.push(...types.map(t => TYPE[t]))
    }

    const bytes = []//instr(node, ctx)
    // FIXME: make direct instr call
    while (node.length) bytes.push(...instr(node, ctx))
    bytes.push(0x0b)

    // squash locals into (n:u32 t:valtype)*, n is number and t is type
    let loctypes = ctx.local.slice(locstart).reduce((a, type) => (type == a[a.length - 1]?.[1] ? a[a.length - 1][0]++ : a.push([1, type]), a), [])

    // https://webassembly.github.io/spec/core/binary/modules.html#code-section
    ctx.code[idx] = vec([...uleb(loctypes.length), ...loctypes.flatMap(([n, t]) => [...uleb(n), t]), ...bytes])

    // cleanup tmp state
    ctx.local = ctx.block = null
  },

  // (table id? 1 2? funcref)
  table(idx, [...node], ctx) {
    ctx.table[idx] = [TYPE[node.pop()], ...limits(node)]
  },

  // (memory id? export* min max shared)
  memory(idx, [...node], ctx) {
    ctx.memory[idx] = limits(node)
  },

  // (global $id? (mut i32) (i32.const 42))
  global(idx, [...node], ctx) {
    let [type] = node, mut = type[0] === 'mut' ? 1 : 0

    let [, [...init]] = node
    ctx.global[idx] = [TYPE[mut ? type[1] : type], mut, ...expr(init, ctx), 0x0b]
  },

  //  (export "name" (func|table|mem $name|idx))
  export(_, [nm, [kind, id]], ctx) {
    // put placeholder to future-init
    let idx = id[0] === '$' ? ctx[kind][id] : +id
    ctx.export.push([...vec(str(nm.slice(1,-1))), KIND[kind], ...uleb(idx)])
  },

  // (start $main)
  start(_,[id], ctx) {
    id = id[0] === '$' ? ctx.func[id] : +id
    ctx.start[0] = uleb(id)
  },

  // ref: https://webassembly.github.io/spec/core/binary/modules.html#element-section
  // passive: (elem elem*)
  // declarative: (elem declare elem*)
  // active: (elem (table idx)? (offset expr)|(expr) elem*)
  // elems: funcref|externref (item expr)|expr (item expr)|expr
  // idxs: func? $id0 $id1
  elem(idx,[...parts], ctx) {
    let tabidx, offset, mode = 0b000, reftype

    // declare?
    if (parts[0] === 'declare') parts.shift(), mode |= 0b010

    // table?
    if (parts[0][0] === 'table') {
      [, tabidx] = parts.shift()
      tabidx = tabidx[0] === '$' ? ctx.table[tabidx] : +tabidx
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
    if (parts[0]?.[0]!=='$') reftype = parts.shift()
    // externref makes explicit table index
    if (reftype === 'externref') offset ||= ['i32.const', 0], mode = 0b110

    // reset to simplest mode if no actual elements
    if (!parts.length) mode &= 0b011

    // simplify els sequence
    parts = parts.map(el => {
      if (el[0] === 'item') [, el] = el
      if (el[0] === 'ref.func') [, el] = el
      // (ref.null func) and other expressions turn expr init mode
      if (typeof el !== 'string') mode |= 0b100
      return el
    })

    ctx.elem[idx] = ([
      mode,
      ...(
        // 0b000 e:expr y*:vec(funcidx)                     | type=funcref, init ((ref.func y)end)*, active (table=0,offset=e)
        mode === 0b000 ? [...expr(offset, ctx), 0x0b] :
          // 0b001 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive
          mode === 0b001 ? [0x00] :
            // 0b010 x:tabidx e:expr et:elkind y*:vec(funcidx)  | type=0x00, init ((ref.func y)end)*, active (table=x,offset=e)
            mode === 0b010 ? [...uleb(tabidx || 0), ...expr(offset, ctx), 0x0b, 0x00] :
              // 0b011 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive declare
              mode === 0b011 ? [0x00] :
                // 0b100 e:expr el*:vec(expr)                       | type=funcref, init el*, active (table=0, offset=e)
                mode === 0b100 ? [...expr(offset, ctx), 0x0b] :
                  // 0b101 et:reftype el*:vec(expr)                   | type=et, init el*, passive
                  mode === 0b101 ? [TYPE[reftype]] :
                    // 0b110 x:tabidx e:expr et:reftype el*:vec(expr)   | type=et, init el*, active (table=x, offset=e)
                    mode === 0b110 ? [...uleb(tabidx || 0), ...expr(offset, ctx), 0x0b, TYPE[reftype]] :
                      // 0b111 et:reftype el*:vec(expr)                   | type=et, init el*, passive declare
                      [TYPE[reftype]]
      ),
      ...uleb(parts.length),
      ...parts.flatMap(mode & 0b100 ?
        // ((ref.func y)end)*
        el => [...expr(typeof el === 'string' ? ['ref.func', el] : [...el], ctx), 0x0b] :
        // el*
        el => uleb(el[0] === '$' ? ctx.func[el] : +el)
      )
    ])
  },

  // (data (i32.const 0) "\aa" "\bb"?)
  // (data (memory ref) (offset (i32.const 0)) "\aa" "\bb"?)
  // (data (global.get $x) "\aa" "\bb"?)
  data(idx, [...inits], ctx) {
    let offset, memidx = 0

    // (memory ref)?
    if (inits[0]?.[0] === 'memory') {
      [, memidx] = inits.shift()
      memidx = memidx[0] === '$' ? ctx.memory[memidx] : +memidx
    }

    // (offset (i32.const 0)) or (i32.const 0)
    if (typeof inits[0] !== 'string') {
      offset = inits.shift()
      if (offset[0] === 'offset') [, offset] = offset
    }

    ctx.data[idx] = [
      ...(
        // active: 2, x=memidx, e=expr
        memidx ? [2, ...uleb(memidx), ...expr([...offset], ctx), 0x0b] :
        // active: 0, e=expr
        offset ? [0, ...expr([...offset], ctx), 0x0b] :
        // passive: 1
        [1]
      ),
      ...vec(str(inits.map(i => i.slice(1, -1)).join('')))
    ]
  }
}

// convert sequence of instructions from input nodes to out bytes
const instr = (nodes, ctx) => {
  if (!nodes?.length) return []

  // flatten groups, eg. (cmd z w) -> z w cmd
  let group = Array.isArray(nodes[0]);
  if (group) nodes = [...nodes.shift()];
  let op = nodes.shift(), code, immed, out = [];

  [...immed] = INSTR[op] ?? err('Unknown instruction: ' + op);
  [code] = immed


  // v128s: (v128.load x) etc
  // https://github.com/WebAssembly/simd/blob/master/proposals/simd/BinarySIMD.md
  if (code === 0xfd) {
    [,code] = immed
    immed = [0xfd, ...uleb(code)]
    // (v128.load)
    if (code <= 0x0b) {
      const o = memarg(nodes)
      immed.push(Math.log2(o.align ?? align(op)), ...uleb(o.offset ?? 0))
    }
    // (v128.load_lane offset? align? idx)
    else if (code >= 0x54 && code <= 0x5d) {
      const o = memarg(nodes)
      immed.push(Math.log2(o.align ?? align(op)), ...uleb(o.offset ?? 0))
      // (v128.load_lane_zero)
      if (code <= 0x5b) immed.push(...uleb(nodes.shift()))
    }
    // (i8x16.shuffle 0 1 ... 15 a b)
    else if (code === 0x0d) {
      // i8, i16, i32 - bypass the encoding
      for (let i = 0; i < 16; i++) immed.push(encode.i32.parse(nodes.shift()))
    }
    // (v128.const i32x4)
    else if (code === 0x0c) {
      immed.push(...v128(nodes))
    }
    // (i8x16.extract_lane_s 0 ...)
    else if (code >= 0x15 && code <= 0x22) {
      immed.push(...uleb(nodes.shift()))
    }
  }

  // bulk memory: (memory.init) (memory.copy) (data.drop) (memory.fill)
  // table ops: (table.init|copy|grow|size|fill) (elem.drop)
  // https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md#instruction-encoding
  else if (code == 0xfc) {
    [,code] = immed

    // memory.init idx, data.drop idx,
    if (code === 0x08 || code === 0x09) {
      // toggle datacount section
      if (ctx.data.length) ctx.datacount[0] ??= [ctx.data.length]
      immed.push(...uleb(nodes[0][0] === '$' ? ctx.data[nodes.shift()] : +nodes.shift()))
    }

    // memory placeholders
    if (code == 0x08 || code == 0x0b) immed.push(0)
    else if (code === 0x0a) immed.push(0,0)

    // elem.drop elemidx
    if (code === 0x0d) {
      immed.push(...uleb(nodes[0][0] === '$' ? ctx.elem[nodes.shift()] : +nodes.shift()))
    }
    // table.init tableidx? elemidx -> 0xfc 0x0c elemidx tableidx
    // https://webassembly.github.io/spec/core/binary/instructions.html#table-instructions
    else if (code === 0x0c) {
      let tabidx = (nodes[1][0] === '$' || !isNaN(nodes[1])) ? (nodes[0][0] === '$' ? ctx.table[nodes.shift()] : +nodes.shift()) : 0
      immed.push(...uleb(nodes[0][0] === '$' ? ctx.elem[nodes.shift()] : +nodes.shift()), ...uleb(tabidx))
    }
    // table.* tableidx?
    // abbrs https://webassembly.github.io/spec/core/text/instructions.html#id1
    else if (code >= 0x0c) {
      immed.push(...uleb(nodes[0][0] === '$' ? ctx.table[nodes.shift()] : !isNaN(nodes[0]) ? +nodes.shift() : 0))
      // table.copy tableidx? tableidx?
      if (code === 0x0e) immed.push(...uleb(nodes[0][0] === '$' ? ctx.table[nodes.shift()] : !isNaN(nodes[0]) ? +nodes.shift() : 0))
    }
  }
    // control block abbrs
  // (block ...), (loop ...), (if ...)
  else if (code === 2 || code === 3 || code === 4) {
    ctx.block.push(code)

    // (block $x) (loop $y)
    if (nodes[0]?.[0] === '$') ctx.block[nodes.shift()] = ctx.block.length

    // get type - can be either typeidx or valtype (numtype | reftype)
    // (result i32) - doesn't require registering type
    if (nodes[0]?.[0] === 'result' && nodes[0].length == 2) immed.push(TYPE[nodes.shift()[1]])
    // (type idx)? (param i32 i32)? (result i32 i32)
    else if (['type', 'param', 'result'].includes(nodes[0]?.[0])) immed.push(...uleb(typeuse(nodes, ctx)[0]))
    else immed.push(TYPE.void)
  }
  // (else)
  else if (code === 5) {}
  // (then)
  else if (code === 6) immed = [] // ignore

  // (local.get $id), (local.tee $id x)
  else if (code == 0x20 || code == 0x21 || code == 0x22) {
    immed.push(...uleb(nodes[0][0] === '$' ? ctx.local[nodes.shift()] : +nodes.shift()))
  }

  // (global.get $id), (global.set $id)
  else if (code == 0x23 || code == 0x24) {
    immed.push(...uleb(nodes[0][0] === '$' ? ctx.global[nodes.shift()] : +nodes.shift()))
  }

  // (call id ...nodes)
  else if (code == 0x10) {
    immed.push(...uleb(nodes[0]?.[0] === '$' ? ctx.func[nodes.shift()] : +nodes.shift()))
    // FIXME: how to get signature of imported function
  }

  // (call_indirect tableIdx? (type $typeName) (idx) ...nodes)
  else if (code == 0x11) {
    let tableidx = nodes[0]?.[0] === '$' ? ctx.table[nodes.shift()] : 0
    let [typeidx] = typeuse(nodes, ctx)
    immed.push(...uleb(typeidx), ...uleb(tableidx))
  }

  // (end)
  else if (code == 0x0b) ctx.block.pop()

  // (br $label result?)
  // (br_if $label cond result?)
  else if (code == 0x0c || code == 0x0d) {
    // br index indicates how many block items to pop
    immed.push(...uleb(nodes[0]?.[0] === '$' ? ctx.block.length - ctx.block[nodes.shift()] : nodes.shift()))
  }

  // (br_table 1 2 3 4  0  selector result?)
  else if (code == 0x0e) {
    let args = []
    while (nodes[0] && !Array.isArray(nodes[0])) {
      let id = nodes.shift()
      args.push(...uleb(id[0][0] === '$' ? ctx.block.length - ctx.block[id] : id))
    }
    args.unshift(...uleb(args.length - 1))
    immed.push(...args)
  }

  // ref.func $id
  else if (code == 0xd2) {
    immed.push(...uleb(nodes[0][0] === '$' ? ctx.func[nodes.shift()] : +nodes.shift()))
  }

  // ref.null
  else if (code == 0xd0) {
    immed.push(TYPE[nodes.shift() + 'ref']) // func->funcref, extern->externref
  }

  // binary/unary (i32.add a b) - no immed
  else if (code >= 0x45) { }

  // (i32.store align=n offset=m at value) etc
  else if (code >= 0x28 && code <= 0x3e) {
    // FIXME: figure out point in Math.log2 aligns
    let o = memarg(nodes)
    immed.push(Math.log2(o.align ?? align(op)), ...uleb(o.offset ?? 0))
  }

  // (i32.const 123), (f32.const 123.45) etc
  else if (code >= 0x41 && code <= 0x44) {
    immed.push(...encode[op.split('.')[0]](nodes.shift()))
  }

  // (memory.grow|size $idx?) - mandatory 0x00
  // https://webassembly.github.io/spec/core/binary/instructions.html#memory-instructions
  else if (code == 0x3f || code == 0x40) {
    immed.push(0)
  }

  // (table.get $id)
  else if (code == 0x25 || code == 0x26) {
    immed.push(...uleb(nodes[0]?.[0] === '$' ? ctx.table[nodes.shift()] : +nodes.shift()))
  }

  // table.grow id, table.size id, table.fill id
  else if (code >= 0x0f && code <= 0x11) {
  }

  // if group (cmd im1 im2 arg1 arg2) - insert any remaining nodes first: arg1 arg2
  if (group) while (nodes.length) out.push(...instr(nodes, ctx))

  out.push(...immed)

  return out
}

// instantiation time const initializer (consuming) - we redirect to instr
const expr = (node, ctx) => instr([node], ctx)

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
// consume (type $id|id) (param t+)* (result t+)*
const typeuse = (nodes, ctx) => {
  let idx, param, result, alias

  // existing/new type (type 0|$name)
  if (nodes[0]?.[0] === 'type') {
    [, idx] = nodes.shift();

    // (type 0), (type $n) - existing type
    if (ctx.type[idx] != null) {
      paramres(nodes);
      if (idx[0] === '$') idx = ctx.type[idx];
      ({ param, result } = ctx.type[idx] ?? err('Bad type ' + idx));
      return [+idx, param, result]
    }
  }

  // if new type - find existing match
  ;[param, result] = paramres(nodes), alias = param + '>' + result
  // or register new type
  if (ctx.type[alias] == null) {
    build.type(ctx.type.length, [[, ['param', ...param], ['result', ...result]]], ctx)
  }

  return [ctx.type[alias], param, result]
}

// consume (param t+)* (result t+)* sequence
const paramres = (nodes) => {
  let param = [], result = []

  // collect param (param i32 i64) (param $x? i32)
  while (nodes[0]?.[0] === 'param') {
    let [, ...args] = nodes.shift()
    let name = args[0]?.[0] === '$' && args.shift()
    if (name) param[name] = param.length // expose name refs
    param.push(...args)
  }

  // collect result eg. (result f64 f32)(result i32)
  while (nodes[0]?.[0] === 'result') {
    let [, ...args] = nodes.shift()
    result.push(...args)
  }

  return [param, result]
}

// consume align/offset/etc params
const memarg = (args) => {
  let ao = {}, kv
  while (args[0]?.includes('=')) kv = args.shift().split('='), ao[kv[0]] = Number(kv[1])
  return ao
}

// ref:
// const ALIGN = {
//   'i32.load': 4, 'i64.load': 8, 'f32.load': 4, 'f64.load': 8,
//   'i32.load8_s': 1, 'i32.load8_u': 1, 'i32.load16_s': 2, 'i32.load16_u': 2,
//   'i64.load8_s': 1, 'i64.load8_u': 1, 'i64.load16_s': 2, 'i64.load16_u': 2, 'i64.load32_s': 4, 'i64.load32_u': 4, 'i32.store': 4,
//   'i64.store': 8, 'f32.store': 4, 'f64.store': 8, 'i32.store8': 1, 'i32.store16': 2, 'i64.store8': 1, 'i64.store16': 2, 'i64.store32': 4,
//   'v128.load': 16, 'v128.load8x8_s': 8, 'v128.load8x8_u': 8, 'v128.load16x4_s': 8, 'v128.load16x4_u': 8, 'v128.load32x2_s': 8, 'v128.load32x2_u': 8, 'v128.load8_splat': 1, 'v128.load16_splat': 2, 'v128.load32_splat': 4, 'v128.load64_splat': 8, 'v128.store': 16,
//   'v128.load': 16, 'v128.load8_lane': 1, 'v128.load16_lane': 2, 'v128.load32_lane': 4, 'v128.load64_lane': 8, 'v128.store8_lane': 1, 'v128.store16_lane': 2, 'v128.store32_lane': 4, 'v128.store64_lane': 8, 'v128.load32_zero': 4, 'v128.load64_zero': 8
// }
const align = (op) => {
  let [group, opname] = op.split('.'); // v128.load8x8_u -> gsize = 32, opname = load8_u
  let [lsize] = (opname[0] === 'l' ? opname.slice(4) : opname.slice(5)).split('_') // load8x8_u -> lsize = 8x8
  let [size, x] = lsize ? lsize.split('x') : [group.slice(1)] // 8x8 -> size = 8
  return x ? 8 : +size / 8
}


// build limits sequence (non-consuming)
const limits = ([min, max, shared]) => isNaN(parseInt(max)) ? [0, ...uleb(min)] : [shared === 'shared' ? 3 : 1, ...uleb(min), ...uleb(max)]

// escape codes
const escape = { n: 10, r: 13, t: 9, v: 1, '"':34, "'": 39, '\\': 92 }

// build string binary
const str = str => {
  let res = [], i = 0, c, BSLASH = 92
  // https://webassembly.github.io/spec/core/text/values.html#strings
  for (; i < str.length;) {
    c = str.charCodeAt(i++)
    res.push(c === BSLASH ? escape[str[i++]] || parseInt(str.slice(i - 1, ++i), 16) : c)
  }
  return res
}

// serialize binary array
const vec = a => [...uleb(a.length), ...a]

const err = text => { throw Error(text) }
