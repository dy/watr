/**
 * WebAssembly Text Format (WAT) compiler, parser, printer.
 *
 * @module watr
 */

import _compile from './src/compile.js'
import parse from './src/parse.js'
import print from './src/print.js'
import _polyfill from './src/polyfill.js'
import _optimize from './src/optimize.js'
import { compile as _tcompile, watr as _twatr } from './src/template.js'

/** JS-source backend primitives for the tagged-template layer. */
const backend = { parse, compile: _compile, optimize: _optimize, polyfill: _polyfill }

/**
 * Compile WAT to binary. Supports both string and template literal.
 *
 * @param {string|TemplateStringsArray} source - WAT source or template strings
 * @param {...any} values - Interpolation values (for template literal).
 *   Last value can be an options object: { polyfill, optimize }.
 * @returns {Uint8Array} WebAssembly binary
 *
 * @example
 * compile('(func (export "f") (result i32) (i32.const 42))')
 * compile`(func (export "f") (result f64) (f64.const ${Math.PI}))`
 * compile(src, { polyfill: true, optimize: true })
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
export { watr, compile, parse, print, _polyfill as polyfill, _optimize as optimize }
