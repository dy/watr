
/**
 * Parses a wasm text string and constructs a nested array structure (AST).
 *
 * @param {string} str - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */

export default (str, o={ comments: false, annotations: false }) => {
  let i = 0, level = [], buf = '', comment

  // push buffer onto level stack, reset buffer
  const commit = () => buf && (
    level.push(buf),
    buf = ''
  )

  // push one character to buffer, make sure it's legal
  const push = () => buf += str[i++]

  const parseLevel = () => {
    for (let c, root, q; i < str.length;) {

      c = str[i]
      if (q) {
        push()
        if (str[i-1] === '\\') push()
        else if (c === '"') commit(), q = 0
      }
      else if (c === '"') {
        commit(), q = c, push()
      }
      else if (c === '(') {
        commit(), i++
        if (str[i] === ';') comment = str.slice(i-1, i = str.indexOf(';)', i) + 2), o.comments && level.push(comment) // (; ... ;)
        else {
          root = level, level = []
          parseLevel()
          if (level[0]?.[0] === '@' && !o.annotations); else
          root.push(level)
          level = root
        }
      }
      else if (c === ';' && str[i+1] === ';') commit(), comment = str.slice(i, i = str.indexOf('\n', i) + 1 || str.length), o.comments && level.push(comment)  // ; ...
      else if (c <= ' ') commit(), i++
      else if (c === ')') return commit(), i++
      else push()
    }

    commit()
  }

  parseLevel()

  return level.length > 1 ? level : level[0]
}
