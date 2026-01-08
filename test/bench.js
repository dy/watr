import t, { is } from 'tst'
import watr from '../src/compile.js'
import watCompiler from './lib/wat-compiler.js'
import { wat2wasm } from './index.js'

// Load wast.cjs - works in both Node.js and browser
let WebAssemblyText
if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js - use CommonJS require
  const { createRequire } = await import('module')
  const req = createRequire(import.meta.url)
  WebAssemblyText = req('./lib/wast.cjs').WebAssemblyText
} else {
  // Browser - dynamic import sets globalThis.WebAssemblyText
  await import('./lib/wast.cjs')
  WebAssemblyText = globalThis.WebAssemblyText
}

// bench
t.only('bench: brownian', async () => {
  // example.ts
  let res = await fetch('/test/example/brownian.wat')
  let src = await res.text()
  // let src = `(module
  //   (func $dummy)
  //   (func (export "foo") (param i32) (result i32)
  //     (if (result i32) (local.get 0)
  //       (then (call $dummy) (i32.const 1))
  //       (else (call $dummy) (i32.const 0))
  //     )
  //   )
  // )`
  // is(watr(src), wassemble(src))


  let N = 500

  let start, elapsed, opsPerSec

  start = performance.now()
  for (let i = 0; i < N; i++) WebAssemblyText.encode(src, { metrics: false })
  elapsed = performance.now() - start
  opsPerSec = Math.round((N / elapsed) * 1000)
  console.log(`wast (spec): ${opsPerSec.toLocaleString()} op/s`)

  start = performance.now()
  for (let i = 0; i < N; i++) watr(src)
  elapsed = performance.now() - start
  opsPerSec = Math.round((N / elapsed) * 1000)
  console.log(`watr: ${opsPerSec.toLocaleString()} op/s`)

  start = performance.now()
  for (let i = 0; i < N; i++) watCompiler(src, { metrics: false })
  elapsed = performance.now() - start
  opsPerSec = Math.round((N / elapsed) * 1000)
  console.log(`wat-compiler: ${opsPerSec.toLocaleString()} op/s`)

  start = performance.now()
  for (let i = 0; i < N; i++) wat2wasm(src, { metrics: false })
  elapsed = performance.now() - start
  opsPerSec = Math.round((N / elapsed) * 1000)
  console.log(`wabt: ${opsPerSec.toLocaleString()} op/s`)

  // console.time('wassemble')
  // for (let i = 0; i < N; i++) wassemble(src)
  // console.timeEnd('wassemble')
})
