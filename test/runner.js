/**
 * Swappable test runner: loads either watr.wasm (via jz runtime) or JS source.
 *
 * Usage:
 *   WATR_WASM=1 node test/compile.js    # run with wasm
 *   node test/compile.js                # run with JS source (default)
 *
 * Both modes share src/template.js — the tagged-template wrapper that detects
 * `source.raw`, infers function-value imports, and runs `new WebAssembly.Module`,
 * since those are JS-host concerns the wasm boundary cannot express. Only the
 * backend primitives differ: wasm exports vs JS source. The wasm `compile`
 * export returns a marshalled array, rewrapped here as a Uint8Array.
 */

import { readFileSync } from 'fs'
import { compile as tcompile, watr as twatr } from '../src/template.js'

const isWasm = !!(
  typeof process !== 'undefined' && process.env?.WATR_WASM ||
  (typeof globalThis !== 'undefined' && globalThis.WATR_WASM)
)

let compile, parse, print, optimize, polyfill, watr

if (isWasm) {
  const { instantiate } = await import('../../jz/interop.js')
  const wasmBytes = readFileSync(new URL('../dist/watr.wasm', import.meta.url))
  const { exports } = instantiate(wasmBytes, { memory: 4096 })

  parse = exports.parse
  print = exports.print
  optimize = exports.optimize
  polyfill = exports.polyfill

  const backend = {
    parse,
    compile: ast => new Uint8Array(exports.compile(ast)),
    optimize,
    polyfill,
  }
  compile = (source, ...values) => tcompile(backend, source, values)
  watr = (source, ...values) => twatr(backend, source, values)
} else {
  ;({ compile, parse, print, optimize, polyfill, default: watr } = await import('../watr.js'))
}

export { compile, parse, print, optimize, polyfill, watr }
export default watr
