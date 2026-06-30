/**
 * WebAssembly Text Format (WAT) compiler, parser, printer.
 *
 * @module watr
 */

import _compile from './src/compile.js'
import parse from './src/parse.js'
import print from './src/print.js'
import { compile as _tcompile, watr as _twatr } from './src/template.js'

/** JS-source backend primitives for the tagged-template layer.
 *  `polyfill` and `optimize` are intentionally NOT wired here — they're heavy
 *  (the optimizer alone is ~5× the core encoder) and ship as separate entries,
 *  `watr/polyfill` and `watr/optimize`, that you compose explicitly:
 *  `compile(optimize(src))`. This keeps the default bundle minimal. */
const backend = { parse, compile: _compile }

/**
 * Compile WAT to binary. Supports both string and template literal.
 *
 * @param {string|TemplateStringsArray} source - WAT source or template strings
 * @param {...any} values - Interpolation values (for template literal).
 * @returns {Uint8Array} WebAssembly binary
 *
 * @example
 * compile('(func (export "f") (result i32) (i32.const 42))')
 * compile`(func (export "f") (result f64) (f64.const ${Math.PI}))`
 * // transforms ship as separate entries — compose them:
 * // import optimize from 'watr/optimize'
 * // compile(optimize(src))
 */
function compile(source, ...values) {
  return _tcompile(backend, source, values)
}

/**
 * Compile and instantiate WAT, returning exports.
 *
 * @param {string|TemplateStringsArray} source - WAT source or template strings
 * @param {...any} values - Interpolation values (for template literal)
 * @returns {WebAssembly.Exports} Module exports
 *
 * @example
 * const { add } = watr`(func (export "add") (param i32 i32) (result i32)
 *   (i32.add (local.get 0) (local.get 1))
 * )`
 */
function watr(source, ...values) {
  return _twatr(backend, source, values)
}

export default watr
export { watr, compile, parse, print }
