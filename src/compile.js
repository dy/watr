import * as encode from './encode.js'
import { uleb, i32, i64 } from './encode.js'
import { SECTION, TYPE, KIND, INSTR, DEFTYPE } from './const.js'
import parse from './parse.js'
import { err, tdec, tenc } from './util.js'


// recursively strip all annotation nodes from AST, except @custom and @metadata.code.*
// clones nodes by the way
const unannot = (node) => Array.isArray(node) ? (node[0]?.[0] === '@' && node[0] !== '@custom' && !node[0]?.startsWith?.('@meta') ? null : node.map(unannot).filter(n => n != null)) : node

// iterating context
let cur, idx

/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (WASM).
 *
 * @param {string|Array} nodes - The WAT tree or string to be compiled to WASM binary.
 * @returns {Uint8Array} The compiled WASM binary data.
 */
export default function compile(nodes) {
  // normalize to (module ...) form
  if (typeof nodes === 'string') nodes = parse(nodes) || []

  // strip annotations (text-format only), except @custom and @metadata.code.* which become binary sections
  nodes = unannot(nodes) || []

  cur = nodes, idx = 0

  // module abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') idx++, isId(cur[idx]) && idx++
  // single node, not module
  else if (typeof nodes[0] === 'string') cur = [nodes]

  // binary abbr "\00" "\0x61" ...
  if (cur[idx] === 'binary') return Uint8Array.from(cur.slice(++idx).flat())

  // quote "a" "b"
  if (cur[idx] === 'quote') return compile(cur.slice(++idx).map(v => v.valueOf().slice(1, -1)).flat().join(''))

  // scopes are aliased by key as well, eg. section.func.$name = section[SECTION.func] = idx
  const ctx = []
  for (let kind in SECTION) (ctx[SECTION[kind]] = ctx[kind] = []).name = kind
  ctx.metadata = {} // code metadata storage: { type: [[funcIdx, [[pos, data]...]]] }

  // initialize types
  cur.slice(idx).filter(([kind, ...node]) => {
    // (@custom "name" placement? data) - custom section support
    if (kind === '@custom') {
      ctx.custom.push(node)
    }
    // (rec (type $a (sub final? $sup* (func ...))...) (type $b ...)) -> save subtypes
    else if (kind === 'rec') {
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
          ctx.elem.push([['table', items.length], ['offset', [is64 ? 'i64.const' : 'i32.const', is64 ? 0n : 0]], reftype, ...els])
        }
      }

      // data abbr: (memory id? i64? (data str)) -> (memory id? i64? n n) + (data ...)
      else if (kind === 'memory') {
        const is64 = node[0] === 'i64', idx = is64 ? 1 : 0
        if (node[idx]?.[0] === 'data') {
          let [, ...data] = node.splice(idx, 1)[0], m = '' + Math.ceil(data.flat().length / 65536) // FIXME: figure out actual data size
          ctx.data.push([['memory', items.length], [is64 ? 'i64.const' : 'i32.const', is64 ? 0n : 0], ...data])
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

  // Generate metadata custom sections
  const binMeta = () => {
    const sections = []
    for (const type in ctx.metadata) {
      const name = vec([...tenc.encode(`metadata.code.${type}`)])
      const content = vec(ctx.metadata[type].map(([funcIdx, instances]) =>
        [...uleb(funcIdx), ...vec(instances.map(([pos, data]) => [...uleb(pos), ...vec(data)]))]
      ))
      sections.push(0, ...vec([...name, ...content]))
    }
    return sections
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
    ...binMeta(),
    ...bin(SECTION.data)
  ])
}


// if node is a valid index reference
const isIdx = n => n?.[0] === '$' || !isNaN(n)
// if node is an identifier (starts with $)
const isId = n => n?.[0] === '$'
// if node is align/offset parameter (starts with 'a' or 'o')
const isMemParam = n => n?.[0] === 'a' || n?.[0] === 'o'

// normalize & flatten function body, collect types info, rectify structure
function normalize(nodes, ctx) {
  const out = []
  nodes = [...nodes]
  while (nodes.length) {
    let node = nodes.shift()
    if (typeof node === 'string') {
      out.push(node)
      if (node === 'block' || node === 'if' || node === 'loop') {
        if (isId(nodes[0])) out.push(nodes.shift())
        out.push(blocktype(nodes, ctx))
      }
      else if (node === 'else' || node === 'end') {
        if (isId(nodes[0])) nodes.shift()
      }
      else if (node === 'select') out.push(paramres(nodes)[1])
      else if (node.endsWith('call_indirect')) {
        let tableidx = isIdx(nodes[0]) ? nodes.shift() : 0, [idx, param, result] = typeuse(nodes, ctx)
        out.push(tableidx, ['type', idx ?? regtype(param, result, ctx)])
      }
      else if (node === 'table.init') out.push(isIdx(nodes[1]) ? nodes.shift() : 0, nodes.shift())
      else if (node === 'table.copy' || node === 'memory.copy') out.push(isIdx(nodes[0]) ? nodes.shift() : 0, isIdx(nodes[0]) ? nodes.shift() : 0)
      else if (node.startsWith('table.')) out.push(isIdx(nodes[0]) ? nodes.shift() : 0)
      else if (node === 'memory.init') {
        out.push(...(isIdx(nodes[1]) ? [nodes.shift(), nodes.shift()].reverse() : [nodes.shift(), 0]))
        ctx.datacount && (ctx.datacount[0] = true)
      }
      else if (node === 'data.drop' || node === 'array.new_data' || node === 'array.init_data') {
        node === 'data.drop' && out.push(nodes.shift())
        ctx.datacount && (ctx.datacount[0] = true)
      }
      // memory.* instructions and load/store with optional memory index
      else if ((node.startsWith('memory.') || node.endsWith('load') || node.endsWith('store')) && isIdx(nodes[0])) out.push(nodes.shift())
    }
    else if (Array.isArray(node)) {
      const op = node[0]

      // code metadata annotations - pass through as marker with metadata type and data
      // (@metadata.code.<type> data:str)
      if (op?.startsWith?.('@metadata.code.')) {
        let type = op.slice(15) // remove '@metadata.code.' prefix
        out.push(['@metadata', type, node[1]])
        continue
      }

      // Check if node is a valid instruction (string with opcode in INSTR)
      if (typeof op !== 'string' || !Array.isArray(INSTR[op])) { out.push(node); continue }
      const parts = node.slice(1)
      if (op === 'block' || op === 'loop') {
        out.push(op)
        if (isId(parts[0])) out.push(parts.shift())
        out.push(blocktype(parts, ctx), ...normalize(parts, ctx), 'end')
      }
      else if (op === 'if') {
        let then = [], els = []
        if (parts.at(-1)?.[0] === 'else') els = normalize(parts.pop().slice(1), ctx)
        if (parts.at(-1)?.[0] === 'then') then = normalize(parts.pop().slice(1), ctx)
        let immed = [op]
        if (isId(parts[0])) immed.push(parts.shift())
        immed.push(blocktype(parts, ctx))
        out.push(...normalize(parts, ctx), ...immed, ...then)
        els.length && out.push('else', ...els)
        out.push('end')
      }
      else if (op === 'try_table') {
        out.push(op)
        if (parts[0]?.[0] === '$') out.push(parts.shift())
        out.push(blocktype(parts, ctx))
        // Collect catch clauses
        while (parts[0]?.[0] === 'catch' || parts[0]?.[0] === 'catch_ref' || parts[0]?.[0] === 'catch_all' || parts[0]?.[0] === 'catch_all_ref') {
          out.push(parts.shift())
        }
        out.push(...normalize(parts, ctx), 'end')
      }
      else {
        const imm = []
        // Collect immediate operands (non-arrays or special forms like type/param/result/ref)
        while (parts.length && (!Array.isArray(parts[0]) || 'type,param,result,ref'.includes(parts[0][0]))) imm.push(parts.shift())
        out.push(...normalize(parts, ctx), op, ...imm)
        nodes.unshift(...out.splice(out.length - 1 - imm.length))
      }
    } else out.push(node)
  }
  return out
}

// Register implicit function type definition, return type index (not related to reftype)
const regtype = (param, result, ctx, idx = '$' + param + '>' + result) => (ctx.type[idx] ??= ctx.type.push(['func', [param, result]]) - 1, idx)

// Collect field sequence: (field a) (field b c) -> [a, b, c]
const fieldseq = (nodes, field) => {
  let seq = []
  while (nodes[0]?.[0] === field) {
    let [, ...args] = nodes.shift(), nm = isId(args[0]) && args.shift()
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



// consume section name eg. $t ...
const name = (node, list) => {
  let nm = isId(node[0]) && node.shift();
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
    // parse already returns strings as byte arrays, so just vec them
    return [...vec(name), ...data.flat()]
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
    if (parts[0]?.[0] === 'table') {
      [, tabidx] = parts.shift()
      tabidx = id(tabidx, ctx.table)
    }
    // Handle abbreviated form: (elem tableidx (offset ...) ...) where tableidx is directly a number/identifier
    else if ((typeof parts[0] === 'string' || typeof parts[0] === 'number') &&
             (parts[1]?.[0] === 'offset' || (Array.isArray(parts[1]) && parts[1][0] !== 'item' && !parts[1][0]?.startsWith('ref')))) {
      tabidx = id(parts.shift(), ctx.table)
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
    if (TYPE[parts[0]] || parts[0]?.[0] === 'ref') rt = reftype(parts.shift(), ctx)
    // func ... abbr https://webassembly.github.io/function-references/core/text/modules.html#id7
    else if (parts[0] === 'func') rt = [TYPE[parts.shift()]]
    // or anything else
    else rt = [TYPE.func]

    // deabbr els sequence, detect expr usage
    parts = parts.map(el => {
      // (item ref.func $f) or (item (ref.func $f)) → $f
      if (el[0] === 'item') el = el.length === 3 && el[1] === 'ref.func' ? el[2] : el[1]
      // (ref.func $f) → $f
      if (el[0] === 'ref.func') [, el] = el
      // (ref.null func) and other expressions turn expr els mode
      if (typeof el !== 'string') elexpr = 1
      return el
    })

    // reftype other than (ref null? func) forces table index via nofunc flag
    // also it forces elexpr
    if (rt[0] !== TYPE.funcref) nofunc = 1, elexpr = 1

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

    // Track current code index for code metadata
    if (ctx._codeIdx === undefined) ctx._codeIdx = 0
    let codeIdx = ctx._codeIdx++

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [, ...types] = body.shift()
      if (isId(types[0])) {
        let nm = types.shift()
        if (nm in ctx.local) err(`Duplicate local ${nm}`)
        else ctx.local[nm] = ctx.local.length
      }
      ctx.local.push(...types)
    }

    // Setup metadata tracking for this function
    ctx.meta = {}
    const bytes = instr(body, ctx)

    // Store collected metadata for this function
    const funcIdx = ctx.import.filter(imp => imp[2][0] === 'func').length + codeIdx
    for (const type in ctx.meta) ((ctx.metadata ??= {})[type] ??= []).push([funcIdx, ctx.meta[type]])

    // squash locals into (n:u32 t:valtype)*, n is number and t is type
    // we skip locals provided by params
    let loctypes = ctx.local.slice(param.length).reduce((a, type) => (type == a[a.length - 1]?.[1] ? a[a.length - 1][0]++ : a.push([1, type]), a), [])

    // cleanup tmp state
    ctx.local = ctx.block = ctx.meta = null

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
    // Handle abbreviated form: (data memidx (offset ...) ...) where memidx is directly a number/identifier
    else if ((typeof inits[0] === 'string' || typeof inits[0] === 'number') &&
             (inits[1]?.[0] === 'offset' || (Array.isArray(inits[1]) && typeof inits[1][0] === 'string'))) {
      memidx = id(inits.shift(), ctx.memory)
    }

    // (offset (i32.const 0)) or (i32.const 0)
    if (Array.isArray(inits[0]) && typeof inits[0]?.[0] === 'string') {
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

  // (tag $name? (type idx))
  ([[, typeidx]], ctx) => [0x00, ...uleb(id(typeidx, ctx.type))]
]

// Build reference type encoding (ref/refnull forms, not related to regtype which handles func types)
// https://webassembly.github.io/gc/core/binary/types.html#reference-types
const reftype = (t, ctx) => (
  t[0] === 'ref' ?
    t[1] == 'null' ?
      TYPE[t[2]] ? [TYPE[t[2]]] : [TYPE.refnull, ...uleb(id(t[t.length - 1], ctx.type))] :
      [TYPE.ref, ...uleb(TYPE[t[t.length - 1]] || id(t[t.length - 1], ctx.type))] :
    // abbrs
    [TYPE[t] ?? err(`Unknown type ${t}`)]
);

// build type with mutable flag (mut t) or t
const fieldtype = (t, ctx, mut = t[0] === 'mut' ? 1 : 0) => [...reftype(mut ? t[1] : t, ctx), mut];





// Pre-defined instruction handlers
const IMM = {
  null: () => [],
  reversed: (n, c) => { let t = n.shift(), e = n.shift(); return [...uleb(id(e, c.elem)), ...uleb(id(t, c.table))] },
  block: (n, c) => {
    c.block.push(1)
    isId(n[0]) && (c.block[n.shift()] = c.block.length)
    let t = n.shift()
    return !t ? [TYPE.void] : t[0] === 'result' ? reftype(t[1], c) : uleb(id(t[1], c.type))
  },
  try_table: (n, c) => {
    n[0]?.[0] === '$' && (c.block[n.shift()] = c.block.length + 1)
    let blocktype = n.shift()
    let result = !blocktype ? [TYPE.void] : blocktype[0] === 'result' ? reftype(blocktype[1], c) : uleb(id(blocktype[1], c.type))
    // Collect catch clauses BEFORE pushing try_table to block stack (catch labels are relative to outer blocks)
    let catches = [], count = 0
    while (n[0]?.[0] === 'catch' || n[0]?.[0] === 'catch_ref' || n[0]?.[0] === 'catch_all' || n[0]?.[0] === 'catch_all_ref') {
      let clause = n.shift()
      let kind = clause[0] === 'catch' ? 0x00 : clause[0] === 'catch_ref' ? 0x01 : clause[0] === 'catch_all' ? 0x02 : 0x03
      if (kind <= 0x01) catches.push(kind, ...uleb(id(clause[1], c.tag)), ...uleb(blockid(clause[2], c.block)))
      else catches.push(kind, ...uleb(blockid(clause[1], c.block)))
      count++
    }
    c.block.push(1)  // NOW push try_table to block stack after processing catches
    return [...result, ...uleb(count), ...catches]
  },
  end: (_n, c) => (c.block.pop(), []),
  call_indirect: (n, c) => { let t = n.shift(), [, idx] = n.shift(); return [...uleb(id(idx, c.type)), ...uleb(id(t, c.table))] },
  br_table: (n, c) => {
    let labels = [], count = 0
    while (n[0] && (!isNaN(n[0]) || isId(n[0]))) (labels.push(...uleb(blockid(n.shift(), c.block))), count++)
    return [...uleb(count - 1), ...labels]
  },
  select: (n, c) => { let r = n.shift() || []; return r.length ? vec(r.map(t => reftype(t, c))) : [] },
  ref_null: (n, c) => { let t = n.shift(); return TYPE[t] ? [TYPE[t]] : uleb(id(t, c.type)) },
  memarg: (n, c, op) => memargEnc(n, op, isIdx(n[0]) && !isMemParam(n[0]) ? id(n.shift(), c.memory) : 0),
  opt_memory: (n, c) => uleb(id(isIdx(n[0]) ? n.shift() : 0, c.memory)),
  reftype: (n, c) => { let ht = reftype(n.shift(), c); return ht.length > 1 ? ht.slice(1) : ht },
  reftype2: (n, c) => { let b = blockid(n.shift(), c.block), h1 = reftype(n.shift(), c), h2 = reftype(n.shift(), c); return [((h2[0] !== TYPE.ref) << 1) | (h1[0] !== TYPE.ref), ...uleb(b), h1.pop(), h2.pop()] },
  v128const: (n) => {
    let [t, num] = n.shift().split('x'), bits = +t.slice(1), stride = bits >>> 3; num = +num
    if (t[0] === 'i') {
      let arr = num === 16 ? new Uint8Array(16) : num === 8 ? new Uint16Array(8) : num === 4 ? new Uint32Array(4) : new BigUint64Array(2)
      for (let j = 0; j < num; j++) arr[j] = encode[t].parse(n.shift())
      return [...new Uint8Array(arr.buffer)]
    }
    let arr = new Uint8Array(16)
    for (let j = 0; j < num; j++) arr.set(encode[t](n.shift()), j * stride)
    return [...arr]
  },
  shuffle: (n) => { let result = []; for (let j = 0; j < 16; j++) result.push(parseUint(n.shift(), 32)); return result },
  memlane: (n, c, op) => {
    // SIMD lane: [memidx?] [offset/align]* laneidx - memidx present if isId OR (isIdx AND (next is memParam OR isIdx))
    const memIdx = isId(n[0]) || (isIdx(n[0]) && (isMemParam(n[1]) || isIdx(n[1]))) ? id(n.shift(), c.memory) : 0
    return [...memargEnc(n, op, memIdx), ...uleb(parseUint(n.shift()))]
  },
  '*': (n) => uleb(n.shift()),

  // *idx types
  labelidx: (n, c) => uleb(blockid(n.shift(), c.block)),
  laneidx: (n) => [parseUint(n.shift(), 0xff)],
  funcidx: (n, c) => uleb(id(n.shift(), c.func)),
  typeidx: (n, c) => uleb(id(n.shift(), c.type)),
  tableidx: (n, c) => uleb(id(n.shift(), c.table)),
  memoryidx: (n, c) => uleb(id(n.shift(), c.memory)),
  globalidx: (n, c) => uleb(id(n.shift(), c.global)),
  localidx: (n, c) => uleb(id(n.shift(), c.local)),
  dataidx: (n, c) => uleb(id(n.shift(), c.data)),
  elemidx: (n, c) => uleb(id(n.shift(), c.elem)),
  tagidx: (n, c) => uleb(id(n.shift(), c.tag)),
  'memoryidx?': (n, c) => uleb(id(isIdx(n[0]) ? n.shift() : 0, c.memory)),

  // Value type
  i32: (n) => encode.i32(n.shift()),
  i64: (n) => encode.i64(n.shift()),
  f32: (n) => encode.f32(n.shift()),
  f64: (n) => encode.f64(n.shift()),
  v128: (n) => encode.v128(n.shift()),

  // Combinations
  typeidx_field: (n, c) => { let typeId = id(n.shift(), c.type); return [...uleb(typeId), ...uleb(id(n.shift(), c.type[typeId][1]))] },
  typeidx_multi: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(n.shift())],
  typeidx_dataidx: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(id(n.shift(), c.data))],
  typeidx_elemidx: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(id(n.shift(), c.elem))],
  typeidx_typeidx: (n, c) => [...uleb(id(n.shift(), c.type)), ...uleb(id(n.shift(), c.type))],
  dataidx_memoryidx: (n, c) => [...uleb(id(n.shift(), c.data)), ...uleb(id(n.shift(), c.memory))],
  memoryidx_memoryidx: (n, c) => [...uleb(id(n.shift(), c.memory)), ...uleb(id(n.shift(), c.memory))],
  tableidx_tableidx: (n, c) => [...uleb(id(n.shift(), c.table)), ...uleb(id(n.shift(), c.table))]
};

// per-op imm handlers
const HANDLER = {};


// Populate INSTR and IMM
(function populate(items, pre) {
  for (let op = 0, item, nm, imm; op < items.length; op++) if (item = items[op]) {
    // Nested array (0xfb, 0xfc, 0xfd opcodes)
    if (Array.isArray(item)) populate(item, op)
    else [nm, imm] = item.split(' '), INSTR[nm] = pre ? [pre, ...uleb(op)] : [op], imm && (HANDLER[nm] = IMM[imm])
  }
})(INSTR);


// instruction encoder
const instr = (nodes, ctx) => {
  let out = [], meta = []

  while (nodes?.length) {
    let op = nodes.shift()

    // Handle code metadata marker - store for next instruction
    // ['@metadata', type, data]
    if (op?.[0] === '@metadata') {
      meta.push(op.slice(1))
      continue
    }

    let [...bytes] = INSTR[op] || err(`Unknown instruction ${op}`)

    // special op handlers
    if (HANDLER[op]) {
      // select: becomes typed select (opcode+1) if next node is an array with result types
      if (op === 'select' && nodes[0]?.length) bytes[0]++
      // ref.type|cast: opcode+1 if type is nullable: (ref null $t) or (funcref, anyref, etc.)
      else if (HANDLER[op] === IMM.reftype && (nodes[0][1] === 'null' || nodes[0][0] !== 'ref')) {
        bytes[bytes.length - 1]++
      }
      bytes.push(...HANDLER[op](nodes, ctx, op))
    }

    // Record metadata at current byte position
    for (const [type, data] of meta) ((ctx.meta[type] ??= []).push([out.length, data]))

    out.push(...bytes)
  }

  return out.push(0x0b), out
}

// instantiation time value initializer (consuming) - normalize then encode + add end byte
const expr = (node, ctx) => instr(normalize([node], ctx), ctx)

// deref id node to numeric idx
const id = (nm, list, n) => (n = isId(nm) ? list[nm] : +nm, n in list ? n : err(`Unknown ${list.name} ${nm}`))

// block id - same as id but for block
// index indicates how many block items to pop
const blockid = (nm, block, i) => (
  i = isId(nm) ? block.length - block[nm] : +nm,
  isNaN(i) || i > block.length ? err(`Bad label ${nm}`) : i
)

// consume align/offset params
const memarg = (args) => {
  let align, offset, k, v
  while (isMemParam(args[0])) [k, v] = args.shift().split('='), k === 'offset' ? offset = +v : k === 'align' ? align = +v : err(`Unknown param ${k}=${v}`)

  if (offset < 0 || offset > 0xffffffff) err(`Bad offset ${offset}`)
  if (align <= 0 || align > 0xffffffff) err(`Bad align ${align}`)
  if (align) ((align = Math.log2(align)) % 1) && err(`Bad align ${align}`)
  return [align, offset]
}

// Encode memarg (align + offset) with default values based on instruction
// If memIdx is non-zero, set bit 6 in alignment flags and insert memIdx after align
const memargEnc = (nodes, op, memIdx = 0) => {
  const [a, o] = memarg(nodes), alignVal = (a ?? align(op)) | (memIdx && 0x40)
  return memIdx ? [...uleb(alignVal), ...uleb(memIdx), ...uleb(o ?? 0)] : [...uleb(alignVal), ...uleb(o ?? 0)]
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
  let i = op.indexOf('.', 3) + 1, group = op.slice(1, op[0] === 'v' ? 4 : 3) // type: i32->32, v128->128
  if (op[i] === 'a') i = op.indexOf('.', i) + 1 // skip 'atomic.'
  if (op[0] === 'm') return op.includes('64') ? 3 : 2 // memory.*.wait64 vs wait32/notify
  if (op[i] === 'r') { // rmw: extract size from rmw##
    let m = op.slice(i, i + 6).match(/\d+/)
    return m ? Math.log2(m[0] / 8) : Math.log2(+group / 8)
  }
  // load/store: extract size after operation name
  let k = op[i] === 'l' ? i + 4 : i + 5, m = op.slice(k).match(/(\d+)(x|_|$)/)
  return Math.log2(m ? (m[2] === 'x' ? 8 : m[1] / 8) : +group / 8)
}

// build limits sequence (consuming)
// Memory64: i64 index type uses flags 0x04-0x07 (bit 2 = is_64)
const limits = (node) => {
  const is64 = node[0] === 'i64' && node.shift()
  const shared = node[node.length - 1] === 'shared' && node.pop()
  const hasMax = !isNaN(parseInt(node[1]))
  const flag = (is64 ? 4 : 0) | (shared ? 2 : 0) | (hasMax ? 1 : 0)
  // For i64, parse as unsigned BigInt (limits are always unsigned)
  const parse = is64 ? v => {
    if (typeof v === 'bigint') return v
    const str = typeof v === 'string' ? v.replaceAll('_', '') : String(v)
    return BigInt(str)
  } : parseUint

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
