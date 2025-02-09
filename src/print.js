import parse from './parse.js';

const INLINE = [
  'param',
  'local',
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

/**
 * Formats a tree or a WAT (WebAssembly Text) string into a readable format.
 *
 * @param {string | Array} tree - The code to print. If a string is provided, it will be parsed into a tree structure first.
 * @param {Object} [options={}] - Optional settings for printing.
 * @param {string} [options.indent='  '] - The string used for one level of indentation. Defaults to two spaces.
 * @param {string} [options.newline='\n'] - The string used for line breaks. Defaults to a newline character.
 * @returns {string} The formatted WAT string.
 */
export default function print(tree, options = {}) {
  if (typeof tree === 'string') tree = parse(tree);

  let { indent='  ', newline='\n' } = options;
  indent ||= '', newline ||= ''; // false -> str

  return typeof tree[0] === 'string' ? printNode(tree) : tree.map(node => printNode(node)).join(newline)

  function printNode(node, level = 0) {
    if (!Array.isArray(node)) return node

    let content = node[0]

    for (let i = 1; i < node.length; i++) {
      // (<keyword> ...)
      if (Array.isArray(node[i])) {
        // inline nodes like (param x)(param y)
        // (func (export "xxx")..., but not (func (export "a")(param "b")...
        // if (
        //   INLINE.includes(node[i][0]) &&
        //   (!Array.isArray(node[i - 1]) || INLINE.includes(node[i - 1][0]))
        // ) {
        //   if (!Array.isArray(node[i - 1])) content += ` `
        // }
        // // new line
        // else {

        // flat node (<keyword> <str>*)
        if (node[i].length < 8 && !node[i].some(subnode => Array.isArray(subnode))) console.log(node), content += ` ` + printNode(node[i])

        // newline
        else content += newline + indent.repeat(level + 1) + printNode(node[i], level + 1)
      }
      // data chunks "\00...")
      else if (node[i].includes('\\'))   {
        content += (newline || ` `) + indent.repeat(level + 1) + node[i]
      }
      // inline nodes
      else {
        content += ` ` + node[i]
      }
    }
    return `(${content})`
  }
}
