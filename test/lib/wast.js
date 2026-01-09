// Wrapper for _wast.cjs that works in both Node.js and browser
let WebAssemblyText

if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js - use createRequire to load CJS
  const { createRequire } = await import('module')
  const req = createRequire(import.meta.url)
  WebAssemblyText = req('./_wast.cjs').WebAssemblyText
} else {
  // Browser - fetch and eval the CJS script
  if (typeof globalThis.WebAssemblyText === 'undefined') {
    const code = await (await fetch(new URL('./_wast.cjs', import.meta.url))).text()
    new Function(code)()
  }
  WebAssemblyText = globalThis.WebAssemblyText
}

export default WebAssemblyText
