/**
 * @module watr/normalize
 * Deabbrs & makes explicit input WAT file
 */
import parse from './parse.js'
import { SECTION } from './const.js'

export default function normalize(nodes) {
  if (typeof nodes === 'string') nodes = parse(nodes)

  // (module ...) abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') nodes = nodes.slice(nodes[1]?.[0] === '$' ? 2 : 1)
  // (op ...) single node
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  // (module binary "..."), (module quote "...")
  if (nodes[0] === 'binary' || nodes[0] === 'quote') return nodes

  let types = [], sections = [[], types, [], [], [], [], [], [], [], [], [], []]

  // deref id node to numeric idx
  // const deref = (nm, list, n) => (n = nm[0] === '$' ? list[nm] : +nm, n in list ? n : err(`Unknown ${list.name} ${nm}`))

  let idx = 0 // reusable within-node pointer

  // normalize type definition
  // (type $n? (func param* result*))
  // (type $n? (array (mut i8)))
  // (type $n? (struct (field a)*)
  // -> (type (sub final (struct|array|func ...)))
  const normtype = (node) => {
    idx = 1
    let nm = node[idx][0] === '$' && node[idx++],
        subtype = node[idx],
        comptype = subtype[0] === 'sub' ? subtype.at(-1) : subtype

    if (nm) nm in types ? err(`Duplicate type ${nm}`) : types[nm] = types.length

    idx = 1
    if (comptype[0] === 'func') comptype = paramres(comptype), types['$' + comptype.join('>')] ??= types.length
    else if (comptype[0] === 'struct') comptype = fieldseq(comptype, 'field', true)

    return []
  }

  // consume (param t+)* (result t+)* sequence
  const paramres = (node, names = true) => {
    // collect param (param i32 i64) (param $x? i32)
    let param = fieldseq(node, 'param', names)

    // collect result eg. (result f64 f32)(result i32)
    let result = fieldseq(node, 'result')

    if (node[idx]?.[0] === 'param') err(`Unexpected param`)

    return [param, result]
  }

  // collect sequence of field, eg. (param a) (param b c), (field a) (field b c) or (result a b) (result c)
  // optionally allow or not names
  const fieldseq = (node, field, names = false) => {
    let seq = []
    // collect field eg. (field f64 f32)(field i32)
    while (node[idx]?.[0] === field) {
      let [, ...args] = node[idx++]
      // (field $x type)
      if (args[0]?.[0] === '$') {
        let [name, type] = args
        if (names) name in seq ? err(`Duplicate ${field} ${name}`) : seq[name] = seq.length
        else err(`Unexpected ${field} name ${name}`)
        seq.push(type)
      }
      // (field type*)
      else seq.push(...args)
    }
    return seq
  }

  // consume typeuse nodes, return type index/params, or null idx if no type
  // https://webassembly.github.io/spec/core/text/modules.html#type-uses
  const typeuse = (node, names) => {
    let id, param, result

    // explicit type (type 0|$name)
    if (node[idx]?.[0] === 'type') {
      [, id] = node[idx++];
      if (id[0] === '$') id = types[id] ?? err(`Unknown type ${id}`)
    }

    // implicit type (param i32 i32)(result i32)
    [param, result] = paramres(node, names)

    // TODO: check type consistency
    // if ((param.length || result.length) && id in types)
    //   if (types[deref(id, types)][1].join('>') !== param + '>' + result) err(`Type ${id} mismatch`)

    // we detect typeuse after explicit types, so undefined types are implicit
    id ??= (types['$' + param + '>' + result] ??= types.push(['type', ['func', ['param', ...param], ['result', ...result]]])-1)

    return id
  }

  // collect & normalize types
  nodes.filter(node => {
    let [kind] = node

    // TODO
    // if (kind === 'type') node = normtype(node)
    // // (rec (type $a (sub final? $sup* (func ...))...) (type $b ...)) -> normalize subtypes
    // else if (kind === 'rec') {
    //   types.push(node.map((type, i) => !i ? type : normtype(type)))
    //   // TODO: collect/normalize func/struct type elements
    // }
    if (kind === 'rec' || kind === 'type') types.push(node)
    else if (kind === 'export' || kind === 'start' || kind === 'elem' || kind === 'data') sections[SECTION[kind]].push(node)
    else return true
  })

  // reorder nodes by sections, deabbr
  // (kind === 'table' || kind === 'memory' || kind === 'global' || kind === 'func')
  .forEach((node) => {
    // TODO: dealias section names
    idx = 0
    let kind = node[0], imported = 0

    // import abbr
    // (import m n (table|memory|global|func id? type)) -> (table|memory|global|func id? (import m n) type)
    if (kind === 'import') {
      let [, m, n, dfn] = node
      idx = (dfn[1]?.[0] === '$') + 1
      node = [...dfn.slice(0, idx), [kind, m, n], ...dfn.slice(idx)]
      kind = node[0]
    }

    let items = sections[SECTION[kind]];

    // index, alias
    idx = 1 // within-node idx
    let name = (node[idx]?.[0] === '$') && node[idx++]

    // export abbr
    // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
    while (node[idx]?.[0] === 'export') sections[SECTION.export].push([...node[idx++], [kind, items.length]])

    // skip import
    if (node[idx]?.[0] === 'import') idx++, imported = 1;

    // table abbr
    // (table id? reftype (elem ...n)) -> (table id? n n reftype) (elem (table id) (i32.const 0) reftype ...)
    if (kind === 'table' && node[idx + 1]?.[0] === 'elem') {
      let reftype = node[idx], [, ...els] = node[idx + 1]
      idx = 0, node = [els.length, els.length, reftype]
      sections[SECTION.elem].push(['elem', ['table', name || items.length], ['i32.const', '0'], reftype, ...els])
    }

    // data abbr
    // (memory id? (data str)) -> (memory id? n n) (data (memory id) (i32.const 0) str)
    else if (kind === 'memory' && node[idx]?.[0] === 'data') {
      let [, ...data] = node[idx],
        m = ('' + Math.ceil(data.reduce((s, str) => (s + str.length - 2), 0) / 65536)) // FIXME: figure out precise data size
      sections[SECTION.data].push(['data', ['memory', items.length], ['i32.const', 0], ...data])
      idx = 0, node = [m, m]
    }

    // resolve type
    // (func id? export* import? typeuse local* instr*), typeuse = (type idx?)? param* result*
    // else if (kind === 'func') {
    //   let [typeid, param, result] = typeuse(node);
    //   typeid ?? (_types[typeid = '$' + param + '>' + result] ||= [param, result]); // infer type

    //   // consume locals

    //   let code = plain(node)

    //   // // we save typeid because type can be defined after
    //   // nodes.push(['code', [typeid, param, result], ...plain(node, ctx)]) // pass param since they may have names

    //   node = [['type', typeid], ...code]
    // }

    items.push([kind, name || `(;${items.length};)`, ...node.slice(idx - imported)])
  })

  // collect implicit types
  // TODO: plainify code, resolve name refs
  // sections[SECTION.func] = sections[SECTION.func].map(([kind, nm, ...code]) => {
  //   idx = 0
  //   return [['type', typeuse(code)], nm, ...code]
  // })


  return sections.flat()
}
