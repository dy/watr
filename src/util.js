
export const err = text => { throw Error(text) }

export const sepRE = /^_|_$|[^\da-f]_|_[^\da-f]/i

export const intRE = /^[+-]?(?:0x[\da-f]+|\d+)$/i
