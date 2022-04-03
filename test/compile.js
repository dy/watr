import t, { is, ok, same } from 'tst'
import compile from '../src/compile.js'
import { hex, wat } from './lib/util.js'

// examples from https://ontouchstart.pages.dev/chapter_wasm_binary

t('compile: empty', t => {
  is(compile(['module']), hex`00 61 73 6d 01 00 00 00`)
})

t('compile: (module (func))', t => {
  let buffer
  is(compile(['module', ['func']]), buffer = hex`
    00 61 73 6d 01 00 00 00
    01 04 01  60 00 00         ; type section
    03 02 01  00               ; func section
    0a 04 01  02 00 0b         ; code section
  `)

  new WebAssembly.Module(buffer)
})

t('compile: (module (memory 1) (func))', t => {
  let buffer = hex`
    00 61 73 6d 01 00 00 00
    01 04 01  60 00 00       ; type
    03 02 01  00             ; func
    05 03 01  00 01          ; memory
    0a 04 01  02 00 0b       ; code
  `
  new WebAssembly.Module(buffer)

  is(compile(['module', ['memory', 1], ['func']]), buffer )
})

t('compile: (module (memory (import "js" "mem") 1) (func))', t => {
  let buffer = hex`
    00 61 73 6d 01 00 00 00
    01 04 01 60 00 00                       ; type
    02 0b 01 02 6a 73 03 6d 65 6d 02 00 01  ; import
    03 02 01 00                             ; func
    0a 04 01 02 00 0b                       ; code
  `
  new WebAssembly.Module(buffer)
  is(compile(['module', ['memory', ['import', 'js', 'mem'], 1], ['func']]), buffer)
})

t('compile: export mem/func', t => {
  let buffer = hex`
    00 61 73 6d 01 00 00 00
    01 07 01 60 02 7f 7f 01 7f                    ; type
    03 02 01 00                                   ; function
    05 03 01 00 01                                ; memory
    07 09 02 01 6d 02 00 01 66 00 00              ; export
    0a 0d 01 0b 00 20 00 20 01 36 02 00 20 01 0b  ; code
  `
  is(compile(['module',                                   // (module
    ['memory', 1],                                        //   (memory 1)
    ['func', ['param', 'i32', 'i32'], ['result', 'i32'],  //   (func (param i32 i32) (result i32)
      ['local.get', 0],                                   //     local.get 0
      ['local.get', 1],                                   //     local.get 1
      ['i32.store', ['align','4']],                           //     i32.store
      ['local.get', 1]                                    //     local.get 1
    ],                                                    //   )
    ['export', '"m"', ['memory', 0]],                       //   (export "m" (memory 0 ))
    ['export', '"f"', ['func', 0]],                         //   (export "f" (func 0 ))
  ]),                                                     // )
  buffer)

  new WebAssembly.Module(buffer)
})


t.todo('wat-compiler: reexport', () => {
  let src = `
    (export "f0" (func 0))
    (export "f1" (func 1))
    (import "math" "add" (func (param i32 i32) (result i32)))
    (func (param i32 i32) (result i32)
      (i32.sub (local.get 0) (local.get 1))
    )
  `
  console.log(wat(src))
  // let buffer = compile(parse(src))
  // is(buffer, wat(src).buffer)
  let {buffer}=wat(src)

  const math = { add: (a, b) => a + b }
  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod, {math})
  let {f0, f1} = instance.exports

  console.log(f0(3,1), f1(3,1))
})

