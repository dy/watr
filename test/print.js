import t, { is, ok, same } from 'tst'
import print from '../src/print.js'
import parse from '../src/parse.js'
import compile from '../src/compile.js'

t('print: basics', () => {
  const tree = [
    'func', ['export', '"double"'], ['param', 'f64', 'f32'], ['param', '$"x"', 'i32'], ['result', 'f64'],
    ['f64.mul', ['local.get', 0], ['f64.const', 2]]
  ]

  // minify
  const min = print(tree, {
    indent: false,
    newline: false
  })
  is(min, `(func(export "double")(param f64 f32)(param $"x" i32)(result f64)(f64.mul(local.get 0)(f64.const 2)))`)

  // pretty-print
  const pretty = print(tree, {
    indent: '  ',   // indentation characters
    newline: '\n',  // new line charactes
  })
  is(pretty,
    `(func\n  (export \"double\")\n  (param f64 f32)\n  (param $\"x\" i32)\n  (result f64)\n  (f64.mul (local.get 0) (f64.const 2))\n)`)

  is(
    print(`(import "Math" "random" (func $random (result f32)))`, { newline: '', indent: '' }),
    `(import \"Math\" \"random\"(func $"random"(result f32)))`
  )
})

t('print: nice inlines', t => {
  is(print(`(local.set 3
  (i64.const 0))`, {
    indent: '  ',
    newline: '\n'
  }), `(local.set 3 (i64.const 0))`)
})

t('print: comments - inline block comments', () => {
  const src = '(an (; inline ;) comment 1)'
  
  // without comments flag - should strip comments
  is(print(src, { indent: '', newline: '' }), '(an comment 1)')
  
  // with comments flag - should preserve comments
  is(print(src, { indent: '', newline: '', comments: true }), '(an (; inline ;) comment 1)')
  
  // with pretty printing
  const pretty = print(src, { indent: '  ', newline: '\n', comments: true })
  is(pretty, '(an (; inline ;) comment 1\n)')
})

t('print: comments - line comments', () => {
  const src = '(an comment\n;; line comment\n1)'
  
  // without comments flag
  is(print(src, { indent: '', newline: '', comments: false }), '(an comment 1)')
  
  // with comments flag - line comments always need newline (even minified)
  is(print(src, { indent: '', newline: '', comments: true }), '(an comment ;; line comment\n1)')
  
  // with pretty printing - line comments need newline after
  const pretty = print(src, { indent: '  ', newline: '\n', comments: true })
  is(pretty, `(an comment ;; line comment\n1\n)`)
})

t('print: comments - mixed comments', () => {
  const src = `(func
  ;; This is a function
  (param i32)
  (; block comment ;)
  (result i32)
  ;; Return the param
  (local.get 0)
)`
  
  // without comments
  const noComments = print(src, { indent: '  ', newline: '\n', comments: false })
  is(noComments, `(func\n  (param i32)\n  (result i32)\n  (local.get 0)\n)`)
  
  // with comments
  const withComments = print(src, { indent: '  ', newline: '\n', comments: true })
  ok(withComments.includes(';; This is a function'))
  ok(withComments.includes('(; block comment ;)'))
  ok(withComments.includes(';; Return the param'))
})

t('print: comments - nested structures with comments', () => {
  const src = `(module
  ;; Memory section
  (memory 1)
  ;; Function section
  (func $add (; inline ;) (param i32 i32) (result i32)
    ;; Add two numbers
    (i32.add (local.get 0) (local.get 1))
  )
)`
  
  const withComments = print(src, { indent: '  ', newline: '\n', comments: true })
  ok(withComments.includes(';; Memory section'))
  ok(withComments.includes(';; Function section'))
  ok(withComments.includes('(; inline ;)'))
  ok(withComments.includes(';; Add two numbers'))
  
  const noComments = print(src, { indent: '  ', newline: '\n', comments: false })
  ok(!noComments.includes(';;'))
  ok(!noComments.includes('(;'))
})

t('print: comments - roundtrip with comments', () => {
  const src = '(func (; example ;) (param i32) ;; takes int\n(result i32) ;; returns int\n(local.get 0))'
  
  // Parse with comments, print with comments
  const tree = parse(src, { comments: true })
  const output = print(tree, { indent: '  ', newline: '\n', comments: true })
  
  // Parse the output again with comments
  const tree2 = parse(output, { comments: true })
  const output2 = print(tree2, { indent: '  ', newline: '\n', comments: true })
  
  // Should be stable
  is(output, output2)
})

t('print: doesnt break samples', async t => {
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
    let res = await fetch(path)
    let src = await res.text()
    const dino = print(src)
    ok(parse(dino), path)
  }
})
