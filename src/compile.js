import * as encode from './encode.js'
import { uleb, i32, i64 } from './encode.js'
import { SECTION, TYPE, KIND, INSTR, HEAPTYPE, DEFTYPE, RECTYPE, REFTYPE, INSTR_META, FIELD_TYPE } from './const.js'
import parse from './parse.js'
import { err, tdec } from './util.js'

// iterating context
let cur, idx

/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (WASM).
 *
 * @param {string|Array} nodes - The WAT tree or string to be compiled to WASM binary.
 * @returns {Uint8Array} The compiled WASM binary data.
 */
export default function compile(nodes) {
  // deep clone array to avoid mutating input
  const clone = a => a.map(i => Array.isArray(i) ? clone(i) : i)
  // normalize to (module ...) form
  if (typeof nodes === 'string') nodes = parse(nodes) || []
  else nodes = clone(nodes)
  // console.log(clone(nodes))

  cur = nodes, idx = 0
  // module abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') idx++, cur[idx]?.[0] === '$' && idx++
  // single node, not module
  else if (typeof nodes[0] === 'string') cur = [nodes]

  // binary abbr "\00" "\0x61" ...
  if (cur[idx] === 'binary') return Uint8Array.from(cur.slice(++idx).flat())

  // quote "a" "b"
  if (cur[idx] === 'quote') return compile(cur.slice(++idx).map(v => v.valueOf().slice(1,-1)).flat().join(''))

  // scopes are aliased by key as well, eg. section.func.$name = section[SECTION.func] = idx
  const ctx = []
  for (let kind in SECTION) (ctx[SECTION[kind]] = ctx[kind] = []).name = kind

  // initialize types
  cur.slice(idx).filter(([kind, ...node]) => {
    // (@custom "name" placement? data) - custom section support
    if (kind === '@custom') {
      ctx.custom.push(node)
      return false
    }
    // (rec (type $a (sub final? $sup* (func ...))...) (type $b ...)) -> save subtypes
    if (kind === 'rec') {
      // node contains a list of subtypes, (type ...) or (type (sub final? ...))
      // convert rec type into regular type (first subtype) with stashed subtypes length
      // add rest of subtypes as regular type nodes with subtype flag
      for (let i = 0; i < node.length; i++) {
        let [, ...subnode] = node[i]
        name(subnode, ctx.type);
        (subnode = typedef(subnode, ctx)).push(i ? true : [ctx.type.length, node.length])
        ctx.type.push(subnode)
      }
    }
    // (type (func param* result*))
    // (type (array (mut i8)))
    // (type (struct (field a)*)
    // (type (sub final? $nm* (struct|array|func ...)))
    else if (kind === 'type') {
      name(node, ctx.type);
      ctx.type.push(typedef(node, ctx));
    }
    // other sections may have id
    else if (kind === 'start' || kind === 'export') ctx[kind].push(node)

    else return true
  })

    // prepare/normalize nodes
    .forEach(([kind, ...node]) => {
      let imported // if node needs to be imported

      // import abbr
      // (import m n (table|memory|global|func id? type)) -> (table|memory|global|func id? (import m n) type)
      if (kind === 'import') [kind, ...node] = (imported = node).pop()

      // index, alias
      let items = ctx[kind];
      name(node, items);

      // export abbr
      // (table|memory|global|func|tag id? (export n)* ...) -> (table|memory|global|func|tag id ...) (export n (table|memory|global|func id))
      while (node[0]?.[0] === 'export') ctx.export.push([node.shift()[1], [kind, items.length]])

      // for import nodes - redirect output to import
      if (node[0]?.[0] === 'import') [, ...imported] = node.shift()

      // table abbr: (table id? i64? reftype (elem ...)) -> (table id? i64? n n reftype) + (elem ...)
      if (kind === 'table') {
        const is64 = node[0] === 'i64', idx = is64 ? 1 : 0
        if (node[idx + 1]?.[0] === 'elem') {
          let [reftype, [, ...els]] = [node[idx], node[idx + 1]]
          node = is64 ? ['i64', els.length, els.length, reftype] : [els.length, els.length, reftype]
          ctx.elem.push([['table', items.length], [is64 ? 'i64.const' : 'i32.const', 0], reftype, ...els])
        }
      }

      // data abbr: (memory id? i64? (data str)) -> (memory id? i64? n n) + (data ...)
      else if (kind === 'memory') {
        const is64 = node[0] === 'i64', idx = is64 ? 1 : 0
        if (node[idx]?.[0] === 'data') {
          let [, ...data] = node.splice(idx, 1)[0], m = '' + Math.ceil(data.flat().length / 65536) // FIXME: figure out actual data size
          ctx.data.push([['memory', items.length], [is64 ? 'i64.const' : 'i32.const', 0], ...data])
          node = is64 ? ['i64', m, m] : [m, m]
        }
      }

      // dupe to code section, save implicit type
      else if (kind === 'func') {
        let [idx, param, result] = typeuse(node, ctx);
        idx ??= regtype(param, result, ctx)

        // flatten + normalize function body
        !imported && ctx.code.push([[idx, param, result], ...normalize(node, ctx)])
        node = [['type', idx]]
      }

      // tag has a type similar to func
      else if (kind === 'tag') {
        let [idx, param] = typeuse(node, ctx);
        idx ??= regtype(param, [], ctx)
        node = [['type', idx]]
      }

      // import writes to import section amd adds placeholder for (kind) section
      if (imported) ctx.import.push([...imported, [kind, ...node]]), node = null

      items.push(node)
    })

  // convert nodes to bytes
  const bin = (kind, count = true) => {
    const items = ctx[kind]
      .filter(Boolean)  // filter out (type, imported) placeholders
      .map(item => build[kind](item, ctx))
      .filter(Boolean)  // filter out unrenderable things (subtype or data.length)

    // Custom sections - each is output as separate section with own header
    if (kind === SECTION.custom) return items.flatMap(content => [kind, ...vec(content)])

    return !items.length ? [] : [kind, ...vec(count ? vec(items) : items)]
  }

  // build final binary
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    ...bin(SECTION.custom),
    ...bin(SECTION.type),
    ...bin(SECTION.import),
    ...bin(SECTION.func),
    ...bin(SECTION.table),
    ...bin(SECTION.memory),
    ...bin(SECTION.tag),
    ...bin(SECTION.global),
    ...bin(SECTION.export),
    ...bin(SECTION.start, false),
    ...bin(SECTION.elem),
    ...bin(SECTION.datacount, false),
    ...bin(SECTION.code),
    ...bin(SECTION.data)
  ])
}


// if node is a valid index reference
const isIdx = n => n?.[0] === '$' || !isNaN(n)

// Helper for optional index immediate
const takeOptIdx = (nodes, ctx, field, defaultVal = 0) =>
  uleb(id(isIdx(nodes[0]) ? nodes.shift() : defaultVal, ctx[field]))

const isInstr = s => typeof s === 'string' && Array.isArray(INSTR[s])
const isImmed = n => !Array.isArray(n) || 'type,param,result,ref'.includes(n[0])
const optIdx2 = nodes => [isIdx(nodes[0]) ? nodes.shift() : 0, isIdx(nodes[0]) ? nodes.shift() : 0]


// --- normalize function (was in normalize.js) ---
export function normalize(nodes, ctx) {
  const out = []
  nodes = [...nodes]
  while (nodes.length) {
    let node = nodes.shift()
    if (typeof node === 'string') {
      out.push(node)
      if (node === 'block' || node === 'if' || node === 'loop') {
        if (nodes[0]?.[0] === '$') out.push(nodes.shift())
        out.push(blocktype(nodes, ctx))
      } else if (node === 'else' || node === 'end') { if (nodes[0]?.[0] === '$') nodes.shift() }
      else if (node === 'select') out.push(paramres(nodes)[1])
      else if (node.endsWith('call_indirect')) {
        let tableidx = isIdx(nodes[0]) ? nodes.shift() : 0, [idx, param, result] = typeuse(nodes, ctx)
        out.push(tableidx, ['type', idx ?? regtype(param, result, ctx)])
      } else if (node === 'table.init') out.push(isIdx(nodes[1]) ? nodes.shift() : 0, nodes.shift())
      else if (node === 'table.copy' || node === 'memory.copy') out.push(...optIdx2(nodes))
      else if (node.startsWith('table.')) out.push(isIdx(nodes[0]) ? nodes.shift() : 0)
      else if (node === 'memory.init') {
        out.push(...(isIdx(nodes[1]) ? [nodes.shift(), nodes.shift()].reverse() : [nodes.shift(), 0]))
        ctx.datacount && (ctx.datacount[0] = true)
      } else if (node === 'data.drop' || node === 'array.new_data' || node === 'array.init_data') {
        node === 'data.drop' && out.push(nodes.shift())
        ctx.datacount && (ctx.datacount[0] = true)
      } else if (node.startsWith('memory.') && isIdx(nodes[0])) out.push(nodes.shift())
    } else if (Array.isArray(node)) {
      const op = node[0]
      if (typeof op !== 'string' || !isInstr(op)) { out.push(node); continue }
      const parts = node.slice(1)
      if (op === 'block' || op === 'loop') {
        out.push(op)
        if (parts[0]?.[0] === '$') out.push(parts.shift())
        out.push(blocktype(parts, ctx), ...normalize(parts, ctx), 'end')
      } else if (op === 'if') {
        let then = [], els = []
        if (parts.at(-1)?.[0] === 'else') els = normalize(parts.pop().slice(1), ctx)
        if (parts.at(-1)?.[0] === 'then') then = normalize(parts.pop().slice(1), ctx)
        let immed = [op]
        if (parts[0]?.[0] === '$') immed.push(parts.shift())
        immed.push(blocktype(parts, ctx))
        out.push(...normalize(parts, ctx), ...immed, ...then)
        els.length && out.push('else', ...els)
        out.push('end')
      } else {
        const imm = []
        while (parts.length && isImmed(parts[0])) imm.push(parts.shift())
        out.push(...normalize(parts, ctx), op, ...imm)
        nodes.unshift(...out.splice(out.length - 1 - imm.length))
      }
    } else out.push(node)
  }
  return out
}
// --- end normalize ---


// --- Type helpers ---
// Register implicit type, return index
const regtype = (param, result, ctx, idx = '$' + param + '>' + result) => (ctx.type[idx] ??= ctx.type.push(['func', [param, result]]) - 1, idx)

// Collect field sequence: (field a) (field b c) -> [a, b, c]
const fieldseq = (nodes, field) => {
  let seq = []
  while (nodes[0]?.[0] === field) {
    let [, ...args] = nodes.shift(), nm = args[0]?.[0] === '$' && args.shift()
    if (nm) nm in seq ? (() => { throw Error(`Duplicate ${field} ${nm}`) })() : seq[nm] = seq.length
    seq.push(...args)
  }
  return seq
}

// Consume (param ...)* (result ...)*
const paramres = (nodes) => {
  let param = fieldseq(nodes, 'param'), result = fieldseq(nodes, 'result')
  if (nodes[0]?.[0] === 'param') throw Error('Unexpected param')
  return [param, result]
}

// Consume typeuse: (type idx)? (param ...)* (result ...)*
const typeuse = (nodes, ctx) => {
  if (nodes[0]?.[0] !== 'type') return [, ...paramres(nodes)]
  let [, idx] = nodes.shift(), [param, result] = paramres(nodes)
  const entry = ctx.type[(typeof idx === 'string' && isNaN(idx)) ? ctx.type[idx] : +idx]
  if (!entry) throw Error(`Unknown type ${idx}`)
  if ((param.length || result.length) && entry[1].join('>') !== param + '>' + result) throw Error(`Type ${idx} mismatch`)
  return [idx, ...entry[1]]
}

// Resolve blocktype: void | (result t) | (type idx)
const blocktype = (nodes, ctx) => {
  let [idx, param, result] = typeuse(nodes, ctx)
  if (!param.length && !result.length) return
  if (!param.length && result.length === 1) return ['result', ...result]
  return ['type', idx ?? regtype(param, result, ctx)]
}
// --- End type helpers ---



// consume section name eg. $t ...
const name = (node, list) => {
  let nm = (node[0]?.[0] === '$') && node.shift();
  if (nm) nm in list ? err(`Duplicate ${list.name} ${nm}`) : list[nm] = list.length; // save alias
  return nm
}

// (type $id? (func param* result*))
// (type $id? (array (mut i8)))
// (type $id? (struct (field a)*)
// (type $id? (sub final? $nm* (struct|array|func ...)))
const typedef = ([dfn], ctx) => {
  let subkind = 'subfinal', supertypes = [], compkind
  if (dfn[0] === 'sub') {
    subkind = dfn.shift(), dfn[0] === 'final' && (subkind += dfn.shift())
    dfn = (supertypes = dfn).pop() // last item is definition
  }

  [compkind, ...dfn] = dfn // composite type kind

  if (compkind === 'func') dfn = paramres(dfn), ctx.type['$' + dfn.join('>')] ??= ctx.type.length
  else if (compkind === 'struct') dfn = fieldseq(dfn, 'field')
  else if (compkind === 'array') [dfn] = dfn

  return [compkind, dfn, subkind, supertypes]
}


// build section binary [by section codes] (non consuming)
const build = [
  // (@custom "name" placement? data) - custom section builder
  ([name, ...rest], ctx) => {
    // Check if second arg is placement directive (before|after section)
    let data = rest
    if (rest[0]?.[0] === 'before' || rest[0]?.[0] === 'after') {
      // Skip placement for now - would need more complex section ordering
      data = rest.slice(1)
    }
    // Custom section format: name (vec string) + raw content bytes
    return [...vec(name.flat()), ...data.flat()]
  },
  // type kinds
  // (func params result)
  // (array i8)
  // (struct ...fields)
  ([kind, fields, subkind, supertypes, rec], ctx) => {
    if (rec === true) return // ignore rec subtypes cept for 1st one

    let details
    // (rec (sub ...)*)
    if (rec) {
      kind = 'rec'
      let [from, length] = rec, subtypes = Array.from({ length }, (_, i) => build[SECTION.type](ctx.type[from + i].slice(0, 4), ctx))
      details = vec(subtypes)
    }
    // (sub final? sups* (type...))
    else if (subkind === 'sub' || supertypes?.length) {
      details = [...vec(supertypes.map(n => id(n, ctx.type))), ...build[SECTION.type]([kind, fields], ctx)]
      kind = subkind
    }

    else if (kind === 'func') {
      details = [...vec(fields[0].map(t => reftype(t, ctx))), ...vec(fields[1].map(t => reftype(t, ctx)))]
    }
    else if (kind === 'array') {
      details = fieldtype(fields, ctx)
    }
    else if (kind === 'struct') {
      details = vec(fields.map(t => fieldtype(t, ctx)))
    }

    return [DEFTYPE[kind], ...details]
  },

  // (import "math" "add" (func|table|global|memory|tag dfn?))
  ([mod, field, [kind, ...dfn]], ctx) => {
    let details

    if (kind === 'func') {
      // we track imported funcs in func section to share namespace, and skip them on final build
      let [[, typeidx]] = dfn
      details = uleb(id(typeidx, ctx.type))
    }
    else if (kind === 'tag') {
      let [[, typeidx]] = dfn
      details = [0x00, ...uleb(id(typeidx, ctx.type))]
    }
    else if (kind === 'memory') {
      details = limits(dfn)
    }
    else if (kind === 'global') {
      details = fieldtype(dfn[0], ctx)
    }
    else if (kind === 'table') {
      details = [...reftype(dfn.pop(), ctx), ...limits(dfn)]
    }
    else err(`Unknown kind ${kind}`)

    return ([...vec(mod), ...vec(field), KIND[kind], ...details])
  },

  // (func $name? ...params result ...body)
  ([[, typeidx]], ctx) => (uleb(id(typeidx, ctx.type))),

  // (table 1 2 funcref)
  (node, ctx) => {
    let lims = limits(node), t = reftype(node.shift(), ctx), [init] = node
    return init ? [0x40, 0x00, ...t, ...lims, ...expr(init, ctx)] : [...t, ...lims]
  },

  // (memory id? export* min max shared)
  (node, ctx) => limits(node),

  // (global $id? (mut i32) (i32.const 42))
  ([t, init], ctx) => [...fieldtype(t, ctx), ...expr(init, ctx)],

  // (export "name" (func|table|mem $name|idx))
  ([nm, [kind, l]], ctx) => ([...vec(nm), KIND[kind], ...uleb(id(l, ctx[kind]))]),

  // (start $main)
  ([l], ctx) => uleb(id(l, ctx.func)),

  // (elem elem*) - passive
  // (elem declare elem*) - declarative
  // (elem (table idx)? (offset expr)|(expr) elem*) - active
  // ref: https://webassembly.github.io/spec/core/binary/modules.html#element-section
  (parts, ctx) => {
    let passive = 0, declare = 0, elexpr = 0, nofunc = 0, tabidx, offset, rt

    // declare?
    if (parts[0] === 'declare') parts.shift(), declare = 1

    // table?
    if (parts[0][0] === 'table') {
      [, tabidx] = parts.shift()
      tabidx = id(tabidx, ctx.table)
    }

    // (offset expr)|expr
    if (parts[0]?.[0] === 'offset' || (Array.isArray(parts[0]) && parts[0][0] !== 'item' && !parts[0][0].startsWith('ref'))) {
      offset = parts.shift()
      if (offset[0] === 'offset') [, offset] = offset
      offset = expr(offset, ctx)
    }
    // no offset = passive
    else if (!declare) passive = 1

    // funcref|externref|(ref ...)
    if (REFTYPE[parts[0]] || parts[0]?.[0] === 'ref') rt = reftype(parts.shift(), ctx)
    // func ... abbr https://webassembly.github.io/function-references/core/text/modules.html#id7
    else if (parts[0] === 'func') rt = [HEAPTYPE[parts.shift()]]
    // or anything else
    else rt = [HEAPTYPE.func]

    // deabbr els sequence, detect expr usage
    parts = parts.map(el => {
      if (el[0] === 'item') [, ...el] = el
      if (el[0] === 'ref.func') [, el] = el
      // (ref.null func) and other expressions turn expr els mode
      if (typeof el !== 'string') elexpr = 1
      return el
    })

    // reftype other than (ref null? func) forces table index via nofunc flag
    // also it forces elexpr
    if (rt[0] !== REFTYPE.funcref) nofunc = 1, elexpr = 1

    // mode:
    // bit 0 indicates a passive or declarative segment
    // bit 1 indicates the presence of an explicit table index for an active segment
    // and otherwise distinguishes passive from declarative segments
    // bit 2 indicates the use of element type and element expressions instead of elemkind=0x00 and element indices.
    let mode = (elexpr << 2) | ((passive || declare ? declare : (!!tabidx || nofunc)) << 1) | (passive || declare);

    return ([
      mode,
      ...(
        // 0b000 e:expr y*:vec(funcidx)                     | type=(ref func), init ((ref.func y)end)*, active (table=0,offset=e)
        mode === 0b000 ? offset :
          // 0b001 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive
          mode === 0b001 ? [0x00] :
            // 0b010 x:tabidx e:expr et:elkind y*:vec(funcidx)  | type=0x00, init ((ref.func y)end)*, active (table=x,offset=e)
            mode === 0b010 ? [...uleb(tabidx || 0), ...offset, 0x00] :
              // 0b011 et:elkind y*:vec(funcidx)                  | type=0x00, init ((ref.func y)end)*, passive declare
              mode === 0b011 ? [0x00] :
                // 0b100 e:expr el*:vec(expr)                       | type=(ref null func), init el*, active (table=0, offset=e)
                mode === 0b100 ? offset :
                  // 0b101 et:reftype el*:vec(expr)                   | type=et, init el*, passive
                  mode === 0b101 ? rt :
                    // 0b110 x:tabidx e:expr et:reftype el*:vec(expr)   | type=et, init el*, active (table=x, offset=e)
                    mode === 0b110 ? [...uleb(tabidx || 0), ...offset, ...rt] :
                      // 0b111 et:reftype el*:vec(expr)                   | type=et, init el*, passive declare
                      rt
      ),
      ...vec(
        parts.map(elexpr ?
          // ((ref.func y)end)*
          el => expr(typeof el === 'string' ? ['ref.func', el] : el, ctx) :
          // el*
          el => uleb(id(el, ctx.func))
        )
      )
    ])
  },

  // (code)
  (body, ctx) => {
    let [typeidx, param] = body.shift()
    if (!param) [, [param]] = ctx.type[id(typeidx, ctx.type)]

    // provide param/local in ctx
    ctx.local = Object.create(param) // list of local variables - some of them are params
    ctx.block = [] // control instructions / blocks stack

    // display names for error messages
    ctx.local.name = 'local'
    ctx.block.name = 'block'

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [, ...types] = body.shift()
      if (types[0]?.[0] === '$') {
        let nm = types.shift()
        if (nm in ctx.local) err(`Duplicate local ${nm}`)
        else ctx.local[nm] = ctx.local.length
      }
      ctx.local.push(...types)
    }

    const bytes = []
    while (body.length) bytes.push(...instr(body, ctx))
    bytes.push(0x0b)

    // squash locals into (n:u32 t:valtype)*, n is number and t is type
    // we skip locals provided by params
    let loctypes = ctx.local.slice(param.length).reduce((a, type) => (type == a[a.length - 1]?.[1] ? a[a.length - 1][0]++ : a.push([1, type]), a), [])

    // cleanup tmp state
    ctx.local = ctx.block = null

    // https://webassembly.github.io/spec/core/binary/modules.html#code-section
    return vec([...vec(loctypes.map(([n, t]) => [...uleb(n), ...reftype(t, ctx)])), ...bytes])
  },

  // (data (i32.const 0) "\aa" "\bb"?)
  // (data (memory ref) (offset (i32.const 0)) "\aa" "\bb"?)
  // (data (global.get $x) "\aa" "\bb"?)
  (inits, ctx) => {
    let offset, memidx = 0

    // (memory ref)?
    if (inits[0]?.[0] === 'memory') {
      [, memidx] = inits.shift()
      memidx = id(memidx, ctx.memory)
    }

    // (offset (i32.const 0)) or (i32.const 0)
    if (typeof inits[0]?.[0] === 'string') {
      offset = inits.shift()
      if (offset[0] === 'offset') [, offset] = offset
      offset ?? err('Bad offset', offset)
    }

    return ([
      ...(
        // active: 2, x=memidx, e=expr
        memidx ? [2, ...uleb(memidx), ...expr(offset, ctx)] :
          // active: 0, e=expr
          offset ? [0, ...expr(offset, ctx)] :
            // passive: 1
            [1]
      ),
      ...vec(inits.flat())
    ])
  },

  // datacount
  (nodes, ctx) => uleb(ctx.data.length),

  // tag - placeholder (actual tag data built via import or handled separately)
  (nodes, ctx) => []
]

// (tag $id? (param i32)*) - tags for exception handling
build[SECTION.tag] = ([[, typeidx]], ctx) => [0x00, ...uleb(id(typeidx, ctx.type))]

// build reftype, either direct absheaptype or wrapped heaptype https://webassembly.github.io/gc/core/binary/types.html#reference-types
const reftype = (t, ctx) => (
  t[0] === 'ref' ?
    t[1] == 'null' ?
      HEAPTYPE[t[2]] ? [HEAPTYPE[t[2]]] : [REFTYPE.refnull, ...uleb(id(t[t.length - 1], ctx.type))] :
      [TYPE.ref, ...uleb(HEAPTYPE[t[t.length - 1]] || id(t[t.length - 1], ctx.type))] :
    // abbrs
    [TYPE[t] ?? err(`Unknown type ${t}`)]
);

// build type with mutable flag (mut t) or t
const fieldtype = (t, ctx, mut = t[0] === 'mut' ? 1 : 0) => [...reftype(mut ? t[1] : t, ctx), mut];



// Compact handler registry
const H = {
  block: (n, c, i) => (c.block.push(i[0]), n[0]?.[0] === '$' && (c.block[n.shift()] = c.block.length), (t => !t ? i.push(TYPE.void) : t[0] === 'result' ? i.push(...reftype(t[1], c)) : i.push(...uleb(id(t[1], c.type))))(n.shift())),
  end: (n, c) => c.block.pop(),
  call_indirect: (n, c, i) => ((t, [, idx]) => i.push(...uleb(id(idx, c.type)), ...uleb(id(t, c.table))))(n.shift(), n.shift()),
  br_table: (n, c, i) => (a => (i.push(...uleb(a.length - 1), ...a)))((() => { let a = []; while (n[0] && (!isNaN(n[0]) || n[0][0] === '$')) a.push(...uleb(blockid(n.shift(), c.block))); return a })()),
  select: (n, c, i) => (r => r.length && i.push(i.pop() + 1, ...vec(r.map(t => reftype(t, c)))))(n.shift() || []),
  ref_null: (n, c, i) => (t => i.push(...(HEAPTYPE[t] ? [HEAPTYPE[t]] : uleb(id(t, c.type)))))(n.shift()),
  memarg: (n, c, i, op) => i.push(...memargEnc(n, op)),
  opt_memory: (n, c, i) => i.push(...takeOptIdx(n, c, 'memory')),
  reftype: (n, c, i) => (ht => (ht[0] !== REFTYPE.ref && (i[i.length - 1] += 1), ht.length > 1 && ht.shift(), i.push(...ht)))(reftype(n.shift(), c)),
  reftype2: (n, c, i) => (([b, h1, h2]) => i.push(((h2[0] !== REFTYPE.ref) << 1) | (h1[0] !== REFTYPE.ref), ...uleb(b), h1.pop(), h2.pop()))([blockid(n.shift(), c.block), reftype(n.shift(), c), reftype(n.shift(), c)]),
  // SIMD special handlers
  v128const: (n, _c, i) => {
    let [t, num] = n.shift().split('x'), bits = +t.slice(1), stride = bits >>> 3
    num = +num
    if (t[0] === 'i') {
      let arr = num === 16 ? new Uint8Array(16) : num === 8 ? new Uint16Array(8) : num === 4 ? new Uint32Array(4) : new BigUint64Array(2)
      for (let j = 0; j < num; j++) arr[j] = encode[t].parse(n.shift())
      i.push(...new Uint8Array(arr.buffer))
    } else {
      let arr = new Uint8Array(16)
      for (let j = 0; j < num; j++) arr.set(encode[t](n.shift()), j * stride)
      i.push(...arr)
    }
  },
  shuffle: (n, _c, i) => { for (let j = 0; j < 16; j++) i.push(parseUint(n.shift(), 32)) },
  memlane: (n, _c, i, op) => (i.push(...memargEnc(n, op)), i.push(...uleb(parseUint(n.shift()))))
}

// Unified instruction encoder - fully declarative using INSTR.spec and INSTR.imm
const instr = (nodes, ctx) => {
  if (!nodes?.length) return []
  let out = [], op = nodes.shift(), immed, spec

  // Nested group: recurse
  if (Array.isArray(op)) {
    immed = instr(op, ctx)
    while (op.length) out.push(...instr(op, ctx))
    out.push(...immed)
    return out
  }

  ;[...immed] = isNaN(op[0]) && INSTR[op] || err(`Unknown instruction ${op}`)

  // Multi-byte opcodes: ULEB-encode the secondary opcode
  if (immed.length > 1) immed = [immed[0], ...uleb(immed[1])]

  // Unified metadata dispatch
  if (spec = INSTR_META[op]) {
    // Check if it's a handler (exists in H) or special string
    if (spec === 'null') {} // No-op (else, then)
    else if (spec === 'reversed') {
      // Special case: table.init has reversed argument order
      let t = nodes.shift(), e = nodes.shift()
      immed.push(...uleb(id(e, ctx.elem)), ...uleb(id(t, ctx.table)))
    }
    else if (H[spec]) {
      // Custom handler
      H[spec](nodes, ctx, immed, op)
    }
    // Multi-field spec: parse space-separated fields
    else if (spec.includes(' ')) {
      spec.split(' ').forEach(f => {
        if (f === '*') immed.push(...uleb(nodes.shift()))
        else if (f === 'field') immed.push(...uleb(id(nodes.shift(), ctx.type[immed[immed.length - 1]][1])))
        else {
          const opt = f[0] === '?', field = opt ? f.slice(1) : f
          const immSpec = FIELD_TYPE[field]
          if (!immSpec) err(`Unknown field ${field}`)
          const val = opt && !isIdx(nodes[0]) ? 0 : nodes.shift()
          typeof immSpec === 'string' ? immed.push(...encode[immSpec](val)) : immed.push(...uleb((immSpec[1] === 'blockid' ? blockid : id)(val, ctx[immSpec[0]])))
        }
      })
    }
    // Simple field spec: lookup in FIELD_TYPE
    else {
      const opt = spec[0] === '?', field = opt ? spec.slice(1) : spec
      const immSpec = FIELD_TYPE[field]
      if (!immSpec) err(`Unknown immediate type ${field}`)
      const val = opt && !isIdx(nodes[0]) ? 0 : nodes.shift()
      typeof immSpec === 'string' ?
        immSpec === 'parseUint' ? immed.push(parseUint(val, 0xff)) : immed.push(...encode[immSpec](val)) :
        immed.push(...uleb((immSpec[1] === 'blockid' ? blockid : id)(val, ctx[immSpec[0]])))
    }
  }

  return out.push(...immed), out
}

// instantiation time value initializer (consuming) - we redirect to instr
const expr = (node, ctx) => [...instr([node], ctx), 0x0b]

// deref id node to numeric idx
const id = (nm, list, n) => (n = nm[0] === '$' ? list[nm] : +nm, n in list ? n : err(`Unknown ${list.name} ${nm}`))

// block id - same as id but for block
// index indicates how many block items to pop
const blockid = (nm, block, i) => (
  i = nm?.[0] === '$' ? block.length - block[nm] : +nm,
  isNaN(i) || i > block.length ? err(`Bad label ${nm}`) : i
)

// consume align/offset params
const memarg = (args) => {
  let align, offset, k, v
  while (args[0]?.includes('=')) [k, v] = args.shift().split('='), k === 'offset' ? offset = +v : k === 'align' ? align = +v : err(`Unknown param ${k}=${v}`)

  if (offset < 0 || offset > 0xffffffff) err(`Bad offset ${offset}`)
  if (align <= 0 || align > 0xffffffff) err(`Bad align ${align}`)
  if (align) ((align = Math.log2(align)) % 1) && err(`Bad align ${align}`)
  return [align, offset]
}

// Encode memarg (align + offset) with default values based on instruction
const memargEnc = (nodes, op) => {
  const [a, o] = memarg(nodes)
  return [...uleb((a ?? align(op))), ...uleb(o ?? 0)]
}

// const ALIGN = {
//   'i32.load': 4, 'i64.load': 8, 'f32.load': 4, 'f64.load': 8,
//   'i32.load8_s': 1, 'i32.load8_u': 1, 'i32.load16_s': 2, 'i32.load16_u': 2,
//   'i64.load8_s': 1, 'i64.load8_u': 1, 'i64.load16_s': 2, 'i64.load16_u': 2, 'i64.load32_s': 4, 'i64.load32_u': 4, 'i32.store': 4,
//   'i64.store': 8, 'f32.store': 4, 'f64.store': 8, 'i32.store8': 1, 'i32.store16': 2, 'i64.store8': 1, 'i64.store16': 2, 'i64.store32': 4,
//   'v128.load': 16, 'v128.load8x8_s': 8, 'v128.load8x8_u': 8, 'v128.load16x4_s': 8, 'v128.load16x4_u': 8, 'v128.load32x2_s': 8, 'v128.load32x2_u': 8, 'v128.load8_splat': 1, 'v128.load16_splat': 2, 'v128.load32_splat': 4, 'v128.load64_splat': 8, 'v128.store': 16,
//   'v128.load': 16, 'v128.load8_lane': 1, 'v128.load16_lane': 2, 'v128.load32_lane': 4, 'v128.load64_lane': 8, 'v128.store8_lane': 1, 'v128.store16_lane': 2, 'v128.store32_lane': 4, 'v128.store64_lane': 8, 'v128.load32_zero': 4, 'v128.load64_zero': 8
// }
const align = (op) => {
  let [group, opname] = op.split('.'); // v128.load8x8_u -> group = v128, opname = load8x8_u
  let [lsize] = (opname[0] === 'l' ? opname.slice(4) : opname.slice(5)).split('_') // load8x8_u -> lsize = 8x8
  let [size, x] = lsize ? lsize.split('x') : [group.slice(1)] // 8x8 -> size = 8
  return Math.log2(x ? 8 : +size / 8)
}

// build limits sequence (consuming)
// Memory64: i64 index type uses flags 0x04-0x07 (bit 2 = is_64)
const limits = (node) => {
  const is64 = node[0] === 'i64' && node.shift()
  const shared = node[node.length - 1] === 'shared' && node.pop()
  const hasMax = !isNaN(parseInt(node[1]))
  const flag = (is64 ? 4 : 0) | (shared ? 2 : 0) | (hasMax ? 1 : 0)
  const parse = is64 ? v => typeof v === 'string' ? i64.parse(v) : v : parseUint

  return hasMax
    ? [flag, ...uleb(parse(node.shift())), ...uleb(parse(node.shift()))]
    : [flag, ...uleb(parse(node.shift()))]
}

// check if node is valid int in a range
const parseUint = (v, max = 0xFFFFFFFF) => {
  const n = typeof v === 'string' && v[0] !== '+' ? i32.parse(v) : typeof v === 'number' ? v : err(`Bad int ${v}`)
  return n > max ? err(`Value out of range ${v}`) : n
}


// serialize binary array
const vec = a => [...uleb(a.length), ...a.flat()]
