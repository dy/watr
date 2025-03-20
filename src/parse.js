
/**
 * Parses a WASM text string into sequence of tokens (AST) without semantics yet.
 *
 * @param {string} s - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */

import { err } from "./util.js"

export default (s, o={ comments: false, annotations: false }) => {
  let i = 0, root = [], buf = '', comment = 0

  const parseLevel = (level) => {
    let c, q, sublevel // current char, is "", is $

    // push buffer onto level, reset buffer
    const commit = () => buf && (
      (!comment || o.comments) && level.push(buf),
      buf = ''
    )
    const push = () => buf += s[i++]

    while (i < s.length) {
      c = s[i]
      // (;;)
      if (comment > 0) {
        push()
        if (c === '(' && s[i] === ';') push(), comment++ // (;(;;);)
        else if (c === ';' && s[i] === ')') push(), comment == 1 && (commit(), comment--)
      }
      // ;;
      else if (comment < 0) {
        push()
        if (c === '\n' || c === '\r') commit(), comment = 0
      }
      else if (q) {
        push()
        if (c === '\\') push()
        else if (c === '"') commit(), q = 0
      }
      else if (c === '"') q = 1, buf != '$' && commit(), push()  // "..."
      else if (c === '(') {
        commit()
        if (s[i+1] === ';') push(), push(), comment = 1 // (; ... ;)
        else {
          i++
          parseLevel(sublevel = [])
          if (s[i++] !== ')') err(`Unclosed paren`)
          if (sublevel[0]?.[0] === '@' && !o.annotations); else level.push(sublevel) // (@...)
        }
      }
      else if (c === ';' && s[i+1] === ';') commit(), push(), push(), comment = -1  // ;; ...
      // https://webassembly.github.io/annotations/core/text/lexical.html#white-space
      else if (c <= ' ') commit(), i++
      else if (c === ')') return commit()
      else push()
    }

    commit()
  }

  parseLevel(root)
  if (i < s.length) err(`Parens mismatch`)

  return root.length > 1 ? root : root[0] || []
}
