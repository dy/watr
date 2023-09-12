import parse from './parse.js';

let indent = '', newline = '\n'

/**
 * Formats a tree or a WAT string.
 *
 * @param {string | Array} tree - The code to print. If a string is provided, it will be parsed first.
 * @param {Object} [options] - Printing options.
 * @param {string} [options.indent='  '] - The string used for one level of indentation.
 * @param {string} [options.newline='\n'] - The string used for line breaks.
 * @returns {string} The formatted WAT string.
 */
export default function print(tree, options = {}) {
  if (typeof tree === 'string') tree = parse(tree);

  ({ indent='  ', newline='\n' } = options);
  indent ||= '', newline ||= '';

  return typeof tree[0] === 'string' ? printNode(tree) : tree.map(node => printNode(node)).join(newline)
}

const INLINE = [
  'param',
  'drop',
  'f32.const',
  'f64.const',
  'i32.const',
  'i64.const',
  'local.get',
  'global.get',
  'memory.size',
  'result',
  'export',
  'unreachable',
  'nop'
]

function printNode(node, level = 0) {
  if (!Array.isArray(node)) return node + ''

  let content = node[0]

  for (let i = 1; i < node.length; i++) {
    // new node doesn't need space separator, eg. [x,[y]] -> `x(y)`
    if (Array.isArray(node[i])) {
      // inline nodes like (param x)(param y)
      // (func (export "xxx")..., but not (func (export "a")(param "b")...

      if (
        INLINE.includes(node[i][0]) &&
        (!Array.isArray(node[i - 1]) || INLINE.includes(node[i - 1][0]))
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