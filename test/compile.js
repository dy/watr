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
      // ['local.get', 0],                                   //     local.get 0
      // ['local.get', 1],                                   //     local.get 1
      // ['i32.store', ['align','4']],                           //     i32.store
      ['i32.store', ['align','4'], ['local.get', 0], ['local.get', 1]],
      ['local.get', 1]                                    //     local.get 1
    ],                                                    //   )
    ['export', '"m"', ['memory', 0]],                       //   (export "m" (memory 0 ))
    ['export', '"f"', ['func', 0]],                         //   (export "f" (func 0 ))
  ]),                                                     // )
  buffer)

  new WebAssembly.Module(buffer)
})

t('compiler: reexport', () => {
  let src = `
    (export "f0" (func 0))
    (export "f1" (func 1))
    (import "math" "add" (func (param i32 i32) (result i32)))
    (func (param i32 i32) (result i32)
      (i32.sub (local.get 0) (local.get 1))
    )
  `

  let {f0, f1} = run(src, {math:{add(a,b){return a+b}}}).exports
  is(f0(3,1), 4)
  is(f1(3,1), 2)
})

t('compiler: memory $foo (import "a" "b" ) 1 2 shared', () => {
  let src = `(memory $foo (import "env" "mem") 1 2 shared)`
  run(src, {env:{mem: new WebAssembly.Memory({initial:1, maximum: 1, shared: 1})}})
})

t('compiler: stacked syntax should not be supported', () => {
  throws(t => {
    compile(parse(`
      (func (export "answer") (param i32 i32) (result i32)
        (local.get 0)
        (local.get 1)
        (i32.add)
      )
    `))
  })
})

t('compiler: inline syntax is not supported', () => {
  throws(t => {
    compile(parse(`
      (func $f1 (result i32)
        i32.const 42)
    `))
  })
})


// wat-compiler
t('wat-compiler: minimal function', t => {
  run('(module (func (export "answer") (result i32) (i32.const 42)))')
})

t('wat-compiler: function with 1 param', t => {
  run('(func (export "answer") (param i32) (result i32) (local.get 0))')
})

t('wat-compiler: function with 1 param', () => {
  let {answer} = run(`
    (func (export "answer") (param i32) (result i32) (local.get 0))
  `).exports
  is(answer(42), 42)
})

t('wat-compiler: function with 2 params', () => {
  let {answer} = run(`
    (func (export "answer") (param i32 i32) (result i32)
      (i32.add (local.get 0) (local.get 1))
    )
  `).exports
  is(answer(20,22), 42)
})

t('wat-compiler: function with 2 params 2 results', () => {
  let {answer} = run(`
    (func (export "answer") (param i32 i32) (result i32 i32)
      (i32.add (local.get 0) (local.get 1))
      (i32.const 666)
    )
  `).exports

  is(answer(20,22), [42,666])
})

t('wat-compiler: named function named param', () => {
  let {dbl} = run(`
    (func $dbl (export "dbl") (param $a i32) (result i32)
      (i32.add (local.get $a) (local.get $a))
    )
  `).exports

  is(dbl(21), 42)
})

t('wat-compiler: call function direct', () => {
  let {call_function_direct} = run(`
  (func $dbl (param $a i32) (result i32)
    (i32.add (local.get $a) (local.get $a))
  )
  (func (export "call_function_direct") (param $a i32) (result i32)
    (call $dbl (local.get $a))
  )
  `).exports
  is(call_function_direct(333), 666)
})

t('wat-compiler: function param + local', () => {
  let {add} = run(`
    (func (export "add") (param $a i32) (result i32)
      (local $b i32)
      (i32.add (local.get $a) (local.tee $b (i32.const 20)))
    )
  `).exports

  is(add(22), 42)
})

t('wat-compiler: call function indirect (table)', () => {
  let {call_function_indirect} = run(`
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

t('wat-compiler: call function indirect (table) non zero indexed ref types', () => {
  let {call_function_indirect} = run(`
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

t('wat-compiler: 1 global const (immutable)', () => {
  let {get} = run(`
    (global $answer i32 (i32.const 42))
    (func (export "get") (result i32)
      (global.get $answer)
    )
  `).exports

  is(get(), 42)
})

t('wat-compiler: 1 global var (mut)', () => {
  let {get} = run(`
    (global $answer (mut i32) (i32.const 42))
    (func (export "get") (result i32)
      (global.get $answer)
    )
  `).exports

  is(get(), 42)
})

t('wat-compiler: 1 global var (mut) + mutate', () => {
  let {get} = run(`
    (global $answer (mut i32) (i32.const 42))
    (func (export "get") (result i32)
      (global.set $answer (i32.const 777))
      (global.get $answer)
    )
  `).exports

  is(get(), 777)
})

t('wat-compiler: memory.grow', () => {
  run(`
    (memory 1)
    (func (export "main") (result i32)
      (memory.grow (i32.const 2))
    )
  `)
})

t('wat-compiler: local memory page min 1 - data 1 offset 0 i32', () => {
  let {get} = run(String.raw`
    (memory 1)
    (data (i32.const 0) "\2a")
    (func (export "get") (result i32)
      (i32.load (i32.const 0))
    )
  `).exports

  is(get(), 42)
})

t('wat-compiler: local memory page min 1 max 2 - data 1 offset 0 i32', () => {
  let {get} = run(String.raw`
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

t('wat-compiler: import function', () => {
  let src = `
    (import "math" "add" (func $add (param i32 i32) (result i32)))
    (func (export "call_imported_function") (result i32)
      (call $add (i32.const 20) (i32.const 22))
    )
  `
  let {call_imported_function} = run(src, {math:{ add: (a, b) => a + b }}).exports

  is(call_imported_function(), 42)
})

t('wat-compiler: import memory 1', () => {
  run(`
    (import "env" "mem" (memory 1))
  `, {env: {mem: new WebAssembly.Memory({initial:1})}})
})

t('wat-compiler: import memory 1 2', () => {
  run(`
    (import "env" "mem" (memory 1 2))
  `, {env: {mem: new WebAssembly.Memory({initial:1, maximum:1})}})
})

t('wat-compiler: import memory 1 2 shared', () => {
  run(`
    (import "env" "mem" (memory 1 2 shared))
  `, {env: {mem: new WebAssembly.Memory({initial:1, maximum:1, shared:1})}})
})

t('wat-compiler: import memory $foo 1 2 shared', () => run(`
  (import "env" "mem" (memory $foo 1 2 shared))
`, {env:{mem: new WebAssembly.Memory({initial:1, maximum: 1, shared: 1})}}))

t('wat-compiler: set a start function', () => {
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
  let {get} = run(src).exports

  is(get(), 666)
})

t('wat-compiler: if else', () => {
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
  // these are identical parts, but we restrict to lisp syntax src1
  // console.log(wat(src1))
  is(wat(src1).buffer, wat(src2).buffer)
  let {foo} = run(src1).exports
  is(foo(0), 0)
  is(foo(1), 1)
})

t('wat-compiler: block', () => {
  let src = `
    (func (export "answer") (result i32)
      (block (nop))
      (block (result i32) (i32.const 42))
    )
  `
  let {answer} = run(src).exports
  is(answer(), 42)
  is(answer(), 42)
})

t('wat-compiler: block multi', () => {
  let src = `
    (func $dummy)
    (func (export "multi") (result i32)
      (block (call $dummy) (call $dummy) (call $dummy) (call $dummy))
      (block (result i32) (call $dummy) (call $dummy) (call $dummy) (i32.const 8))
    )
  `
  let {multi} = run(src).exports
  is(multi(), 8)
  is(multi(), 8)

})

t('wat-compiler: br', () => {
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

  let {main} = run(src).exports
  is(main(), 42)
  is(main(), 42)
})

t('wat-compiler: br mid', () => {
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
  let {main} = run(src).exports
  is(main(), 666)
  is(main(), 666)
})

t('wat-compiler: block named + br', () => {
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
  // console.log(wat(src))
  let {main} = run(src).exports
  is(main(), 0)
  is(main(), 0)
})

t('wat-compiler: block named 2 + br', () => {
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
  let {main} = run(src).exports

  is(main(), 0)
  is(main(), 0)

})

t('wat-compiler: br_table', () => {
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
  // console.log(wat(src))
  let {main} = run(src).exports
  is(main(0), 22)
  is(main(1), 20)
})

t('wat-compiler: br_table multiple', () => {
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
  let {main} = run(src).exports

  is(main(0), 103)
  is(main(1), 102)
  is(main(2), 101)
  is(main(3), 100)
  is(main(4), 104)
})

t('wat-compiler: loop', () => {
  let src = `
    (func (export "main") (result i32)
      (loop (nop))
      (loop (result i32) (i32.const 42))
    )
  `
  let {main} = run(src).exports
  is(main(), 42)
})

t('wat-compiler: break-value', () => {
  let src = `
    (func (export "main") (result i32)
      (block (result i32)
        (loop (result i32) (br 1 (i32.const 18)) (br 0) (i32.const 19))
      )
    )
  `
  // console.log(wat(src))
  let {main} = run(src).exports
  is(main(), 18)
  is(main(), 18)
})

t('wat-compiler: br_if', () => {
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
  let {main} = run(src).exports
  is(main(), 18)
})

t('wat-compiler: while', () => {
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
  let {main} = run(src).exports
  is(main(), 1)
})

t('wat-compiler: select', () => {
  let src = `
    (func (export "main") (result i32)
      (select (loop (result i32) (i32.const 1)) (i32.const 2) (i32.const 3))
    )
  `
  let {main} = run(src).exports
  is(main(), 1)
})

t('wat-compiler: select mid', () => {
  let src = `
    (func (export "main") (result i32)
      (select (i32.const 2) (loop (result i32) (i32.const 1)) (i32.const 3))
    )
  `
  let {main} = run(src).exports
  is(main(), 2)
})

t('wat-compiler: block labels', () => {
  let src = `
    (func (export "main") (result i32)
      (block $exit (result i32)
        (br $exit (i32.const 1))
        (i32.const 0)
      )
    )
  `
  let {main} = run(src).exports
  is(main(), 1)
})

t('wat-compiler: loop labels', () => {
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
  // console.log(wat(src))
  let {main} = run(src).exports
  is(main(), 5)
})

t('wat-compiler: loop labels 2', () => {
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
  let {main} = run(src).exports
  is(main(), 8)
})

t('wat-compiler: switch', () => {
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
  // console.log(wat(src))
  let {main} = run(src).exports
  is(main(0), 50)
  is(main(1), 20)
  is(main(3), 3)
})

t('wat-compiler: label redefinition', () => {
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
  let {main} = run(src).exports
  is(main(), 5)
})

t('wat-compiler: address', () => {
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
  // console.log(wat(src))
  let {a,b,ab,cd,z}=run(src).exports
  is(a(), 97)
  is(b(), 98)
  is(ab(), 25185)
  is(cd(), 25699)
  is(z(), 122)
})

t('wat-compiler: int literals', () => {
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
    (func (export "i64.neg_zero") (result i64) (return (i64.const -0x0)))
    (func (export "i64.not_octal") (result i64) (return (i64.const 010)))
    (func (export "i64.plus_sign") (result i64) (return (i64.const +42)))
    (;func (export "i64.test") (result i64) (return (i64.const 0x0CABBA6E0ba66a6e)))
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
    (func (export "i64-hex-sep1") (result i64) (i64.const 0xa_f00f_0000_9999);)
  `
  run(src)
})

t('wat-compiler: float literals', () => {
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
    (;func (export "f32.zero") (result i32) (i32.reinterpret_f32 (f32.const 0x0.0p0)))
    (func (export "f32.positive_zero") (result i32) (i32.reinterpret_f32 (f32.const +0x0.0p0)))
    (func (export "f32.negative_zero") (result i32) (i32.reinterpret_f32 (f32.const -0x0.0p0)))
    (func (export "f32.misc") (result i32) (i32.reinterpret_f32 (f32.const 0x1.921fb6p+2)))
    (func (export "f32.min_positive") (result i32) (i32.reinterpret_f32 (f32.const 0x1p-149)))
    (func (export "f32.min_normal") (result i32) (i32.reinterpret_f32 (f32.const 0x1p-126)))
    (func (export "f32.max_finite") (result i32) (i32.reinterpret_f32 (f32.const 0x1.fffffep+127)))
    (func (export "f32.max_subnormal") (result i32) (i32.reinterpret_f32 (f32.const 0x1.fffffcp-127)))
    (func (export "f32.trailing_dot") (result i32) (i32.reinterpret_f32 (f32.const 0x1.p10));)

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
    (;func (export "f64.zero") (result i64) (i64.reinterpret_f64 (f64.const 0x0.0p0)))
    (func (export "f64.positive_zero") (result i64) (i64.reinterpret_f64 (f64.const +0x0.0p0)))
    (func (export "f64.negative_zero") (result i64) (i64.reinterpret_f64 (f64.const -0x0.0p0)))
    (func (export "f64.misc") (result i64) (i64.reinterpret_f64 (f64.const 0x1.921fb54442d18p+2)))
    (func (export "f64.min_positive") (result i64) (i64.reinterpret_f64 (f64.const 0x0.0000000000001p-1022)))
    (func (export "f64.min_normal") (result i64) (i64.reinterpret_f64 (f64.const 0x1p-1022)))
    (func (export "f64.max_subnormal") (result i64) (i64.reinterpret_f64 (f64.const 0x0.fffffffffffffp-1022)))
    (func (export "f64.max_finite") (result i64) (i64.reinterpret_f64 (f64.const 0x1.fffffffffffffp+1023)))
    (func (export "f64.trailing_dot") (result i64) (i64.reinterpret_f64 (f64.const 0x1.p100));)

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
    (;func (export "f32-hex-sep1") (result f32) (f32.const 0xa_0f_00_99))
    (func (export "f32-hex-sep2") (result f32) (f32.const 0x1_a_A_0_f))
    (func (export "f32-hex-sep3") (result f32) (f32.const 0xa0_ff.f141_a59a))
    (func (export "f32-hex-sep4") (result f32) (f32.const 0xf0P+1_3))
    (func (export "f32-hex-sep5") (result f32) (f32.const 0x2a_f00a.1f_3_eep2_3))
    (func (export "f64-hex-sep1") (result f64) (f64.const 0xa_f00f_0000_9999))
    (func (export "f64-hex-sep2") (result f64) (f64.const 0x1_a_A_0_f))
    (func (export "f64-hex-sep3") (result f64) (f64.const 0xa0_ff.f141_a59a))
    (func (export "f64-hex-sep4") (result f64) (f64.const 0xf0P+1_3))
    (func (export "f64-hex-sep5") (result f64) (f64.const 0x2a_f00a.1f_3_eep2_3);)`

    run(special)
})

t(`wat-compiler: export 2 funcs`, () => run(`
  (func (export "value") (result i32)
    (i32.const 42)
  )
  (func (export "another") (result i32)
    (i32.const 666)
  )
`))

t(`wat-compiler: exported & unexported function`, () => {
  run(`
    (func (export "value") (result i32)
      (i32.const 42)
    )
    (func (result i32)
      (i32.const 666)
    )
  `)
})

t(`wat-compiler: 2 different locals`, () => {
  let src = `
    (func (export "value") (result i32)
      (local i32)
      (local i64)
      (i32.const 42)
    )
  `
  let {value} = run(src).exports
  is(value(), 42)
})

t(`wat-compiler: 3 locals [i32, i64, i32] (disjointed)`, () => {
  let src = `
    (func (export "value") (result i32)
      (local i32)
      (local i64)
      (local i32)
      (i32.const 42)
    )
  `
  let {value} = run(src).exports
  is(value(), 42)
})

t(`wat-compiler: 3 locals [i32, i32, i64] (joined)`, () => {
  let src = `
    (func (export "value") (result i32)
      (local i32)
      (local i32)
      (local i64)
      (i32.const 42)
    )
  `
  let {value} = run(src).exports
  is(value(), 42)
})

t('wat-compiler: call function indirect (table)', () => {
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
  let {call_function_indirect} = run(src).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})

t('wat-compiler: call function indirect (table) non zero indexed ref types', () => {
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
  let {call_function_indirect} = run(src).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})


// found cases
t('case: global (import)', async () => {
  let src = `(global $blockSize (import "js" "blockSize") (mut i32))`
  run(src, {js:{blockSize: new WebAssembly.Global({value:'i32',mutable:true}, 1)}})
})

t('case: 0-args return', () => {
  run(`(func (result i32) (i32.const 0) (return))`)
})

t('case: (memory (export))', () => {
  let src = `
  (import "" "rand" (func $random (result f64)))
  (memory (export "mem") 5)`
  is(wat(src).buffer, compile(parse(src)))
})

t('case: offset', () => {
  let src = `(func (local $i i32) (i32.store8 offset=53439 (local.get $i) (i32.const 36)))`
  is(compile(parse(src)), wat(src).buffer)
})

t('case: multiple datas', () => {
  let src=String.raw`
  (memory 5)
  (data (i32.const 268800)
  "\07\07"
  "\FF\FF")`
  is(compile(parse(src)), wat(src).buffer)
  // new WebAssembly.Module()
})

t('case: globals', () => {
  let src = `
  (global $Px (mut f32) (f32.const 21))
  (global $Py (mut f32) (f32.const 21))
  (global $angle (mut f32) (f32.const 0.7853981633974483))`
  is(compile(parse(src)), wat(src).buffer)
})

// examples
t.only('example: wat-compiler', () => {
  // runExample('/test/example/malloc.wat')
  // runExample('/test/example/brownian.wat')
  // runExample('/test/example/fire.wat')
  // runExample('/test/example/quine.wat')
  // runExample('/test/example/metaball.wat')
  runExample('/test/example/maze.wat')
  // runExample('/test/example/snake.wat')
  // runExample('/test/example/raytrace.wat')
  // runExample('/test/example/containers.wat')
  // runExample('/test/example/dino.wat')
  // runExample('/test/example/raycast.wat')
})

t('example: legacy', () => {
  runExample('/test/example/amp.wat')
  runExample('/test/example/global.wat')
  runExample('/test/example/loops.wat')
  runExample('/test/example/memory.wat')
  runExample('/test/example/multivar.wat')
  runExample('/test/example/stack.wat')
  // FIXME runExample('/test/example/table.wat')
  // FIXME runExample('/test/example/types.wat')

})



// bench
t.skip('bench: brownian', async () => {
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
  for (let i = 0; i < N; i++) watCompiler(src, {metrics: false})
  console.timeEnd('wat-compiler')

  console.time('wabt')
  for (let i = 0; i < N; i++) wat(src, {metrics: false})
  console.timeEnd('wabt')
})

async function file(path) {
  let res = await fetch(path)
  let src = await res.text()
  return src
}

async function runExample(path) {
  let src = await file(path)
  let buffer = compile(parse(src))
  is(buffer, wat(src).buffer)
  const mod = new WebAssembly.Module(buffer)
}

// stub fetch for local purpose
if (!global.fetch) {
  let {readFileSync} = await import('fs')
  global.fetch = async path => {
    path = `.${path}`
    const data = readFileSync(path, 'utf8')
    return {text(){return data}}
  }
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
    .replace(/;[^\n]*/g,'')
    .split(/[\s\n]+/)
    .filter(n => n !== '')
    .map(n => parseInt(n, 16))
  )

function wat (code, config) {
  let metrics = config ? config.metrics : true
  const parsed = wabt.parseWat('inline', code, {})
  metrics && console.time('wabt build')
  const binary = parsed.toBinary({
    log: true,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: false,
  })
  parsed.destroy()
  metrics && console.timeEnd('wabt build')

  return binary
}

// run test case against wabt, return instance
// FIXME: rename to something more meaningful? testCase?
const run = (src, importObj) => {
  let tree = parse(src)
  const freeze = node => Array.isArray(node) && (Object.freeze(node), node.forEach(freeze))
  freeze(tree)
  let buffer = compile(tree)
  is(buffer, wat(src).buffer)
  const mod = new WebAssembly.Module(buffer)
  return new WebAssembly.Instance(mod, importObj)
}
