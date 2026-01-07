import { unescape } from "./util.js"

const OPAREN = 40, CPAREN = 41, OBRACK = 91, CBRACK = 93, SPACE = 32, DQUOTE = 34, PERIOD = 46,
  _0 = 48, _9 = 57, SEMIC = 59, NEWLINE = 32, PLUS = 43, MINUS = 45, COLON = 58, BACKSLASH = 92, AT = 64


/**
 * Parses (lexes) a WASM text string into tree of tokens without semantics yet.
 *
 * @param {string} str - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */
export default (str, o={ comments: false }) => {
  let i = 0, level = [], buf = '', comment = ''

  const commit = () => buf && (
    level.push(buf),
    buf = ''
  )

  const parseLevel = () => {
    for (let c, root, q, id; i < str.length;) {

      c = str.charCodeAt(i)
      if (q) {
        buf += str[i++]
        if (c === BACKSLASH) buf += str[i++]
        else if (c === DQUOTE) id && (buf = '$' + unescape(buf)), commit(), q = id = 0
      }
      else if (c === DQUOTE) {
        q = c, id = buf == '$', !id && commit(), buf = '"', i++
      }
      else if (c === OPAREN) {
        if (str.charCodeAt(i + 1) === SEMIC) comment = str.slice(i, i = str.indexOf(';)', i) + 2), o.comments && level.push(comment) // (; ... ;)
        else if (str.charCodeAt(i + 1) === AT) commit(), i += 2, buf = '@', (root = level).push(level = []), parseLevel(), level = root // (@annotid ...)
        else commit(), i++, (root = level).push(level = []), parseLevel(), level = root
      }
      else if (c === SEMIC && str.charCodeAt(i + 1) === SEMIC) comment = str.slice(i, i = str.indexOf('\n', i) + 1 || str.length), o.comments && level.push(comment)  // ;; ...
      else if (c <= SPACE) commit(), i++
      else if (c === CPAREN) return commit(), i++
      else buf += str[i++]
    }

    commit()
  }

  parseLevel()

  return level.length > 1 ? level : level[0]
}
