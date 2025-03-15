/**
 * Parses a wasm text string and constructs a nested array structure (AST).
 *
 * @param {string} str - The input string with WAT code to parse.
 * @param {object} options - Parse options, like comments, annotations, etc.
 * @returns {Array} An array representing the nested syntax tree (AST).
 */
export default (str, o={ comments: false, annot: false }) => {
  let i = 0, level = [], buf = '', comment = ''

  const commit = () => buf && (
    level.push(buf),
    buf = ''
  )

  const parseLevel = () => {
    for (let c, root, q; i < str.length;) {

      c = str[i]
      if (q) {
        buf += str[i]
        if (str[i++] === '\\') buf += str[i++]
        else if (c === '"') commit(), q = 0
      }
      else if (c === '"') {
        commit(), q = c, buf += str[i++]
      }
      else if (c === '(') {
        if (str[i+1] === ';') comment = str.slice(i, i = str.indexOf(';)', i) + 2), o.comments && level.push(comment) // (; ... ;)
        else commit(), i++, (root = level).push(level = []), parseLevel(), level = root
      }
      else if (c === ';' && str[i+1] === ';') comment = str.slice(i, i = str.indexOf('\n', i) + 1 || str.length), o.comments && level.push(comment)  // ; ...
      else if (c <= ' ') commit(), i++
      else if (c === ')') return commit(), i++
      else buf += str[i++]
    }

    commit()
  }

  parseLevel()

  return level.length > 1 ? level : level[0]
}
