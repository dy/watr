import { err } from "./util.js"

/**
 * Parses a wasm text string and constructs a nested array structure (AST).
 *
 * @param {string} str - The input string with WAT code to parse.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */
export default (str) => {
  let i = 0, level = [], buf = '', q = 0

  const commit = () => buf && (level.push(buf), buf = '')

  const parseLevel = () => {
    for (let c, root; i < str.length;) {
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
      else if (c === 40 && str.charCodeAt(i + 1) === 64) (commit(), i += 2, buf = '@', (root = level).push(level = []), parseLevel(), level = root)
      // start (
      else if (c === 40) (commit(), i++, (root = level).push(level = []), parseLevel(), level = root)
      // end )
      else if (c === 41) return commit(), i++
      // whitespace
      else if (c <= 32) (commit(), i++)
      // other
      else buf += str[i++]
    }

    q < 0 && commit() // trailing line comment
    commit()
  }

  parseLevel()

  if (q === 34) err(`Unclosed quote`)
  if (i < str.length) err(`Unexpected closing parenthesis`)

  return level.length > 1 ? level : level[0] || []
}
