import { err } from "./util.js"

/**
 * Parses a wasm text string and constructs a nested array structure (AST).
 * Each array node has `.loc` property with source offset for error reporting.
 *
 * @param {string} str - The input string with WAT code to parse.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */
export default (str) => {
  let i = 0, level = [], buf = '', q = 0, depth = 0

  const commit = () => buf && (level.push(buf), buf = '')

  const parseLevel = (pos) => {
    level.loc = pos // store start position for error reporting
    for (let c, root, p; i < str.length;) {
      c = str.charCodeAt(i)

      // inside "..." or $"..."
      if (q === 34) (buf += str[i++], c === 92 ? buf += str[i++] : c === 34 && (commit(), q = 0))
      // inside (; ... ;) with nesting support (q=60 means depth 1, q=61 means depth 2, etc)
      else if (q > 59) (
        c === 40 && str.charCodeAt(i + 1) === 59 ? (q++, buf += str[i++] + str[i++]) : // nested (;
        c === 59 && str.charCodeAt(i + 1) === 41 ? (buf += str[i++] + str[i++], --q === 59 && (commit(), q = 0)) : // ;)
        buf += str[i++]
      )
      // inside ;; ...\n
      else if (q < 0) (c === 10 || c === 13 ? (buf += str[i++], commit(), q = 0) : buf += str[i++])
      // start "
      else if (c === 34) (buf !== '$' && commit(), q = 34, buf += str[i++])
      // start (;
      else if (c === 40 && str.charCodeAt(i + 1) === 59) (commit(), q = 60, buf = str[i++] + str[i++])
      // start ;;
      else if (c === 59 && str.charCodeAt(i + 1) === 59) (commit(), q = -1, buf = str[i++] + str[i++])
      // start (@
      else if (c === 40 && str.charCodeAt(i + 1) === 64) (commit(), p = i, i += 2, buf = '@', depth++, (root = level).push(level = []), parseLevel(p), level = root)
      // start (
      else if (c === 40) (commit(), p = i++, depth++, (root = level).push(level = []), parseLevel(p), level = root)
      // end )
      else if (c === 41) return commit(), i++, depth--
      // whitespace
      else if (c <= 32) (commit(), i++)
      // other
      else buf += str[i++]
    }

    q < 0 && commit() // trailing line comment
    commit()
  }

  parseLevel(0)

  if (q === 34) err(`Unclosed quote`, i)
  if (q > 59) err(`Unclosed block comment`, i)
  if (depth > 0) err(`Unclosed parenthesis`, i)
  if (i < str.length) err(`Unexpected closing parenthesis`, i)

  return level.length > 1 ? level : level[0] || []
}
