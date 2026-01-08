// Wrapper for _wast.cjs that works in both Node.js and browser
let WebAssemblyText

if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js - use createRequire to load CJS
  const { createRequire } = await import('module')
  const req = createRequire(import.meta.url)
  WebAssemblyText = req('./_wast.cjs').WebAssemblyText
} else {
  // Browser - the CJS file should have already set globalThis.WebAssemblyText
  // via a <script> tag or synchronous loading mechanism
  if (typeof globalThis.WebAssemblyText === 'undefined') {
    throw new Error('WebAssemblyText not loaded. Please load _wast.cjs before importing this module.')
  }
  WebAssemblyText = globalThis.WebAssemblyText
}

export default WebAssemblyText
