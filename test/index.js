import './parse.js'
import './compile.js'
import './print.js'
import './bench.js'

// stub fetch for local purpose
const isNode = typeof global !== 'undefined' && globalThis === global
if (isNode) {
  let { readFileSync } = await import('fs')
  globalThis.fetch = async path => {
    path = `.${path}`
    const data = readFileSync(path, 'utf8')
    return { text() { return data } }
  }
}
