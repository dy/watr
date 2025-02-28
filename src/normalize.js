import parse from './parse.js'

export default function normalize (nodes) {
  if (typeof nodes === 'string') nodes = parse(nodes)
  else nodes = clone(nodes)

  return nodes
}

const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)
