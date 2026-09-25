import { err } from "./util.js"

/**
 * Parses a wasm text string and constructs a nested array structure (AST).
 * Each array node has `.loc` property with source offset for error reporting.
 *
 * @param {string} str - The input string with WAT code to parse.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */
export default (str) => {
  let i = 0, level = [], start = -1, q = 0, depth = 0

  // Tokens preserve their source spelling, including quotes and comments.
  const commit = () => start < 0 || (level.push(str.slice(start, i)), start = -1)

  const parseLevel = (pos) => {
    level.loc = pos // store start position for error reporting
    for (let c, root, p; i < str.length;) {
      c = str.charCodeAt(i)

      // inside "..." or $"..."
      if (q === 34) (i++, c === 92 ? i++ : c === 34 && (commit(), q = 0))
      // inside (; ... ;) with nesting support (q=60 means depth 1, q=61 means depth 2, etc)
      else if (q > 59) (
        c === 40 && str.charCodeAt(i + 1) === 59 ? (q++, i += 2) : // nested (;
        c === 59 && str.charCodeAt(i + 1) === 41 ? (i += 2, --q === 59 && (commit(), q = 0)) : // ;)
        i++
      )
      // inside ;; ..\n: q=-1 normal (has newline), q=-2 inline (no newline — ) ends comment)
      else if (q < 0) (
        c === 10 || c === 13 ? (i++, commit(), q = 0) :
        q === -2 && c === 41 ? (commit(), q = 0) :
        i++
      )
      // start "
      else if (c === 34) ((start !== i - 1 || str.charCodeAt(start) !== 36) && commit(), start < 0 && (start = i), q = 34, i++)
      // start (;
      else if (c === 40 && str.charCodeAt(i + 1) === 59) (commit(), q = 60, start = i, i += 2)
      // start ;;
      else if (c === 59 && str.charCodeAt(i + 1) === 59) (commit(), q = str.indexOf('\n', i) < 0 ? -2 : -1, start = i, i += 2)
      // start (@
      else if (c === 40 && str.charCodeAt(i + 1) === 64) (commit(), p = i, start = i + 1, i += 2, depth++, (root = level).push(level = []), parseLevel(p), level = root)
      // start (
      else if (c === 40) (commit(), p = i++, depth++, (root = level).push(level = []), parseLevel(p), level = root)
      // end )
      else if (c === 41) return commit(), i++, depth--
      // whitespace
      else if (c <= 32) (commit(), i++)
      // other
      else (start < 0 && (start = i), i++)
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
