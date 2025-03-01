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
    if (nodes[1] === 'binary' || nodes[1] === 'quote') return nodes // FIXME: make more clever
    from = nodes[1]?.[0] === '$' ? 2 : 1
  }
  // (op ...) single node
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  let sections = []

  // TODO: dealias section names
  // TODO: deabbr exports
  // arrange by section ids, eg. types first
  for (let i = from; i < nodes.length; i++) {
    let node = nodes[i], [kind] = node, secIdx;
    let iidx = node[1]?.[0] === '$' ? 2 : 1; // internal non-name index

    if (kind === 'rec') secIdx = SECTION.type
    // deabbr import - import sections should go first
    // (table|memory|global|func id? (import m n) type) -> (import m n (table|memory|global|func id? type))
    else if (node[iidx]?.[0] === 'import') {
      node = [...node[iidx], [...node.slice(0, iidx), ...node.slice(iidx+1)]]
      secIdx = SECTION[node[0]]
    }
    else secIdx = SECTION[kind]

    let items = (sections[secIdx] ||= [])


    items.push(node)
  }

  // TODO: push implicit types
  return ['module', ...sections.flat()]
}
