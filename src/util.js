import { ESCAPE } from './const.js'

export const err = text => { throw Error(text) }

export const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)

export const sepRE = /^_|_$|[^\da-f]_|_[^\da-f]/i

export const intRE = /^[+-]?(?:0x[\da-f]+|\d+)$/i

/**
 * Unescapes a WAT string literal, removing quotes and decoding all escape sequences.
 * Handles: \n, \t, \r, \v, \", \', \\, \xx (hex bytes as UTF-8), \u{...} (unicode)
 *
 * @param {string} str - String with quotes and escapes, e.g. '"hello\\nworld"'
 * @returns {string} Unescaped string without quotes, e.g. 'hello\nworld'
 */
export const unescape = str => {
  // Remove surrounding quotes if present
  str = str[0] === '"' ? str.slice(1, -1) : str

  let res = '', i = 0
  while (i < str.length) {
    let c = str.charCodeAt(i)
    if (c === 92) { // backslash
      let n = str[i+1]
      // \u{...} unicode escape
      if (n === 'u' && str[i+2] === '{') {
        let hex = str.slice(i+3, i = str.indexOf('}', i+3))
        res += String.fromCodePoint(parseInt(hex, 16))
        i++
      }
      // Named escape
      else if (ESCAPE[n]) {
        res += String.fromCharCode(ESCAPE[n])
        i += 2
      }
      // \xx hex byte(s) - collect UTF-8 sequence and decode
      else {
        let bytes = []
        while (i < str.length && str[i] === '\\') {
          bytes.push(parseInt(str.slice(i+1, i+3), 16))
          i += 3
        }
        res += new TextDecoder().decode(new Uint8Array(bytes))
      }
    }
    else res += str[i++]
  }
  return res
}
