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
    pad: false
  })
  wat2wasm(min)
  is(min, `(func (export "double")(param f64 f32)(param $x i32)(result f64)(f64.mul(local.get 0)(f64.const 2)))`)

  // pretty-print
  const pretty = print(tree, {
    indent: '  ',   // indentation characters
    newline: '\n',  // new line charactes
    pad: ''        // pad start of each line with a string
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

t.only('print: doesnt break samples', async t => {
  const files = ['/test/example/malloc.wat',
    '/test/example/brownian.wat',
    '/test/example/fire.wat',
    '/test/example/quine.wat',
    '/test/example/metaball.wat',
    '/test/example/maze.wat',
    '/test/example/raytrace.wat',
    '/test/example/snake.wat',
    '/test/example/dino.wat',
    '/test/example/containers.wat',
    '/test/example/raycast.wat',
    '/test/example/amp.wat',
    '/test/example/global.wat',
    '/test/example/loops.wat',
    '/test/example/memory.wat',
    '/test/example/multivar.wat',
    '/test/example/stack.wat',
  ]
  for (let path of files) {
    let src = await file(path)
    const dino = print(src)
    wat2wasm(dino)
  }
})