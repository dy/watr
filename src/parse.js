
/**
 * Parses (lexes) a WASM text string into tree of tokens without semantics yet.
 *
 * @param {string} s - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */

import { err, tenc, tdec } from "./util.js"


export default (s, o = { comments: false, annotations: false }) => {
  let i = 0, // pointer
    c, // current char
    q, // is string
    level = [], // current level
    buf = '', // current collected string
    comment = 0, // is comment
    $ // is id

  // push buffer onto level, reset buffer
  const commit = () => (
    // we try to store strings as raw bytes and ids as strings
    q ? level.push(str(buf)) :
    $ ? level.push('$' + tdec.decode(Uint8Array.from(str(buf)))) :
    buf && (!comment || o.comments) && level.push(buf),
    buf = '', $ = q = null
  )
  const next = () => buf += s[i++]

  const parseLevel = (parent = level) => {
    while (i < s.length) {
      c = s[i]
      // "...", $"..."
      if (q) {
        if (c === '\\') next(), next()
        else if (c === '"') i++, commit()
        else next()
      }
      // (;;)
      else if (comment > 0) {
        next()
        if (c === '(' && s[i] === ';') next(), comment++ // (;(;;);)
        else if (c === ';' && s[i] === ')') next(), comment == 1 && (commit(), comment--)
      }
      // ;;
      else if (comment < 0) {
        next()
        if (c === '\n' || c === '\r') commit(), comment = 0
      }
      // https://webassembly.github.io/annotations/core/text/lexical.html#white-space
      else if (c <= ' ') commit(), i++
      else if (c === '$' && !$) $ = 1, i++
      else if (c === '"') !$ && commit(), q = 1, i++
      else if (c === '(') {
        commit()
        if (s[i + 1] === ';') next(), next(), comment = 1 // (; ... ;)
        else {
          i++, level = [] // parent is saved on entry
          parseLevel()
          if (s[i++] !== ')') err(`Unbalanced syntax`)
          if (level[0]?.[0] === '@' && !o.annotations); else parent.push(level) // (@...)
          level = parent
        }
      }
      else if (c === ')') return commit()
      else if (c === ';' && s[i + 1] === ';') commit(), next(), next(), comment = -1  // ;; ...
      else next()
    }

    commit()
  }

  parseLevel()
  // if (i < s.length) err(`Unbalanced syntax`)

  return level.length > 1 ? level : level[0] || []
}



// const escape = { n: 10, r: 13, t: 9, '"': 34, "'": 39, '\\': 92 }
const escape = { n: '\n', r: '\r', t: '\t', '"':'"', "'": "'", '\\': '\\' }

// convert string to bytes sequence
const str = s => {
  let bytes = [], i = 0, code, c, buf = ''

  const commit = () => (buf && bytes.push(...tenc.encode(buf)), buf = '')

  while (i < s.length) {
    c = s[i++], code = 0

    if (c === '\\') {
      // \u{abcd}
      if (s[i] === 'u') {
        i++, i++ // 'u{'
        c = String.fromCodePoint(parseInt(s.slice(i, i = s.indexOf('}', i)), 16))
        i++ // '}'
      }
      // \n, \t, \r
      else if (escape[s[i]]) c = escape[s[i++]]
      // \00 - raw bytes
      else if (!isNaN(code = parseInt(s[i] + s[i + 1], 16))) i++, i++
      // \*
      else c += s[i]
    }

    code ? (commit(), bytes.push(code)) : buf += c
  }
  commit()

  return bytes
}
