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
// polyfill/optimize are JS-only library transforms (watr.wasm is the bare
// encoder, and the default JS entry no longer bundles them), so both backends
// source them from JS src rather than from the main entry or wasm exports.
import optimize from '../src/optimize.js'
import polyfill from '../src/polyfill.js'

export const isWasm = !!(
  typeof process !== 'undefined' && process.env?.WATR_WASM ||
  (typeof globalThis !== 'undefined' && globalThis.WATR_WASM)
)

let compile, parse, print, watr

if (isWasm) {
  // the PACKAGED jz interop — its ABI must match the jz that built dist/watr.wasm
  const { instantiate } = await import('jz/interop')
  const wasmBytes = readFileSync(new URL('../dist/watr.wasm', import.meta.url))
  const { exports } = instantiate(wasmBytes, { memory: 4096 })

  // polyfill emits raw BigInt leaves (i64 sign_ext shifts, trunc_sat clamp
  // bounds, extended_const folds) — a plain BigInt can't cross the wasm
  // boundary as a value (jz's marshaler rejects it with no host-BigInt
  // evidence at that slot), so stringify same as template.js's PUA values:
  // a decimal string parses back to the same i64 on the other side.
  const unbig = node => Array.isArray(node) ? node.map(unbig) : typeof node === 'bigint' ? node.toString() : node

  parse = exports.parse
  print = (ast, ...rest) => exports.print(unbig(ast), ...rest)

  const backend = {
    parse,
    compile: ast => new Uint8Array(exports.compile(unbig(ast))),
    optimize,
    polyfill,
  }
  compile = (source, ...values) => tcompile(backend, source, values)
  watr = (source, ...values) => twatr(backend, source, values)
} else {
  ;({ compile, parse, print, default: watr } = await import('../watr.js'))
}

export { compile, parse, print, optimize, polyfill, watr }
export default watr
