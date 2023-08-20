import parse from './parse.js';

let indent = '', newline = '\n', pad = '', comments = false, _i = 0

export default function print(tree, options = {}) {
  if (typeof tree === 'string') tree = parse(tree);

  ({ indent, newline, pad, comments } = options);
  newline ||= ''
  pad ||= ''
  indent ||= ''

  let out = typeof tree[0] === 'string' ? printNode(tree) : tree.map(node => printNode(node)).join(newline)

  return out
}

const flats = ['param', 'local', 'global', 'result', 'export']

function printNode(node, level = 0) {
  if (!Array.isArray(node)) return node + ''

  let content = node[0]

  for (let i = 1; i < node.length; i++) {
    // new node doesn't need space separator, eg. [x,[y]] -> `x(y)`
    if (Array.isArray(node[i])) {
      // inline nodes like (param x)(param y)
      // (func (export "xxx")..., but not (func (export "a")(param "b")...
      if (
        flats.includes(node[i][0]) &&
        (!Array.isArray(node[i - 1]) || node[i][0] === node[i - 1][0])
      ) {
        if (!Array.isArray(node[i - 1])) content += ` `
      } else {
        content += newline
        if (node[i]) content += indent.repeat(level + 1)
      }

      content += printNode(node[i], level + 1)
    }
    else {
      content += ` `
      content += node[i]
    }
  }
  return `(${content})`
}