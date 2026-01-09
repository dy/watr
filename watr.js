/**
 * WebAssembly Text Format (WAT) compiler, parser, printer.
 *
 * @module watr
 */

import _compile from './src/compile.js'
import parse from './src/parse.js'
import print from './src/print.js'

// Private Use Area character as placeholder
const PUA = '\uE000'

/**
 * Walk AST and transform nodes, handling array splicing
 */
function walk(node, fn) {
  node = fn(node)
  if (Array.isArray(node)) {
    let result = []
    for (let i = 0; i < node.length; i++) {
      let child = walk(node[i], fn)
      // If child is marked for splicing (parsed code with multiple exprs), flatten it
      if (child && child._splice) {
        result.push(...child)
      } else {
        result.push(child)
      }
    }
    node.length = 0
    node.push(...result)
  }
  return node
}

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
function compile(source, ...values) {
  // Template literal: source is TemplateStringsArray
  if (Array.isArray(source) && source.raw) {
    // Build source with placeholders
    let src = source[0]
    for (let i = 0; i < values.length; i++) {
      src += PUA + source[i + 1]
    }

    // Parse to AST
    let ast = parse(src)

    // Replace placeholders with actual values
    let idx = 0
    ast = walk(ast, node => {
      if (node === PUA) {
        const value = values[idx++]
        // String containing WAT code → parse and splice
        if (typeof value === 'string' && (value[0] === '(' || /^\s*\(/.test(value))) {
          const parsed = parse(value)
          // Check if it's multiple top-level expressions (array of arrays)
          if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
            parsed._splice = true  // Mark for splicing
          }
          return parsed
        }
        // Uint8Array → convert to plain array for flat() compatibility
        if (value instanceof Uint8Array) return [...value]
        return value
      }
      return node
    })

    return _compile(ast)
  }
  return _compile(source)
}

/**
 * Compile and instantiate WAT, returning exports.
 *
 * @param {TemplateStringsArray} strings - Template strings
 * @param {...any} values - Interpolation values
 * @returns {WebAssembly.Exports} Module exports
 *
 * @example
 * const { add } = watr`(func (export "add") (param i32 i32) (result i32)
 *   (i32.add (local.get 0) (local.get 1))
 * )`
 */
function watr(strings, ...values) {
  const binary = compile(strings, ...values)
  const module = new WebAssembly.Module(binary)
  const instance = new WebAssembly.Instance(module)
  return instance.exports
}

export default watr
export { watr, compile, parse, print }
