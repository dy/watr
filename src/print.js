import parse from './parse.js';


/**
 * Formats a tree or a WAT (WebAssembly Text) string into a readable format.
 *
 * @param {string | Array} tree - The code to print. If a string is provided, it will be parsed into a tree structure first.
 * @param {Object} [options={}] - Optional settings for printing.
 * @param {string} [options.indent='  '] - The string used for one level of indentation. Defaults to two spaces.
 * @param {string} [options.newline='\n'] - The string used for line breaks. Defaults to a newline character.
 * @param {boolean} [options.comments=false] - Whether to include comments in the output. Defaults to false.
 * @returns {string} The formatted WAT string.
 */
export default function print(tree, options = {}) {
  if (typeof tree === 'string') tree = parse(tree, { comments: options.comments });

  let { indent='  ', newline='\n', comments=false } = options;
  indent ||= '', newline ||= ''; // false -> str

  return typeof tree[0] === 'string' ? printNode(tree) : tree.map(node => printNode(node)).join(newline)

  function printNode(node, level = 0) {
    if (!Array.isArray(node)) return node

    let content = node[0]
    if (!content) return ''

    // flat node (no deep subnodes), eg. (i32.const 1), (module (export "") 1)
    let flat = !!newline && node.length < 4
    let curIndent = indent.repeat(level + 1)

    for (let i = 1; i < node.length; i++) {
      const sub = node[i].valueOf() // "\00abc\ff" strings are stored as arrays but have ._ with original value

      // comments - just add with space
      if (comments && typeof sub === 'string' && sub[1] === ';') {
        const last = content[content.length - 1]
        if (last && last !== ' ' && last !== '(') content += ' '
        content += sub.trimEnd()
        // line comments MUST have newline after (even when minified)
        if (sub[0] === ';') content += '\n'
      }
      // (<keyword> ...)
      else if (Array.isArray(sub)) {
        if (flat) flat = sub.every(sub => !Array.isArray(sub))
        content += newline + curIndent + printNode(sub, level + 1)
      }
      // data chunks "\00..."
      else if (node[0] === 'data')   {
        flat = false;
        if (newline || content[content.length-1] !== ')') content += newline || ' '
        content += curIndent + sub
      }
      // inline nodes
      else {
        const last = content[content.length - 1]
        // after newline from line comment, no extra space needed
        if (last === '\n') content += ''
        else if (last && last !== ')' && last !== ' ') content += ' '
        else if (newline || last === ')') content += ' '
        content += sub
      }
    }

    // shrink unnecessary spaces
    if (flat) return `(${content.replaceAll(newline + curIndent + '(', ' (')})`

    return `(${content + newline + indent.repeat(level)})`
  }
}
