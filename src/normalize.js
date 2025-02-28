import parse from './parse.js'

export default function normalize (nodes) {
  if (typeof nodes === 'string') nodes = parse(nodes)
  else nodes = clone(nodes) // FIXME: get rid of

  let out = ['module']

  // (module ...) abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') out.push(...nodes.slice(nodes[1]?.[0] === '$' ? 2 : 1))
  // (op ...) single node
  else if (typeof nodes[0] === 'string') out.push(nodes)
  // (a ...)(b ...)
  else out.push(...nodes)

  return out
}

const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)
