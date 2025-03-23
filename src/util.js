
export const err = text => { throw Error(text) }

export const clone = items => items.map(item => Array.isArray(item) ? clone(item) : item)

export const sepRE = /^_|_$|[^\da-f]_|_[^\da-f]/i

export const intRE = /^[+-]?(?:0x[\da-f]+|\d+)$/i

// convert string into sequence of bytes
const textEncoder = new TextEncoder()
export const str = s => s[0] === '\\' ? s.split('\\').slice(1).map(v => parseInt(v, 16)) : textEncoder.encode(str)
