/**
 * Throws an error with optional source position.
 * Uses err.src for source and err.loc for default position.
 * If pos provided or err.loc set, appends "at line:col".
 *
 * @param {string} text - Error message
 * @param {number} [pos] - Byte offset in source (defaults to err.loc)
 * @throws {Error}
 */
export const err = (text, pos=err.loc) => {
  if (pos != null && err.src) {
    let line = 1, col = 1
    for (let i = 0; i < pos && i < err.src.length; i++) {
      if (err.src[i] === '\n') line++, col = 1
      else col++
    }
    text += ` at ${line}:${col}`
  }
  throw Error(text)
}

/**
 * Deep clone an array tree structure.
 * @param {Array} items - Array to clone
 * @returns {Array} Cloned array
 */
export const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)

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
