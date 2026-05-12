/**
 * Swappable test runner: loads either watr.wasm (via jz runtime) or JS source.
 *
 * Usage:
 *   WATR_WASM=1 node test/compile.js    # run with wasm
 *   node test/compile.js                # run with JS source (default)
 *
 * In wasm mode, the `compile` / `watr` wrappers are reimplemented JS-side to
 * handle tagged-template detection (`source.raw` is lost across wasm) and
 * `new WebAssembly.Module` instantiation (jzify strips `new`, leaving a bare
 * call which throws). The wasm exports back the meat: parse, print, inner
 * compile, optimize, polyfill. Auto-import inference also runs JS-side because
 * function values held by the AST cannot survive being copied through wasm.
 */

import { readFileSync } from 'fs'

const isWasm = !!(
  typeof process !== 'undefined' && process.env?.WATR_WASM ||
  (typeof globalThis !== 'undefined' && globalThis.WATR_WASM)
)

let compile, parse, print, optimize, polyfill, watr

if (isWasm) {
  const { instantiate } = await import('../../jz/src/host.js')
  const wasmPath = new URL('../dist/watr.wasm', import.meta.url)
  const wasmBytes = readFileSync(wasmPath)

  const fakeCompile = () => wasmBytes
  const result = instantiate(fakeCompile, '', { memory: 4096 })

  const _wasmCompile = result.exports.compile
  parse = result.exports.parse
  print = result.exports.print
  optimize = result.exports.optimize
  polyfill = result.exports.polyfill

  // === JS-side tagged-template wrapper. Mirrors watr.js verbatim — only the
  // calls into compile/parse/optimize/polyfill are redirected at wasm exports.
  const PUA = ''

  const instrType = op => {
    if (!op || typeof op !== 'string') return null
    const prefix = op.split('.')[0]
    if (/^[if](32|64)|v128/.test(prefix)) return prefix
    if (/\.(eq|ne|[lg][te]|eqz)/.test(op)) return 'i32'
    if (op === 'memory.size' || op === 'memory.grow') return 'i32'
    return null
  }

  const exprType = (node, ctx = {}) => {
    if (!Array.isArray(node)) {
      if (typeof node === 'string' && node[0] === '$' && ctx.locals?.[node]) return ctx.locals[node]
      return null
    }
    const [op, ...args] = node
    if (instrType(op)) return instrType(op)
    if (op === 'local.get' && ctx.locals?.[args[0]]) return ctx.locals[args[0]]
    if (op === 'call' && ctx.funcs?.[args[0]]) return ctx.funcs[args[0]].result?.[0]
    return null
  }

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

  function inferImports(ast, funcs) {
    const imports = []
    const importMap = new Map()
    walk(ast, node => {
      if (!Array.isArray(node)) return node
      if (node[0] === 'call' && typeof node[1] === 'function') {
        const fn = node[1]
        if (!importMap.has(fn)) {
          const params = []
          for (let i = 2; i < node.length; i++) {
            const t = exprType(node[i])
            if (t) params.push(t)
          }
          const idx = imports.length
          const name = fn.name || `$fn${idx}`
          importMap.set(fn, { idx, name: name.startsWith('$') ? name : '$' + name, params, fn })
          imports.push(importMap.get(fn))
        }
        node[1] = importMap.get(fn).name
      }
      return node
    })
    return imports
  }

  const genImports = imports => imports.map(({ name, params }) =>
    ['import', '"env"', `"${name.slice(1)}"`, ['func', name, ...params.map(t => ['param', t])]]
  )

  compile = function (source, ...values) {
    let opts = {}
    if (!Array.isArray(source) && values.length && typeof values[values.length - 1] === 'object' && values[values.length - 1] !== null && !values[values.length - 1].byteLength) {
      opts = values.pop()
    }

    if (Array.isArray(source) && source.raw) {
      let src = source[0]
      for (let i = 0; i < values.length; i++) src += PUA + source[i + 1]

      let ast = parse(src)

      const funcsToImport = []
      let idx = 0
      ast = walk(ast, node => {
        if (node === PUA) {
          const value = values[idx++]
          if (typeof value === 'function') { funcsToImport.push(value); return value }
          if (typeof value === 'string' && (value[0] === '(' || /^\s*\(/.test(value))) {
            const parsed = parse(value)
            if (Array.isArray(parsed) && Array.isArray(parsed[0])) parsed._splice = true
            return parsed
          }
          if (value?.byteLength !== undefined) return [...value]
          // BigInt would be marshalled as UNDEF_NAN across the wasm boundary;
          // convert to string here so watr's i64/i32 encoders parse it back.
          if (typeof value === 'bigint') return value.toString()
          return value
        }
        return node
      })

      let importObjs = null
      if (funcsToImport.length) {
        const imports = inferImports(ast, funcsToImport)
        if (imports.length) {
          const importDecls = genImports(imports)
          if (ast[0] === 'module') ast.splice(1, 0, ...importDecls)
          else if (typeof ast[0] === 'string') ast = [...importDecls, ast]
          else ast.unshift(...importDecls)
          importObjs = { env: {} }
          for (const imp of imports) importObjs.env[imp.name.slice(1)] = imp.fn
        }
      }

      if (opts.polyfill) ast = polyfill(ast, opts.polyfill)
      if (opts.optimize) ast = optimize(ast, opts.optimize)

      const binary = new Uint8Array(_wasmCompile(ast))
      if (importObjs) binary._imports = importObjs
      return binary
    }

    if (opts.polyfill || opts.optimize) {
      let ast = typeof source === 'string' ? parse(source) : source
      if (opts.polyfill) ast = polyfill(ast, opts.polyfill)
      if (opts.optimize) ast = optimize(ast, opts.optimize)
      return new Uint8Array(_wasmCompile(ast))
    }
    return new Uint8Array(_wasmCompile(source))
  }

  watr = function (source, ...values) {
    const binary = compile(source, ...values)
    const module = new WebAssembly.Module(binary)
    const instance = new WebAssembly.Instance(module, binary._imports)
    return instance.exports
  }
} else {
  const watrMod = await import('../watr.js')
  compile = watrMod.compile
  parse = watrMod.parse
  print = watrMod.print
  optimize = watrMod.optimize
  polyfill = watrMod.polyfill
  watr = watrMod.default
}

export { compile, parse, print, optimize, polyfill, watr }
export default watr
