import t, { is, ok, same, throws } from 'tst'
import compile from '../src/compile.js'
import parse from '../src/parse.js'
import Wabt from '../lib/wabt.js'
import watCompiler from '../lib/wat-compiler.js'


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

  is(compile(['module', ['memory', 1], ['func']]), buffer)
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
  // let src = `
  //   (module
  //     (memory 1)
  //     (func)
  //     (export "m" (memory 0))
  //     (export "f" (func 0))
  //   )
  // `
  // console.log(wat2wasm(src))
  // is(wat2wasm(src).buffer, compile(parse(src)))
  is(compile(['module',                                   // (module
    ['memory', 1],                                        //   (memory 1)
    ['func', ['param', 'i32', 'i32'], ['result', 'i32'],  //   (func (param i32 i32) (result i32)
      // ['local.get', 0],                                   //     local.get 0
      // ['local.get', 1],                                   //     local.get 1
      // ['i32.store', ['align','4']],                           //     i32.store
      ['i32.store', 'align=4', ['local.get', 0], ['local.get', 1]],
      ['local.get', 1]                                    //     local.get 1
    ],                                                    //   )
    ['export', '"m"', ['memory', 0]],                       //   (export "m" (memory 0 ))
    ['export', '"f"', ['func', 0]],                         //   (export "f" (func 0 ))
  ]),                                                     // )
    buffer)

  new WebAssembly.Module(buffer)
})

t('compile: reexport', () => {
  let src = `
    (export "f0" (func 0))
    (export "f1" (func 1))
    (import "math" "add" (func (param i32 i32) (result i32)))
    (func (param i32 i32) (result i32)
      (i32.sub (local.get 0) (local.get 1))
    )
  `

  let { f0, f1 } = run(src, { math: { add(a, b) { return a + b } } }).exports
  is(f0(3, 1), 4)
  is(f1(3, 1), 2)
})

t('compile: memory $foo (import "a" "b" ) 1 2 shared', () => {
  let src = `(memory $foo (import "env" "mem") 1 2 shared)`
  run(src, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: 1 }) } })
})

t('compile: stacked syntax is supported', () => {
  let src = `
    (func (export "add") (param i32 i32) (result i32)
      (local.get 0)
      (local.get 1)
      (i32.add)
    )
  `

  let { add } = run(src).exports
  is(add(3, 1), 4)
})

t('compile: inline syntax is supported', () => {
  let src = `
    (func (export "add") (param i32 i32) (result i32)
      local.get 0
      local.get 1
      i32.add
    )
  `

  let { add } = run(src).exports
  is(add(5, 2), 7)
})


// wat-compiler
t('compile: minimal function', t => {
  run('(module (func (export "answer") (param i32)(result i32) (i32.add (i32.const 42) (local.get 0))))')
  // run(`(module (func (export "x") (param i32)(result i32) local.get 0 i32.const 42 i32.add))`)
})

t('compile: function with 1 param', t => {
  run('(func (export "answer") (param i32) (result i32) (local.get 0))')
})

t('compile: function with 1 param', () => {
  let { answer } = run(`
    (func (export "answer") (param i32) (result i32) (local.get 0))
  `).exports
  is(answer(42), 42)
})

t('compile: function with 2 params', () => {
  let { answer } = run(`
    (func (export "answer") (param i32 i32) (result i32)
      (i32.add (local.get 0) (local.get 1))
    )
  `).exports
  is(answer(20, 22), 42)
})

t('compile: function with 2 params 2 results', () => {
  let { answer } = run(`
    (func (export "answer") (param i32 i32) (result i32 i32)
      (i32.add (local.get 0) (local.get 1))
      (i32.const 666)
    )
  `).exports

  is(answer(20, 22), [42, 666])
})

t('compile: named function named param', () => {
  let { dbl } = run(`
    (func $dbl (export "dbl") (param $a i32) (result i32)
      (i32.add (local.get $a) (local.get $a))
    )
  `).exports

  is(dbl(21), 42)
})

t('compile: call function direct', () => {
  let { call_function_direct } = run(`
  (func $dbl (param $a i32) (result i32)
    (i32.add (local.get $a) (local.get $a))
  )
  (func (export "call_function_direct") (param $a i32) (result i32)
    (call $dbl (local.get $a))
  )
  `).exports
  is(call_function_direct(333), 666)
})

t('compile: function param + local', () => {
  let { add } = run(`
    (func (export "add") (param $a i32) (result i32)
      (local $b i32)
      (i32.add (local.get $a) (local.tee $b (i32.const 20)))
    )
  `).exports

  is(add(22), 42)
})

t('compile: call function indirect (table)', () => {
  let { call_function_indirect } = run(`
    (type $return_i32 (func (result i32)))
    (table 2 funcref)
      (elem (i32.const 0) $f1 $f2)
      (func $f1 (result i32)
        (i32.const 42))
      (func $f2 (result i32)
        (i32.const 13))
    (func (export "call_function_indirect") (param $a i32) (result i32)
      (call_indirect (type $return_i32) (local.get $a))
    )
  `).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})

t('compile: call function indirect (table) non zero indexed ref types', () => {
  let { call_function_indirect } = run(`
    (type $return_i32 (func (result i32)))
    (type $return_i64 (func (result i64)))
    (table 2 funcref)
      (elem (i32.const 0) $f1 $f2)
      (func $xx (result i32)
        (i32.const 42))
      (func $f1 (result i32)
        (i32.const 42))
      (func $f2 (result i32)
        (i32.const 13))
    (func (export "call_function_indirect") (param $a i32) (result i32)
      (call_indirect (type $return_i32) (local.get $a))
    )
  `).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})

t('compile: 1 global const (immutable)', () => {
  let { get } = run(`
    (global $answer i32 (i32.const 42))
    (func (export "get") (result i32)
      (global.get $answer)
    )
  `).exports

  is(get(), 42)
})

t('compile: 1 global var (mut)', () => {
  let { get } = run(`
    (global $answer (mut i32) (i32.const 42))
    (func (export "get") (result i32)
      (global.get $answer)
    )
  `).exports

  is(get(), 42)
})

t('compile: 1 global var (mut) + mutate', () => {
  let { get } = run(`
    (global $answer (mut i32) (i32.const 42))
    (func (export "get") (result i32)
      (global.set $answer (i32.const 777))
      (global.get $answer)
    )
  `).exports

  is(get(), 777)
})

t('compile: memory.grow', () => {
  run(`
    (memory 1)
    (func (export "main") (result i32)
      (memory.grow (i32.const 2))
    )
  `)
})

t('compile: local memory page min 1 - data 1 offset 0 i32', () => {
  let { get } = run(String.raw`
    (memory 1)
    (data (i32.const 0) "\2a")
    (func (export "get") (result i32)
      (i32.load (i32.const 0))
    )
  `).exports

  is(get(), 42)
})

t('compile: local memory page min 1 max 2 - data 1 offset 0 i32', () => {
  let { get } = run(String.raw`
    (memory 1 2)
    (data (i32.const 0) "\2a")
    (func (export "get") (result i32)
      (drop (i32.const 1))
      (drop (i32.const 2))
      (i32.load offset=0 align=4 (i32.const 0))
    )
  `).exports

  is(get(), 42)
})

t('compile: import function', () => {
  let src = `
    (import "math" "add" (func $add (param i32 i32) (result i32)))
    (func (export "call_imported_function") (result i32)
      (call $add (i32.const 20) (i32.const 22))
    )
  `
  let { call_imported_function } = run(src, { math: { add: (a, b) => a + b } }).exports

  is(call_imported_function(), 42)
})

t('compile: import memory 1', () => {
  run(`
    (import "env" "mem" (memory 1))
  `, { env: { mem: new WebAssembly.Memory({ initial: 1 }) } })
})

t('compile: import memory 1 2', () => {
  run(`
    (import "env" "mem" (memory 1 2))
  `, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1 }) } })
})

t('compile: import memory 1 2 shared', () => {
  run(`
    (import "env" "mem" (memory 1 2 shared))
  `, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: 1 }) } })
})

t('compile: import memory $foo 1 2 shared', () => run(`
  (import "env" "mem" (memory $foo 1 2 shared))
`, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: 1 }) } }))

t('compile: set a start function', () => {
  let src = `
    (global $answer (mut i32) (i32.const 42))
    (start $main)
    (func $main
      (global.set $answer (i32.const 666))
    )
    (func (export "get") (result i32)
      (global.get $answer)
    )
  `
  let { get } = run(src).exports

  is(get(), 666)
})

t('compile: if else', () => {
  let src1 = `
    (func $dummy)
    (func (export "foo") (param i32) (result i32)
      (if (result i32) (local.get 0)
        (then (call $dummy) (i32.const 1))
        (else (call $dummy) (i32.const 0))
      )
    )
  `, src2 = `
    (func $dummy)
    (func (export "foo") (param i32) (result i32)
      (local.get 0)
      if (result i32)
        (call $dummy)
        (i32.const 1)
      else
        (call $dummy)
        (i32.const 0)
      end
    )
  `
  // these are identical parts
  // console.log(wat2wasm(src1))
  // is(wat2wasm(src1).buffer, wat2wasm(src2).buffer)
  let { foo } = run(src1).exports
  is(foo(0), 0)
  is(foo(1), 1)
  let { foo: foo2 } = run(src2).exports
  is(foo2(0), 0)
  is(foo2(1), 1)
})

t('compile: block', () => {
  let src = `
    (func (export "answer") (result i32)
      (block (nop))
      (block (result i32) (i32.const 42))
    )
  `
  let { answer } = run(src).exports
  is(answer(), 42)
  is(answer(), 42)
})

t('compile: block multi', () => {
  let src = `
    (func $dummy)
    (func (export "multi") (result i32)
      (block (call $dummy) (call $dummy) (call $dummy) (call $dummy))
      (block (result i32) (call $dummy) (call $dummy) (call $dummy) (i32.const 8))
    )
  `
  let { multi } = run(src).exports
  is(multi(), 8)
  is(multi(), 8)

})

t('compile: br', () => {
  let src = `
    (global $answer (mut i32) (i32.const 42))
    (func $set
      (global.set $answer (i32.const 666))
    )
    (func (export "main") (result i32)
      (block (br 0) (call $set))
      (global.get $answer)
    )
  `

  let { main } = run(src).exports
  is(main(), 42)
  is(main(), 42)
})

t('compile: br mid', () => {
  let src = `
    (global $answer (mut i32) (i32.const 42))
    (func $set
      (global.set $answer (i32.const 666))
    )
    (func (export "main") (result i32)
      (block (call $set) (br 0) (global.set $answer (i32.const 0)))
      (global.get $answer)
    )
  `
  let { main } = run(src).exports
  is(main(), 666)
  is(main(), 666)
})

t('compile: block named + br', () => {
  let src = `
    (global $answer (mut i32) (i32.const 42))
    (func $set
      (global.set $answer (i32.const 666))
    )
    (func (export "main") (result i32)
      (block $outerer ;; 3
        (block $outer ;; 2
          (block $inner ;; 1
            (block $innerer ;; 0
              (call $set)
              (br 1)
            )
          )
          (global.set $answer (i32.const 0))
        )
      )
      (global.get $answer)
    )
  `
  // console.log(wat2wasm(src))
  let { main } = run(src).exports
  is(main(), 0)
  is(main(), 0)
})

t('compile: block named 2 + br', () => {
  let src = `
    (global $answer (mut i32) (i32.const 42))
    (func $set
      (global.set $answer (i32.const 666))
    )
    (func (export "main") (result i32)
      (block $outer
        (block $inner
          (call $set)
          (br $inner)
        )
        (block $inner2
          (global.set $answer (i32.const 444))
          (br $inner2)
        )
        (global.set $answer (i32.const 0))
      )
      (global.get $answer)
    )
  `
  let { main } = run(src).exports

  is(main(), 0)
  is(main(), 0)

})

t('compile: br_table', () => {
  let src = `
    (func (export "main") (param i32) (result i32)
      (block
        (block
          (br_table 1 0 (local.get 0))
          (return (i32.const 21))
        )
        (return (i32.const 20))
      )
      (i32.const 22)
    )
  `
  // console.log(wat2wasm(src))
  let { main } = run(src).exports
  is(main(0), 22)
  is(main(1), 20)
})

t('compile: br_table multiple', () => {
  let src = `
    (func (export "main") (param i32) (result i32)
      (block
        (block
          (block
            (block
              (block
                (br_table 3 2 1 0 4 (local.get 0))
                (return (i32.const 99))
              )
              (return (i32.const 100))
            )
            (return (i32.const 101))
          )
          (return (i32.const 102))
        )
        (return (i32.const 103))
      )
      (i32.const 104)
    )
  `
  let { main } = run(src).exports

  is(main(0), 103)
  is(main(1), 102)
  is(main(2), 101)
  is(main(3), 100)
  is(main(4), 104)
})

t('compile: loop', () => {
  let src = `
    (func (export "main") (result i32)
      (loop (nop))
      (loop (result i32) (i32.const 42))
    )
  `
  let { main } = run(src).exports
  is(main(), 42)
})

t('compile: break-value', () => {
  let src = `
    (func (export "main") (result i32)
      (block (result i32)
        (loop (result i32) (br 1 (i32.const 18)) (br 0) (i32.const 19))
      )
    )
  `
  // console.log(wat2wasm(src))
  let { main } = run(src).exports
  is(main(), 18)
  is(main(), 18)
})

t('compile: br_if', () => {
  let src = `
    (func (export "main") (result i32)
      (block (result i32)
        (loop (result i32)
          (br 1 (i32.const 18))
          (br 1 (i32.const 19))
          (drop (br_if 1 (i32.const 20) (i32.const 0)))
          (drop (br_if 1 (i32.const 20) (i32.const 1)))
          (br 1 (i32.const 21))
          (br_table 1 (i32.const 22) (i32.const 0))
          (br_table 1 1 1 (i32.const 23) (i32.const 1))
          (i32.const 21)
        )
      )
    )
  `
  let { main } = run(src).exports
  is(main(), 18)
})

t('compile: while', () => {
  let src = `
    (func (export "main") (param i32) (result i32)
      (local i32)
      (local.set 1 (i32.const 1))
      (block
        (loop
          (br_if 1 (i32.eqz (local.get 0)))
          (local.set 1 (i32.mul (local.get 0) (local.get 1)))
          (local.set 0 (i32.sub (local.get 0) (i32.const 1)))
          (br 0)
        )
      )
      (local.get 1)
    )
  `
  let { main } = run(src).exports
  is(main(), 1)
})

t('compile: select', () => {
  let src = `
    (func (export "main") (result i32)
      (select (loop (result i32) (i32.const 1)) (i32.const 2) (i32.const 3))
    )
  `
  let { main } = run(src).exports
  is(main(), 1)
})

t('compile: select mid', () => {
  let src = `
    (func (export "main") (result i32)
      (select (i32.const 2) (loop (result i32) (i32.const 1)) (i32.const 3))
    )
  `
  let { main } = run(src).exports
  is(main(), 2)
})

t('compile: block labels', () => {
  let src = `
    (func (export "main") (result i32)
      (block $exit (result i32)
        (br $exit (i32.const 1))
        (i32.const 0)
      )
    )
  `
  let { main } = run(src).exports
  is(main(), 1)
})

t('compile: loop labels', () => {
  let src = `
    (func (export "main") (result i32)
      (local $i i32)
      (local.set $i (i32.const 0))
      (block $exit (result i32)
        (loop $cont (result i32)
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (if (i32.eq (local.get $i) (i32.const 5))
            (then (br $exit (local.get $i)))
          )
          (br $cont)
        )
      )
    )
  `
  // console.log(wat2wasm(src))
  let { main } = run(src).exports
  is(main(), 5)
})

t('compile: loop labels 2', () => {
  let src = `
    (func (export "main") (result i32)
      (local $i i32)
      (local.set $i (i32.const 0))
      (block $exit (result i32)
        (loop $cont (result i32)
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (if (i32.eq (local.get $i) (i32.const 5))
            (then (br $cont))
          )
          (if (i32.eq (local.get $i) (i32.const 8))
            (then (br $exit (local.get $i)))
          )
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont)
        )
      )
    )
  `
  let { main } = run(src).exports
  is(main(), 8)
})

t('compile: switch', () => {
  let src = `
    (func (export "main") (param i32) (result i32)
      (block $ret (result i32)
        (i32.mul (i32.const 10)
          (block $exit (result i32)
            (block $0
              (block $default
                (block $3
                  (block $2
                    (block $1
                      (br_table $0 $1 $2 $3 $default (local.get 0))
                    ) ;; 1
                  ) ;; 2
                  (br $exit (i32.const 2))
                ) ;; 3
                (br $ret (i32.const 3))
              ) ;; default
            ) ;; 0
            (i32.const 5)
          )
        )
      )
    )
  `
  // console.log(wat2wasm(src))
  let { main } = run(src).exports
  is(main(0), 50)
  is(main(1), 20)
  is(main(3), 3)
})

t('compile: label redefinition', () => {
  let src = `
    (func (export "main") (result i32)
      (block $l1 (result i32)
        (i32.add
          (block $l1 (result i32) (i32.const 2))
          (block $l1 (result i32) (br $l1 (i32.const 3)))
        )
      )
    )
  `
  let { main } = run(src).exports
  is(main(), 5)
})

t('compile: address', () => {
  let src = `
    (memory 1)
    (data (i32.const 0) "abcdefghijklmnopqrstuvwxyz")
    (func (export "a") (param $i i32) (result i32)
      (i32.load8_u offset=0 (local.get $i))                   ;; 97 'a'
    )
    (func (export "b") (param $i i32) (result i32)
      (i32.load8_u offset=1 align=1 (local.get $i))           ;; 98 'b'
    )
    (func (export "ab") (param $i i32) (result i32)
      (i32.load16_s offset=0 (local.get $i))                  ;; 25185 'ab'
    )
    (func (export "cd") (param $i i32) (result i32)
      (i32.load16_u offset=2 align=2 (local.get $i))          ;; 25699 'cd'
    )
    (func (export "z") (param $i i32) (result i32)
      (i32.load8_s offset=25 align=1 (local.get $i))          ;; 122 'z'
    )
  `
  // console.log(wat2wasm(src))
  let { a, b, ab, cd, z } = run(src).exports
  is(a(), 97)
  is(b(), 98)
  is(ab(), 25185)
  is(cd(), 25699)
  is(z(), 122)
})

t('compile: int literals', () => {
  let src = `
    (func (export "i32.test") (result i32) (return (i32.const 0x0bAdD00D)))
    (func (export "i32.umax") (result i32) (return (i32.const 0xffffffff)))
    (func (export "i32.smax") (result i32) (return (i32.const 0x7fffffff)))
    (func (export "i32.neg_smax") (result i32) (return (i32.const -0x7fffffff)))
    (func (export "i32.smin") (result i32) (return (i32.const -0x80000000)))
    (func (export "i32.alt_smin") (result i32) (return (i32.const 0x80000000)))
    (func (export "i32.placeholder") (result i32) (return (i32.const 0x0c_00_01_00)))
    (func (export "i32.inc_smin") (result i32) (return (i32.add (i32.const -0x80000000) (i32.const 1))))
    (func (export "i32.neg_zero") (result i32) (return (i32.const -0x0)))
    (func (export "i32.not_octal") (result i32) (return (i32.const 010)))
    (func (export "i32.plus_sign") (result i32) (return (i32.const +42)))
    (func (export "i32.unsigned_decimal") (result i32) (return (i32.const 4294967295)))
    (func (export "i64.not_octal") (result i64) (return (i64.const 010)))
    (func (export "i64.plus_sign") (result i64) (return (i64.const +42)))
    (func (export "i64.test") (result i64) (return (i64.const 0x0CABBA6E0ba66a6e)))
    (func (export "i64.neg_zero") (result i64) (return (i64.const -0x0)))
    (func (export "i64.umax") (result i64) (return (i64.const 0xffffffffffffffff)))
    (func (export "i32-dec-sep1") (result i32) (i32.const 1_000_000))
    (func (export "i32-dec-sep2") (result i32) (i32.const 1_0_0_0))
    (func (export "i32-hex-sep1") (result i32) (i32.const 0xa_0f_00_99))
    (func (export "i32-hex-sep2") (result i32) (i32.const 0x1_a_A_0_f))
    (func (export "i64-dec-sep1") (result i64) (i64.const 1_000_000))
    (func (export "i64-dec-sep2") (result i64) (i64.const 1_0_0_0))
    (func (export "i64-hex-sep2") (result i64) (i64.const 0x1_a_A_0_f))
    (func (export "i64.smax") (result i64) (return (i64.const 0x7fffffffffffffff)))
    (func (export "i64.neg_smax") (result i64) (return (i64.const -0x7fffffffffffffff)))
    (func (export "i64.smin") (result i64) (return (i64.const -0x8000000000000000)))
    (func (export "i64.alt_smin") (result i64) (return (i64.const 0x8000000000000000)))
    (func (export "i64.inc_smin") (result i64) (return (i64.add (i64.const -0x8000000000000000) (i64.const 1))))
    (func (export "i64.unsigned_decimal") (result i64) (return (i64.const 18446744073709551615)))
    (func (export "i64-hex-sep1") (result i64) (i64.const 0xa_f00f_0000_9999))
  `
  run(src)
})

t('compile: float literals', () => {
  let src = `
    ;; f32 in decimal format
    (func (export "f32_dec.zero") (result i32) (i32.reinterpret_f32 (f32.const 0.0e0)))
    (func (export "f32_dec.positive_zero") (result i32) (i32.reinterpret_f32 (f32.const +0.0e0)))
    (func (export "f32_dec.negative_zero") (result i32) (i32.reinterpret_f32 (f32.const -0.0e0)))
    (func (export "f32_dec.misc") (result i32) (i32.reinterpret_f32 (f32.const 6.28318548202514648)))
    (func (export "f32_dec.min_positive") (result i32) (i32.reinterpret_f32 (f32.const 1.4013e-45)))
    (func (export "f32_dec.min_normal") (result i32) (i32.reinterpret_f32 (f32.const 1.1754944e-38)))
    (func (export "f32_dec.max_subnormal") (result i32) (i32.reinterpret_f32 (f32.const 1.1754942e-38)))
    (func (export "f32_dec.max_finite") (result i32) (i32.reinterpret_f32 (f32.const 3.4028234e+38)))
    (func (export "f32_dec.trailing_dot") (result i32) (i32.reinterpret_f32 (f32.const 1.e10)))
    ;; https://twitter.com/Archivd/status/994637336506912768
    (func (export "f32_dec.root_beer_float") (result i32) (i32.reinterpret_f32 (f32.const 1.000000119)))
    ;; f64 numbers in decimal format
    (func (export "f64_dec.zero") (result i64) (i64.reinterpret_f64 (f64.const 0.0e0)))
    (func (export "f64_dec.positive_zero") (result i64) (i64.reinterpret_f64 (f64.const +0.0e0)))
    (func (export "f64_dec.negative_zero") (result i64) (i64.reinterpret_f64 (f64.const -0.0e0)))
    (func (export "f64_dec.misc") (result i64) (i64.reinterpret_f64 (f64.const 6.28318530717958623)))
    (func (export "f64_dec.min_positive") (result i64) (i64.reinterpret_f64 (f64.const 4.94066e-324)))
    (func (export "f64_dec.min_normal") (result i64) (i64.reinterpret_f64 (f64.const 2.2250738585072012e-308)))
    (func (export "f64_dec.max_subnormal") (result i64) (i64.reinterpret_f64 (f64.const 2.2250738585072011e-308)))
    (func (export "f64_dec.max_finite") (result i64) (i64.reinterpret_f64 (f64.const 1.7976931348623157e+308)))
    (func (export "f64_dec.trailing_dot") (result i64) (i64.reinterpret_f64 (f64.const 1.e100)))
    ;; https://twitter.com/Archivd/status/994637336506912768
    (func (export "f64_dec.root_beer_float") (result i64) (i64.reinterpret_f64 (f64.const 1.000000119)))
  `
  run(src)

  let special = `
    ;; f32 special values
    (func (export "f32.nan") (result i32) (i32.reinterpret_f32 (f32.const nan)))
    (func (export "f32.positive_nan") (result i32) (i32.reinterpret_f32 (f32.const +nan)))
    (func (export "f32.negative_nan") (result i32) (i32.reinterpret_f32 (f32.const -nan)))
    (func (export "f32.plain_nan") (result i32) (i32.reinterpret_f32 (f32.const nan:0x400000)))
    (func (export "f32.informally_known_as_plain_snan") (result i32) (i32.reinterpret_f32 (f32.const nan:0x200000)))
    (func (export "f32.all_ones_nan") (result i32) (i32.reinterpret_f32 (f32.const -nan:0x7fffff)))
    (func (export "f32.misc_nan") (result i32) (i32.reinterpret_f32 (f32.const nan:0x012345)))
    (func (export "f32.misc_positive_nan") (result i32) (i32.reinterpret_f32 (f32.const +nan:0x304050)))
    (func (export "f32.misc_negative_nan") (result i32) (i32.reinterpret_f32 (f32.const -nan:0x2abcde)))
    (func (export "f32.infinity") (result i32) (i32.reinterpret_f32 (f32.const inf)))
    (func (export "f32.positive_infinity") (result i32) (i32.reinterpret_f32 (f32.const +inf)))
    (func (export "f32.negative_infinity") (result i32) (i32.reinterpret_f32 (f32.const -inf)))
    ;; f32 numbers
    (func (export "f32.zero") (result i32) (i32.reinterpret_f32 (f32.const 0x0.0p0)))
    (func (export "f32.positive_zero") (result i32) (i32.reinterpret_f32 (f32.const +0x0.0p0)))
    (func (export "f32.negative_zero") (result i32) (i32.reinterpret_f32 (f32.const -0x0.0p0)))
    (func (export "f32.misc") (result i32) (i32.reinterpret_f32 (f32.const 0x1.921fb6p+2)))
    (func (export "f32.min_positive") (result i32) (i32.reinterpret_f32 (f32.const 0x1p-149)))
    (func (export "f32.min_normal") (result i32) (i32.reinterpret_f32 (f32.const 0x1p-126)))
    (func (export "f32.max_finite") (result i32) (i32.reinterpret_f32 (f32.const 0x1.fffffep+127)))
    (func (export "f32.max_subnormal") (result i32) (i32.reinterpret_f32 (f32.const 0x1.fffffcp-127)))
    (func (export "f32.trailing_dot") (result i32) (i32.reinterpret_f32 (f32.const 0x1.p10)))

    ;; f64 special values
    (func (export "f64.nan") (result i64) (i64.reinterpret_f64 (f64.const nan)))
    (func (export "f64.positive_nan") (result i64) (i64.reinterpret_f64 (f64.const +nan)))
    (func (export "f64.negative_nan") (result i64) (i64.reinterpret_f64 (f64.const -nan)))
    (func (export "f64.plain_nan") (result i64) (i64.reinterpret_f64 (f64.const nan:0x8000000000000)))
    (func (export "f64.informally_known_as_plain_snan") (result i64) (i64.reinterpret_f64 (f64.const nan:0x4000000000000)))
    (func (export "f64.all_ones_nan") (result i64) (i64.reinterpret_f64 (f64.const -nan:0xfffffffffffff)))
    (func (export "f64.misc_nan") (result i64) (i64.reinterpret_f64 (f64.const nan:0x0123456789abc)))
    (func (export "f64.misc_positive_nan") (result i64) (i64.reinterpret_f64 (f64.const +nan:0x3040506070809)))
    (func (export "f64.misc_negative_nan") (result i64) (i64.reinterpret_f64 (f64.const -nan:0x2abcdef012345)))
    (func (export "f64.infinity") (result i64) (i64.reinterpret_f64 (f64.const inf)))
    (func (export "f64.positive_infinity") (result i64) (i64.reinterpret_f64 (f64.const +inf)))
    (func (export "f64.negative_infinity") (result i64) (i64.reinterpret_f64 (f64.const -inf)))
    ;; f64 numbers
    (func (export "f64.zero") (result i64) (i64.reinterpret_f64 (f64.const 0x0.0p0)))
    (func (export "f64.positive_zero") (result i64) (i64.reinterpret_f64 (f64.const +0x0.0p0)))
    (func (export "f64.negative_zero") (result i64) (i64.reinterpret_f64 (f64.const -0x0.0p0)))
    (func (export "f64.misc") (result i64) (i64.reinterpret_f64 (f64.const 0x1.921fb54442d18p+2)))
    (func (export "f64.min_positive") (result i64) (i64.reinterpret_f64 (f64.const 0x0.0000000000001p-1022)))
    (func (export "f64.min_normal") (result i64) (i64.reinterpret_f64 (f64.const 0x1p-1022)))
    (func (export "f64.max_subnormal") (result i64) (i64.reinterpret_f64 (f64.const 0x0.fffffffffffffp-1022)))
    (func (export "f64.max_finite") (result i64) (i64.reinterpret_f64 (f64.const 0x1.fffffffffffffp+1023)))
    (func (export "f64.trailing_dot") (result i64) (i64.reinterpret_f64 (f64.const 0x1.p100)))
    (func (export "f64.minus") (result i64) (i64.reinterpret_f64 (f64.const -0x1.7f00a2d80faabp-35)))

    (func (export "f32-dec-sep1") (result f32) (f32.const 1_000_000))
    (func (export "f32-dec-sep2") (result f32) (f32.const 1_0_0_0))
    (func (export "f32-dec-sep3") (result f32) (f32.const 100_3.141_592))
    (func (export "f32-dec-sep4") (result f32) (f32.const 99e+1_3))
    (func (export "f32-dec-sep5") (result f32) (f32.const 122_000.11_3_54E0_2_3))
    (func (export "f64-dec-sep1") (result f64) (f64.const 1_000_000))
    (func (export "f64-dec-sep2") (result f64) (f64.const 1_0_0_0))
    (func (export "f64-dec-sep3") (result f64) (f64.const 100_3.141_592))
    (func (export "f64-dec-sep4") (result f64) (f64.const 99e-1_23))
    (func (export "f64-dec-sep5") (result f64) (f64.const 122_000.11_3_54e0_2_3))
    (func (export "f32-hex-sep1") (result f32) (f32.const 0xa_0f_00_99))
    (func (export "f32-hex-sep2") (result f32) (f32.const 0x1_a_A_0_f))
    (func (export "f32-hex-sep3") (result f32) (f32.const 0xa0_ff.f141_a59a))
    (func (export "f32-hex-sep4") (result f32) (f32.const 0xf0P+1_3))
    (func (export "f32-hex-sep5") (result f32) (f32.const 0x2a_f00a.1f_3_eep2_3))
    (func (export "f64-hex-sep1") (result f64) (f64.const 0xa_f00f_0000_9999))
    (func (export "f64-hex-sep2") (result f64) (f64.const 0x1_a_A_0_f))
    (func (export "f64-hex-sep3") (result f64) (f64.const 0xa0_ff.f141_a59a))
    (func (export "f64-hex-sep4") (result f64) (f64.const 0xf0P+1_3))
    (func (export "f64-hex-sep5") (result f64) (f64.const 0x2a_f00a.1f_3_eep2_3))`

  run(special)
})

t(`compile: export 2 funcs`, () => run(`
  (func (export "value") (result i32)
    (i32.const 42)
  )
  (func (export "another") (result i32)
    (i32.const 666)
  )
`))

t(`compile: exported & unexported function`, () => {
  run(`
    (func (export "value") (result i32)
      (i32.const 42)
    )
    (func (result i32)
      (i32.const 666)
    )
  `)
})

t(`compile: 2 different locals`, () => {
  let src = `
    (func (export "value") (result i32)
      (local i32)
      (local i64)
      (i32.const 42)
    )
  `
  let { value } = run(src).exports
  is(value(), 42)
})

t(`compile: 3 locals [i32, i64, i32] (disjointed)`, () => {
  let src = `
    (func (export "value") (result i32)
      (local i32)
      (local i64)
      (local i32)
      (i32.const 42)
    )
  `
  let { value } = run(src).exports
  is(value(), 42)
})

t(`compile: 3 locals [i32, i32, i64] (joined)`, () => {
  let src = `
    (func (export "value") (result i32)
      (local i32)
      (local i32)
      (local i64)
      (i32.const 42)
    )
  `
  let { value } = run(src).exports
  is(value(), 42)
})

t('compile: call function indirect (table)', () => {
  let src = `
    (type $return_i32 (func (result i32)))
    (table 2 funcref)
      (elem (i32.const 0) $f1 $f2)
      (func $f1 (result i32)
        (i32.const 42))
      (func $f2 (result i32)
        (i32.const 13))
    (func (export "call_function_indirect") (param $a i32) (result i32)
      (call_indirect (type $return_i32) (local.get $a))
    )
  `
  let { call_function_indirect } = run(src).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})

t('compile: call function indirect (table) non zero indexed ref types', () => {
  let src = `
    (type $return_i64 (func (result i64)))
    (type $return_i32 (func (result i32)))
    (table 2 funcref)
      (elem (i32.const 0) $f1 $f2)
      (func $xx (result i64)
        (i64.const 42))
      (func $f1 (result i32)
        (i32.const 42))
      (func $f2 (result i32)
        (i32.const 13))
    (func (export "call_function_indirect") (param $a i32) (result i32)
      (call_indirect (type $return_i32) (local.get $a))
    )
  `
  let { call_function_indirect } = run(src).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})


// found cases
t('case: global (import)', async () => {
  let src = `(global $blockSize (import "js" "blockSize") (mut i32))`
  run(src, { js: { blockSize: new WebAssembly.Global({ value: 'i32', mutable: true }, 1) } })
})

t('case: 0-args return', () => {
  run(`(func (result i32) (i32.const 0) (return))`)
})

t('case: (memory (export))', () => {
  let src = `
  (import "" "rand" (func $random (result f64)))
  (memory (export "mem") 5)`
  is(wat2wasm(src).buffer, compile(parse(src)))
})

t('case: offset', () => {
  let src = `(func (local $i i32) (i32.store8 offset=53439 (local.get $i) (i32.const 36)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: multiple datas', () => {
  let src = String.raw`
  (memory 5)
  (data (i32.const 268800)

  "\00\00\48\43" ;; 200   x range
  "\00\00\48\42" ;; 50    x addend
  "\cd\cc\cc\3e" ;; 0.4   dx range
  "\cd\cc\4c\be" ;; -0.2  dx adde

  "\07\07"
  "\FF\FF")`
  is(compile(parse(src)), wat2wasm(src).buffer)
  // new WebAssembly.Module()
})

t('case: non-hex data', () => {
  let src = String.raw`
  (memory 5)
  (data (i32.const 268800) "\n")`
  is(compile(parse(src)), wat2wasm(src).buffer)
  // new WebAssembly.Module()
})

t('case: globals', () => {
  let src = `
  (global $Px (mut f32) (f32.const 21))
  (global $Py (mut f32) (f32.const 21))
  (global $angle (mut f32) (f32.const 0.7853981633974483))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: func hoist', () => {
  let src = `
    (func (call $a))
    (func $a)
  `
  run(src)
})

t('case: inline loop', () => {
  let src = `(func $find
    loop $search
    end
  )
  `
  run(src)
})

t('case: if then else', () => {
  let src = `
  (func $find (param $n_bytes i32) (result i32)
    (if (i32.eq (i32.const 1) (i32.const 1))
      (then)(else)
    )
    (i32.const 0)
  )
  `
  // console.log(wat2wasm(src))
  run(src)
})

t('case: label within inline loop', () => {
  let src = `(func
    loop $search
      (if (i32.const 1)(then
        (if (i32.const 1) (then
          (br $search)
        ))
      ))
    end
  )`

  run(src)
})

t('case: double inline block', () => {
  let src = `(func
    loop $a
      loop $b
        (if (i32.const 1)(then (br $a)))
      end
    end
  )`

  run(src)
})

t('case: inline if', () => {
  // equiv to (if (result x) a (then b))
  let src2 = `(func (if (result i32) (i32.const 1) (i32.const 2)))`
  is(compile(parse(src2)), wat2wasm(src2).buffer)

  // equiv to (if (result x) a (then b)(else c))
  let src = `(func (if (result i32) (i32.const 1) (i32.const 2) (i32.const 3)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: block/loop params', () => {
  let src = `(func (block (param i32) (i32.const 1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  let src2 = `(func (block (param i32 i32) (result i32 i32) (i32.const 1)))`
  is(compile(parse(src2)), wat2wasm(src2).buffer)

  let src3 = `(func (loop (param i32 i32) (result i32 i32) (i32.const 1)))`
  is(compile(parse(src3)), wat2wasm(src3).buffer)
})

t('case: data content', () => {
  let src = `(data (i32.const 0) "\\00\\n\\\\")`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: data offset', () => {
  let src = `(data (offset (i32.const 65505)) "\\16\\17\\18\\19\\20\\21\\22\\23\\24\\25\\26\\27\\28\\29\\30\\31")`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: data full cases', () => {
  // ref: https://github.com/WebAssembly/simd/blob/master/test/core/data.wast
  let src = `
  (global $a i32 (i32.const 1))
  (global $b i32 (i32.const 1))
  (data (i32.const 0))
  (data (i32.const 1) "a" "" "bcd")
  (data (i32.const 0x1_0000) "")
  (data (offset (i32.const 0)))
  (data (offset (i32.const 0)) "" "a" "bc" "")
  (data (global.get $a) "a")
  (data (global.get 1) "bc")
  ;; (data (memory 0) (i32.const 0))
  ;; (data (memory 0x0) (i32.const 1) "a" "" "bcd")
  ;; (data (memory 0x000) (offset (i32.const 0)))
  ;; (data (memory 0) (offset (i32.const 0)) "" "a" "bc" "")
  ;; (data (memory $m) (i32.const 0))
  ;; (data (memory $m) (i32.const 1) "a" "" "bcd")
  ;; (data (memory $m) (offset (i32.const 0)))
  ;; (data (memory $m) (offset (i32.const 0)) "" "a" "bc" "")
  ;; (data $d1 (i32.const 0))
  ;; (data $d2 (i32.const 1) "a" "" "bcd")
  ;; (data $d3 (offset (i32.const 0)))
  ;; (data $d4 (offset (i32.const 0)) "" "a" "bc" "")
  ;; (data $d5 (memory 0) (i32.const 0))
  ;; (data $d6 (memory 0x0) (i32.const 1) "a" "" "bcd")
  ;; (data $d7 (memory 0x000) (offset (i32.const 0)))
  ;; (data $d8 (memory 0) (offset (i32.const 0)) "" "a" "bc" "")
  ;; (data $d9 (memory $m) (i32.const 0))
  ;; (data $d10 (memory $m) (i32.const 1) "a" "" "bcd")
  ;; (data $d11 (memory $m) (offset (i32.const 0)))
  ;; (data $d12 (memory $m) (offset (i32.const 0)) "" "a" "bc" "")
  `

  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: float hex', () => {
  let src = `(func (f64.const 0x1p+0) (f64.const -0x1.7f00a2d80faabp-35))`

  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: i32.shr', () => {
  let src = `(func (i32.shl (i32.const 0) (i32.const 1)))`

  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: error on unknown instruction', () => {
  throws(() => {
    compile(parse(`(func (i32.shr (i32.const 0) (i32.const 1)) (xxx))`))
  }, /i32.shr/)
})

t('feature: multiple results', () => {
  let src = `(func (block (result i32 i32) (i32.const 1) (i32.const 2)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  let src2 = `(func (block (result f32 f64) (i32.const 1) (i32.const 2)))`
  is(compile(parse(src2)), wat2wasm(src2).buffer)

  let src3 = `(func (result f32 f64) (i32.const 1) (i32.const 2))`
  is(compile(parse(src3)), wat2wasm(src3).buffer)

  let src4 = `(func (if (result i32 i32) (i32.const 0) (then (i32.const 1)(i32.const 2))))`
  is(compile(parse(src4)), wat2wasm(src4).buffer)

  let src5 = `(func (if (result i32 i32 i32) (i32.const 0)(i32.const 1)(i32.const 2)))`
  is(compile(parse(src5)), wat2wasm(src5).buffer)
})

t('feature: bulk memory', () => {
  let src = `(func $x (result f64)
    (memory.copy (local.get 0)(i32.const 0)(i32.const 16))
    (memory.fill (local.get 0)(i32.const 0)(i32.const 16))
    (memory.init 0 (local.get 0)(i32.const 0)(i32.const 16))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd load', () => {
  // ref: https://github.com/WebAssembly/simd/tree/master/test/core/simd
  let src = `;; Load/Store v128 data with different valid offset/alignment
  (module
    ;; (data (i32.const 0) "\\00\\01\\02\\03\\04\\05\\06\\07\\08\\09\\10\\11\\12\\13\\14\\15")
    ;; (data (offset (i32.const 65505)) "\\16\\17\\18\\19\\20\\21\\22\\23\\24\\25\\26\\27\\28\\29\\30\\31")

    (func (param $i i32) (result v128)
      (v128.load (local.get $i))                   ;; 0x00 0x01 0x02 0x03 0x04 0x05 0x06 0x07 0x08 0x09 0x10 0x11 0x12 0x13 0x14 0x15
    )
    (func (export "load_data_2") (param $i i32) (result v128)
      (v128.load align=1 (local.get $i))                    ;; 0x00 0x01 0x02 0x03 0x04 0x05 0x06 0x07 0x08 0x09 0x10 0x11 0x12 0x13 0x14 0x15
    )
    (func (export "load_data_3") (param $i i32) (result v128)
      (v128.load offset=1 align=1 (local.get $i))           ;; 0x01 0x02 0x03 0x04 0x05 0x06 0x07 0x08 0x09 0x10 0x11 0x12 0x13 0x14 0x15 0x00
    )
    (func (export "load_data_4") (param $i i32) (result v128)
      (v128.load offset=2 align=1 (local.get $i))           ;; 0x02 0x03 0x04 0x05 0x06 0x07 0x08 0x09 0x10 0x11 0x12 0x13 0x14 0x15 0x00 0x00
    )
    (func (export "load_data_5") (param $i i32) (result v128)
      (v128.load offset=15 align=1 (local.get $i))          ;; 0x15 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0x00
    )
  )`

  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd const', () => {
  // ref: https://github.com/WebAssembly/simd/tree/master/test/core/simd
  let src = `
  (global v128 (v128.const i8x16  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF))
  (global v128 (v128.const i8x16 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80))
  (global v128 (v128.const i8x16  255  255  255  255  255  255  255  255  255  255  255  255  255  255  255  255))
  (global v128 (v128.const i8x16 -128 -128 -128 -128 -128 -128 -128 -128 -128 -128 -128 -128 -128 -128 -128 -128))
  (global v128 (v128.const i16x8  0xFFFF  0xFFFF  0xFFFF  0xFFFF  0xFFFF  0xFFFF  0xFFFF  0xFFFF))
  (global v128 (v128.const i16x8 -0x8000 -0x8000 -0x8000 -0x8000 -0x8000 -0x8000 -0x8000 -0x8000))
  (global v128 (v128.const i16x8  65535  65535  65535  65535  65535  65535  65535  65535))
  (global v128 (v128.const i16x8 -32768 -32768 -32768 -32768 -32768 -32768 -32768 -32768))
  (global v128 (v128.const i16x8  65_535  65_535  65_535  65_535  65_535  65_535  65_535  65_535))
  (global v128 (v128.const i16x8 -32_768 -32_768 -32_768 -32_768 -32_768 -32_768 -32_768 -32_768))
  (global v128 (v128.const i16x8  0_123_45 0_123_45 0_123_45 0_123_45 0_123_45 0_123_45 0_123_45 0_123_45))
  (global v128 (v128.const i16x8  0x0_1234 0x0_1234 0x0_1234 0x0_1234 0x0_1234 0x0_1234 0x0_1234 0x0_1234))
  (global v128 (v128.const i32x4  0xffffffff  0xffffffff  0xffffffff  0xffffffff))
  (global v128 (v128.const i32x4 -0x80000000 -0x80000000 -0x80000000 -0x80000000))
  (global v128 (v128.const i32x4  4294967295  4294967295  4294967295  4294967295))
  (global v128 (v128.const i32x4 -2147483648 -2147483648 -2147483648 -2147483648))
  (global v128 (v128.const i32x4  0xffff_ffff  0xffff_ffff  0xffff_ffff  0xffff_ffff))
  (global v128 (v128.const i32x4 -0x8000_0000 -0x8000_0000 -0x8000_0000 -0x8000_0000))
  (global v128 (v128.const i32x4 4_294_967_295  4_294_967_295  4_294_967_295  4_294_967_295))
  (global v128 (v128.const i32x4 -2_147_483_648 -2_147_483_648 -2_147_483_648 -2_147_483_648))
  (global v128 (v128.const i32x4 0_123_456_789 0_123_456_789 0_123_456_789 0_123_456_789))
  (global v128 (v128.const i32x4 0x0_9acf_fBDF 0x0_9acf_fBDF 0x0_9acf_fBDF 0x0_9acf_fBDF))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  // FIXME: nan: values
  src = `
  (global v128 (v128.const i64x2  0xffffffffffffffff  0xffffffffffffffff))
  (global v128 (v128.const i64x2 -0x8000000000000000 -0x8000000000000000))
  (global v128 (v128.const i64x2  18446744073709551615 18446744073709551615))
  (global v128 (v128.const i64x2 -9223372036854775808 -9223372036854775808))
  (global v128 (v128.const i64x2  0xffff_ffff_ffff_ffff  0xffff_ffff_ffff_ffff))
  (global v128 (v128.const i64x2 -0x8000_0000_0000_0000 -0x8000_0000_0000_0000))
  (global v128 (v128.const i64x2  18_446_744_073_709_551_615 18_446_744_073_709_551_615))
  (global v128 (v128.const i64x2 -9_223_372_036_854_775_808 -9_223_372_036_854_775_808))
  (global v128 (v128.const i64x2  0_123_456_789 0_123_456_789))
  (global v128 (v128.const i64x2  0x0125_6789_ADEF_bcef 0x0125_6789_ADEF_bcef))
  (global v128 (v128.const f32x4  1.2  1.2  1.2  1.2))
  (global v128 (v128.const f32x4  0x1p127  0x1p127  0x1p127  0x1p127))
  (global v128 (v128.const f32x4 -0x1p127 -0x1p127 -0x1p127 -0x1p127))
  (global v128 (v128.const f32x4  1e38  1e38  1e38  1e38))
  (global v128 (v128.const f32x4 -1e38 -1e38 -1e38 -1e38))
  (global v128 (v128.const f32x4  340282356779733623858607532500980858880 340282356779733623858607532500980858880
                                  340282356779733623858607532500980858880 340282356779733623858607532500980858880))
  (global v128 (v128.const f32x4 -340282356779733623858607532500980858880 -340282356779733623858607532500980858880
                                  -340282356779733623858607532500980858880 -340282356779733623858607532500980858880))
  ;; (global v128 (v128.const f32x4 nan:0x1 nan:0x1 nan:0x1 nan:0x1))
  ;; (global v128 (v128.const f32x4 nan:0x7f_ffff nan:0x7f_ffff nan:0x7f_ffff nan:0x7f_ffff))
  (global v128 (v128.const f32x4 0123456789 0123456789 0123456789 0123456789))
  (global v128 (v128.const f32x4 0123456789e019 0123456789e019 0123456789e019 0123456789e019))
  (global v128 (v128.const f32x4 0123456789e+019 0123456789e+019 0123456789e+019 0123456789e+019))
  (global v128 (v128.const f32x4 0123456789e-019 0123456789e-019 0123456789e-019 0123456789e-019))
  (global v128 (v128.const f32x4 0123456789. 0123456789. 0123456789. 0123456789.))
  (global v128 (v128.const f32x4 0123456789.e019 0123456789.e019 0123456789.e019 0123456789.e019))
  (global v128 (v128.const f32x4 0123456789.e+019 0123456789.e+019 0123456789.e+019 0123456789.e+019))
  (global v128 (v128.const f32x4 0123456789.e-019 0123456789.e-019 0123456789.e-019 0123456789.e-019))
  (global v128 (v128.const f32x4 0123456789.0123456789 0123456789.0123456789 0123456789.0123456789 0123456789.0123456789))
  (global v128 (v128.const f32x4 0123456789.0123456789e019 0123456789.0123456789e019 0123456789.0123456789e019 0123456789.0123456789e019))
  (global v128 (v128.const f32x4 0123456789.0123456789e+019 0123456789.0123456789e+019 0123456789.0123456789e+019 0123456789.0123456789e+019))
  (global v128 (v128.const f32x4 0123456789.0123456789e-019 0123456789.0123456789e-019 0123456789.0123456789e-019 0123456789.0123456789e-019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF 0x0123456789ABCDEF 0x0123456789ABCDEF 0x0123456789ABCDEF))
  (global v128 (v128.const f32x4 0x0123456789ABCDEFp019 0x0123456789ABCDEFp019 0x0123456789ABCDEFp019 0x0123456789ABCDEFp019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEFp+019 0x0123456789ABCDEFp+019 0x0123456789ABCDEFp+019 0x0123456789ABCDEFp+019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEFp-019 0x0123456789ABCDEFp-019 0x0123456789ABCDEFp-019 0x0123456789ABCDEFp-019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF. 0x0123456789ABCDEF. 0x0123456789ABCDEF. 0x0123456789ABCDEF.))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF.p019 0x0123456789ABCDEF.p019 0x0123456789ABCDEF.p019 0x0123456789ABCDEF.p019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF.p+019 0x0123456789ABCDEF.p+019 0x0123456789ABCDEF.p+019 0x0123456789ABCDEF.p+019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF.p-019 0x0123456789ABCDEF.p-019 0x0123456789ABCDEF.p-019 0x0123456789ABCDEF.p-019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF.019aF 0x0123456789ABCDEF.019aF 0x0123456789ABCDEF.019aF 0x0123456789ABCDEF.019aF))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF.019aFp019 0x0123456789ABCDEF.019aFp019 0x0123456789ABCDEF.019aFp019 0x0123456789ABCDEF.019aFp019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF.019aFp+019 0x0123456789ABCDEF.019aFp+019 0x0123456789ABCDEF.019aFp+019 0x0123456789ABCDEF.019aFp+019))
  (global v128 (v128.const f32x4 0x0123456789ABCDEF.019aFp-019 0x0123456789ABCDEF.019aFp-019 0x0123456789ABCDEF.019aFp-019 0x0123456789ABCDEF.019aFp-019))
  (global v128 (v128.const f64x2  0x1p1023  0x1p1023))
  (global v128 (v128.const f64x2 -0x1p1023 -0x1p1023))
  (global v128 (v128.const f64x2  1e308  1e308))
  (global v128 (v128.const f64x2 -1e308 -1e308))
  (global v128 (v128.const f64x2  179769313486231570814527423731704356798070567525844996598917476803157260780028538760589558632766878171540458953514382464234321326889464182768467546703537516986049910576551282076245490090389328944075868508455133942304583236903222948165808559332123348274797826204144723168738177180919299881250404026184124858368
                                  179769313486231570814527423731704356798070567525844996598917476803157260780028538760589558632766878171540458953514382464234321326889464182768467546703537516986049910576551282076245490090389328944075868508455133942304583236903222948165808559332123348274797826204144723168738177180919299881250404026184124858368))
  (global v128 (v128.const f64x2 -179769313486231570814527423731704356798070567525844996598917476803157260780028538760589558632766878171540458953514382464234321326889464182768467546703537516986049910576551282076245490090389328944075868508455133942304583236903222948165808559332123348274797826204144723168738177180919299881250404026184124858368
                                  -179769313486231570814527423731704356798070567525844996598917476803157260780028538760589558632766878171540458953514382464234321326889464182768467546703537516986049910576551282076245490090389328944075868508455133942304583236903222948165808559332123348274797826204144723168738177180919299881250404026184124858368))
  ;; (global v128 (v128.const f64x2 nan:0x1 nan:0x1))
  ;; (global v128 (v128.const f64x2 nan:0xf_ffff_ffff_ffff nan:0xf_ffff_ffff_ffff))
  (global v128 (v128.const f64x2 0123456789 0123456789))
  (global v128 (v128.const f64x2 0123456789e019 0123456789e019))
  (global v128 (v128.const f64x2 0123456789e+019 0123456789e+019))
  (global v128 (v128.const f64x2 0123456789e-019 0123456789e-019))
  (global v128 (v128.const f64x2 0123456789. 0123456789.))
  (global v128 (v128.const f64x2 0123456789.e019 0123456789.e019))
  (global v128 (v128.const f64x2 0123456789.e+019 0123456789.e+019))
  (global v128 (v128.const f64x2 0123456789.e-019 0123456789.e-019))
  (global v128 (v128.const f64x2 0123456789.0123456789 0123456789.0123456789))
  (global v128 (v128.const f64x2 0123456789.0123456789e019 0123456789.0123456789e019))
  (global v128 (v128.const f64x2 0123456789.0123456789e+019 0123456789.0123456789e+019))
  (global v128 (v128.const f64x2 0123456789.0123456789e-019 0123456789.0123456789e-019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef 0x0123456789ABCDEFabcdef))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdefp019 0x0123456789ABCDEFabcdefp019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdefp+019 0x0123456789ABCDEFabcdefp+019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdefp-019 0x0123456789ABCDEFabcdefp-019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef. 0x0123456789ABCDEFabcdef.))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef.p019 0x0123456789ABCDEFabcdef.p019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef.p+019 0x0123456789ABCDEFabcdef.p+019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef.p-019 0x0123456789ABCDEFabcdef.p-019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdef 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdef))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdefp019 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdefp019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdefp+019 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdefp+019))
  (global v128 (v128.const f64x2 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdefp-019 0x0123456789ABCDEFabcdef.0123456789ABCDEFabcdefp-019))`;
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
  ;; Non-splat cases
  (global v128 (v128.const i8x16  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF  0xFF
                                  -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80))
  (global v128 (v128.const i8x16  0xFF  0xFF  0xFF  0xFF   255   255   255   255
                                  -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80 -0x80))
  (global v128 (v128.const i8x16  0xFF  0xFF  0xFF  0xFF   255   255   255   255
                                  -0x80 -0x80 -0x80 -0x80  -128  -128  -128  -128))
  (global v128 (v128.const i16x8 0xFF 0xFF  0xFF  0xFF -0x8000 -0x8000 -0x8000 -0x8000))
  (global v128 (v128.const i16x8 0xFF 0xFF 65535 65535 -0x8000 -0x8000 -0x8000 -0x8000))
  (global v128 (v128.const i16x8 0xFF 0xFF 65535 65535 -0x8000 -0x8000  -32768  -32768))
  (global v128 (v128.const i32x4 0xffffffff 0xffffffff -0x80000000 -0x80000000))
  (global v128 (v128.const i32x4 0xffffffff 4294967295 -0x80000000 -0x80000000))
  (global v128 (v128.const i32x4 0xffffffff 4294967295 -0x80000000 -2147483648))
  (global v128 (v128.const f32x4 0x1p127 0x1p127 -0x1p127 -1e38))
  (global v128 (v128.const f32x4 0x1p127 340282356779733623858607532500980858880 -1e38 -340282356779733623858607532500980858880))
  (global v128 (v128.const f32x4 nan -nan inf -inf))
  (global v128 (v128.const i64x2 0xffffffffffffffff 0x8000000000000000))
  (global v128 (v128.const i64x2 0xffffffffffffffff -9223372036854775808))
  (global v128 (v128.const f64x2 0x1p1023 -1e308))
  (global v128 (v128.const f64x2 nan -inf))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})


// examples
t('example: wat-compiler', async () => {
  await runExample('/test/example/malloc.wat')
  await runExample('/test/example/brownian.wat')
  await runExample('/test/example/fire.wat')
  await runExample('/test/example/quine.wat')
  await runExample('/test/example/metaball.wat')
  await runExample('/test/example/maze.wat')
  await runExample('/test/example/raytrace.wat')
  await runExample('/test/example/snake.wat')
  await runExample('/test/example/dino.wat')
  await runExample('/test/example/containers.wat')
  await runExample('/test/example/raycast.wat')
})

t('example: legacy', async () => {
  await runExample('/test/example/amp.wat')
  await runExample('/test/example/global.wat')
  await runExample('/test/example/loops.wat')
  await runExample('/test/example/memory.wat')
  await runExample('/test/example/multivar.wat')
  await runExample('/test/example/stack.wat')
  // FIXME await runExample('/test/example/table.wat')
  // FIXME await runExample('/test/example/types.wat')

})



// bench
t.skip('bench: brownian', async () => {
  // example.ts
  let src = await file('/test/example/brownian.wat')
  // let src = `(func $dummy)
  //   (func (export "foo") (param i32) (result i32)
  //     (if (result i32) (local.get 0)
  //       (then (call $dummy) (i32.const 1))
  //       (else (call $dummy) (i32.const 0))
  //     )
  //   )`
  is(compile(parse(src)), watCompiler(src))
  let N = 500

  console.time('watr')
  for (let i = 0; i < N; i++) compile(parse(src))
  console.timeEnd('watr')

  console.time('wat-compiler')
  for (let i = 0; i < N; i++) watCompiler(src, { metrics: false })
  console.timeEnd('wat-compiler')

  console.time('wabt')
  for (let i = 0; i < N; i++) wat2wasm(src, { metrics: false })
  console.timeEnd('wabt')
})

export async function file(path) {
  let res = await fetch(path)
  let src = await res.text()
  return src
}

async function runExample(path) {
  let src = await file(path)
  let buffer = compile(parse(src))
  is(buffer, wat2wasm(src).buffer)
  // const mod = new WebAssembly.Module(buffer)
}

console.hex = (d) => console.log((Object(d).buffer instanceof ArrayBuffer ? new Uint8Array(d.buffer) :
  typeof d === 'string' ? (new TextEncoder('utf-8')).encode(d) :
    new Uint8ClampedArray(d)).reduce((p, c, i, a) => p + (i % 16 === 0 ? i.toString(16).padStart(6, 0) + '  ' : ' ') +
      c.toString(16).padStart(2, 0) + (i === a.length - 1 || i % 16 === 15 ?
        ' '.repeat((15 - i % 16) * 3) + Array.from(a).splice(i - i % 16, 16).reduce((r, v) =>
          r + (v > 31 && v < 127 || v > 159 ? String.fromCharCode(v) : '.'), '  ') + '\n' : ''), ''));


let wabt = await Wabt()

const hex = (str, ...fields) =>
  new Uint8Array(
    String.raw.call(null, str, fields)
      .trim()
      .replace(/;[^\n]*/g, '')
      .split(/[\s\n]+/)
      .filter(n => n !== '')
      .map(n => parseInt(n, 16))
  )

// convert wast code to binary via Wabt
export function wat2wasm(code, config) {
  let metrics = config ? config.metrics : true
  const parsed = wabt.parseWat('inline', code, {
    bulk_memory: true,
    simd: true
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

// run test case against wabt, return instance
// FIXME: rename to something more meaningful? testCase?
const run = (src, importObj) => {
  let tree = parse(src)
  // in order to make sure tree is not messed up we freeze it
  const freeze = node => Array.isArray(node) && (Object.freeze(node), node.forEach(freeze))
  freeze(tree)
  let wabtBuffer = wat2wasm(src).buffer, watrBuffer = compile(tree)
  // console.log('wabt:')
  // console.log(...wat2wasm(src).buffer)
  // console.log('watr:')
  // console.log(...buffer)
  is(watrBuffer, wabtBuffer)
  const mod = new WebAssembly.Module(watrBuffer)
  return new WebAssembly.Instance(mod, importObj)
}
