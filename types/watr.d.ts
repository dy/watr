export default watr;
/**
 * Compile and instantiate WAT, returning exports.
 *
 * @param {string|TemplateStringsArray} strings - WAT source string or template strings
 * @param {...any} values - Interpolation values (for template literal)
 * @returns {WebAssembly.Exports} Module exports
 *
 * @example
 * // Template literal
 * const { add } = watr`(func (export "add") (param i32 i32) (result i32)
 *   (i32.add (local.get 0) (local.get 1))
 * )`
 *
 * // Plain string
 * const { add } = watr('(func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))')
 */
export function watr(strings: string | TemplateStringsArray, ...values: any[]): WebAssembly.Exports;
/**
 * Compile WAT to binary. Supports both string and template literal.
 *
 * @param {string|TemplateStringsArray} source - WAT source or template strings
 * @param {...any} values - Interpolation values (for template literal)
 * @returns {Uint8Array} WebAssembly binary
 *
 * @example
 * compile('(func (export "f") (result i32) (i32.const 42))')
 * compile`(func (export "f") (result f64) (f64.const ${Math.PI}))`
 */
export function compile(source: string | TemplateStringsArray, ...values: any[]): Uint8Array;
import parse from './src/parse.js';
import print from './src/print.js';
export { parse, print };
//# sourceMappingURL=watr.d.ts.map