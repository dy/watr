import { ESCAPE } from './const.js'

export const err = text => { throw Error(text) }

export const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)

export const sepRE = /^_|_$|[^\da-f]_|_[^\da-f]/i

export const intRE = /^[+-]?(?:0x[\da-f]+|\d+)$/i

export const tenc = new TextEncoder();
export const tdec = new TextDecoder('utf-8', { fatal: true });

// build string binary - convert WAT string to byte array
export const str = (...parts) => {
  let s = parts.map(s => s[0] === '"' ? s.slice(1, -1) : s).join(''), res = []

  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c === 92) { // backslash
      let n = s[i + 1]
      // \u{...} unicode - decode and UTF-8 encode
      if (n === 'u' && s[i + 2] === '{') {
        let hex = s.slice(i + 3, i = s.indexOf('}', i + 3))
        res.push(...tenc.encode(String.fromCodePoint(parseInt(hex, 16))))
        // i now points to '}', loop i++ will move past it
      }
      // Named escape
      else if (ESCAPE[n]) {
        res.push(ESCAPE[n])
        i++ // skip the named char, loop i++ will move past backslash
      }
      // \xx hex byte (raw byte, not UTF-8 decoded)
      else {
        res.push(parseInt(s.slice(i + 1, i + 3), 16))
        i += 2 // skip two hex digits, loop i++ will complete the skip
      }
    }
    // Multi-byte char - UTF-8 encode
    else if (c > 255) {
      res.push(...tenc.encode(s[i]))
    }
    // Raw byte
    else res.push(c)
  }
  return res
}

/**
 * Unescapes a WAT string literal by parsing escapes to bytes, then UTF-8 decoding.
 * Reuses str() for escape parsing to eliminate duplication.
 *
 * @param {string} s - String with quotes and escapes, e.g. '"hello\\nworld"'
 * @returns {string} Unescaped string without quotes, e.g. 'hello\nworld'
 */
export const unescape = s => new TextDecoder().decode(new Uint8Array(str(s)))
