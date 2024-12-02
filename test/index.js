import './parse.js'
import './compile.js'
import './print.js'
import './bench.js'

// stub fetch for local purpose
const isNode = typeof global !== 'undefined' && globalThis === global
if (isNode) {
  let { readFileSync } = await import('fs')
  globalThis.fetch = async path => {
    const data = readFileSync(`.${path}`, 'utf8')
    return { text() { return data } }
  }
}

// redefine console.log to return last arg
console.tap = (...args) => (console.log(args), args.pop())

// render buffer as hex
console.hex = (d) => console.log((Object(d).buffer instanceof ArrayBuffer ? new Uint8Array(d.buffer) :
  typeof d === 'string' ? (new TextEncoder('utf-8')).encode(d) :
    new Uint8ClampedArray(d)).reduce((p, c, i, a) => p + (i % 16 === 0 ? i.toString(16).padStart(6, 0) + '  ' : ' ') +
      c.toString(16).padStart(2, 0) + (i === a.length - 1 || i % 16 === 15 ?
        ' '.repeat((15 - i % 16) * 3) + Array.from(a).splice(i - i % 16, 16).reduce((r, v) =>
          r + (v > 31 && v < 127 || v > 159 ? String.fromCharCode(v) : '.'), '  ') + '\n' : ''), ''));
