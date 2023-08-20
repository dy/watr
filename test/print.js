import t, { is, ok, same } from 'tst'
import print from '../src/print.js'
import { wat2wasm, file } from './compile.js'

t.only('print: basics', () => {
  const tree = [
    'func', ['export', '"double"'], ['param', 'f64', 'f32'], ['param', '$x', 'i32'], ['result', 'f64'],
    ['f64.mul', ['local.get', 0], ['f64.const', 2]]
  ]

  // minify
  const min = print(tree, {
    indent: false,
    newline: false,
    pad: false,
    comments: false
  })
  wat2wasm(min)
  is(min, `(func (export "double")(param f64 f32)(param $x i32)(result f64)(f64.mul(local.get 0)(f64.const 2)))`)

  // pretty-print
  const pretty = print(tree, {
    indent: '  ',   // indentation characters
    newline: '\n',  // new line charactes
    pad: '',        // pad start of each line with a string
    comments: true  // keep comments
  })
  wat2wasm(pretty)
  is(pretty,
    `(func (export "double")
  (param f64 f32)(param $x i32)
  (result f64)
  (f64.mul
    (local.get 0)
    (f64.const 2)))`)

  is(
    print(`(import "Math" "random" (func $random (result f32)))`),
    `(import \"Math\" \"random\"(func $random (result f32)))`
  )
})

t.only('print: dino', async t => {
  let src = await file('./example/dino.wat')
  const dino = print(src)
  console.log(dino)

  wat2wasm(dino)
})