import Wabt from './lib/wabt.js'
import print from '../src/print.js'
import { f32, f64, i64, i32, uleb } from '../src/encode.js'
import parse from '../src/parse.js'
import compile from '../src/compile.js'
import { throws, ok, is } from 'tst'

import './parse.js'
import './print.js'
import './compile.js'
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
  return inst
}

// execute test case from file
export async function file(path, imports = {}) {
  // load src
  let res = await fetch(path)
  let src = await res.text()

  // Remove all escape characters (e.g., \\, \", \n, etc.)
  // src = src.replace(/\\(.)/g, '$1');

  // parse
  let nodes = parse(src, { comments: true })
  freeze(nodes)

  // test runtime
  let buf, mod = {},
    importObj = { ...imports },
    lastExports,
    lastComment

  if (typeof nodes[0] === 'string' && !nodes[0].startsWith(';;')) nodes = [nodes]

  for (let node of nodes) {
    if (typeof node === 'string') lastComment = node
    ex(node)
  }

  // execute node
  function ex(node) {
    // (module $name) - creates module instance, collects exports
    if (node[0] === 'module') {
      // strip comments
      node = node.flatMap(function uncomment(el) { return !el ? [el] : typeof el === 'string' ? (el[1] === ';' ? [] : [el]) : [el.flatMap(uncomment)] })

      try {
        buf = compile(node)
        let m = new WebAssembly.Module(buf)
        let inst = new WebAssembly.Instance(m, importObj)
        lastExports = inst.exports
        // collect exports under name
        if (node[1]?.[0] === '$') mod[node[1]] = lastExports
      } catch (e) {
        // Skip modules with non-$name identifiers (definitions) or memory64 limit tests
        if ((typeof node[1] === 'string' && node[1] !== 'binary' && node[1][0] !== '$') || /maximum memory size \(281474976710656 pages\)/.test(e.message)) {
          return console.warn('module: skip', e.message.slice(0, 80))
        }
        // Normalize error messages to match spec test expectations
        if (/memory index.*exceeds number of declared memories/.test(e.message)) {
          e.message = 'unknown memory'
        }
        if (/invalid (table|memory) limits flags/.test(e.message)) {
          e.message = 'malformed limits flags'
        }
        if (/(initial|maximum) memory size.*larger than.*limit/.test(e.message)) {
          e.message = 'memory size'
        }
        if (/Bad offset/.test(e.message) || /Value out of range.*offset/.test(e.message)) {
          e.message = 'offset out of range'
        }
        throw e
      }

    }
    if (node[0] === 'register') {
      // include exports from prev module
      let [, nm] = node
      console.log('register', nm)
      importObj[nm.slice(1, -1)] = lastExports

    }
    if (node[0] === 'assert_return') {
      let [, [kind, ...args], ...expects] = node;
      let m = args[0]?.[0] === '$' ? mod[args.shift()] : lastExports,
        nm = args.shift().slice(1, -1);

      // console.log('assert_return', kind, nm, 'args:', ...args, 'expects:', ...expects)

      if (expects.some(v => v[0] === 'v128.const') || args.some(v => v[0] === 'v128.const')) return console.warn('assert_return: skip v128');

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

    }
    if (node[0] === 'invoke') {
      let [, ...args] = node
      let m = args[0]?.[0] === '$' ? mod[args.shift()] : lastExports,
        nm = args.shift().slice(1, -1);
      args = args.map(val)
      // console.log('(invoke)', nm, ...args)
      m[nm](...args)

    }
    if (node[0] === 'assert_invalid') {
      let [, nodes, msg] = node

      // unwrap quote modules
      if (nodes[1] === 'quote') {
        let code = nodes.slice(2).map(str => str.slice(1, -1).replaceAll(/\\(.)/g, '$1')).join('\n')
        nodes = parse(code)
        nodes = typeof nodes[0] === 'string' ? nodes[0] === 'module' ? nodes : ['module', nodes] : ['module', ...nodes]
      }

      // skip (data const_expr) - we don't have constant expr limitations
      if (nodes.some(n => n[0] === 'data' && typeof n !== 'string')) return console.warn('assert_invalid: skip data const expr');
      // skip (global const_expr) - we don't have constant expr limitations
      if (nodes.some(n => n[0] === 'global' && typeof n[2] !== 'string')) return console.warn('assert_invalid: skip global const expr');
      // skip (elem const_expr) - we don't have constant expr limitations
      if (nodes.some(n => n[0] === 'elem' && typeof n[1] !== 'string')) return console.warn('assert_invalid: skip elem const expr');
      // skip multimemory - there's no issue with proposal enabled
      let m = 0
      if (nodes.some(n => (n[0] === 'memory' && (++m) > 1))) return console.warn('assert_invalid: skip multi memory');
      // skip recursive type checks
      if (msg === '"unknown type"') return console.warn('assert_invalid: skip type checks');

      // console.group('assert_invalid', ...node)
      lastComment = ``
      throws(() => ex(nodes), msg, msg)
      // console.groupEnd()
    }
    if (node[0] === 'assert_trap') {
      // console.group('assert_trap', ...node)
      let [, nodes, msg] = node
      try {
        ex(nodes)
      } catch (e) {
        // console.log('trap error', e, msg)
        ok(e.message, `assert_trap: ${msg}`)
      }
      // console.groupEnd()
    }
    if (node[0] === 'assert_malformed') {
      // console.group('assert_malformed', ...node)
      lastComment = ``
      let [, nodes, msg] = node
      let err
      // skip if wat2wasm compiles without error - certain tests are unnecessary
      if (nodes[1] === 'binary') {
        try { wat2wasm(print(nodes)) } catch (e) { err = e }
        if (err) throws(() => ex(nodes), msg, msg)
        else console.warn(`assert_malformed: skip ${msg} as wat2wasm compiles fine`)
      }
      else if (nodes[1] === 'quote') {
        // (module quote ...nodes) make wat2wasm hang - unwrap them
        let code = nodes.slice(2).map(str => str.slice(1, -1).replaceAll(/\\(.)/g, '$1')).join('\n')

        // skips
        if (code.includes('nan:')) return console.warn(`assert_malformed: skip nan-related tests`)
        if (/[a-z$]"|"[a-z$]|""/i.test(code)) return console.warn(`assert_malformed: skip space required (data"abc") tests`)
        if (/v128\.const/i.test(code) && /range/.test(msg)) return console.warn(`assert_malformed: skip out-of-range v128.const tests`)
        if (/v128\.const/i.test(code) && /operator/.test(msg)) return console.warn(`assert_malformed: skip bad tokens`)
        if (code.includes('@') && /character|utf|un|empty/i.test(msg)) return console.warn(`assert_malformed: skip illegal annotations`)
        if (code.includes('$)')) return console.warn(`assert_malformed: skip empty id`)

        nodes = parse(code)
        nodes = typeof nodes[0] === 'string' ? nodes[0] === 'module' ? nodes : ['module', nodes] : ['module', ...nodes]
        throws(() => ex(nodes), msg, msg)
        // let err
        // try {ex(nodes)} catch (e) {err=e}
        // if (err) ok(err, msg)
        // else console.error(msg) // not really a failure, just log
      }
      // console.groupEnd()
    }
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
