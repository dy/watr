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
  if (typeof tree === 'string') tree = parse(tree);

  let { indent='  ', newline='\n', comments=true } = options;
  indent ||= '', newline ||= ''; // false -> str

  // If tree[0] is a string but NOT starting with `;` (comment), it's a keyword like `module` - print as single node
  // Otherwise it's multiple nodes (comments + module) - print each separately
  return typeof tree[0] === 'string' && tree[0][0] !== ';' ? printNode(tree) : tree.map(node => printNode(node)).join(newline)

  function printNode(node, level = 0) {
    if (!Array.isArray(node)) return node

    let content = node[0]
    if (!content) return ''

    // Special handling for try_table: keep catch clauses inline
    if (content === 'try_table') {
      let i = 1
      // Add label if present
      if (typeof node[i] === 'string' && node[i][0] === '$') content += ' ' + node[i++]
      // Add blocktype if present
      if (Array.isArray(node[i]) && (node[i][0] === 'result' || node[i][0] === 'type')) content += ' ' + printNode(node[i++], level)
      // Add catch clauses inline
      while (Array.isArray(node[i]) && /^catch/.test(node[i][0])) content += ' ' + printNode(node[i++], level).trim()
      // Rest is body - print normally
      for (; i < node.length; i++) content += Array.isArray(node[i]) ? newline + indent.repeat(level + 1) + printNode(node[i], level + 1) : ' ' + node[i]
      return `(${content + newline + indent.repeat(level)})`
    }

    // flat node (no deep subnodes), eg. (i32.const 1), (module (export "") 1)
    // not flat if contains line comments (they need their own line)
    let flat = !!newline && node.length < 4 && !node.some(n => typeof n === 'string' && n[0] === ';' && n[1] === ';')
    let curIndent = indent.repeat(level + 1)

    for (let i = 1; i < node.length; i++) {
      const sub = node[i].valueOf() // "\00abc\ff" strings are stored as arrays but have ._ with original value

      // comments - skip if not enabled
      if (typeof sub === 'string' && sub[1] === ';') {
        if (!comments) continue
        // line comments (;;)
        if (sub[0] === ';') {
          // prettified: put on own line before next element
          if (newline) {
            content += newline + curIndent + sub.trimEnd()
          }
          // minified: keep inline but must have newline after (WAT syntax requires it)
          else {
            const last = content[content.length - 1]
            if (last && last !== ' ' && last !== '(') content += ' '
            content += sub.trimEnd() + '\n'
          }
        }
        // block comments ((;...;)) can stay inline
        else {
          const last = content[content.length - 1]
          if (last && last !== ' ' && last !== '(') content += ' '
          content += sub.trimEnd()
        }
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
        // after newline from minified line comment, no extra space needed
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
