
/**
 * Parses a wasm text string and constructs a nested array structure (AST).
 *
 * @param {string} str - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */

import { err } from "./util.js"

export default (str, o={ comments: false, annotations: false }) => {
  let i = 0, root = [], buf = '', comment = 0

  const parseLevel = (level) => {
    // push buffer onto level, reset buffer
    const commit = () => buf && (
      (!comment || o.comments) && level.push(buf),
      buf = ''
    )
    const push = () => buf += str[i++]

    for (let c, q, sublevel; i < str.length;) {
      c = str[i]
      // (;;)
      if (comment > 0) {
        push()
        if (c === '(' && str[i] === ';') push(), comment++ // (;(;;);)
        else if (c === ';' && str[i] === ')') push(), comment == 1 && (commit(), comment--)
      }
      // ;;
      else if (comment < 0) {
        push()
        if (c === '\n' || c === '\r') commit(), comment = 0
      }
      else if (q) {
        push()
        if (str[i-1] === '\\') push() // "\\""
        else if (c === '"') commit(), q = 0
      }
      else if (c === '"') {
        buf !== '$' && commit(), q = c, push() // "..."
      }
      else if (c === '(') {
        commit()
        if (str[i+1] === ';') push(), push(), comment = 1 // (; ... ;)
        else {
          i++
          parseLevel(sublevel = [])
          if (str[i++] !== ')') err(`Unclosed paren`)
          if (sublevel[0]?.[0] === '@' && !o.annotations); else level.push(sublevel) // (@...)
        }
      }
      else if (c === ';' && str[i+1] === ';') commit(), push(), push(), comment = -1  // ;; ...
      else if (c <= ' ') commit(), i++
      else if (c === ')') return commit()
      else push()
    }

    commit()
  }

  parseLevel(root)
  if (i < str.length) err(`Parens mismatch`)

  return root.length > 1 ? root : root[0] || []
}
