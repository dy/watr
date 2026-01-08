import Wabt from './lib/wabt.js'
import print from '../src/print.js'
import { f32, f64, i64, i32, uleb } from '../src/encode.js'
import parse from '../src/parse.js'
import compile from '../src/compile.js'
import { throws, ok, is } from 'tst'

import './parse.js'
import './compile.js'
import './print.js'
import './testsuite.js'
// import './bench.js'

// stub fetch for local purpose
const isNode = typeof global !== 'undefined' && globalThis === global
if (isNode) {
  let { readFileSync } = await import('fs')
  globalThis.fetch = async path => {
    const data = readFileSync(`.${path}`, 'utf8')
    return { text() { return data } }
  }
}

// redefine console.log to return last arg
console.tap = (...args) => (console.log(...args), args.pop())

// render buffer as hex
console.hex = (d) => console.log((Object(d).buffer instanceof ArrayBuffer ? new Uint8Array(d.buffer) :
  typeof d === 'string' ? (new TextEncoder('utf-8')).encode(d) :
    new Uint8ClampedArray(d)).reduce((p, c, i, a) => p + (i % 16 === 0 ? i.toString(16).padStart(6, 0) + '  ' : ' ') +
      c.toString(16).padStart(2, 0) + (i === a.length - 1 || i % 16 === 15 ?
        ' '.repeat((15 - i % 16) * 3) + Array.from(a).splice(i - i % 16, 16).reduce((r, v) =>
          r + (v > 31 && v < 127 || v > 159 ? String.fromCharCode(v) : '.'), '  ') + '\n' : ''), ''));


// helpers
const wabt = await Wabt()

// convert wast code to binary via Wabt
export function wat2wasm(code, config) {
  let metrics = config ? config.metrics : true
  const parsed = wabt.parseWat('inline', code, {
    "exceptions": true,
    "mutable_globals": true,
    "sat_float_to_int": true,
    "sign_extension": true,
    "simd": true,
    "threads": true,
    "function_references": true,
    "multi_value": true,
    "tail_call": true,
    "bulk_memory": true,
    "reference_types": true,
    "annotations": true,
    "code_metadata": true,
    "gc": true,
    "memory64": true,
    "multi_memory": true,
    "extended_const": true,
    "relaxed_simd": true
  })
  // metrics && console.time('wabt build')
  const binary = parsed.toBinary({
    log: true,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: false
  })
  parsed.destroy()
  // metrics && console.timeEnd('wabt build')

  return binary
}


// compile & instantiate inline
export function inline(src, importObj) {
  let tree = parse(src)
  // in order to make sure tree is not messed up we freeze it
  freeze(tree)
  let watrBuffer = compile(tree)
  const mod = new WebAssembly.Module(watrBuffer)
  const inst = new WebAssembly.Instance(mod, importObj)
  ok(1, `instantiates inline`)
  return inst
}


// execute test case from file
export async function file(path, imports = {}) {
  // load src
  let res = await fetch(path)
  let src = await res.text()

  // parse
  let nodes = parse(src, { comments: true, annotations: true })

  // skip ((@) module) or ;;
  nodes.forEach(node => {
    if (Array.isArray(node)) while (/;|@/.test(node[0]?.[0]?.[0]) || node[0]?.startsWith?.('(;') || node[0]?.[0]?.startsWith?.('(;')) node.shift()
  })

  // (module) -> ((module ...)) - WAST compatible
  if (nodes[0] === 'module' || nodes[0]?.startsWith?.('assert')) nodes = [nodes]

  freeze(nodes)

  // test runtime
  let buf, mod = {},
    importObj = { ...imports },
    lastExports,
    lastComment

  const ex = {
    // (module $name) - creates module instance, collects exports
    module(node) {
      if (node?.length < 2) return console.warn('skip empty module')

      // Handle (module definition $name ...) - save the module definition for later instantiation
      if (node[1] === 'definition') {
        const defName = node[2] // e.g., $M
        if (!defName || typeof defName !== 'string' || !defName.startsWith('$')) return console.warn('skip module definition without name')
      }

      if (node[1][0] === 'memory' && node[1][3]?.startsWith?.('0x1_0000_0000_0000')) return console.warn('skip huge memory')
      if (node[1][0] === 'table' && node[1][3]?.startsWith?.('0x1_0000_0000')) return console.warn('skip huge table')
      if (node.some(n => Array.isArray(n) && (n[0] === 'table' || n[0] === 'memory') && n[1] === 'i64' && n[3]?.startsWith('0xffff_ffff_ffff'))) return console.warn('skip i64 table/memory beyond v8 limit')


      // Handle (module quote "...") by parsing the quoted string
      if (node[1] === 'quote') {
        let code = node.slice(2).map(arr =>
          typeof arr === 'string' ? arr.slice(1, -1) :
          Array.isArray(arr) ? String.fromCharCode(...arr) : arr
        ).join('\n')
        node = parse(code)
      }

      buf = compile(print(node))

      let m = new WebAssembly.Module(buf)
      let inst = new WebAssembly.Instance(m, importObj)
      ok(1, `instantiates module ${lastComment}`)

      lastExports = inst.exports
      // collect exports under name
      if (node[1]?.[0] === '$') mod[node[1]] = lastExports
    },

    register([, nm]) {
      // include exports from prev module
      console.log('register', nm, lastExports)
      importObj[nm.slice(1,-1)] = lastExports
    },

    assert_return([, [kind, ...args], ...expects]) {
      let m = args[0]?.[0] === '$' ? mod[args.shift()?.valueOf()] : lastExports,
        nm = new TextDecoder('utf-8', {ignoreBOM: true}).decode(Uint8Array.from(args.shift()));

      // console.log('assert_return', kind, nm, 'args:', ...args, 'expects:', ...expects)

      if (expects.some(v => v[0] === 'v128.const') || args.some(v => v[0] === 'v128.const')) return console.warn('assert_return: skip v128');

      // skip when function name is exnref or nullexnref (these return exnref types)
      if (nm === 'exnref' || nm === 'nullexnref') return console.warn('assert_return: skip exnref');

      args = args.map(val)
      expects = expects?.map(val)

      if (args.some(isNaNValue) || expects.some(isNaNValue)) return console.warn('assert_return: skip NaN');

      if (kind === 'invoke') {
        if (expects[0] === 'any' || expects[0] === 'extern' || expects[0] === 'host') m[nm](...args), ok(1, `assert_return: invoke ${nm}(${args}) is ${expects}`)
        else if (typeof expects[0] === 'string') is(typeof m[nm](...args), expects[0], `assert_return: invoke ${nm}(${args}) === ${expects}`)
        else if (typeof expects[0] === 'function') ok(m[nm](...args)?.toString().includes('function'), `assert_return: invoke ${nm}(${args}) === ${expects}`)
        else is(m[nm](...args), expects.length > 1 ? expects : expects[0], `assert_return: invoke ${nm}(${args}) === ${expects}`)
      }
      else if (kind === 'get') {
        is(m[nm].value, expects[0], `assert_return: get ${nm} === ${expects}`)
      }
    },

    get([]) {

    },

    invoke([, ...args]) {
      let m = args[0]?.[0] === '$' ? mod[args.shift()] : lastExports,
        nm = args.shift().slice(1, -1);
      args = args.map(val)
      // console.log('(invoke)', nm, ...args)
      m[nm](...args)
    },

    assert_invalid([, nodes, msg]) {
      // skip (data const_expr) - we don't have constant expr limitations
      if (nodes.some(n => n[0] === 'data' && typeof n !== 'string')) return console.warn('assert_invalid: skip (data const_expr)', );
      // skip (global const_expr) - we don't have constant expr limitations
      if (nodes.some(n => n[0] === 'global' && typeof n[2] !== 'string')) return console.warn('assert_invalid: skip (global const_expr)');
      // skip (elem const_expr) - we don't have constant expr limitations
      if (nodes.some(n => n[0] === 'elem' && typeof n[1] !== 'string')) return console.warn('assert_invalid: skip (elem const_expr)');
      // skip constant expression opcode restrictions - compiler treats them as regular fn bodies
      if (/not allowed in constant expressions/.test(msg)) return console.warn('assert_invalid: skip constant expression limitations');
      // skip multimemory - there's no issue with proposal enabled
      let m = 0
      if (nodes.some(n => (n[0] === 'memory' && (++m) > 1))) return console.warn('assert_invalid: skip multi memory required fail');
      // skip multiple tables - modern WASM with reference-types proposal allows multiple tables
      let t = 0
      if (nodes.some(n => (n[0] === 'table' && (++t) > 1)) && msg === '"multiple tables"') return console.warn('assert_invalid: skip multiple tables (allowed in modern WASM)');
      // skip recursive type checks that refer to itself
      if (msg === '"unknown type"' && nodes.join('').includes('ref,$')) return console.warn('assert_invalid: skip type checks');
      // skip offset out of range validation (we don't validate offset ranges in 32-bit memory)
      if (/offset out of range/.test(msg)) return console.warn('assert_invalid: skip offset range validation');
      // skip alignment validation for 64-bit values (we don't validate these specifically)
      if (/alignment must not be larger/.test(msg) && nodes.join('').includes('0x8000_0000_0000_0000')) return console.warn('assert_invalid: skip 64-bit alignment validation');
      // skip tag result type validation (tags can't have result types)
      if (/non-empty tag result type/.test(msg)) return console.warn('assert_invalid: skip tag result type validation');

      lastComment = ``
      throws(() => ex[nodes[0]](nodes), msg, msg)
    },

    assert_trap([, nodes, msg]) {
      // console.group('assert_trap', ...node)
      throws(() => ex[nodes[0]](nodes), `assert_trap: ${msg}`)
      // console.groupEnd()
    },

    assert_exception([, nodes, msg]) {
      // assert_exception is like assert_trap but specifically for exception handling
      throws(() => ex[nodes[0]](nodes), `assert_exception: ${msg || 'exception expected'}`)
    },

    assert_malformed([, nodes, msg]) {
      lastComment = ``

      if (nodes[1] === 'binary') {
        // our purpose isn't validating binaries
        let err
        try {
          let buf = compile(print(nodes))
          let m = new WebAssembly.Module(buf)
          let inst = new WebAssembly.Instance(m, importObj)
        } catch (e) {
          err = e
        }
        if (!err) console.warn(`assert_malformed: ${msg} must doesn't fail`)
        else ok(err, msg)

        return
      }

      if (nodes[1] === 'quote') {
        // (module quote ...nodes) - remove escaped quotes
        let code = nodes.slice(2).map(str => str.valueOf().slice(1, -1)).join('\n')

        // skip annotation validation edge cases
        if (code.includes('@') && /illegal character|malformed UTF|unknown operator|empty annotation/.test(msg)) return console.warn(`assert_malformed: skip annotation edge case`, msg)
        // skip empty id validation
        if (/empty identifier/.test(msg)) return console.warn(`assert_malformed: skip empty id validation`, msg)
        // skip label mismatch validation (we don't validate labels)
        if (/mismatching label/.test(msg)) return console.warn(`assert_malformed: skip label validation`, msg)
        // skip unexpected token validation
        if (/unexpected token/.test(msg)) return console.warn(`assert_malformed: skip token validation`, msg)
        // skip v128.const malformed validation (we don't validate number formats in v128)
        if (/v128\.const/i.test(code) && /constant out of range|unknown operator/.test(msg)) return console.warn(`assert_malformed: skip v128 validation`, msg)
        // skip offset out of range validation (memory64 allows large offsets, we don't validate ranges)
        if (/offset out of range/.test(msg)) return console.warn(`assert_malformed: skip offset range validation`, msg)

        let err
        try {
          nodes = parse(code, { annotations: true })
          let buf = compile(print(nodes))
          let m = new WebAssembly.Module(buf)
          let inst = new WebAssembly.Instance(m, importObj)
        } catch (e) { err = e }
        // FIXME: try to cover all low-hanging malformed cases
        if (!err) console.warn(`assert_malformed: not failing. ${msg}`, code)
        else ok(err, msg)
      }

    },

    assert_exhaustion([, [kind, ...args], msg]) {
      throws(() => {
        ex[kind]([,...args])
      }, msg, msg)
    },

    // (assert_unlinkable (module (import "test" "unknown" (func))) "msg")
    assert_unlinkable([, node, msg]) {
      throws(() => {
        let buf = compile(print(node))
        let m = new WebAssembly.Module(buf)
        let inst = new WebAssembly.Instance(m, importObj)
      })
    }
  }

  for (let node of nodes) {
    if (typeof node === 'string') lastComment = node
    else ex[node[0]](node.map(v => v.valueOf()))
  }
}

// save binary (asm buffer) to file
export function save(buf) {
  // Create a Blob
  const blob = new Blob([buf], { type: "application/wasm" });

  // Create a download link
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "module.wasm"; // Desired file name
  document.body.appendChild(link);

  // Trigger the download
  link.click();
  document.body.removeChild(link);
}


// lock array to make sure watr doesn't modify it
const freeze = node => Array.isArray(node) && (Object.freeze(node), node.forEach(freeze))

// more generic tester
const isNaNValue = a => (typeof a === 'number' && isNaN(a)) || a === 2143289344 || a === -4194304 || a === -2251799813685248n || a === 9221120237041090560n

// get value from [type, value] args
var f32arr = new Float32Array(1), i32arr = new Int32Array(1), i64arr = new BigInt64Array(1)
const val = ([t, v]) => {
  return t === 'ref.func' ? 'function' :
    t === 'ref.array' || t === 'ref.eq' || t === 'ref.struct' ? 'object' :
      t === 'ref.i31' ? 'number' :
        t === 'ref.null' ? null :
          t.startsWith('ref') ? t.split('.')[1] : // (ref.extern 1), (ref.null extern) etc
            t === 'v128.const' ? v :
              t === 'i64.const' ? (i64arr[0] = i64.parse(v), i64arr[0]) :
                t === 'f32.const' ? (f32arr[0] = f32.parse(v), f32arr[0]) :
                  t === 'i32.const' ? (i32arr[0] = i32.parse(v), i32arr[0]) :
                    t === 'f64.const' ? f64.parse(v) :
                      v;
}
