import * as encode from './encode.js'
import { uleb, i32, i64 } from './encode.js'
import { SECTION, TYPE, KIND, INSTR, HEAPTYPE, DEFTYPE, RECTYPE, REFTYPE, ESCAPE } from './const.js'
import parse from './parse.js'
import { clone, err, str } from './util.js'

// build instructions index
INSTR.forEach((op, i) => INSTR[op] = i >= 0x133 ? [0xfd, i - 0x133] : i >= 0x11b ? [0xfc, i - 0x11b] : i >= 0xfb ? [0xfb, i - 0xfb] : [i]);

// recursively strip all annotation nodes from AST, except @custom and @metadata.code.branch_hint
const unannot = (node) => Array.isArray(node) ? (node[0]?.[0] === '@' && node[0] !== '@custom' && !node[0]?.startsWith?.('@metadata.code.branch_hint') ? null : node.map(unannot).filter(n => n != null)) : node

/**
 * Converts a WebAssembly Text Format (WAT) tree to a WebAssembly binary format (WASM).
 *
 * @param {string|Array} nodes - The WAT tree or string to be compiled to WASM binary.
 * @param {Object} opt - opt.fullSize for fixed-width uleb encoding
 * @returns {Uint8Array} The compiled WASM binary data.
 */
export default function watr(nodes) {
  // normalize to (module ...) form
  if (typeof nodes === 'string') nodes = parse(nodes);
  else nodes = clone(nodes)

  // strip annotations (text-format only), except @custom which becomes binary custom sections
  nodes = unannot(nodes) || []

  // module abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') nodes.shift(), nodes[0]?.[0] === '$' && nodes.shift()
  // single node, not module
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  // binary abbr "\00" "\0x61" ...
  if (nodes[0] === 'binary') {
    nodes.shift()
    return Uint8Array.from(str(...nodes))
  }
  // quote "a" "b"
  else if (nodes[0] === 'quote') {
    nodes.shift()
    return watr(nodes.map(s => s.slice(1, -1)).join(''))
  }

  // scopes are aliased by key as well, eg. section.func.$name = section[SECTION.func] = idx
  const ctx = []
  for (let kind in SECTION) (ctx[SECTION[kind]] = ctx[kind] = []).name = kind

  // initialize types
  nodes.filter(([kind, ...node]) => {
    // (rec (type $a (sub final? $sup* (func ...))...) (type $b ...)) -> save subtypes
    if (kind === 'rec') {
      // node contains a list of subtypes, (type ...) or (type (sub final? ...))
      // convert rec type into regular type (first subtype) with stashed subtypes length
      // add rest of subtypes as regular type nodes with subtype flag
      for (let i = 0; i < node.length; i++) {
        let [, ...subnode] = node[i]
        alias(subnode, ctx.type);
        (subnode = typedef(subnode, ctx)).push(i ? true : [ctx.type.length, node.length])
        ctx.type.push(subnode)
      }
    }
    // (type (func param* result*))
    // (type (array (mut i8)))
    // (type (struct (field a)*)
    // (type (sub final? $nm* (struct|array|func ...)))
    else if (kind === 'type') {
      alias(node, ctx.type);
      ctx.type.push(typedef(node, ctx));
    }
    // (@custom "name" placement? data)
    else if (kind === '@custom') {
      ctx.custom.push(node)  // node is just the arguments, not including @custom
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
      let name = alias(node, items);

      // export abbr
      // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
      while (node[0]?.[0] === 'export') ctx.export.push([node.shift()[1], [kind, items?.length]])

      // for import nodes - redirect output to import
      if (node[0]?.[0] === 'import') [, ...imported] = node.shift()

      // table abbr
      if (kind === 'table') {
        // (table id? reftype (elem ...{n})) -> (table id? n n reftype) (elem (table id) (i32.const 0) reftype ...)
        if (node[1]?.[0] === 'elem') {
          let [reftype, [, ...els]] = node
          node = [els.length, els.length, reftype]
          ctx.elem.push([['table', name || items.length], ['i32.const', '0'], reftype, ...els])
        }
      }

      // data abbr
      // (memory id? (data str)) -> (memory id? n n) (data (memory id) (i32.const 0) str)
      else if (kind === 'memory' && node[0]?.[0] === 'data') {
        let [, ...data] = node.shift(), m = '' + Math.ceil(data.map(s => s.slice(1, -1)).join('').length / 65536) // FIXME: figure out actual data size
        ctx.data.push([['memory', items.length], ['i32.const', 0], ...data])
        node = [m, m]
      }

      // dupe to code section, save implicit type
      else if (kind === 'func') {
        let [idx, param, result] = typeuse(node, ctx);
        idx ??= regtype(param, result, ctx)

        // we save idx because type can be defined after
        !imported && ctx.code.push([[idx, param, result], ...plain(node, ctx)]) // pass param since they may have names
        node.unshift(['type', idx])
      }

      // tag has a type similar to func
      else if (kind === 'tag') {
        let [idx, param] = typeuse(node, ctx);
        idx ??= regtype(param, [], ctx)
        node.unshift(['type', idx])
      }

      // import writes to import section amd adds placeholder for (kind) section
      if (imported) ctx.import.push([...imported, [kind, ...node]]), node = null

      items?.push(node)
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

  // Build sections that need to be in order
  const customSection = bin(SECTION.custom)
  const typeSection = bin(SECTION.type)
  const importSection = bin(SECTION.import)
  const funcSection = bin(SECTION.func)
  const tableSection = bin(SECTION.table)
  const memorySection = bin(SECTION.memory)
  const tagSection = bin(SECTION.tag)
  const globalSection = bin(SECTION.global)
  const exportSection = bin(SECTION.export)
  const startSection = bin(SECTION.start, false)
  const elemSection = bin(SECTION.elem)
  const datacountSection = bin(SECTION.datacount, false)
  const codeSection = bin(SECTION.code)  // Build code first to collect branch hints
  const dataSection = bin(SECTION.data)

  // Build branch hints custom section (must appear before code section)
  const buildBranchHints = () => {
    if (!ctx.branchHints || ctx.branchHints.length === 0) return []

    // Sort by function index
    ctx.branchHints.sort((a, b) => a.funcIdx - b.funcIdx)

    // Section name: "metadata.code.branch_hint"
    const name = 'metadata.code.branch_hint'
    const nameBytes = [...uleb(name.length), ...Array.from(name).map(c => c.charCodeAt(0))]

    // Build function hints
    const funcHintsBytes = []
    for (const { funcIdx, hints } of ctx.branchHints) {
      // Sort hints by offset within function
      hints.sort((a, b) => a[0] - b[0])

      // funcidx: u32
      funcHintsBytes.push(...uleb(funcIdx))

      // vec of hints
      funcHintsBytes.push(...uleb(hints.length))
      for (const [offset, hint] of hints) {
        // offset: u32 (relative to function body, after locals)
        funcHintsBytes.push(...uleb(offset))
        // reserved: u32 (must be 1)
        funcHintsBytes.push(...uleb(1))
        // hint: u32 (0 = unlikely, 1 = likely)
        funcHintsBytes.push(...uleb(hint))
      }
    }

    // vec of function hints
    const content = [...uleb(ctx.branchHints.length), ...funcHintsBytes]

    // Custom section: id=0, then size, then name + content
    const sectionContent = [...nameBytes, ...content]
    return [0, ...uleb(sectionContent.length), ...sectionContent]
  }

  // build final binary
  return Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    ...customSection,
    ...typeSection,
    ...importSection,
    ...funcSection,
    ...tableSection,
    ...memorySection,
    ...tagSection,
    ...globalSection,
    ...exportSection,
    ...startSection,
    ...elemSection,
    ...datacountSection,
    ...buildBranchHints(),  // Branch hints must appear before code section
    ...codeSection,
    ...dataSection
  ])
}

// consume name eg. $t ...
const alias = (node, list) => {
  let name = (node[0]?.[0] === '$' || node[0]?.[0] == null) && node.shift();
  if (name && list) name in list ? err(`Duplicate ${list.name} ${name}`) : list[name] = list.length; // save alias
  return name
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
  else if (compkind === 'struct') dfn = fieldseq(dfn, 'field', true)
  else if (compkind === 'array') [dfn] = dfn

  return [compkind, dfn, subkind, supertypes]
}

// register (implicit) type
const regtype = (param, result, ctx, idx = '$' + param + '>' + result) => (
  (ctx.type[idx] ??= ctx.type.push(['func', [param, result]]) - 1),
  idx
)

// consume typeuse nodes, return type index/params, or null idx if no type
// https://webassembly.github.io/spec/core/text/modules.html#type-uses
const typeuse = (nodes, ctx, names) => {
  let idx, param, result

  // explicit type (type 0|$name)
  if (nodes[0]?.[0] === 'type') {
    [, idx] = nodes.shift();
    [param, result] = paramres(nodes, names);

    const [, srcParamRes] = ctx.type[id(idx, ctx.type)] ?? err(`Unknown type ${idx}`)

    // check type consistency (excludes forward refs)
    if ((param.length || result.length) && srcParamRes.join('>') !== param + '>' + result) err(`Type ${idx} mismatch`)

    return [idx, ...srcParamRes]
  }

  // implicit type (param i32 i32)(result i32)
  return [idx, ...paramres(nodes, names)]
}

// consume (param t+)* (result t+)* sequence
const paramres = (nodes, names = true) => {
  // let param = [], result = []

  // collect param (param i32 i64) (param $x? i32)
  let param = fieldseq(nodes, 'param', names)

  // collect result eg. (result f64 f32)(result i32)
  let result = fieldseq(nodes, 'result')

  if (nodes[0]?.[0] === 'param') err(`Unexpected param`)

  return [param, result]
}

// collect sequence of field, eg. (param a) (param b c), (field a) (field b c) or (result a b) (result c)
// optionally allow or not names
const fieldseq = (nodes, field, names = false) => {
  let seq = []
  // collect field eg. (field f64 f32)(field i32)
  while (nodes[0]?.[0] === field) {
    let [, ...args] = nodes.shift()
    let name = args[0]?.[0] === '$' && args.shift()
    // expose name refs, if allowed
    if (name) {
      if (names) name in seq ? err(`Duplicate ${field} ${name}`) : seq[name] = seq.length
      else err(`Unexpected ${field} name ${name}`)
    }
    seq.push(...args)
  }
  return seq
}

// consume blocktype - makes sure either type or single result is returned
const blocktype = (nodes, ctx) => {
  let [idx, param, result] = typeuse(nodes, ctx, 0)

  // get type - can be either idx or valtype (numtype | reftype)
  if (!param.length && !result.length) return

  // (result i32) - doesn't require registering type
  if (!param.length && result.length === 1) return ['result', ...result]

  // register implicit type
  idx ??= regtype(param, result, ctx)

  return ['type', idx]
}

// abbr blocks, loops, ifs; collect implicit types via typeuses; resolve optional immediates
// https://webassembly.github.io/spec/core/text/instructions.html#folded-instructions
const plain = (nodes, ctx) => {
  let out = [], stack = [], label
  // helper: check if node is immediate (not array operand)
  const isImm = n => typeof n === 'string' || typeof n === 'number'

  while (nodes.length) {
    let node = nodes.shift()

    // branch hint annotation - pass through as marker
    if (Array.isArray(node) && node[0] === '@metadata.code.branch_hint') {
      // Extract hint value from annotation: (@metadata.code.branch_hint "\00"|"\01")
      let hintStr = node[1]
      // Parse the hint value - "\00" means unlikely (0), "\01" means likely (1)
      let hint = hintStr === '"\\01"' || hintStr === '"\x01"' ? 1 : 0
      out.push(['@branch_hint', hint])
      continue
    }

    // lookup is slower than sequence of known ifs
    if (typeof node === 'string') {
      out.push(node)

      // block typeuse?
      if (node === 'block' || node === 'if' || node === 'loop') {
        // (loop $l?)
        if (nodes[0]?.[0] === '$') label = nodes.shift(), out.push(label), stack.push(label)

        out.push(blocktype(nodes, ctx))
      }

      // else $label
      // end $label - make sure it matches block label
      else if (node === 'else' || node === 'end') {
        if (nodes[0]?.[0] === '$') (node === 'end' ? stack.pop() : label) !== (label = nodes.shift()) && err(`Mismatched ${node} label ${label}`)
      }

      // select (result i32 i32 i32)?
      else if (node === 'select') {
        out.push(paramres(nodes, 0)[1])
      }

      // call_indirect $table? $typeidx
      // return_call_indirect $table? $typeidx
      else if (node.endsWith('call_indirect')) {
        let tableidx = nodes[0]?.[0] === '$' || !isNaN(nodes[0]) ? nodes.shift() : 0
        let [idx, param, result] = typeuse(nodes, ctx, 0)
        out.push(tableidx, ['type', idx ?? regtype(param, result, ctx)])
      }

      // mark datacount section as required
      else if (node === 'memory.init' || node === 'data.drop' || node === 'array.new_data' || node === 'array.init_data') {
        ctx.datacount[0] = true
        // memory.init memidx? dataidx
        if (node === 'memory.init') out.push(isImm(nodes[1]) ? nodes.shift() : 0, isImm(nodes[0]) ? nodes.shift() : 0)
      }

      // memory.* memidx? - multi-memory proposal
      else if (node === 'memory.size' || node === 'memory.grow' || node === 'memory.fill') {
        out.push(isImm(nodes[0]) ? nodes.shift() : 0)
      }

      // memory.copy dstmem? srcmem?
      else if (node === 'memory.copy') {
        out.push(isImm(nodes[0]) ? nodes.shift() : 0, isImm(nodes[0]) ? nodes.shift() : 0)
      }

      // table.init tableidx? elemidx -> table.init tableidx elemidx
      else if (node === 'table.init') out.push((nodes[1][0] === '$' || !isNaN(nodes[1])) ? nodes.shift() : 0, nodes.shift())

      // table.* tableidx?
      else if (node.startsWith('table.')) {
        out.push(nodes[0]?.[0] === '$' || !isNaN(nodes[0]) ? nodes.shift() : 0)

        // table.copy tableidx? tableidx?
        if (node === 'table.copy') out.push(nodes[0][0] === '$' || !isNaN(nodes[0]) ? nodes.shift() : 0)
      }
    }

    else {
      // (block ...) -> block ... end
      if (node[0] === 'block' || node[0] === 'loop') {
        out.push(...plain(node, ctx), 'end')
      }

      // (if ...) -> if ... end
      else if (node[0] === 'if') {
        // Check if there's a pending branch hint that should attach to this if
        let pendingBranchHint = null
        if (out.length > 0 && Array.isArray(out[out.length - 1]) && out[out.length - 1][0] === '@branch_hint') {
          pendingBranchHint = out.pop()
        }
        
        let then = [], els = [], immed = [node.shift()]
        // (if label? blocktype? cond*? (then instr*) (else instr*)?) -> cond*? if label? blocktype? instr* else instr*? end
        // https://webassembly.github.io/spec/core/text/instructions.html#control-instructions
        if (node[node.length - 1]?.[0] === 'else') {
          els = plain(node.pop(), ctx)
          // ignore empty else
          // https://webassembly.github.io/spec/core/text/instructions.html#abbreviations
          if (els.length === 1) els.length = 0
        }
        if (node[node.length - 1]?.[0] === 'then') then = plain(node.pop(), ctx)

        // label?
        if (node[0]?.[0] === '$') immed.push(node.shift())

        // blocktype?
        immed.push(blocktype(node, ctx))

        if (typeof node[0] === 'string') err('Unfolded condition')

        // For branch hints, we need: condition, hint, if (so hint comes right before if)
        const conditions = plain(node, ctx)
        if (pendingBranchHint) {
          out.push(...conditions, pendingBranchHint, ...immed, ...then, ...els, 'end')
        } else {
          out.push(...conditions, ...immed, ...then, ...els, 'end')
        }
      }
      else out.push(plain(node, ctx))
    }
  }

  return out
}


// build section binary [by section codes] (non consuming)
const build = [
  // (@custom "name" placement? data)
  // placement is optional: (before|after section) or (before first)|(after last)
  // For now we ignore placement and just output the custom section
  ([name, ...rest], ctx) => {
    // Check if second arg is placement directive
    let data = rest
    if (rest[0]?.[0] === 'before' || rest[0]?.[0] === 'after') {
      // Skip placement for now - would need more complex section ordering
      data = rest.slice(1)
    }

    // Custom section format: name (vec string) + raw content bytes
    return [...vec(str(name)), ...str(...data)]
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

  // (import "math" "add" (func|table|global|memory dfn?))
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

    return ([...vec(str(mod)), ...vec(str(field)), KIND[kind], ...details])
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

  //  (export "name" (func|table|mem $name|idx))
  ([nm, [kind, l]], ctx) => ([...vec(str(nm)), KIND[kind], ...uleb(id(l, ctx[kind]))]),

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

    // Track current code index for branch hints
    if (ctx._codeIdx === undefined) ctx._codeIdx = 0
    let codeIdx = ctx._codeIdx++

    // collect locals
    while (body[0]?.[0] === 'local') {
      let [, ...types] = body.shift()
      if (types[0]?.[0] === '$') {
        let name = types.shift()
        if (name in ctx.local) err(`Duplicate local ${name}`)
        else ctx.local[name] = ctx.local.length
      }
      ctx.local.push(...types)
    }

    // Initialize hint tracking
    ctx._pendingHint = undefined

    const bytes = []
    while (body.length) bytes.push(...instr(body, ctx))
    bytes.push(0x0b)

    // Extract hint placeholders from bytes array - scan once and collect hints + clean bytes
    const hints = [], cleanBytes = []
    for (const b of bytes) {
      if (b?.hint !== undefined) hints.push([cleanBytes.length, b.hint])
      else cleanBytes.push(b)
    }

    // Store hints for this function if any were found
    if (hints.length) {
      ctx.branchHints ??= []
      let importedFuncs = ctx.import.filter(imp => imp[2][0] === 'func').length
      ctx.branchHints.push({ funcIdx: importedFuncs + codeIdx, hints })
    }

    ctx._pendingHint = undefined

    // squash locals into (n:u32 t:valtype)*, n is number and t is type
    // we skip locals provided by params
    let loctypes = ctx.local.slice(param.length).reduce((a, type) => (type == a[a.length - 1]?.[1] ? a[a.length - 1][0]++ : a.push([1, type]), a), [])

    // cleanup tmp state
    ctx.local = ctx.block = null

    // https://webassembly.github.io/spec/core/binary/modules.html#code-section
    return vec([...vec(loctypes.map(([n, t]) => [...uleb(n), ...reftype(t, ctx)])), ...cleanBytes])
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
    if (typeof inits[0] !== 'string' && inits[0]) {
      offset = inits.shift()
      if (offset?.[0] === 'offset') [, offset] = offset
      else offset ?? err('Bad offset', offset)
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
      ...vec(str(...inits))
    ])
  },

  // datacount
  (nodes, ctx) => uleb(ctx.data.length)
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


// consume one instruction from nodes sequence
const instr = (nodes, ctx) => {
  if (!nodes?.length) return []

  let out = [], op = nodes.shift(), immed, code
  // helper: check if node is immediate (not array operand)
  const isImm = n => typeof n === 'string' || typeof n === 'number'

  // Handle branch hint marker - store hint for next hintable instruction
  if (Array.isArray(op) && op[0] === '@branch_hint') {
    ctx._pendingHint = op[1]
    return nodes.length ? instr(nodes, ctx) : []
  }

  // consume group
  if (Array.isArray(op)) {
    immed = instr(op, ctx)
    while (op.length) out.push(...instr(op, ctx))
    // Insert hint placeholder before hintable instruction (if/br_if)
    if (ctx._pendingHint !== undefined && (immed[0] === 0x04 || immed[0] === 0x0d)) {
      out.push({ hint: ctx._pendingHint })
      ctx._pendingHint = undefined
    }
    out.push(...immed)
    return out
  }

  [...immed] = isNaN(op[0]) && INSTR[op] || err(`Unknown instruction ${op}`)
  code = immed[0]

  // gc-related
  // https://webassembly.github.io/gc/core/binary/instructions.html#reference-instructions
  if (code === 0x0fb) {
    [, code] = immed

    // struct.new $t ... array.set $t
    if ((code >= 0 && code <= 14) || (code >= 16 && code <= 19)) {
      let tidx = id(nodes.shift(), ctx.type)
      immed.push(...uleb(tidx))

      // struct.get|set* $t $f - read field by index from struct definition (ctx.type[structidx][dfnidx])
      if (code >= 2 && code <= 5) immed.push(...uleb(id(nodes.shift(), ctx.type[tidx][1])))
      // array.new_fixed $t n
      else if (code === 8) immed.push(...uleb(nodes.shift()))
      // array.new_data|init_data $t $d
      else if (code === 9 || code === 18) {
        immed.push(...uleb(id(isImm(nodes[0]) ? nodes.shift() : 0, ctx.data)))
      }
      // array.new_elem|init_elem $t $e
      else if (code === 10 || code === 19) immed.push(...uleb(id(nodes.shift(), ctx.elem)))
      // array.copy $t $t
      else if (code === 17) immed.push(...uleb(id(nodes.shift(), ctx.type)))
    }
    // ref.test|cast (ref null? $t|heaptype)
    else if (code >= 20 && code <= 23) {
      let ht = reftype(nodes.shift(), ctx)
      if (ht[0] !== REFTYPE.ref) immed.push(code = immed.pop() + 1) // ref.test|cast (ref null $t) is next op
      if (ht.length > 1) ht.shift() // pop ref
      immed.push(...ht)
    }
    // br_on_cast[_fail] $l? (ref null? ht1) (ref null? ht2)
    else if (code === 24 || code === 25) {
      let i = blockid(nodes.shift(), ctx.block),
        ht1 = reftype(nodes.shift(), ctx),
        ht2 = reftype(nodes.shift(), ctx),
        castflags = ((ht2[0] !== REFTYPE.ref) << 1) | (ht1[0] !== REFTYPE.ref)
      immed.push(castflags, ...uleb(i), ht1.pop(), ht2.pop()) // we take only abstype or
    }
  }

  // bulk memory: (memory.init) (memory.copy) (data.drop) (memory.fill)
  // table ops: (table.init|copy|grow|size|fill) (elem.drop)
  // https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md#instruction-encoding
  else if (code == 0xfc) {
    [, code] = immed

    // memory.init memidx dataidx (binary: dataidx memidx)
    if (code === 0x08) {
      let m = isImm(nodes[0]) ? nodes.shift() : 0, d = isImm(nodes[0]) ? nodes.shift() : 0
      immed.push(...uleb(id(d, ctx.data)), ...uleb(id(m, ctx.memory)))
    }
    // data.drop idx
    else if (code === 0x09) {
      immed.push(...uleb(id(nodes.shift(), ctx.data)))
    }
    // memory.copy dstmem srcmem
    else if (code === 0x0a) {
      immed.push(...uleb(id(isImm(nodes[0]) ? nodes.shift() : 0, ctx.memory)), ...uleb(id(isImm(nodes[0]) ? nodes.shift() : 0, ctx.memory)))
    }
    // memory.fill memidx
    else if (code === 0x0b) {
      immed.push(...uleb(id(isImm(nodes[0]) ? nodes.shift() : 0, ctx.memory)))
    }

    // elem.drop elemidx
    if (code === 0x0d) {
      immed.push(...uleb(id(nodes.shift(), ctx.elem)))
    }
    // table.init tableidx elemidx -> 0xfc 0x0c elemidx tableidx
    else if (code === 0x0c) {
      immed.push(...uleb(id(nodes[1], ctx.elem)), ...uleb(id(nodes.shift(), ctx.table)))
      nodes.shift()
    }
    // table.* tableidx?
    // abbrs https://webassembly.github.io/spec/core/text/instructions.html#id1
    else if (code >= 0x0c && code < 0x13) {
      immed.push(...uleb(id(nodes.shift(), ctx.table)))
      // table.copy tableidx? tableidx?
      if (code === 0x0e) immed.push(...uleb(id(nodes.shift(), ctx.table)))
    }
  }

  // v128s: (v128.load x) etc
  // https://github.com/WebAssembly/simd/blob/master/proposals/simd/BinarySIMD.md
  else if (code === 0xfd) {
    [, code] = immed
    immed = [0xfd, ...uleb(code)]
    // (v128.load offset? align?)
    if (code <= 0x0b) {
      const [a, o] = memarg(nodes)
      immed.push(...uleb((a ?? align(op))), ...uleb(o ?? 0))
    }
    // (v128.load_lane offset? align? idx)
    else if (code >= 0x54 && code <= 0x5d) {
      const [a, o] = memarg(nodes)
      immed.push(...uleb((a ?? align(op))), ...uleb(o ?? 0))
      // (v128.load_lane_zero)
      if (code <= 0x5b) immed.push(...uleb(nodes.shift()))
    }
    // (i8x16.shuffle 0 1 ... 15 a b)
    else if (code === 0x0d) {
      // i8, i16, i32 - bypass the encoding
      for (let i = 0; i < 16; i++) immed.push(parseUint(nodes.shift(), 32))
    }
    // (v128.const i32x4 1 2 3 4)
    else if (code === 0x0c) {
      let [t, n] = nodes.shift().split('x'),
        bits = +t.slice(1),
        stride = bits >>> 3 // i16 -> 2, f32 -> 4
      n = +n
      // i8, i16, i32 - bypass the encoding
      if (t[0] === 'i') {
        let arr = n === 16 ? new Uint8Array(16) : n === 8 ? new Uint16Array(8) : n === 4 ? new Uint32Array(4) : new BigUint64Array(2)
        for (let i = 0; i < n; i++) {
          let s = nodes.shift(), v = encode[t].parse(s)
          arr[i] = v
        }
        immed.push(...(new Uint8Array(arr.buffer)))
      }
      // f32, f64 - encode
      else {
        let arr = new Uint8Array(16)
        for (let i = 0; i < n; i++) {
          let s = nodes.shift(), v = encode[t](s)
          arr.set(v, i * stride)
        }
        immed.push(...arr)
      }
    }
    // (i8x16.extract_lane_s 0 ...)
    else if (code >= 0x15 && code <= 0x22) {
      immed.push(...uleb(parseUint(nodes.shift())))
    }
  }

  // control block abbrs
  // block ..., loop ..., if ...
  else if (code === 2 || code === 3 || code === 4) {
    ctx.block.push(code)

    // (block $x) (loop $y) - save label pointer
    if (nodes[0]?.[0] === '$') ctx.block[nodes.shift()] = ctx.block.length

    let t = nodes.shift();

    // void
    if (!t) immed.push(TYPE.void)
    // (result i32) - doesn't require registering type
    // FIXME: Make sure it is signed positive integer (leb, not uleb) https://webassembly.github.io/gc/core/binary/instructions.html#control-instructions
    else if (t[0] === 'result') immed.push(...reftype(t[1], ctx))
    // (type idx)
    else immed.push(...uleb(id(t[1], ctx.type)))
  }
  // else
  else if (code === 5) { }
  // then
  else if (code === 6) immed = [] // ignore

  // local.get $id, local.tee $id x
  else if (code == 0x20 || code == 0x21 || code == 0x22) {
    immed.push(...uleb(id(nodes.shift(), ctx.local)))
  }

  // global.get $id, global.set $id
  else if (code == 0x23 || code == 0x24) {
    immed.push(...uleb(id(nodes.shift(), ctx.global)))
  }

  // call $func ...nodes
  // return_call $func
  else if (code == 0x10 || code == 0x12) {
    immed.push(...uleb(id(nodes.shift(), ctx.func)))
  }

  // call_indirect $table (type $typeName) ...nodes
  // return_call_indirect $table (type $typeName) ... nodes
  else if (code == 0x11 || code == 0x13) {
    immed.push(
      ...uleb(id(nodes[1][1], ctx.type)),
      ...uleb(id(nodes.shift(), ctx.table))
    )
    nodes.shift()
  }

  // call_ref $type
  // return_call_ref $type
  else if (code == 0x14 || code == 0x15) {
    immed.push(...uleb(id(nodes.shift(), ctx.type)))
  }

  // end
  else if (code == 0x0b) ctx.block.pop()

  // br $label result?
  // br_if $label cond result?
  // br_on_null $l, br_on_non_null $l
  else if (code == 0x0c || code == 0x0d || code == 0xd5 || code == 0xd6) {
    immed.push(...uleb(blockid(nodes.shift(), ctx.block)))
  }

  // br_table 1 2 3 4  0  selector result?
  else if (code == 0x0e) {
    let args = []
    while (nodes[0] && (!isNaN(nodes[0]) || nodes[0][0] === '$')) {
      args.push(...uleb(blockid(nodes.shift(), ctx.block)))
    }
    args.unshift(...uleb(args.length - 1))
    immed.push(...args)
  }

  // select (result t+)
  else if (code == 0x1b) {
    let result = nodes.shift()
    // 0x1b -> 0x1c
    if (result.length) immed.push(immed.pop() + 1, ...vec(result.map(t => reftype(t, ctx))))
  }

  // ref.func $id
  else if (code == 0xd2) {
    immed.push(...uleb(id(nodes.shift(), ctx.func)))
  }

  // ref.null func
  else if (code == 0xd0) {
    let t = nodes.shift()
    immed.push(...(HEAPTYPE[t] ? [HEAPTYPE[t]] : uleb(id(t, ctx.type)))) // func->funcref, extern->externref
  }

  // binary/unary (i32.add a b) - no immed
  else if (code >= 0x45) { }

  // i32.store align=n offset=m
  else if (code >= 0x28 && code <= 0x3e) {
    let [a, o] = memarg(nodes)
    immed.push(...uleb((a ?? align(op))), ...uleb(o ?? 0))
  }

  // i32.const 123, f32.const 123.45
  else if (code >= 0x41 && code <= 0x44) {
    immed.push(...encode[op.split('.')[0]](nodes.shift()))
  }

  // memory.grow|size memidx
  // https://webassembly.github.io/spec/core/binary/instructions.html#memory-instructions
  else if (code == 0x3f || code == 0x40) {
    immed.push(...uleb(id(isImm(nodes[0]) ? nodes.shift() : 0, ctx.memory)))
  }

  // table.get|set $id
  else if (code == 0x25 || code == 0x26) {
    immed.push(...uleb(id(nodes.shift(), ctx.table)))
  }

  // Insert hint placeholder before hintable instruction in flat form (if/br_if)
  if (ctx._pendingHint !== undefined && (code === 0x04 || code === 0x0d)) {
    out.push({ hint: ctx._pendingHint })
    ctx._pendingHint = undefined
  }

  out.push(...immed)

  return out
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
  while (args[0]?.includes('=')) {
    [k, v] = args.shift().split('='), v = v.replaceAll('_', '')
    k === 'offset' ? offset = +v : k === 'align' ? align = +v : err(`Unknown param ${k}=${v}`)
  }
  if ((offset < 0 || offset > 0xffffffff)) err(`Bad offset ${offset}`)
  if ((align <= 0 || align > 0xffffffff)) err(`Bad align ${align}`)
  if (align) ((align = Math.log2(align)) % 1) && err(`Bad align ${align}`)
  return [align, offset]
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
const limits = (node) => (
  isNaN(parseInt(node[1])) ? [0, ...uleb(parseUint(node.shift()))] : [node[2] === 'shared' ? 3 : 1, ...uleb(parseUint(node.shift())), ...uleb(parseUint(node.shift()))]
)

// check if node is valid int in a range
// we put extra condition for index ints for tests complacency
const parseUint = (v, max = 0xFFFFFFFF) => (typeof v === 'string' && v[0] !== '+' ? (typeof max === 'bigint' ? i64 : i32).parse(v) : typeof v === 'number' ? v : err(`Bad int ${v}`)) > max ? err(`Value out of range ${v}`) : v

// serialize binary array
const vec = a => [...uleb(a.length), ...a.flat()]
