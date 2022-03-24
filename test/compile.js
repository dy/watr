import t, { is, ok, same } from 'tst'
import compile from '../src/compile.js'

t.only('compile: empty', t => {
  is(compile(['module']), hex`
    00 61 73 6d
    01 00 00 00
  `)
})

t('compile: (module (func))', t => {
  let {binary} = compile(tree)
  is(binary, hex`
    00 61 73 6d 01 00 00 00  01 04 01 60 00 00 03 02
    01 00 0a 04 01 02 00 0b
  `)
})

t('compile: (module (memory 1) (func))', t => {
  let {binary} = compile(tree)
  is(binary, hex`
    00 61 73 6d 01 00 00 00 01 04 01 60 00 00 03 02
    01 00 05 03 01 00 01 0a 04 01 02 00 0b
  `)
})

t('compile: (module (memory (import "js" "mem") 1) (func))', t => {
  let {binary} = compile(tree)
  is(binary, hex`
    00 61 73 6d 01 00 00 00 01 04 01 60 00 00 02 0b
    01 02 6a 73 03 6d 65 6d 02 00 01 03 02 01 00 0a
    04 01 02 00 0b
  `)
})

t('compile: export mem/func', t => {
  // (module
  //   (memory 1)
  //   (func (param i32 i32) (result i32)
  //     local.get 0
  //     local.get 1
  //     i32.store
  //     local.get 1
  //   )
  //   (export "m" (memory 0 ))
  //   (export "f" (func 0 ))
  // )
  is(binary, hex`
    00 61 73 6d 01 00 00 00 01 07 01 60 02 7f 7f 01
  7f 03 02 01 00 05 03 01 00 01 07 09 02 01 6d 02
  00 01 66 00 00 0a 0d 01 0b 00 20 00 20 01 36 02
  00 20 01 0b `)
})

const hex = (str, ...fields) =>
  new Uint8Array(
    String.raw.call(null, str, fields)
    .trim()
    .split(/[\s\n]+/)
    .map(n => parseInt(n, 16))
  )
