export const err = text => { throw Error(text) }

export const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)

export const sepRE = /^_|_$|[^\da-f]_|_[^\da-f]/i

export const intRE = /^[+-]?(?:0x[\da-f]+|\d+)$/i

export const tenc = new TextEncoder();
export const tdec = new TextDecoder('utf-8', { fatal: true });



const escape = { n: 10, r: 13, t: 9, '"': 34, "'": 39, '\\': 92 }

// convert string literal (with quotes) to bytes sequence, attach valueOf returning original string
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
