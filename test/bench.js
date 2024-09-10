import t, { is } from 'tst'
import { file } from './compile.js'
import watr from '../src/compile.js'
import Wabt from './lib/wabt.js'
import watCompiler from './lib/wat-compiler.js'
import wassemble from 'wassemble/wassemble.mjs'
import { wat2wasm } from './compile.js'


// bench
t.skip('bench: brownian', async () => {
  // example.ts
  let src = await file('/test/example/brownian.wat')
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

  console.time('watr')
  for (let i = 0; i < N; i++) watr(src)
  console.timeEnd('watr')

  console.time('wat-compiler')
  for (let i = 0; i < N; i++) watCompiler(src, { metrics: false })
  console.timeEnd('wat-compiler')

  console.time('wabt')
  for (let i = 0; i < N; i++) wat2wasm(src, { metrics: false })
  console.timeEnd('wabt')

  // console.time('wassemble')
  // for (let i = 0; i < N; i++) wassemble(src)
  // console.timeEnd('wassemble')
})
