/**
 * Tagged-template `compile` / `watr` over swappable backend primitives.
 *
 * The tagged-template entry point (`.raw` detection), interpolated function
 * imports, and `new WebAssembly.Module` instantiation are JS-host concerns the
 * wasm boundary cannot express — so they live here, once, backend-agnostic.
 * watr.js wires the JS-source backend; the wasm test runner wires wasm exports.
 *
 * jz constraint: backend primitives must be destructured into locals before
 * being called — jz miscompiles a direct `backend.fn()` property call, and
 * cannot host these as a nested factory closure. Hence top-level functions
 * taking `backend` as a plain argument.
 *
 * @module watr/template
 */

import { resultType } from './const.js'

/** Private Use Area character as placeholder for interpolation */
const PUA = '\uE000'

/**
 * Apply a backend transform (`polyfill`/`optimize`), or throw an actionable
 * pointer when this entry doesn't bundle it. The default `watr` build wires a
 * lean backend (parse + compile) and leaves the heavy transforms to their own
 * entries, so `compile(src, { optimize })` here directs you to compose instead.
 *
 * @param {Function|undefined} fn - transform from the backend
 * @param {string} name - 'polyfill' | 'optimize'
 * @param {Array} ast
 * @param {any} opt - the option value
 * @returns {Array} transformed AST
 */
function applyTransform(fn, name, ast, opt) {
  if (typeof fn !== 'function')
    throw Error(`watr: '${name}' is not bundled in this entry \u2014 import it from 'watr/${name}' and compose: compile(${name}(src))`)
  return fn(ast, opt)
}

/**
 * Infer type of an expression AST node.
 * Used for auto-import parameter type inference.
 *
 * @param {any} node - AST node (array or primitive)
 * @param {Object} [ctx={}] - Context with locals/funcs type info
 * @returns {string|null} Type string or null if unknown
 */
const exprType = (node, ctx = {}) => {
  if (!Array.isArray(node)) {
    // local.get $x - lookup type
    if (typeof node === 'string' && node[0] === '$' && ctx.locals?.[node]) return ctx.locals[node]
    return null
  }
  const [op, ...args] = node
  // (i32.const 42) → i32
  const rt = resultType(op)
  if (rt) return rt
  // (local.get $x) → lookup
  if (op === 'local.get' && ctx.locals?.[args[0]]) return ctx.locals[args[0]]
  // (call $fn ...) → lookup function result type
  if (op === 'call' && ctx.funcs?.[args[0]]) return ctx.funcs[args[0]].result?.[0]
  return null
}

/**
 * Walk AST and transform nodes depth-first.
 * Handles array splicing when child has `_splice` property.
 *
 * @param {any} node - AST node to walk
 * @param {Function} fn - Transform function (node) => node
 * @returns {any} Transformed node
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
 * Find function references in AST and infer import signatures.
 * Scans for `(call fn args...)` where fn is a JS function,
 * infers param types from arguments, generates import entries.
 *
 * @param {Array} ast - AST to scan
 * @param {Function[]} funcs - Functions to look for
 * @returns {Array<{idx: number, name: string, params: string[], fn: Function}>} Import entries
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
 * Generate WAT import declarations from inferred imports.
 *
 * @param {Array<{name: string, params: string[]}>} imports - Import entries
 * @returns {Array} AST nodes for import declarations
 */
function genImports(imports) {
  return imports.map(({ name, params }) =>
    ['import', '"env"', `"${name.slice(1)}"`, ['func', name, ...params.map(t => ['param', t])]]
  )
}

/**
 * Compile WAT to binary. Supports string, AST, and tagged template.
 *
 * @param {Object} backend - { parse, compile, optimize, polyfill } primitives
 * @param {string|Array|TemplateStringsArray} source - WAT source, AST, or template strings
 * @param {any[]} values - Interpolation values (for template literal)
 *   Last value can be options object:
 *   - polyfill: true | 'funcref sign_ext' | { funcref: true }
 *   - optimize: true | 'fold treeshake' | { fold: true }
 * @returns {Uint8Array} WebAssembly binary
 */
export function compile(backend, source, values) {
  // Destructure into locals: jz miscompiles a direct backend.fn() call.
  const { parse, compile: emit, optimize, polyfill } = backend

  // Options object as last argument (non-template call)
  let opts = {}
  if (!Array.isArray(source) && values.length && typeof values[values.length - 1] === 'object' && values[values.length - 1] !== null && !values[values.length - 1].byteLength) {
    opts = values.pop()
  }

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
        if (value?.byteLength !== undefined) return [...value]
        // BigInt can't cross the wasm boundary as a value, and watr's i32
        // encoder rejects it — a decimal string parses back for both i32/i64.
        if (typeof value === 'bigint') return value.toString()
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

    // Apply transforms (heavy passes live in separate entries — see applyTransform)
    if (opts.polyfill) ast = applyTransform(polyfill, 'polyfill', ast, opts.polyfill)
    if (opts.optimize) ast = applyTransform(optimize, 'optimize', ast, opts.optimize)

    const binary = emit(ast)
    // Attach imports for watr() to use
    if (importObjs) binary._imports = importObjs
    return binary
  }

  // String/AST source with options
  if (opts.polyfill || opts.optimize) {
    let ast = typeof source === 'string' ? parse(source) : source
    if (opts.polyfill) ast = applyTransform(polyfill, 'polyfill', ast, opts.polyfill)
    if (opts.optimize) ast = applyTransform(optimize, 'optimize', ast, opts.optimize)
    return emit(ast)
  }
  return emit(source)
}

/**
 * Compile and instantiate WAT, returning exports.
 *
 * @param {Object} backend - { parse, compile, optimize, polyfill } primitives
 * @param {string|Array|TemplateStringsArray} source - WAT source, AST, or template strings
 * @param {any[]} values - Interpolation values (for template literal)
 * @returns {WebAssembly.Exports} Module exports
 */
export function watr(backend, source, values) {
  const binary = compile(backend, source, values)
  const module = new WebAssembly.Module(binary)
  const instance = new WebAssembly.Instance(module, binary._imports)
  return instance.exports
}
