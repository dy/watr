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
export default function watr (nodes) {
  // normalize to (module ...) form
  if (typeof nodes === 'string') nodes = parse(nodes);
  else nodes = clone(nodes)

  // module abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') nodes.shift(), nodes[0]?.[0] === '$' && nodes.shift()
  // single node, not module
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  // binary abbr "\00" "\0x61" ...
  if (nodes[0] === 'binary') {
    nodes.shift()
    return new Uint8Array(str(nodes.map(i => i.slice(1, -1)).join('')))
  }

  // Scopes are stored directly on section array by key, eg. section.func.$name = idx
  const sections = []
  for (let kind in SECTION) sections[SECTION[kind]] = sections[kind] = []
  sections._ = {} // implicit types

  for (let [kind, ...node] of nodes) {
    let imported // if node needs to be imported

    // import abbr
    // (import m n (table|memory|global|func id? type)) -> (table|memory|global|func id? (import m n) type)
    if (kind === 'import') [kind, ...node] = (imported = node).pop()

    // index, alias
    let name = node[0]?.[0] === '$' && node.shift(), idx = sections[kind].length;
    if (name) sections[kind][name] = idx; // save alias

    // export abbr
    // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
    while (node[0]?.[0] === 'export') sections.export.push([node.shift()[1], [kind, idx]])

    // for import nodes - redirect output to import
    if (node[0]?.[0] === 'import') [,...imported] = node.shift()

    // table abbr
    // (table id? reftype (elem ...{n})) -> (table id? n n reftype) (elem (table id) (i32.const 0) reftype ...)
    if (node[1]?.[0] === 'elem') {
      let [reftype, [, ...els]] = node
      node = [els.length, els.length, reftype]
      sections.elem.push([['table', name || sections.table.length], ['i32.const', '0'],  typeof els[0] === 'string' ? 'func' : reftype, ...els])
    }

    // data abbr
    // (memory id? (data str)) -> (memory id? n n) (data (memory id) (i32.const 0) str)
    else if (node[0]?.[0] === 'data') {
      let [,...data] = node.shift(), m = ''+Math.ceil(data.map(s => s.slice(1,-1)).join('').length / 65536) // FIXME: figure out actual data size
      sections.data.push([['memory', idx], ['i32.const',0], ...data])
      node = [m, m]
    }

    // keep start name
    else if (kind === 'start') name && node.push(name);

    // [func, [param, result]] -> [param, result], alias
    else if (kind === 'type') node[0].shift(), node = paramres(node[0]),  sections.type['$'+node.join('>')] ??= idx

    // dupe to code section, save implicit type
    else if (kind === 'func') {
      let [idx, param, result] = typeuse(node, sections);
      idx ?? (sections._[idx = '$'+param+'>'+result] = [param, result]);
      !imported && nodes.push(['code', [idx, param, result], ...plain(node, sections)]) // pass param since they may have names
      node.unshift(['type', idx])
    }

    // import writes to import section amd adds placeholder for (kind) section
    if (imported) sections.import.push([...imported, [kind, ...node]]), node = null

    sections[kind].push(node)
  }

  // add implicit types - main types receive aliases, implicit types are added if no explicit types exist
  for (let n in sections._) sections.type[n] ??= sections.type.push(sections._[n]) - 1

  // patch datacount if data === 0
  if (!sections.data.length) sections.datacount.length = 0

  // convert nodes to bytes
  const bin = (kind, count=true) => {
    let items = sections[kind].filter(Boolean).map(item => build[kind](item, sections))
    return !items.length ? [] : [kind, ...vec([...(count ? uleb(items.length) : []), ...items.flat()])]
  }

  // build final binary
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    ...bin(SECTION.custom),
    ...bin(SECTION.type),
    ...bin(SECTION.import),
    ...bin(SECTION.func),
    ...bin(SECTION.table),
    ...bin(SECTION.memory),
    ...bin(SECTION.global),
    ...bin(SECTION.export),
    ...bin(SECTION.start, false),
    ...bin(SECTION.elem),
    ...bin(SECTION.datacount, false),
    ...bin(SECTION.code),
    ...bin(SECTION.data)
  ])
}

// abbr blocks, loops, ifs; collect implicit types via typeuses; resolve optional immediates
// https://webassembly.github.io/spec/core/text/instructions.html#folded-instructions
const plain = (nodes, ctx) => {
  let out = []

  while (nodes.length) {
    let node = nodes.shift()

    if (typeof node === 'string') {
      // block typeuse?
      if (node === 'block' || node === 'loop' || node === 'if') {
        out.push(node)

        // (loop $l?)
        if (nodes[0]?.[0] === '$') out.push(nodes.shift())

        let [idx, param, result] = typeuse(nodes, ctx)

        // direct idx (no params/result needed)
        if (idx != null) out.push(['type', idx])
        // get type - can be either idx or valtype (numtype | reftype)
        else if (!param.length && !result.length);
        // (result i32) - doesn't require registering type
        else if (!param.length && result.length === 1) out.push(['result', result])
        // (param i32 i32)? (result i32 i32) - implicit type
        else ctx._[idx = '$'+param+'>'+result] = [param, result], out.push(['type', idx])
      }

      // else $label, end $label
      else if (node === 'else' || node === 'end') out.push(node), nodes[0]?.[0] === '$' && nodes.shift()

      // mark datacount section as required
      else if (node === 'memory.init' || node === 'data.drop') {
        out.push(node)
        ctx.datacount[0] = true // mark datacount element
      }

      else if (node === 'call_indirect') {
        out.push(node)
        if (typeof nodes[0] === 'string' && (nodes[0][0] === '$' || !isNaN(nodes[0]))) out.push(nodes.shift())
          else out.push('0')
          let [idx, param, result] = typeuse(nodes, ctx)
        out.push(['type', idx ?? (ctx._[idx = '$'+param+'>'+result] = [param, result], idx)])
      }

      // abbr table.* idx?
      else if (node.startsWith('table.')) {
        out.push(node)
        out.push(nodes[0]?.[0] === '$' || !isNaN(nodes[0]) ? nodes.shift() : '0')
      }

      // plain instr
      else out.push(node)
    }

    // (block ...) -> block ... end
    else if (node[0] === 'block' || node[0] === 'loop') {
      node = plain(node, ctx)
      out.push(...node, 'end')
    }

    // (if ...) -> if ... end
    else if (node[0] === 'if') {
      node = plain(node, ctx)

      let thenelse = [], blocktype = [node.shift()]
      // (if label? blocktype? cond*? (then instr*) (else instr*)?) -> cond*? if label? blocktype? instr* else instr*? end
      // https://webassembly.github.io/spec/core/text/instructions.html#control-instructions
      if (node[node.length - 1]?.[0] === 'else') thenelse.unshift(...node.pop())
      if (node[node.length - 1]?.[0] === 'then') thenelse.unshift(...node.pop())

      // label?
      if (node[0]?.[0] === '$') blocktype.push(node.shift())

      // blocktype? - (param) are removed already
      if (node[0]?.[0] === 'type' || node[0]?.[0] === 'result') blocktype.push(node.shift());

      // ignore empty else
      // https://webassembly.github.io/spec/core/text/instructions.html#abbreviations
      if (thenelse[thenelse.length - 1] === 'else') thenelse.pop()

      out.push(...node, ...blocktype, ...thenelse, 'end')
    }

    // (instr *) -> unfold internals
    else out.push(plain(node, ctx))
  }

  return out
}

// consume typeuse nodes, return type index/params, or null idx if no type
// https://webassembly.github.io/spec/core/text/modules.html#type-uses
const typeuse = (nodes, ctx) => {
  let idx, parres

  // explicit type (type 0|$name)
  if (nodes[0]?.[0] === 'type') {
    [, idx] = nodes.shift();
    paramres(nodes)
    return [idx]
  }

  // implicit type (param i32 i32)(result i32)
  parres = paramres(nodes)

  return [, ...parres]
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

// build section binary [by section codes] (non consuming)
const build = [,
  // (type $id? (func params result))
  ([param, result], ctx) => ([TYPE.func, ...vec(param.map(t => TYPE[t])), ...vec(result.map(t => TYPE[t]))]),

  // (import "math" "add" (func|table|global|memory typedef?))
  ([mod, field, [kind, ...dfn]], ctx) => {
    let details

    if (kind === 'func') {
      // we track imported funcs in func section to share namespace, and skip them on final build
      let [[,typeidx]] = dfn
      details = uleb(typeidx[0] === '$' ? ctx.type[typeidx] : +typeidx)
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

    return ([...vec(str(mod.slice(1,-1))), ...vec(str(field.slice(1,-1))), KIND[kind], ...details])
  },

  // (func $name? ...params result ...body)
  ([[,typeidx]], ctx) => (uleb(typeidx[0] === '$' ? ctx.type[typeidx] : +typeidx)),

  // (table id? 1 2? funcref)
  (node, ctx) => ([TYPE[node.pop()], ...limits(node)]),

  // (memory id? export* min max shared)
  (node, ctx) => limits(node),

  // (global $id? (mut i32) (i32.const 42))
  (node, ctx) => {
    let [type] = node, mut = type[0] === 'mut' ? 1 : 0

    let [, init] = node
    return ([TYPE[mut ? type[1] : type], mut, ...expr(init, ctx), 0x0b])
  },

  //  (export "name" (func|table|mem $name|idx))
  ([nm, [kind, id]], ctx) => ([...vec(str(nm.slice(1,-1))), KIND[kind], ...uleb(id[0] === '$' ? ctx[kind][id] : +id)]),

  // (start $main)
  ([id], ctx) => (uleb(id[0] === '$' ? ctx.func[id] : +id)),

  // ref: https://webassembly.github.io/spec/core/binary/modules.html#element-section
  // passive: (elem elem*)
  // declarative: (elem declare elem*)
  // active: (elem (table idx)? (offset expr)|(expr) elem*)
  // elems: funcref|externref (item expr)|expr (item expr)|expr
  // idxs: func? $id0 $id1
  (parts, ctx) => {
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
      offset = parts.shift()
      if (offset[0] === 'offset') [, offset] = offset
    }
    else mode |= 0b001 // passive

    // funcref|externref|func, func ... === funcref ...
    if (parts[0] === 'func' || parts[0] === 'funcref' || parts[0] === 'externref') reftype = parts.shift()
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

    return ([
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
        el => [...expr(typeof el === 'string' ? ['ref.func', el] : el, ctx), 0x0b] :
        // el*
        el => uleb(el[0] === '$' ? ctx.func[el] : +el)
      )
    ])
  },

  // (code)
  (body, ctx) => {
    let [typeidx, param] = body.shift()
    if (!param) [param] = ctx.type[typeidx[0] === '$' ? ctx.type[typeidx] : +typeidx]

    // provide param/local in ctx
    ctx.local = Object.create(param) // list of local variables - some of them are params
    ctx.block = [] // control instructions / blocks stack

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [, ...types] = body.shift()
      if (types[0]?.[0] === '$') ctx.local[types.shift()] = ctx.local.length
      ctx.local.push(...types.map(t => TYPE[t]))
    }

    const bytes = []//instr(body, ctx)
    while  (body.length) bytes.push(...instr(body, ctx))
    bytes.push(0x0b)

    // squash locals into (n:u32 t:valtype)*, n is number and t is type
    // we skip locals provided by params
    let loctypes = ctx.local.slice(param.length).reduce((a, type) => (type == a[a.length - 1]?.[1] ? a[a.length - 1][0]++ : a.push([1, type]), a), [])

    // cleanup tmp state
    ctx.local = ctx.block = null

    // https://webassembly.github.io/spec/core/binary/modules.html#code-section
    return (vec([...uleb(loctypes.length), ...loctypes.flatMap(([n, t]) => [...uleb(n), t]), ...bytes]))
  },

  // (data (i32.const 0) "\aa" "\bb"?)
  // (data (memory ref) (offset (i32.const 0)) "\aa" "\bb"?)
  // (data (global.get $x) "\aa" "\bb"?)
  (inits, ctx) => {
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

    return ([
      ...(
        // active: 2, x=memidx, e=expr
        memidx ? [2, ...uleb(memidx), ...expr(offset, ctx), 0x0b] :
        // active: 0, e=expr
        offset ? [0, ...expr(offset, ctx), 0x0b] :
        // passive: 1
        [1]
      ),
      ...vec(str(inits.map(i => i.slice(1, -1)).join('')))
    ])
  },

  // datacount
  (nodes, ctx) => uleb(ctx.data.length)
]

// consume one instruction from nodes sequence
const instr = (nodes, ctx) => {
  if (!nodes?.length) return []

  let out = [], op = nodes.shift(), immed, code

  // consume group
  if (Array.isArray(op)) {
    immed = instr(op, ctx)
    while (op.length) out.push(...instr(op, ctx))
    out.push(...immed)
    return out
  }


  [...immed] = INSTR[op] ?? err('Unknown instruction: ' + op)
  code = immed[0]

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
    // (v128.const i32x4 1 2 3 4)
    else if (code === 0x0c) {
      let [t, n] = nodes.shift().split('x'), stride = t.slice(1) >>> 3 // i16 -> 2, f32 -> 4
      n = +n
      // i8, i16, i32 - bypass the encoding
      if (t[0] === 'i') {
        let arr = n === 16 ? new Uint8Array(16) : n === 8 ? new Uint16Array(8) : n === 4 ? new Uint32Array(4) : new BigInt64Array(2)
        for (let i = 0; i < n; i++) {
          arr[i] = encode[t].parse(nodes.shift())
        }
        immed.push(...(new Uint8Array(arr.buffer)))
      }
      // f32, f64 - encode
      else {
        let arr = new Uint8Array(16)
        for (let i = 0; i < n; i++) arr.set(encode[t](nodes.shift()), i * stride)
        immed.push(...arr)
      }
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
      immed.push(...uleb(nodes[0][0] === '$' ? ctx.table[nodes.shift()] : +nodes.shift()))
      // table.copy tableidx? tableidx?
      if (code === 0x0e) immed.push(...uleb(nodes[0][0] === '$' ? ctx.table[nodes.shift()] : !isNaN(nodes[0]) ? +nodes.shift() : 0))
    }
  }

  // control block abbrs
  // block ..., loop ..., if ...
  else if (code === 2 || code === 3 || code === 4) {
    ctx.block.push(code)

    // (block $x) (loop $y)
    if (nodes[0]?.[0] === '$') ctx.block[nodes.shift()] = ctx.block.length

    let type = nodes[0]?.[0] === 'type' && nodes.shift()
    let typeidx = type?.[1]?.[0] === '$' ? ctx.type[type[1]] : type?.[1]
    let [param, result] = type ? ctx.type[typeidx] : nodes[0]?.[0] === 'result' ? [,[nodes.shift()[1]]] : []

    // void
    if (!param?.length && !result?.length) immed.push(TYPE.void)
    // (result i32) - doesn't require registering type
    else if (!param?.length && result.length === 1) immed.push(TYPE[result[0]])
    // (type idx)
    else immed.push(...uleb( typeidx ))
  }
  // else
  else if (code === 5) {}
  // then
  else if (code === 6) immed = [] // ignore

  // local.get $id, local.tee $id x
  else if (code == 0x20 || code == 0x21 || code == 0x22) {
    immed.push(...uleb(nodes[0][0] === '$' ? ctx.local[nodes.shift()] : +nodes.shift()))
  }

  // global.get $id, global.set $id
  else if (code == 0x23 || code == 0x24) {
    immed.push(...uleb(nodes[0][0] === '$' ? ctx.global[nodes.shift()] : +nodes.shift()))
  }

  // call id ...nodes
  else if (code == 0x10) {
    immed.push(...uleb(nodes[0]?.[0] === '$' ? ctx.func[nodes.shift()] : +nodes.shift()))
  }

  // call_indirect tableIdx? (type $typeName)? ...nodes
  else if (code == 0x11) {
    let tableidx = nodes[0]?.[0] === '$' ? ctx.table[nodes.shift()] : +nodes.shift()
    let typeidx = nodes[0][1][0] === '$' ? ctx.type[nodes.shift()[1]] : +nodes.shift()[1]
    immed.push(...uleb(typeidx), ...uleb(tableidx))
  }

  // end
  else if (code == 0x0b) ctx.block.pop()

  // br $label result?
  // br_if $label cond result?
  else if (code == 0x0c || code == 0x0d) {
    // br index indicates how many block items to pop
    immed.push(...uleb(nodes[0]?.[0] === '$' ? ctx.block.length - ctx.block[nodes.shift()] : nodes.shift()))
  }

  // br_table 1 2 3 4  0  selector result?
  else if (code == 0x0e) {
    let args = []
    while (nodes[0] && (!isNaN(nodes[0]) || nodes[0][0] === '$')) {
      let id = nodes.shift()
      args.push(...uleb(id[0][0] === '$' ? ctx.block.length - ctx.block[id] : +id))
    }
    args.unshift(...uleb(args.length - 1))
    immed.push(...args)
  }

  // select (result t+)?
  else if (code == 0x1b) {
    let [param, result] = paramres(nodes)
    if (result.length) {
      // 0x1b -> 0x1c
      immed.push(immed.pop()+1, ...uleb(result.length), ...result.map(t => TYPE[t]))
    }
  }

  // ref.func $id
  else if (code == 0xd2) {
    immed.push(...uleb(nodes[0][0] === '$' ? ctx.func[nodes.shift()] : +nodes.shift()))
  }

  // ref.null func
  else if (code == 0xd0) {
    immed.push(TYPE[nodes.shift() + 'ref']) // func->funcref, extern->externref
  }

  // binary/unary (i32.add a b) - no immed
  else if (code >= 0x45) { }

  // i32.store align=n offset=m
  else if (code >= 0x28 && code <= 0x3e) {
    let o = memarg(nodes)
    immed.push(Math.log2(o.align ?? align(op)), ...uleb(o.offset ?? 0))
  }

  // i32.const 123, f32.const 123.45
  else if (code >= 0x41 && code <= 0x44) {
    immed.push(...encode[op.split('.')[0]](nodes.shift()))
  }

  // memory.grow|size $idx? - mandatory 0x00
  // https://webassembly.github.io/spec/core/binary/instructions.html#memory-instructions
  else if (code == 0x3f || code == 0x40) {
    immed.push(0)
  }

  // table.get $id
  else if (code == 0x25 || code == 0x26) {
    immed.push(...uleb(nodes[0]?.[0] === '$' ? ctx.table[nodes.shift()] : +nodes.shift()))
  }

  // table.grow id, table.size id, table.fill id
  else if (code >= 0x0f && code <= 0x11) {
  }

  out.push(...immed)

  return out
}

// instantiation time value initializer (consuming) - we redirect to instr
const expr = (node, ctx) => instr([node], ctx)

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

const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)
