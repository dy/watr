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

// Infer result type from instruction name
const instrType = op => {
  if (!op || typeof op !== 'string') return null
  // i32.add → i32, f64.const → f64, v128.load → v128
  const prefix = op.split('.')[0]
  if (/^[if](32|64)|v128/.test(prefix)) return prefix
  // comparisons return i32: .eq .ne .lt .gt .le .ge .eqz
  if (/\.(eq|ne|[lg][te]|eqz)/.test(op)) return 'i32'
  // memory.size/grow return i32
  if (op === 'memory.size' || op === 'memory.grow') return 'i32'
  return null
}

// Infer type of an expression node
const exprType = (node, ctx = {}) => {
  if (!Array.isArray(node)) {
    // local.get $x - lookup type
    if (typeof node === 'string' && node[0] === '$' && ctx.locals?.[node]) return ctx.locals[node]
    return null
  }
  const [op, ...args] = node
  // (i32.const 42) → i32
  if (instrType(op)) return instrType(op)
  // (local.get $x) → lookup
  if (op === 'local.get' && ctx.locals?.[args[0]]) return ctx.locals[args[0]]
  // (call $fn ...) → lookup function result type
  if (op === 'call' && ctx.funcs?.[args[0]]) return ctx.funcs[args[0]].result?.[0]
  return null
}

/**
 * Walk AST and transform nodes, handling array splicing
 */
function walk(node, fn) {
  node = fn(node)
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      let child = walk(node[i], fn)
      if (child?._splice) node.splice(i, 1, ...child), i += child.length - 1
      else node[i] = child
    }
  }
  return node
}

/**
 * Find function calls in AST and infer types for imported functions
 */
function inferImports(ast, funcs) {
  const imports = []
  const importMap = new Map() // fn → import index

  walk(ast, node => {
    if (!Array.isArray(node)) return node

    // Find (call ${fn} args...) where fn is a function
    if (node[0] === 'call' && typeof node[1] === 'function') {
      const fn = node[1]

      if (!importMap.has(fn)) {
        // Infer param types from arguments
        const params = []
        for (let i = 2; i < node.length; i++) {
          const t = exprType(node[i])
          if (t) params.push(t)
        }

        // Create import entry
        const idx = imports.length
        const name = fn.name || `$fn${idx}`
        importMap.set(fn, { idx, name: name.startsWith('$') ? name : '$' + name, params, fn })
        imports.push(importMap.get(fn))
      }

      // Replace function with import reference
      const imp = importMap.get(fn)
      node[1] = imp.name
    }

    return node
  })

  return imports
}

/**
 * Generate import declarations
 */
function genImports(imports) {
  return imports.map(({ name, params }) =>
    ['import', '"env"', `"${name.slice(1)}"`, ['func', name, ...params.map(t => ['param', t])]]
  )
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

    // Collect functions for auto-import
    const funcsToImport = []

    // Replace placeholders with actual values
    let idx = 0
    ast = walk(ast, node => {
      if (node === PUA) {
        const value = values[idx++]
        // Function → mark for import inference
        if (typeof value === 'function') {
          funcsToImport.push(value)
          return value // keep function reference for now
        }
        // String containing WAT code → parse and splice
        if (typeof value === 'string' && (value[0] === '(' || /^\s*\(/.test(value))) {
          const parsed = parse(value)
          if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
            parsed._splice = true
          }
          return parsed
        }
        // Uint8Array → convert to plain array for flat() compatibility
        if (value instanceof Uint8Array) return [...value]
        return value
      }
      return node
    })

    // If we have functions to import, infer and generate imports
    let importObjs = null
    if (funcsToImport.length) {
      const imports = inferImports(ast, funcsToImport)
      if (imports.length) {
        // Insert import declarations at start of module
        const importDecls = genImports(imports)
        if (ast[0] === 'module') {
          ast.splice(1, 0, ...importDecls)
        } else if (typeof ast[0] === 'string') {
          // Single top-level node like ['func', ...] - wrap in array with imports
          ast = [...importDecls, ast]
        } else {
          // Multiple top-level nodes like [['func', ...], ['func', ...]]
          ast.unshift(...importDecls)
        }
        // Build imports object for instantiation
        importObjs = { env: {} }
        for (const imp of imports) {
          importObjs.env[imp.name.slice(1)] = imp.fn
        }
      }
    }

    const binary = _compile(ast)
    // Attach imports for watr() to use
    if (importObjs) binary._imports = importObjs
    return binary
  }
  return _compile(source)
}

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
function watr(strings, ...values) {
  const binary = compile(strings, ...values)
  const module = new WebAssembly.Module(binary)
  const instance = new WebAssembly.Instance(module, binary._imports)
  return instance.exports
}

export default watr
export { watr, compile, parse, print }
