// Ambient source/position for err()'s "at line:col" suffix — set by assemble()
// as it walks a module (err.loc/err.src used to be expando properties on the
// `err` function itself; a self-hosted compile-clear-compile loop bump-allocates
// a HASH props table the first time a property lands on a function value, and
// that table dangles across an arena `_clear` between compiles — corrupting the
// SECOND self-host compile. Plain module-level `let`s are a global-set, not a
// dynamic-key write, so they carry no such table and are `_clear`-safe.
let errLoc, errSrc

/**
 * Throws an error with optional source position.
 * Uses the ambient errSrc for source and errLoc for default position.
 * If pos provided or errLoc set, appends "at line:col".
 *
 * @param {string} text - Error message
 * @param {number} [pos] - Byte offset in source (defaults to errLoc)
 * @throws {Error}
 */
export const err = (text, pos=errLoc) => {
  if (pos != null && errSrc) {
    let line = 1, col = 1
    for (let i = 0; i < pos && i < errSrc.length; i++) {
      if (errSrc.charCodeAt(i) === 10) line++, col = 1
      else col++
    }
    text += ` at ${line}:${col}`
  }
  throw Error(text)
}
// Accessors for the ambient position/source (compile.js is the only writer).
export const setErrLoc = (loc) => { errLoc = loc }
export const setErrSrc = (src) => { errSrc = src }
export const getErrLoc = () => errLoc
export const getErrSrc = () => errSrc

/** Regex to detect invalid underscore placement in numbers */
export const sepRE = /^_|_$|[^\da-f]_|_[^\da-f]/i

/** Regex to match valid integer literals (decimal or hex) */
export const intRE = /^[+-]?(?:0x[\da-f]+|\d+)$/i

const tenc = new TextEncoder();
const tdec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const escape = { n: 10, r: 13, t: 9, '"': 34, "'": 39, '\\': 92 }


/**
 * Convert WAT string literal (with quotes) to byte array.
 * Handles escape sequences: \n, \t, \r, \xx (hex), \u{xxxx} (unicode).
 * Attaches valueOf() returning original string for roundtrip.
 *
 * @param {string} s - String literal including quotes, e.g. '"hello\n"'
 * @returns {number[]} Byte array with valueOf() method
 */
export const str = s => {
  let bytes = [], i = 1, code, c, buf = '' // i=1 to skip opening quote

  const commit = () => (buf && bytes.push(...tenc.encode(buf)), buf = '')

  while (i < s.length - 1) { // -1 to skip closing quote
    c = s[i++], code = null

    if (c === '\\') {
      // \u{abcd}
      if (s[i] === 'u') {
        i++, i++ // 'u{'
        c = String.fromCodePoint(parseInt(s.slice(i, i = s.indexOf('}', i)), 16))
        i++ // '}'
      }
      // \n, \t, \r
      else if (escape[s[i]]) code = escape[s[i++]]
      // \00 - raw bytes
      else if (!isNaN(code = parseInt(s[i] + s[i + 1], 16))) i++, i++
      // \*
      else c += s[i]
    }
    code != null ? (commit(), bytes.push(code)) : buf += c
  }
  commit()

  bytes.valueOf = () => s
  return bytes
}


/**
 * Unescapes a WAT string literal by parsing escapes to bytes, then UTF-8 decoding.
 * Reuses str() for escape parsing to eliminate duplication.
 *
 * @param {string} s - String with quotes and escapes, e.g. '"hello\\nworld"'
 * @returns {string} Unescaped string without quotes, e.g. 'hello\nworld'
 */
export const unescape = s => tdec.decode(new Uint8Array(str(s)))


// AST traversal — every watr AST node is an s-expression array `[head, ...args]`.

/**
 * Deep clone an AST node.
 * @param {any} node
 * @returns {any}
 */
export const clone = (node) => Array.isArray(node) ? node.map(clone) : node

/**
 * Walk AST depth-first (pre-order), call fn on each node. Read-only.
 * @param {any} node
 * @param {Function} fn - (node, parent, idx) => void
 * @param {any} [parent]
 * @param {number} [idx]
 */
export const walk = (node, fn, parent, idx) => {
  fn(node, parent, idx)
  if (Array.isArray(node)) for (let i = 0; i < node.length; i++) walk(node[i], fn, node, i)
}

/**
 * Walk AST depth-first (post-order): children are visited before their parent.
 *
 * A node is replaced either way a callback chooses to express it:
 *   - return a new node — walkPost writes it into `parent[idx]`
 *   - mutate `parent[idx]` in place and return undefined — walkPost leaves it
 * so both the transforming (optimize) and mutating (polyfill) styles compose.
 *
 * @param {any} node
 * @param {Function} fn - (node, parent, idx) => newNode | undefined
 * @param {any} [parent]
 * @param {number} [idx]
 * @returns {any} The (possibly replaced) node
 */
export const walkPost = (node, fn, parent, idx) => {
  if (Array.isArray(node)) for (let i = 0; i < node.length; i++) walkPost(node[i], fn, node, i)
  const result = fn(node, parent, idx)
  if (result !== undefined && parent) parent[idx] = result
  return result !== undefined ? result : node
}
