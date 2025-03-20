
/**
 * Parses (lexes) a WASM text string into tree of tokens without semantics yet.
 *
 * @param {string} s - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */

import { err } from "./util.js"

export default (s, o={ comments: false, annotations: false }) => {
  let i = 0, level = [], buf = '', comment = 0

  // push buffer onto level, reset buffer
  const commit = () => buf && (
    (!comment || o.comments) && level.push(buf),
    buf = ''
  )
  const next = () => buf += s[i++]

  const parseLevel = (parent = level) => {
    while (i < s.length) {
      let c = s[i]
      // (;;)
      if (comment > 0) {
        next()
        if (c === '(' && s[i] === ';') next(), comment++ // (;(;;);)
        else if (c === ';' && s[i] === ')') next(), comment == 1 && (commit(), comment--)
      }
      // ;;
      else if (comment < 0) {
        next()
        if (c === '\n' || c === '\r') commit(), comment = 0
      }
      // "..."
      else if (c === '"') {
        buf != '$' && commit(), next()
        while (s[i] !== '"' && i < s.length) s[i] === '\\' && next(), next()
        next(), commit()
      }
      else if (c === '(') {
        commit()
        if (s[i+1] === ';') next(), next(), comment = 1 // (; ... ;)
        else {
          i++, level = [] // parent is saved on entry
          parseLevel()
          if (s[i++] !== ')') err(`Unbalanced syntax`)
          if (level[0]?.[0] === '@' && !o.annotations); else parent.push(level) // (@...)
          level = parent
        }
      }
      else if (c === ';' && s[i+1] === ';') commit(), next(), next(), comment = -1  // ;; ...
      // https://webassembly.github.io/annotations/core/text/lexical.html#white-space
      else if (c <= ' ') commit(), i++
      else if (c === ')') return commit()
      else next()
    }

    commit()
  }

  parseLevel()
  // if (i < s.length) err(`Unbalanced syntax`)

  return level.length > 1 ? level : level[0] || []
}
