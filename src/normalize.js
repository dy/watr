/**
 * @module watr/normalize
 * Deabbrs & makes explicit input WAT file
 */
import parse from './parse.js'
import { SECTION } from './const.js'

export default function normalize(nodes) {
  if (typeof nodes === 'string') nodes = parse(nodes)

  let from = 0, idx = 0 // reusable within-node pointer

  // (module ...) abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') {
    from = nodes[1]?.[0] === '$' ? 2 : 1
  }
  // (op ...) single node
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  if (nodes[from] === 'binary' || nodes[from] === 'quote') return nodes.slice(from) // FIXME: make more clever, maybe join data definitions?

  const sections = [], _types = []
  for (let kind in SECTION) sections[SECTION[kind]] = []

  // TODO: dealias section names

  // process node (put into corresponding section)
  const normalizeNode = (node) => {
    idx = 0 // within-node indx
    let kind = node[0]

    // (rec (type $a (sub final? $sup* (func ...))...) (type $b ...)) -> save subtypes
    if (kind === 'rec') {
      sections[SECTION.type].push(node);
      return
    }

    // import abbr
    // (import m n (table|memory|global|func id? type)) -> (table|memory|global|func id? (import m n) type)
    if (kind === 'import') {
      let [, m, n, dfn] = node
      idx = (dfn[1]?.[0] === '$') + 1
      node = [...dfn.slice(0, idx), [kind, m, n], ...dfn.slice(idx)]
      kind = node[0]
    }

    let items = sections[SECTION[kind]];

    if (kind === 'export' || kind === 'start' || kind === 'elem' || kind === 'data') {
      items.push(node)
    }

    // (kind === 'type' || kind === 'table' || kind === 'memory' || kind === 'global' || kind === 'func')
    else {
      // index, alias
      idx = 1 // within-node idx
      let name = (node[idx]?.[0] === '$') && node[idx++]

      // export abbr
      // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
      while (node[idx]?.[0] === 'export') sections[SECTION.export].push([...node[idx++], [kind, items.length]])

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
      // // (func id? export* import? typeuse local* instr*), typeuse = (type idx?)? param* result*
      // else if (kind === 'func') {
      //   let [idx, param, result] = typeuse(node);
      //   idx ?? (_types[idx = '$' + param + '>' + result] = [param, result]); // infer type


      //   // we save idx because type can be defined after
      //   !imported && nodes.push(['code', [idx, param, result], ...plain(node, ctx)]) // pass param since they may have names


      //   node.unshift(['type', idx])
      // }

      items.push([kind, name || `(;${items.length};)`, ...node.slice(idx)])
    }
  }

  // consume typeuse nodes, return type index/params, or null idx if no type
  // https://webassembly.github.io/spec/core/text/modules.html#type-uses
  const typeuse = (node, names) => {
    let id, param, result

    // explicit type (type 0|$name)
    if (node[idx]?.[0] === 'type') {
      [, id] = node[idx];
      [param, result] = paramres(node, names);

      // check type consistency (excludes forward refs)
      // if ((param.length || result.length) && id in sections[SECTION.type])
      //   if (sections[SECTION.type][id(id, sections.type)][1].join('>') !== param + '>' + result) err(`Type ${id} mismatch`)

      return [id]
    }

    // implicit type (param i32 i32)(result i32)
    [param, result] = paramres(node, names)

    return [, param, result]
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

  // reorder nodes by sections, deabbr
  for (let i = from; i < nodes.length; i++) normalizeNode(nodes[i])

  // TODO: push implicit types

  // TODO: plainify func, resolve types

  return sections.flat()
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
