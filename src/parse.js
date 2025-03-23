
/**
 * Parses (lexes) a WASM text string into tree of tokens without semantics yet.
 *
 * @param {string} s - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */

import { err } from "./util.js"

const escape = { n: 10, r: 13, t: 9, '"': 34, "'": 39, '\\': 92 }
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export default (s, o = { comments: false, annotations: false }) => {
  let i = 0, // pointer
    c, // current char
    q, // is quote
    $, // is identifier
    level = [], // current level
    buf = '', // current collected string
    comment = 0 // is comment

  // push buffer onto level, reset buffer
  const commit = () => buf && (
    $ && !q && (buf += '"'), // $xxx -> $"xxx"
    (!comment || o.comments) && level.push(buf),
    buf = '', $ = 0
  )
  const next = () => buf += s[i++]

  const parseLevel = (parent = level) => {
    while (i < s.length) {
      c = s[i]
      // "...", $"..."
      if (q) {
        // \u{abcd}
        if (c === '\\' && s[i + 1] === 'u') {
          i++, i++, i++; // 'u{'
          buf += String.fromCodePoint(parseInt(s.slice(i, i = s.indexOf('}', i)), 16));
          i++; // '}'
        }
        // \n, \t, \r
        else if (c === '\\' && escape[s[i + 1]]) i++, buf += String.fromCodePoint(escape[s[i++]])
        // \xx - raw bytes
        // we split string if binary chunk is not convertible to unicode, eg. "123\ca\cb456" -> "123" "\ca\cb" "456"
        // for names and exports it cannot be non-unicode, for data it is easier to detect raw strings
        // FIXME: try making it shorter
        else if (c === '\\' && !isNaN(parseInt(s[i + 1] + s[i + 2], 16))) {
          let from = i, raw
          while (s[i] === '\\' && !isNaN(parseInt(s[i + 1] + s[i + 2], 16))) i += 3;
          raw = s.slice(from, i)
          // try handling bytes to unicode
          try { buf += textDecoder.decode(str(raw)) }
          // if failed - insert a separate string with raw bytes only
          catch { buf != '"' && (buf += '"', commit()), buf = `"${raw}"`, commit(), s[i] === '"' ? (i++, q = 0) : buf = '"' }
        }
        else next(), c === '"' && (commit(), q = 0)
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
      else if (c === '$') next(), !$ && s[i] !== '"' && (buf += '"'), $ = 1
      else if (c === '"') q = 1, buf !== '$' && commit(), next()
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
