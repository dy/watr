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
  if (typeof tree[0] === 'string' && tree[0][0] !== ';') return printNode(tree)

  // Multiple top-level nodes - filter out comments if comments option is false
  return tree
    .filter(node => comments || !isComment(node))
    .map(node => printNode(node))
    .join(newline)

  function isComment(node) {
    // node[1]===';' alone also matches a plain string starting with ';' (n[0] is
    // always '"' for a real string token, so n[1] is its first content byte) — a
    // block comment is '(;…', so also require n[0]==='(' to disambiguate.
    return typeof node === 'string' && (node[0] === ';' || (node[0] === '(' && node[1] === ';'))
  }

  function printNode(node, level = 0) {
    if (!Array.isArray(node)) return node

    let content = node[0]
    if (!content) return ''
    let afterLineComment = false // track if we just printed a line comment

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
      const raw = node[i]?.valueOf?.() ?? node[i] // "\00abc\ff" strings are stored as arrays but have ._ with original value
      // JS-number leaves that don't stringify to WAT tokens: ±Infinity/NaN
      // (String() gives 'Infinity'/'NaN' — unparseable) and -0 (String() drops
      // the sign, a real f64.const value change). Single-def ternary with
      // arithmetic-only tests — this file self-hosts through jz, whose kernel
      // leg miscarried both the Number.isFinite/Object.is forms and a
      // `let`+conditional-reassign union local (finite numbers printed empty).
      const sub = typeof raw === 'number' && (raw - raw !== 0 || (raw === 0 && 1 / raw < 0))
        ? (raw > 0 ? 'inf' : raw < 0 ? '-inf' : raw === 0 ? '-0' : 'nan')
        : raw

      // comments - skip if not enabled. sub[1]===';' alone would also match a plain
      // string starting with ';' (n[0] is always '"' for a real string; block comments
      // are '(;…', so n[0]==='(' must hold too) — see isComment above.
      if (typeof sub === 'string' && (sub[0] === ';' || (sub[0] === '(' && sub[1] === ';'))) {
        if (!comments) continue
        // line comments (;;) - MUST end with newline to avoid consuming following elements
        if (sub[0] === ';') {
          if (newline) {
            // prettified: own line with indent, next element adds its own newline
            content += newline + curIndent + sub.trimEnd()
            afterLineComment = true
          } else {
            // minified: keep inline but must have newline after
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
        afterLineComment = false
      }
      // data chunks "\00..."
      else if (node[0] === 'data')   {
        flat = false;
        if (newline || content[content.length-1] !== ')') content += newline || ' '
        content += curIndent + sub
        afterLineComment = false
      }
      // inline nodes
      else {
        const last = content[content.length - 1]
        // after line comment in prettified mode, need newline + indent
        if (afterLineComment && newline) content += newline + curIndent
        // after newline from line comment (minified), add indent
        else if (last === '\n') content += ''
        else if (last && last !== ')' && last !== ' ') content += ' '
        else if (newline || last === ')') content += ' '
        content += sub
        afterLineComment = false
      }
    }

    // shrink unnecessary spaces
    if (flat) return `(${content.replaceAll(newline + curIndent + '(', ' (')})`

    return `(${content + newline + indent.repeat(level)})`
  }
}
