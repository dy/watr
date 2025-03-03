/**
 * @module watr/normalize
 * Deabbrs & makes explicit input WAT file
 */
import parse from './parse.js'
import { SECTION } from './const.js'

export default function normalize (nodes) {
  if (typeof nodes === 'string') nodes = parse(nodes)

  let from = 0

  // (module ...) abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') {
    from = nodes[1]?.[0] === '$' ? 2 : 1
  }
  // (op ...) single node
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  if (nodes[from] === 'binary' || nodes[from] === 'quote') return nodes.slice(from) // FIXME: make more clever

  const sections = []
  for (let kind in SECTION) sections[SECTION[kind]] = []

  // TODO: dealias section names
  // TODO: deabbr exports

  // reorder nodes by sections, deabbr
  for (let i = from; i < nodes.length; i++) {
    let node = nodes[i], kind = node[0]

    // (rec (type $a (sub final? $sup* (func ...))...) (type $b ...)) -> save subtypes
    if (kind === 'rec') {
      sections[SECTION.type].push(node);
      continue
    }

    // import abbr
    // (import m n (table|memory|global|func id? type)) -> (table|memory|global|func id? (import m n) type)
    if (kind === 'import') {
      let [,m,n,dfn] = node, idx = (dfn[1]?.[0] === '$') + 1
      node = [...dfn.slice(0, idx), [kind,m,n], ...dfn.slice(idx)]
      kind = node[0]
    }

    let items = sections[SECTION[kind]];

    if (kind === 'export' || kind === 'start' || kind === 'elem' || kind === 'data') {
      items.push(node)
    }

    // (kind === 'type' || kind === 'table' || kind === 'memory' || kind === 'global' || kind === 'func')
    else {
      // index, alias
      let idx = 1 // within-node idx
      let name = (node[idx]?.[0] === '$') && node[idx++]

      // export abbr
      // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
      while (node[idx]?.[0] === 'export') sections[SECTION.export].push([...node[idx++], [kind, items.length]])

      // table abbr
      // (table id? reftype (elem ...n)) -> (table id? n n reftype) (elem (table id) (i32.const 0) reftype ...)
      if (kind === 'table' && node[idx+1]?.[0] === 'elem') {
        let reftype = node[idx], [, ...els] = node[idx+1]
        idx = 0, node = [els.length, els.length, reftype]
        sections[SECTION.elem].push(['elem', ['table', name || items.length], ['i32.const', '0'], reftype, ...els])
      }

      // data abbr
      // (memory id? (data str)) -> (memory id? n n) (data (memory id) (i32.const 0) str)
      else if (kind === 'memory' && node[idx]?.[0] === 'data') {
        let [, ...data] = node[idx],
            m = ('' + Math.ceil(data.reduce((s,str) => (s+str.length-2), 0) / 65536)) // FIXME: figure out precise data size
        sections[SECTION.data].push(['data', ['memory', items.length], ['i32.const', 0], ...data])
        idx=0, node = [m, m]
      }

      items.push([kind, name || `(;${items.length};)`, ...node.slice(idx)])
    }
  }

  // TODO: push implicit types
  return sections.flat()
}
