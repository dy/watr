import t, { is, ok, same, throws } from 'tst'
import compile from '../src/compile.js'
import parse from '../src/parse.js'
import {inline, file, wat2wasm} from './index.js'


t('compile: reexport func', () => {
  let src = `
    (export "f0" (func 0))
    (export "f1" (func 1))
    (import "math" "add" (func (param i32 i32) (result i32)))
    (func (param i32 i32) (result i32)
      (i32.sub (local.get 0) (local.get 1))
    )
  `

  let { f0, f1 } = inline(src, { math: { add(a, b) { return a + b } } }).exports
  is(f0(3, 1), 4)
  is(f1(3, 1), 2)
})

t('compile: memory $foo (import "a" "b" ) 1 2 shared', () => {
  let src = `(memory $foo (import "env" "mem") 1 2 shared)`
  inline(src, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: 1 }) } })
})

t('compile: stacked syntax is supported', () => {
  let src = `
    (func (export "add") (param i32 i32) (result i32)
      (local.get 0)
      (local.get 1)
      (i32.add)
    )
  `

  let { add } = inline(src).exports
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

  let { add } = inline(src).exports
  is(add(5, 2), 7)
})


// wat-compiler
t('compile: minimal function', t => {
  inline('(module (func (export "answer") (param i32)(result i32) (i32.add (i32.const 42) (local.get 0))))')
  // inline(`(module (func (export "x") (param i32)(result i32) local.get 0 i32.const 42 i32.add))`)
})

t('compile: function with 1 param', t => {
  inline('(func (export "answer") (param i32) (result i32) (local.get 0))')
})

t('compile: function with 1 param', () => {
  let { answer } = inline(`
    (func (export "answer") (param i32) (result i32) (local.get 0))
  `).exports
  is(answer(42), 42)
})

t('compile: function with 2 params', () => {
  let { answer } = inline(`
    (func (export "answer") (param i32 i32) (result i32)
      (i32.add (local.get 0) (local.get 1))
    )
  `).exports
  is(answer(20, 22), 42)
})

t('compile: function with 2 params 2 results', () => {
  let { answer } = inline(`
    (func (export "answer") (param i32 i32) (result i32 i32)
      (i32.add (local.get 0) (local.get 1))
      (i32.const 666)
    )
  `).exports

  is(answer(20, 22), [42, 666])
})

t('compile: named function named param', () => {
  let { dbl } = inline(`
    (func $dbl (export "dbl") (param $a i32) (result i32)
      (i32.add (local.get $a) (local.get $a))
    )
  `).exports

  is(dbl(21), 42)
})

t('compile: call function direct', () => {
  let { f } = inline(`
  (func $dbl (param $a i32) (result i32)
    (i32.add (local.get $a) (local.get $a))
  )
  (func (export "f") (param $a i32) (result i32)
    (call $dbl (local.get $a))
  )
  `).exports
  is(f(333), 666)
})

t('compile: function param + local', () => {
  let { add } = inline(`
    (func (export "add") (param $a i32) (result i32)
      (local $b i32)
      (i32.add (local.get $a) (local.tee $b (i32.const 20)))
    )
  `).exports

  is(add(22), 42)
})

t('compile: 1 global const (immutable)', () => {
  let { get } = inline(`
    (global $answer i32 (i32.const 42))
    (func (export "get") (result i32)
      (global.get $answer)
    )
  `).exports

  is(get(), 42)
})

t('compile: 1 global var (mut)', () => {
  let { get } = inline(`
    (global $answer (mut i32) (i32.const 42))
    (func (export "get") (result i32)
      (global.get $answer)
    )
  `).exports

  is(get(), 42)
})

t('compile: 1 global var (mut) + mutate', () => {
  let { get } = inline(`
    (global $answer (mut i32) (i32.const 42))
    (func (export "get") (result i32)
      (global.set $answer (i32.const 777))
      (global.get $answer)
    )
  `).exports

  is(get(), 777)
})

t('compile: memory.grow', () => {
  inline(`
    (memory 1)
    (func (export "main") (result i32)
      (memory.grow (i32.const 2))
    )
  `)
})

t('compile: local memory page min 1 - data 1 offset 0 i32', () => {
  let { get } = inline(String.raw`
    (memory 1)
    (data (i32.const 0) "\2a")
    (func (export "get") (result i32)
      (i32.load (i32.const 0))
    )
  `).exports

  is(get(), 42)
})

t('compile: local memory page min 1 max 2 - data 1 offset 0 i32', () => {
  let { get } = inline(String.raw`
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
    (import "m" "add" (func $add (param i32 i32) (result i32)))
    (func (export "c") (result i32)
      (call $add (i32.const 20) (i32.const 22))
    )
  `
  let { c } = inline(src, { m: { add: (a, b) => a + b } }).exports

  is(c(), 42)
})

t('compile: import memory 1', () => {
  inline(`
    (import "env" "mem" (memory 1))
  `, { env: { mem: new WebAssembly.Memory({ initial: 1 }) } })
})

t('compile: import memory 1 2', () => {
  inline(`
    (import "env" "mem" (memory 1 2))
  `, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1 }) } })
})

t('compile: import memory 1 2 shared', () => {
  inline(`
    (import "env" "mem" (memory 1 2 shared))
  `, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: 1 }) } })
})

t('compile: import memory $foo 1 2 shared', () => inline(`
  (import "env" "mem" (memory $foo 1 2 shared))
`, { env: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: 1 }) } }))

t('compile: set a start function', () => {
  let src = `
    (global $answer (mut i32) (i32.const 42))
    (func $main
    (global.set $answer (i32.const 666))
    )
    (func (export "get") (result i32)
    (global.get $answer)
    )
    (start $main)
  `
  let { get } = inline(src).exports

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
  let { foo } = inline(src1).exports
  is(foo(0), 0)
  is(foo(1), 1)
  let { foo: foo2 } = inline(src2).exports
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
  let { answer } = inline(src).exports
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
  let { multi } = inline(src).exports
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

  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports

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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports

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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
  is(main(), 1)
})

t('compile: select', () => {
  let src = `
    (func (export "main") (result i32)
      (select (loop (result i32) (i32.const 1)) (i32.const 2) (i32.const 3))
    )
  `
  let { main } = inline(src).exports
  is(main(), 1)
})

t('compile: select mid', () => {
  let src = `
    (func (export "main") (result i32)
      (select (i32.const 2) (loop (result i32) (i32.const 1)) (i32.const 3))
    )
  `
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { main } = inline(src).exports
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
  let { a, b, ab, cd, z } = inline(src).exports
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
  inline(src)
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
  inline(src)

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

  inline(special)
})

t(`compile: export 2 funcs`, () => inline(`
  (func (export "value") (result i32)
    (i32.const 42)
  )
  (func (export "another") (result i32)
    (i32.const 666)
  )
`))

t(`compile: exported & unexported function`, () => {
  inline(`
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
  let { value } = inline(src).exports
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
  let { value } = inline(src).exports
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
  let { value } = inline(src).exports
  is(value(), 42)
})

t('compile: call function indirect (table)', () => {
  let src = `
    (type $return_i32 (func (result i32)))
    (func $f1 (result i32)
      (i32.const 42))
    (func $f2 (result i32)
      (i32.const 13))
    (table 2 funcref)
      (elem (i32.const 0) $f1 $f2)
    (func (export "call_function_indirect") (param $a i32) (result i32)
      (call_indirect (type $return_i32) (local.get $a))
    )
  `
  let { call_function_indirect } = inline(src).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})

t('compile: call function indirect (table) non zero indexed ref types', () => {
  let src = `
    (type $return_i64 (func (result i64)))
    (type $return_i32 (func (result i32)))
    (table 2 funcref)
    (func $xx (result i64)
    (i64.const 42))
    (func $f1 (result i32)
    (i32.const 42))
    (func $f2 (result i32)
    (i32.const 13))
    (elem (i32.const 0) $f1 $f2)
    (func (export "call_function_indirect") (param $a i32) (result i32)
      (call_indirect (type $return_i32) (local.get $a))
    )
  `
  let { call_function_indirect } = inline(src).exports

  is(call_function_indirect(0), 42)
  is(call_function_indirect(1), 13)
})


// found cases
t('case: global (import)', async () => {
  let src = `(global $blockSize (import "js" "blockSize") (mut i32))`
  inline(src, { js: { blockSize: new WebAssembly.Global({ value: 'i32', mutable: true }, 1) } })
})

t('case: 0-args return', () => {
  inline(`(func (result i32) (i32.const 0) (return))`)
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
    (global funcref (ref.func $a))
    (func (call $a))
    (func $a (type $a))
    (type $a (func))
  `
  inline(src)
})

t('case: inline loop', () => {
  let src = `(func $find
    loop $search
    end
  )
  `
  inline(src)
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
  inline(src)
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

  inline(src)
})

t('case: double inline block', () => {
  let src = `(func
    loop $a
      loop $b
        (if (i32.const 1)(then (br $a)))
      end
    end
  )`

  inline(src)
})

t.skip('case: inline if', () => {
  // FIXME: wabt compiles that only accidentally, it's not part of standard
  // and that doesn't work in repl https://webassembly.github.io/wabt/demo/wat2wasm/

  // equiv to (if (result x) a (then b))
  let src2 = `(func (if (result i32) (i32.const 1) (i32.const 2)))`
  is(compile(parse(src2)), wat2wasm(src2).buffer)

  // equiv to (if (result x) a (then b)(else c))
  let src = `(func (if (result i64) (i64.const 7) (i64.const 8) (i64.const 9)))`
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
  (memory $n 1)
  (memory $m 1)

  (global $a i32 (i32.const 1))
  (global $b i32 (i32.const 1))
  (data (i32.const 0))
  (data (i32.const 1) "a" "" "bcd")
  (data (i32.const 0x1_0000) "")
  (data (offset (i32.const 0)))
  (data (offset (i32.const 0)) "" "a" "bc" "")
  (data (global.get $a) "a")
  (data (global.get 1) "bc")
  (data (memory 0) (i32.const 0))
  (data (memory 0x0) (i32.const 1) "a" "" "bcd")
  (data (memory 0x000) (offset (i32.const 0)))
  (data (memory 0) (offset (i32.const 0)) "" "a" "bc" "")
  (data (memory $m) (i32.const 0))
  (data (memory $m) (i32.const 1) "a" "" "bcd")
  (data (memory $m) (offset (i32.const 0)))
  (data (memory $m) (offset (i32.const 0)) "" "a" "bc" "")
  (data $d1 (i32.const 0))
  (data $d2 (i32.const 1) "a" "" "bcd")
  (data $d3 (offset (i32.const 0)))
  (data $d4 (offset (i32.const 0)) "" "a" "bc" "")
  (data $d5 (memory 0) (i32.const 0))
  (data $d6 (memory 0x0) (i32.const 1) "a" "" "bcd")
  (data $d7 (memory 0x000) (offset (i32.const 0)))
  (data $d8 (memory 0) (offset (i32.const 0)) "" "a" "bc" "")
  (data $d9 (memory $m) (i32.const 0))
  (data $d10 (memory $m) (i32.const 1) "a" "" "bcd")
  (data $d11 (memory $m) (offset (i32.const 0)))
  (data $d12 (memory $m) (offset (i32.const 0)) "" "a" "bc" "")
  `
  // inline(src)
  let mod = new WebAssembly.Module(compile(src))
  new WebAssembly.Instance(mod)
  // NOTE: https://github.com/WebAssembly/wabt/issues/2518 - libwabt is corrupted
  // is(compile(parse(src)), wat2wasm(src).buffer)
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

t('case: export order initialize', () => {
  let src
  src = `
  (memory (export "m") 5)
  (func (export "f"))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
    (func (export "f"))
    (memory (export "m") 5)
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
    (memory (export "m") 5)
    (func (export "f"))
    (func (export "g"))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
    (func (export "f"))
    (memory (export "m") 5)
    (func (export "g"))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
    (func (export "g"))
    (func (export "f"))
    (memory (export "m") 5)
  `
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('case: start index', () => {
  let src = `
  (import "a" "b" (func $a (param i32)))
  (func (param i32))
  (start 1)
  `
  is(compile(parse(src)), wat2wasm(src).buffer)
})


// extensions
t('feature: multiple results', () => {
  let src = `(func (block (result i32 i32) (i32.const 1) (i32.const 2)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  let src2 = `(func (block (result f32 f64) (i32.const 1) (i32.const 2)))`
  is(compile(parse(src2)), wat2wasm(src2).buffer)

  let src3 = `(func (result f32 f64) (i32.const 1) (i32.const 2))`
  is(compile(parse(src3)), wat2wasm(src3).buffer)

  let src4 = `(func (if (result i32 i32) (i32.const 0) (then (i32.const 1)(i32.const 2))))`
  is(compile(parse(src4)), wat2wasm(src4).buffer)

  // FIXME: I think else is optional at the end https://webassembly.github.io/spec/core/text/instructions.html#abbreviations which wabt doesn't do
  // must be an error in wabt
  // let src5 = `(func (if (result i32 i32 i32) (i32.const 0)(i32.const 1)(i32.const 2)))`
  // is(compile(parse(src5)), wat2wasm(src5).buffer)
})

t('feature: bulk memory', () => {
  let src = `
  (memory 1 1)
  (data "abc")
  (func $x (result f64)
    (local i32)
    (memory.copy (local.get 0)(i32.const 0)(i32.const 16))
    (memory.fill (local.get 0)(i32.const 0)(i32.const 16))
    (memory.init 0 (local.get 0)(i32.const 0)(i32.const 16))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd load/store', () => {
  // ref: https://github.com/WebAssembly/simd/tree/master/test/core/simd
  let src = `;; Load/Store v128 data with different valid offset/alignment
    (data (i32.const 0) "\\00\\01\\02\\03\\04\\05\\06\\07\\08\\09\\10\\11\\12\\13\\14\\15")
    (data (offset (i32.const 65505)) "\\16\\17\\18\\19\\20\\21\\22\\23\\24\\25\\26\\27\\28\\29\\30\\31")

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
    )`

  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (result v128)
    (v128.store offset=0 (i32.const 0) (v128.const f32x4 0 1 2 3))
    (v128.load offset=0 (i32.const 0))
  )
  (func (result v128)
    (v128.store align=1 (i32.const 0) (v128.const i32x4 0 1 2 3))
    (v128.load align=1 (i32.const 0))
  )
  (func (result v128)
    (v128.store offset=1 align=1 (i32.const 0) (v128.const i16x8 0 1 2 3 4 5 6 7))
    (v128.load offset=1 align=1 (i32.const 0))
  )
  (func (result v128)
    (v128.store offset=2 align=1 (i32.const 0) (v128.const i8x16 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15))
    (v128.load offset=2 align=1 (i32.const 0))
  )
  (func (result v128)
    (v128.store offset=15 align=1 (i32.const 0) (v128.const i32x4 0 1 2 3))
    (v128.load offset=15 (i32.const 0))
  )
  (func (result v128)
    (v128.store offset=65520 align=1 (i32.const 0) (v128.const i32x4 0 1 2 3))
    (v128.load offset=65520 (i32.const 0))
  )
  (func (param $i i32)
    (v128.store offset=1 align=1 (local.get $i) (v128.const i32x4 0 1 2 3))
  )
  `

  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
  (func
    (drop (v128.load8x8_s (i32.const 0)))
    (drop (v128.load8x8_s align=1 (i32.const 0)))
    (drop (v128.load8x8_s align=2 (i32.const 0)))
    (drop (v128.load8x8_s align=4 (i32.const 0)))
    (drop (v128.load8x8_s align=8 (i32.const 0)))
    (drop (v128.load8x8_u (i32.const 0)))
    (drop (v128.load8x8_u align=1 (i32.const 0)))
    (drop (v128.load8x8_u align=2 (i32.const 0)))
    (drop (v128.load8x8_u align=4 (i32.const 0)))
    (drop (v128.load8x8_u align=8 (i32.const 0)))
    (drop (v128.load16x4_s (i32.const 0)))
    (drop (v128.load16x4_s align=1 (i32.const 0)))
    (drop (v128.load16x4_s align=2 (i32.const 0)))
    (drop (v128.load16x4_s align=4 (i32.const 0)))
    (drop (v128.load16x4_s align=8 (i32.const 0)))
    (drop (v128.load16x4_u (i32.const 0)))
    (drop (v128.load16x4_u align=1 (i32.const 0)))
    (drop (v128.load16x4_u align=2 (i32.const 0)))
    (drop (v128.load16x4_u align=4 (i32.const 0)))
    (drop (v128.load16x4_u align=8 (i32.const 0)))
    (drop (v128.load32x2_s (i32.const 0)))
    (drop (v128.load32x2_s align=1 (i32.const 0)))
    (drop (v128.load32x2_s align=2 (i32.const 0)))
    (drop (v128.load32x2_s align=4 (i32.const 0)))
    (drop (v128.load32x2_s align=8 (i32.const 0)))
    (drop (v128.load32x2_u (i32.const 0)))
    (drop (v128.load32x2_u align=1 (i32.const 0)))
    (drop (v128.load32x2_u align=2 (i32.const 0)))
    (drop (v128.load32x2_u align=4 (i32.const 0)))
    (drop (v128.load32x2_u align=8 (i32.const 0)))

    (drop (v128.load8_splat (i32.const 0)))
    (drop (v128.load8_splat align=1 (i32.const 0)))
    (drop (v128.load16_splat (i32.const 0)))
    (drop (v128.load16_splat align=1 (i32.const 0)))
    (drop (v128.load16_splat align=2 (i32.const 0)))
    (drop (v128.load32_splat (i32.const 0)))
    (drop (v128.load32_splat align=1 (i32.const 0)))
    (drop (v128.load32_splat align=2 (i32.const 0)))
    (drop (v128.load32_splat align=4 (i32.const 0)))
    (drop (v128.load64_splat (i32.const 0)))
    (drop (v128.load64_splat align=1 (i32.const 0)))
    (drop (v128.load64_splat align=2 (i32.const 0)))
    (drop (v128.load64_splat align=4 (i32.const 0)))
    (drop (v128.load64_splat align=8 (i32.const 0)))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func
  (drop (v128.load32_zero offset=0 (i32.const 0)))
  (drop (v128.load32_zero align=1 (i32.const 0)))
  (drop (v128.load64_zero offset=0 (i32.const 0)))
  (drop (v128.load64_zero align=1 (i32.const 0)))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func
  (drop (v128.load32_zero offset=0 (i32.const 0)))
  (drop (v128.load32_zero align=1 (i32.const 0)))
  (drop (v128.load64_zero offset=0 (i32.const 0)))
  (drop (v128.load64_zero align=1 (i32.const 0)))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd load_lane', () => {
  let src
  src = `
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 0 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 1 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 2 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 3 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 4 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 5 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 6 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 7 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 8 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 9 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 10 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 11 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 12 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 13 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 14 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane 15 (local.get $address) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=0 0 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=1 1 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=2 2 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=3 3 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=4 4 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=5 5 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=6 6 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=7 7 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=8 8 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=9 9 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=10 10 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=11 11 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=12 12 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=13 13 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=14 14 (i32.const 0) (local.get $x)))
    (func (param $x v128) (result v128) (v128.load8_lane offset=15 15 (i32.const 0) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 0 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 1 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 2 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 3 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 4 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 5 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 6 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 7 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 8 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 9 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 10 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 11 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 12 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 13 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 14 (local.get $address) (local.get $x)))
    (func (param $address i32) (param $x v128) (result v128) (v128.load8_lane align=1 15 (local.get $address) (local.get $x)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 2 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 3 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 4 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 5 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 6 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane 7 (local.get $address) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=0 0 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=1 1 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=2 2 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=3 3 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=4 4 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=5 5 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=6 6 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load16_lane offset=7 7 (i32.const 0) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 2 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 2 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 3 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 3 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 4 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 4 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 5 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 5 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 6 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 6 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=1 7 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load16_lane align=2 7 (local.get $address) (local.get $x)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane 2 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane 3 (local.get $address) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load32_lane offset=0 0 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load32_lane offset=1 1 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load32_lane offset=2 2 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load32_lane offset=3 3 (i32.const 0) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=1 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=2 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=4 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=1 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=2 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=4 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=1 2 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=2 2 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=4 2 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=1 3 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=2 3 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load32_lane align=4 3 (local.get $address) (local.get $x)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane 1 (local.get $address) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load64_lane offset=0 0 (i32.const 0) (local.get $x)))
  (func (param $x v128) (result v128) (v128.load64_lane offset=1 1 (i32.const 0) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=1 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=2 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=4 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=8 0 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=1 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=2 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=4 1 (local.get $address) (local.get $x)))
  (func (param $address i32) (param $x v128) (result v128) (v128.load64_lane align=8 1 (local.get $address) (local.get $x)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd const', () => {
  let src = `(global v128 (v128.const f32x4 1 1 1 1))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(global v128 (v128.const f32x4 nan:0x1 nan:0x1 nan:0x1 nan:0x1))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(global v128 (v128.const f32x4 nan:0x7f_ffff nan:0x7f_ffff nan:0x7f_ffff nan:0x7f_ffff))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  // ref: https://github.com/WebAssembly/simd/tree/master/test/core/simd
  // FIXME: not sure where's that from - globals seem to be not allowed
  src = `
  (global v128 (v128.const i8x16 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF))
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
  (global v128 (v128.const f32x4 nan:0x1 nan:0x1 nan:0x1 nan:0x1))
  (global v128 (v128.const f32x4 nan:0x7f_ffff nan:0x7f_ffff nan:0x7f_ffff nan:0x7f_ffff))
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
  (global v128 (v128.const f64x2 nan:0x1 nan:0x1))
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

t('feature: simd shuffle, swizzle, splat', () => {
  let src = `(func
    (i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 (v128.const f32x4 0 1 2 3) (v128.const f32x4 0 1 2 3))
    (i8x16.swizzle (v128.load (i32.const 0)) (v128.load offset=15 (i32.const 1)))
    (i8x16.splat (i32.const 0))
    (i16x8.splat (i32.const 0))
    (i32x4.splat (i32.const 0))
    (f32x4.splat (i32.const 0))
    (i64x2.splat (i32.const 0))
    (f64x2.splat (i32.const 0))
  )`
  // FIXME: wrong number of immediates test
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd extract/replace/load_spat lane', () => {
  let src

  src = `
    (func (param v128) (result i32) (i8x16.extract_lane_s 0 (local.get 0)))
    (func (param v128) (result i32) (i8x16.extract_lane_s 15 (local.get 0)))
    (func (param v128) (result i32) (i8x16.extract_lane_u 0 (local.get 0)))
    (func (param v128) (result i32) (i8x16.extract_lane_u 15 (local.get 0)))
    (func (param v128) (result i32) (i16x8.extract_lane_s 0 (local.get 0)))
    (func (param v128) (result i32) (i16x8.extract_lane_s 7 (local.get 0)))
    (func (param v128) (result i32) (i16x8.extract_lane_u 0 (local.get 0)))
    (func (param v128) (result i32) (i16x8.extract_lane_u 7 (local.get 0)))
    (func (param v128) (result i32) (i32x4.extract_lane 0 (local.get 0)))
    (func (param v128) (result i32) (i32x4.extract_lane 3 (local.get 0)))
    (func (param v128) (result f32) (f32x4.extract_lane 0 (local.get 0)))
    (func (param v128) (result f32) (f32x4.extract_lane 3 (local.get 0)))
    (func (param v128 i32) (result v128) (i8x16.replace_lane 0 (local.get 0) (local.get 1)))
    (func (param v128 i32) (result v128) (i8x16.replace_lane 15 (local.get 0) (local.get 1)))
    (func (param v128 i32) (result v128) (i16x8.replace_lane 0 (local.get 0) (local.get 1)))
    (func (param v128 i32) (result v128) (i16x8.replace_lane 7 (local.get 0) (local.get 1)))
    (func (param v128 i32) (result v128) (i32x4.replace_lane 0 (local.get 0) (local.get 1)))
    (func (param v128 i32) (result v128) (i32x4.replace_lane 3 (local.get 0) (local.get 1)))
    (func (param v128 f32) (result v128) (f32x4.replace_lane 0 (local.get 0) (local.get 1)))
    (func (param v128 f32) (result v128) (f32x4.replace_lane 3 (local.get 0) (local.get 1)))
    (func (param v128) (result i64) (i64x2.extract_lane 0 (local.get 0)))
    (func (param v128) (result i64) (i64x2.extract_lane 1 (local.get 0)))
    (func (param v128) (result f64) (f64x2.extract_lane 0 (local.get 0)))
    (func (param v128) (result f64) (f64x2.extract_lane 1 (local.get 0)))
    (func (param v128 i64) (result v128) (i64x2.replace_lane 0 (local.get 0) (local.get 1)))
    (func (param v128 i64) (result v128) (i64x2.replace_lane 1 (local.get 0) (local.get 1)))
    (func (param v128 f64) (result v128) (f64x2.replace_lane 0 (local.get 0) (local.get 1)))
    (func (param v128 f64) (result v128) (f64x2.replace_lane 1 (local.get 0) (local.get 1)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `
    (func
      (i8x16.extract_lane_s 0 (v128.load8_splat (i32.const 6)))
      (i8x16.extract_lane_s 0 (v128.load16_splat (i32.const 7)))
      (i8x16.extract_lane_s 0 (v128.load32_splat (i32.const 8)))
      (i8x16.extract_lane_s 0 (v128.load64_splat (i32.const 11)))

      (i8x16.extract_lane_s 0 (v128.load (i32.const 0)))

      (v128.load8x8_s (i32.const 12))
      (v128.load8x8_u (i32.const 12))
      (v128.load16x4_s (i32.const 12))
      (v128.load16x4_u (i32.const 12))
      (v128.load32x2_s (i32.const 12))
      (v128.load32x2_u (i32.const 12))

      (v128.load8x8_s offset=0 align=1 (i32.const 12))
      (v128.load8x8_s offset=20 align=8 (i32.const 12))

      (i32x4.extract_lane 0 (v128.load32_zero (i32.const 12)))
      (i64x2.extract_lane 0 (v128.load64_zero (i32.const 13)))
    )
  `

  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd bit_shift', () => {
  let src
  src = `
    (func (param $0 v128) (param $1 i32) (result v128) (i8x16.shl (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i8x16.shr_s (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i8x16.shr_u (local.get $0) (local.get $1)))

    (func (param $0 v128) (param $1 i32) (result v128) (i16x8.shl (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i16x8.shr_s (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i16x8.shr_u (local.get $0) (local.get $1)))

    (func (param $0 v128) (param $1 i32) (result v128) (i32x4.shl (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i32x4.shr_s (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i32x4.shr_u (local.get $0) (local.get $1)))

    (func (param $0 v128) (param $1 i32) (result v128) (i64x2.shl (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i64x2.shr_s (local.get $0) (local.get $1)))
    (func (param $0 v128) (param $1 i32) (result v128) (i64x2.shr_u (local.get $0) (local.get $1)))

    ;; shifting by a constant amount
    ;; i8x16
    (func (param $0 v128) (result v128) (i8x16.shl (local.get $0) (i32.const 1)))
    (func (param $0 v128) (result v128) (i8x16.shr_u (local.get $0) (i32.const 8)))
    (func (param $0 v128) (result v128) (i8x16.shr_s (local.get $0) (i32.const 9)))

    ;; i16x8
    (func (param $0 v128) (result v128) (i16x8.shl (local.get $0) (i32.const 1)))
    (func (param $0 v128) (result v128) (i16x8.shr_u (local.get $0) (i32.const 16)))
    (func (param $0 v128) (result v128) (i16x8.shr_s (local.get $0) (i32.const 17)))

    ;; i32x4
    (func (param $0 v128) (result v128) (i32x4.shl (local.get $0) (i32.const 1)))
    (func (param $0 v128) (result v128) (i32x4.shr_u (local.get $0) (i32.const 32)))
    (func (param $0 v128) (result v128) (i32x4.shr_s (local.get $0) (i32.const 33)))

    ;; i64x2
    (func (param $0 v128) (result v128) (i64x2.shl (local.get $0) (i32.const 1)))
    (func (param $0 v128) (result v128) (i64x2.shr_u (local.get $0) (i32.const 64)))
    (func (param $0 v128) (result v128) (i64x2.shr_s (local.get $0) (i32.const 65)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd bitwise', () => {
  let src = `(func (export "not") (param $0 v128) (result v128) (v128.not (local.get $0)))
    (func (export "and") (param $0 v128) (param $1 v128) (result v128) (v128.and (local.get $0) (local.get $1)))
    (func (export "or") (param $0 v128) (param $1 v128) (result v128) (v128.or (local.get $0) (local.get $1)))
    (func (export "xor") (param $0 v128) (param $1 v128) (result v128) (v128.xor (local.get $0) (local.get $1)))
    (func (export "bitselect") (param $0 v128) (param $1 v128) (param $2 v128) (result v128)
      (v128.bitselect (local.get $0) (local.get $1) (local.get $2))
    )
    (func (export "andnot") (param $0 v128) (param $1 v128) (result v128) (v128.andnot (local.get $0) (local.get $1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd boolean', () => {
  let src = `
  (func (export "i8x16.any_true") (param $0 v128) (result i32) (v128.any_true (local.get $0)))
  (func (export "i8x16.all_true") (param $0 v128) (result i32) (i8x16.all_true (local.get $0)))
  (func (export "i8x16.bitmask") (param $0 v128) (result i32) (i8x16.bitmask (local.get $0)))

  (func (export "i16x8.any_true") (param $0 v128) (result i32) (v128.any_true (local.get $0)))
  (func (export "i16x8.all_true") (param $0 v128) (result i32) (i16x8.all_true (local.get $0)))
  (func (export "i16x8.bitmask") (param $0 v128) (result i32) (i16x8.bitmask (local.get $0)))

  (func (export "i32x4.any_true") (param $0 v128) (result i32) (v128.any_true (local.get $0)))
  (func (export "i32x4.all_true") (param $0 v128) (result i32) (i32x4.all_true (local.get $0)))
  (func (export "i32x4.bitmask") (param $0 v128) (result i32) (i32x4.bitmask (local.get $0)))

  (func (export "i64x2.all_true") (param $0 v128) (result i32) (i64x2.all_true (local.get $0)))
  (func (export "i64x2.bitmask") (param $0 v128) (result i32) (i64x2.bitmask (local.get $0)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd conversion', () => {
  let src = `
  ;; Integer to floating point
  (func (export "f32x4.convert_i32x4_s") (param v128) (result v128)
    (f32x4.convert_i32x4_s (local.get 0)))
  (func (export "f32x4.convert_i32x4_u") (param v128) (result v128)
    (f32x4.convert_i32x4_u (local.get 0)))

  (func (export "f64x2.convert_low_i32x4_s") (param v128) (result v128)
    (f64x2.convert_low_i32x4_s (local.get 0)))
  (func (export "f64x2.convert_low_i32x4_u") (param v128) (result v128)
    (f64x2.convert_low_i32x4_u (local.get 0)))

  ;; Integer to integer narrowing
  (func (export "i8x16.narrow_i16x8_s") (param v128 v128) (result v128)
    (i8x16.narrow_i16x8_s (local.get 0) (local.get 1)))
  (func (export "i8x16.narrow_i16x8_u") (param v128 v128) (result v128)
    (i8x16.narrow_i16x8_u (local.get 0) (local.get 1)))
  (func (export "i16x8.narrow_i32x4_s") (param v128 v128) (result v128)
    (i16x8.narrow_i32x4_s (local.get 0) (local.get 1)))
  (func (export "i16x8.narrow_i32x4_u") (param v128 v128) (result v128)
    (i16x8.narrow_i32x4_u (local.get 0)(local.get 1)))

  ;; Float to float promote/demote
  (func (export "f64x2.promote_low_f32x4") (param v128) (result v128)
    (f64x2.promote_low_f32x4 (local.get 0)))
  (func (export "f32x4.demote_f64x2_zero") (param v128) (result v128)
    (f32x4.demote_f64x2_zero (local.get 0)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd f32x4', () => {
  let src = `(func (export "f32x4.min") (param v128 v128) (result v128) (f32x4.min (local.get 0) (local.get 1)))
  (func (export "f32x4.max") (param v128 v128) (result v128) (f32x4.max (local.get 0) (local.get 1)))
  (func (export "f32x4.abs") (param v128) (result v128) (f32x4.abs (local.get 0)))
  ;; f32x4.min const vs const
  (func (export "f32x4.min_with_const_0") (result v128) (f32x4.min (v128.const f32x4 0 1 2 -3) (v128.const f32x4 0 2 1 3)))
  (func (export "f32x4.min_with_const_1") (result v128) (f32x4.min (v128.const f32x4 0 1 2 3) (v128.const f32x4 0 1 2 3)))
  (func (export "f32x4.min_with_const_2") (result v128) (f32x4.min (v128.const f32x4 0x00 0x01 0x02 0x80000000) (v128.const f32x4 0x00 0x02 0x01 2147483648)))
  (func (export "f32x4.min_with_const_3") (result v128) (f32x4.min (v128.const f32x4 0x00 0x01 0x02 0x80000000) (v128.const f32x4 0x00 0x01 0x02 0x80000000)))
  ;; f32x4.min param vs const
  (func (export "f32x4.min_with_const_5")(param v128) (result v128) (f32x4.min (local.get 0) (v128.const f32x4 0 1 2 -3)))
  (func (export "f32x4.min_with_const_6")(param v128) (result v128) (f32x4.min (v128.const f32x4 0 1 2 3) (local.get 0)))
  (func (export "f32x4.min_with_const_7")(param v128) (result v128) (f32x4.min (v128.const f32x4 0x00 0x01 0x02 0x80000000) (local.get 0)))
  (func (export "f32x4.min_with_const_8")(param v128) (result v128) (f32x4.min (local.get 0) (v128.const f32x4 0x00 0x01 0x02 0x80000000)))
  ;; f32x4.max const vs const
  (func (export "f32x4.max_with_const_10") (result v128) (f32x4.max (v128.const f32x4 0 1 2 -3) (v128.const f32x4 0 2 1 3)))
  (func (export "f32x4.max_with_const_11") (result v128) (f32x4.max (v128.const f32x4 0 1 2 3) (v128.const f32x4 0 1 2 3)))
  (func (export "f32x4.max_with_const_12") (result v128) (f32x4.max (v128.const f32x4 0x00 0x01 0x02 0x80000000) (v128.const f32x4 0x00 0x02 0x01 2147483648)))
  (func (export "f32x4.max_with_const_13") (result v128) (f32x4.max (v128.const f32x4 0x00 0x01 0x02 0x80000000) (v128.const f32x4 0x00 0x01 0x02 0x80000000)))
  ;; f32x4.max param vs const
  (func (export "f32x4.max_with_const_15")(param v128) (result v128) (f32x4.max (local.get 0) (v128.const f32x4 0 1 2 -3)))
  (func (export "f32x4.max_with_const_16")(param v128) (result v128) (f32x4.max (v128.const f32x4 0 1 2 3) (local.get 0)))
  (func (export "f32x4.max_with_const_17")(param v128) (result v128) (f32x4.max (v128.const f32x4 0x00 0x01 0x02 0x80000000) (local.get 0)))
  (func (export "f32x4.max_with_const_18")(param v128) (result v128) (f32x4.max (local.get 0) (v128.const f32x4 0x00 0x01 0x02 0x80000000)))

  (func (export "f32x4.abs_with_const") (result v128) (f32x4.abs (v128.const f32x4 -0 -1 -2 -3)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "f32x4.add") (param v128 v128) (result v128) (f32x4.add (local.get 0) (local.get 1)))
  (func (export "f32x4.sub") (param v128 v128) (result v128) (f32x4.sub (local.get 0) (local.get 1)))
  (func (export "f32x4.mul") (param v128 v128) (result v128) (f32x4.mul (local.get 0) (local.get 1)))
  (func (export "f32x4.div") (param v128 v128) (result v128) (f32x4.div (local.get 0) (local.get 1)))
  (func (export "f32x4.neg") (param v128) (result v128) (f32x4.neg (local.get 0)))
  (func (export "f32x4.sqrt") (param v128) (result v128) (f32x4.sqrt (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "eq") (param $x v128) (param $y v128) (result v128) (f32x4.eq (local.get $x) (local.get $y)))
  (func (export "ne") (param $x v128) (param $y v128) (result v128) (f32x4.ne (local.get $x) (local.get $y)))
  (func (export "lt") (param $x v128) (param $y v128) (result v128) (f32x4.lt (local.get $x) (local.get $y)))
  (func (export "le") (param $x v128) (param $y v128) (result v128) (f32x4.le (local.get $x) (local.get $y)))
  (func (export "gt") (param $x v128) (param $y v128) (result v128) (f32x4.gt (local.get $x) (local.get $y)))
  (func (export "ge") (param $x v128) (param $y v128) (result v128) (f32x4.ge (local.get $x) (local.get $y)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "f32x4.pmin") (param v128 v128) (result v128) (f32x4.pmin (local.get 0) (local.get 1)))
  (func (export "f32x4.pmax") (param v128 v128) (result v128) (f32x4.pmax (local.get 0) (local.get 1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "f32x4.ceil") (param v128) (result v128) (f32x4.ceil (local.get 0)))
  (func (export "f32x4.floor") (param v128) (result v128) (f32x4.floor (local.get 0)))
  (func (export "f32x4.trunc") (param v128) (result v128) (f32x4.trunc (local.get 0)))
  (func (export "f32x4.nearest") (param v128) (result v128) (f32x4.nearest (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd f64x2', () => {
  let src = `(func (export "f64x2.min") (param v128 v128) (result v128) (f64x2.min (local.get 0) (local.get 1)))
  (func (export "f64x2.max") (param v128 v128) (result v128) (f64x2.max (local.get 0) (local.get 1)))
  (func (export "f64x2.abs") (param v128) (result v128) (f64x2.abs (local.get 0)))
  ;; f64x2.min const vs const
  (func (export "f64x2.min_with_const_0") (result v128) (f64x2.min (v128.const f64x2 0 1) (v128.const f64x2 0 2)))
  (func (export "f64x2.min_with_const_1") (result v128) (f64x2.min (v128.const f64x2 2 -3) (v128.const f64x2 1 3)))
  (func (export "f64x2.min_with_const_2") (result v128) (f64x2.min (v128.const f64x2 0 1) (v128.const f64x2 0 1)))
  (func (export "f64x2.min_with_const_3") (result v128) (f64x2.min (v128.const f64x2 2 3) (v128.const f64x2 2 3)))
  (func (export "f64x2.min_with_const_4") (result v128) (f64x2.min (v128.const f64x2 0x00 0x01) (v128.const f64x2 0x00 0x02)))
  (func (export "f64x2.min_with_const_5") (result v128) (f64x2.min (v128.const f64x2 0x02 0x80000000) (v128.const f64x2 0x01 2147483648)))
  (func (export "f64x2.min_with_const_6") (result v128) (f64x2.min (v128.const f64x2 0x00 0x01) (v128.const f64x2 0x00 0x01)))
  (func (export "f64x2.min_with_const_7") (result v128) (f64x2.min (v128.const f64x2 0x02 0x80000000) (v128.const f64x2 0x02 0x80000000)))
  ;; f64x2.min param vs const
  (func (export "f64x2.min_with_const_9") (param v128) (result v128) (f64x2.min (local.get 0) (v128.const f64x2 0 1)))
  (func (export "f64x2.min_with_const_10") (param v128) (result v128) (f64x2.min (v128.const f64x2 2 -3) (local.get 0)))
  (func (export "f64x2.min_with_const_11") (param v128) (result v128) (f64x2.min (v128.const f64x2 0 1) (local.get 0)))
  (func (export "f64x2.min_with_const_12") (param v128) (result v128) (f64x2.min (local.get 0) (v128.const f64x2 2 3)))
  (func (export "f64x2.min_with_const_13") (param v128) (result v128) (f64x2.min (v128.const f64x2 0x00 0x01) (local.get 0)))
  (func (export "f64x2.min_with_const_14") (param v128) (result v128) (f64x2.min (v128.const f64x2 0x02 0x80000000) (local.get 0)))
  (func (export "f64x2.min_with_const_15") (param v128) (result v128) (f64x2.min (v128.const f64x2 0x00 0x01) (local.get 0)))
  (func (export "f64x2.min_with_const_16") (param v128) (result v128) (f64x2.min (v128.const f64x2 0x02 0x80000000) (local.get 0)))
  ;; f64x2.max const vs const
  (func (export "f64x2.max_with_const_18") (result v128) (f64x2.max (v128.const f64x2 0 1) (v128.const f64x2 0 2)))
  (func (export "f64x2.max_with_const_19") (result v128) (f64x2.max (v128.const f64x2 2 -3) (v128.const f64x2 1 3)))
  (func (export "f64x2.max_with_const_20") (result v128) (f64x2.max (v128.const f64x2 0 1) (v128.const f64x2 0 1)))
  (func (export "f64x2.max_with_const_21") (result v128) (f64x2.max (v128.const f64x2 2 3) (v128.const f64x2 2 3)))
  (func (export "f64x2.max_with_const_22") (result v128) (f64x2.max (v128.const f64x2 0x00 0x01) (v128.const f64x2 0x00 0x02)))
  (func (export "f64x2.max_with_const_23") (result v128) (f64x2.max (v128.const f64x2 0x02 0x80000000) (v128.const f64x2 0x01 2147483648)))
  (func (export "f64x2.max_with_const_24") (result v128) (f64x2.max (v128.const f64x2 0x00 0x01) (v128.const f64x2 0x00 0x01)))
  (func (export "f64x2.max_with_const_25") (result v128) (f64x2.max (v128.const f64x2 0x02 0x80000000) (v128.const f64x2 0x02 0x80000000)))
  ;; f64x2.max param vs const
  (func (export "f64x2.max_with_const_27") (param v128) (result v128) (f64x2.max (local.get 0) (v128.const f64x2 0 1)))
  (func (export "f64x2.max_with_const_28") (param v128) (result v128) (f64x2.max (v128.const f64x2 2 -3) (local.get 0)))
  (func (export "f64x2.max_with_const_29") (param v128) (result v128) (f64x2.max (v128.const f64x2 0 1) (local.get 0)))
  (func (export "f64x2.max_with_const_30") (param v128) (result v128) (f64x2.max (local.get 0) (v128.const f64x2 2 3)))
  (func (export "f64x2.max_with_const_31") (param v128) (result v128) (f64x2.max (v128.const f64x2 0x00 0x01) (local.get 0)))
  (func (export "f64x2.max_with_const_32") (param v128) (result v128) (f64x2.max (v128.const f64x2 0x02 0x80000000) (local.get 0)))
  (func (export "f64x2.max_with_const_33") (param v128) (result v128) (f64x2.max (v128.const f64x2 0x00 0x01) (local.get 0)))
  (func (export "f64x2.max_with_const_34") (param v128) (result v128) (f64x2.max (v128.const f64x2 0x02 0x80000000) (local.get 0)))

  (func (export "f64x2.abs_with_const_35") (result v128) (f64x2.abs (v128.const f64x2 -0 -1)))
  (func (export "f64x2.abs_with_const_36") (result v128) (f64x2.abs (v128.const f64x2 -2 -3)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "f64x2.add") (param v128 v128) (result v128) (f64x2.add (local.get 0) (local.get 1)))
  (func (export "f64x2.sub") (param v128 v128) (result v128) (f64x2.sub (local.get 0) (local.get 1)))
  (func (export "f64x2.mul") (param v128 v128) (result v128) (f64x2.mul (local.get 0) (local.get 1)))
  (func (export "f64x2.div") (param v128 v128) (result v128) (f64x2.div (local.get 0) (local.get 1)))
  (func (export "f64x2.neg") (param v128) (result v128) (f64x2.neg (local.get 0)))
  (func (export "f64x2.sqrt") (param v128) (result v128) (f64x2.sqrt (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "f64x2.eq") (param v128 v128) (result v128) (f64x2.eq (local.get 0) (local.get 1)))
  (func (export "f64x2.ne") (param v128 v128) (result v128) (f64x2.ne (local.get 0) (local.get 1)))
  (func (export "f64x2.lt") (param v128 v128) (result v128) (f64x2.lt (local.get 0) (local.get 1)))
  (func (export "f64x2.le") (param v128 v128) (result v128) (f64x2.le (local.get 0) (local.get 1)))
  (func (export "f64x2.gt") (param v128 v128) (result v128) (f64x2.gt (local.get 0) (local.get 1)))
  (func (export "f64x2.ge") (param v128 v128) (result v128) (f64x2.ge (local.get 0) (local.get 1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "f64x2.pmin") (param v128 v128) (result v128) (f64x2.pmin (local.get 0) (local.get 1)))
  (func (export "f64x2.pmax") (param v128 v128) (result v128) (f64x2.pmax (local.get 0) (local.get 1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "f64x2.ceil") (param v128) (result v128) (f64x2.ceil (local.get 0)))
  (func (export "f64x2.floor") (param v128) (result v128) (f64x2.floor (local.get 0)))
  (func (export "f64x2.trunc") (param v128) (result v128) (f64x2.trunc (local.get 0)))
  (func (export "f64x2.nearest") (param v128) (result v128) (f64x2.nearest (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd i16x8', () => {
  let src = `(func (export "i16x8.add") (param v128 v128) (result v128) (i16x8.add (local.get 0) (local.get 1)))
  (func (export "i16x8.sub") (param v128 v128) (result v128) (i16x8.sub (local.get 0) (local.get 1)))
  (func (export "i16x8.mul") (param v128 v128) (result v128) (i16x8.mul (local.get 0) (local.get 1)))
  (func (export "i16x8.neg") (param v128) (result v128) (i16x8.neg (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i16x8.min_s") (param v128 v128) (result v128) (i16x8.min_s (local.get 0) (local.get 1)))
  (func (export "i16x8.min_u") (param v128 v128) (result v128) (i16x8.min_u (local.get 0) (local.get 1)))
  (func (export "i16x8.max_s") (param v128 v128) (result v128) (i16x8.max_s (local.get 0) (local.get 1)))
  (func (export "i16x8.max_u") (param v128 v128) (result v128) (i16x8.max_u (local.get 0) (local.get 1)))
  (func (export "i16x8.avgr_u") (param v128 v128) (result v128) (i16x8.avgr_u (local.get 0) (local.get 1)))
  (func (export "i16x8.abs") (param v128) (result v128) (i16x8.abs (local.get 0)))
  (func (export "i16x8.min_s_with_const_0") (result v128) (i16x8.min_s (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535) (v128.const i16x8 65535 65535 16384 16384 32767 32767 -32768 -32768)))
  (func (export "i16x8.min_s_with_const_1") (result v128) (i16x8.min_s (v128.const i16x8 0 0 1 1 2 2 3 3) (v128.const i16x8 3 3 2 2 1 1 0 0)))
  (func (export "i16x8.min_u_with_const_2") (result v128) (i16x8.min_u (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535) (v128.const i16x8 65535 65535 16384 16384 32767 32767 -32768 -32768)))
  (func (export "i16x8.min_u_with_const_3") (result v128) (i16x8.min_u (v128.const i16x8 0 0 1 1 2 2 3 3) (v128.const i16x8 3 3 2 2 1 1 0 0)))
  (func (export "i16x8.max_s_with_const_4") (result v128) (i16x8.max_s (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535) (v128.const i16x8 65535 65535 16384 16384 32767 32767 -32768 -32768)))
  (func (export "i16x8.max_s_with_const_5") (result v128) (i16x8.max_s (v128.const i16x8 0 0 1 1 2 2 3 3) (v128.const i16x8 3 3 2 2 1 1 0 0)))
  (func (export "i16x8.max_u_with_const_6") (result v128) (i16x8.max_u (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535) (v128.const i16x8 65535 65535 16384 16384 32767 32767 -32768 -32768)))
  (func (export "i16x8.max_u_with_const_7") (result v128) (i16x8.max_u (v128.const i16x8 0 0 1 1 2 2 3 3) (v128.const i16x8 3 3 2 2 1 1 0 0)))
  (func (export "i16x8.avgr_u_with_const_8") (result v128) (i16x8.avgr_u (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535) (v128.const i16x8 65535 65535 16384 16384 32767 32767 -32768 -32768)))
  (func (export "i16x8.avgr_u_with_const_9") (result v128) (i16x8.avgr_u (v128.const i16x8 0 0 1 1 2 2 3 3) (v128.const i16x8 3 3 2 2 1 1 0 0)))
  (func (export "i16x8.abs_with_const_10") (result v128) (i16x8.abs (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535)))
  (func (export "i16x8.min_s_with_const_11") (param v128) (result v128) (i16x8.min_s (local.get 0) (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535)))
  (func (export "i16x8.min_s_with_const_12") (param v128) (result v128) (i16x8.min_s (local.get 0) (v128.const i16x8 0 0 1 1 2 2 3 3)))
  (func (export "i16x8.min_u_with_const_13") (param v128) (result v128) (i16x8.min_u (local.get 0) (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535)))
  (func (export "i16x8.min_u_with_const_14") (param v128) (result v128) (i16x8.min_u (local.get 0) (v128.const i16x8 0 0 1 1 2 2 3 3)))
  (func (export "i16x8.max_s_with_const_15") (param v128) (result v128) (i16x8.max_s (local.get 0) (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535)))
  (func (export "i16x8.max_s_with_const_16") (param v128) (result v128) (i16x8.max_s (local.get 0) (v128.const i16x8 0 0 1 1 2 2 3 3)))
  (func (export "i16x8.max_u_with_const_17") (param v128) (result v128) (i16x8.max_u (local.get 0) (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535)))
  (func (export "i16x8.max_u_with_const_18") (param v128) (result v128) (i16x8.max_u (local.get 0) (v128.const i16x8 0 0 1 1 2 2 3 3)))
  (func (export "i16x8.avgr_u_with_const_19") (param v128) (result v128) (i16x8.avgr_u (local.get 0) (v128.const i16x8 -32768 -32768 32767 32767 16384 16384 65535 65535)))
  (func (export "i16x8.avgr_u_with_const_20") (param v128) (result v128) (i16x8.avgr_u (local.get 0) (v128.const i16x8 0 0 1 1 2 2 3 3)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = ` (func (export "eq") (param $x v128) (param $y v128) (result v128) (i16x8.eq (local.get $x) (local.get $y)))
  (func (export "ne") (param $x v128) (param $y v128) (result v128) (i16x8.ne (local.get $x) (local.get $y)))
  (func (export "lt_s") (param $x v128) (param $y v128) (result v128) (i16x8.lt_s (local.get $x) (local.get $y)))
  (func (export "lt_u") (param $x v128) (param $y v128) (result v128) (i16x8.lt_u (local.get $x) (local.get $y)))
  (func (export "le_s") (param $x v128) (param $y v128) (result v128) (i16x8.le_s (local.get $x) (local.get $y)))
  (func (export "le_u") (param $x v128) (param $y v128) (result v128) (i16x8.le_u (local.get $x) (local.get $y)))
  (func (export "gt_s") (param $x v128) (param $y v128) (result v128) (i16x8.gt_s (local.get $x) (local.get $y)))
  (func (export "gt_u") (param $x v128) (param $y v128) (result v128) (i16x8.gt_u (local.get $x) (local.get $y)))
  (func (export "ge_s") (param $x v128) (param $y v128) (result v128) (i16x8.ge_s (local.get $x) (local.get $y)))
  (func (export "ge_u") (param $x v128) (param $y v128) (result v128) (i16x8.ge_u (local.get $x) (local.get $y)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i16x8.extadd_pairwise_i8x16_s") (param v128) (result v128) (i16x8.extadd_pairwise_i8x16_s (local.get 0)))
  (func (export "i16x8.extadd_pairwise_i8x16_u") (param v128) (result v128) (i16x8.extadd_pairwise_i8x16_u (local.get 0)))

  (func (export "i16x8.extmul_low_i8x16_s") (param v128 v128) (result v128) (i16x8.extmul_low_i8x16_s (local.get 0) (local.get 1)))
  (func (export "i16x8.extmul_high_i8x16_s") (param v128 v128) (result v128) (i16x8.extmul_high_i8x16_s (local.get 0) (local.get 1)))
  (func (export "i16x8.extmul_low_i8x16_u") (param v128 v128) (result v128) (i16x8.extmul_low_i8x16_u (local.get 0) (local.get 1)))
  (func (export "i16x8.extmul_high_i8x16_u") (param v128 v128) (result v128) (i16x8.extmul_high_i8x16_u (local.get 0) (local.get 1)))

  (func (export "i16x8.q15mulr_sat_s") (param v128 v128) (result v128) (i16x8.q15mulr_sat_s (local.get 0) (local.get 1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i16x8.add_sat_s") (param v128 v128) (result v128) (i16x8.add_sat_s (local.get 0) (local.get 1)))
  (func (export "i16x8.add_sat_u") (param v128 v128) (result v128) (i16x8.add_sat_u (local.get 0) (local.get 1)))
  (func (export "i16x8.sub_sat_s") (param v128 v128) (result v128) (i16x8.sub_sat_s (local.get 0) (local.get 1)))
  (func (export "i16x8.sub_sat_u") (param v128 v128) (result v128) (i16x8.sub_sat_u (local.get 0) (local.get 1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd i32x4', () => {
  let src = `
  (func (export "i32x4.add") (param v128 v128) (result v128) (i32x4.add (local.get 0) (local.get 1)))
  (func (export "i32x4.sub") (param v128 v128) (result v128) (i32x4.sub (local.get 0) (local.get 1)))
  (func (export "i32x4.mul") (param v128 v128) (result v128) (i32x4.mul (local.get 0) (local.get 1)))
  (func (export "i32x4.neg") (param v128) (result v128) (i32x4.neg (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i32x4.min_s") (param v128 v128) (result v128) (i32x4.min_s (local.get 0) (local.get 1)))
  (func (export "i32x4.min_u") (param v128 v128) (result v128) (i32x4.min_u (local.get 0) (local.get 1)))
  (func (export "i32x4.max_s") (param v128 v128) (result v128) (i32x4.max_s (local.get 0) (local.get 1)))
  (func (export "i32x4.max_u") (param v128 v128) (result v128) (i32x4.max_u (local.get 0) (local.get 1)))
  (func (export "i32x4.abs") (param v128) (result v128) (i32x4.abs (local.get 0)))
  (func (export "i32x4.min_s_with_const_0") (result v128) (i32x4.min_s (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295) (v128.const i32x4 4294967295 1073741824 2147483647 -2147483648)))
  (func (export "i32x4.min_s_with_const_1") (result v128) (i32x4.min_s (v128.const i32x4 0 1 2 3) (v128.const i32x4 3 2 1 0)))
  (func (export "i32x4.min_u_with_const_2") (result v128) (i32x4.min_u (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295) (v128.const i32x4 4294967295 1073741824 2147483647 -2147483648)))
  (func (export "i32x4.min_u_with_const_3") (result v128) (i32x4.min_u (v128.const i32x4 0 1 2 3) (v128.const i32x4 3 2 1 0)))
  (func (export "i32x4.max_s_with_const_4") (result v128) (i32x4.max_s (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295) (v128.const i32x4 4294967295 1073741824 2147483647 -2147483648)))
  (func (export "i32x4.max_s_with_const_5") (result v128) (i32x4.max_s (v128.const i32x4 0 1 2 3) (v128.const i32x4 3 2 1 0)))
  (func (export "i32x4.max_u_with_const_6") (result v128) (i32x4.max_u (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295) (v128.const i32x4 4294967295 1073741824 2147483647 -2147483648)))
  (func (export "i32x4.max_u_with_const_7") (result v128) (i32x4.max_u (v128.const i32x4 0 1 2 3) (v128.const i32x4 3 2 1 0)))
  (func (export "i32x4.abs_with_const_8") (result v128) (i32x4.abs (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295)))
  (func (export "i32x4.min_s_with_const_9") (param v128) (result v128) (i32x4.min_s (local.get 0) (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295)))
  (func (export "i32x4.min_s_with_const_10") (param v128) (result v128) (i32x4.min_s (local.get 0) (v128.const i32x4 0 1 2 3)))
  (func (export "i32x4.min_u_with_const_11") (param v128) (result v128) (i32x4.min_u (local.get 0) (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295)))
  (func (export "i32x4.min_u_with_const_12") (param v128) (result v128) (i32x4.min_u (local.get 0) (v128.const i32x4 0 1 2 3)))
  (func (export "i32x4.max_s_with_const_13") (param v128) (result v128) (i32x4.max_s (local.get 0) (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295)))
  (func (export "i32x4.max_s_with_const_14") (param v128) (result v128) (i32x4.max_s (local.get 0) (v128.const i32x4 0 1 2 3)))
  (func (export "i32x4.max_u_with_const_15") (param v128) (result v128) (i32x4.max_u (local.get 0) (v128.const i32x4 -2147483648 2147483647 1073741824 4294967295)))
  (func (export "i32x4.max_u_with_const_16") (param v128) (result v128) (i32x4.max_u (local.get 0) (v128.const i32x4 0 1 2 3)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i32x4.dot_i16x8_s") (param v128 v128) (result v128) (i32x4.dot_i16x8_s (local.get 0) (local.get 1)))
  (func (export "i32x4.extadd_pairwise_i16x8_s") (param v128) (result v128) (i32x4.extadd_pairwise_i16x8_s (local.get 0)))
  (func (export "i32x4.extadd_pairwise_i16x8_u") (param v128) (result v128) (i32x4.extadd_pairwise_i16x8_u (local.get 0)))
  (func (export "i32x4.extmul_low_i16x8_s") (param v128 v128) (result v128) (i32x4.extmul_low_i16x8_s (local.get 0) (local.get 1)))
  (func (export "i32x4.extmul_high_i16x8_s") (param v128 v128) (result v128) (i32x4.extmul_high_i16x8_s (local.get 0) (local.get 1)))
  (func (export "i32x4.extmul_low_i16x8_u") (param v128 v128) (result v128) (i32x4.extmul_low_i16x8_u (local.get 0) (local.get 1)))
  (func (export "i32x4.extmul_high_i16x8_u") (param v128 v128) (result v128) (i32x4.extmul_high_i16x8_u (local.get 0) (local.get 1)))
  (func (export "i32x4.trunc_sat_f32x4_s") (param v128) (result v128) (i32x4.trunc_sat_f32x4_s (local.get 0)))
  (func (export "i32x4.trunc_sat_f32x4_u") (param v128) (result v128) (i32x4.trunc_sat_f32x4_u (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i32x4.trunc_sat_f64x2_s_zero") (param v128) (result v128) (i32x4.trunc_sat_f64x2_s_zero (local.get 0)))
  (func (export "i32x4.trunc_sat_f64x2_u_zero") (param v128) (result v128) (i32x4.trunc_sat_f64x2_u_zero (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: simd i64x2', () => {
  let src = `
  (func (export "i64x2.add") (param v128 v128) (result v128) (i64x2.add (local.get 0) (local.get 1)))
  (func (export "i64x2.sub") (param v128 v128) (result v128) (i64x2.sub (local.get 0) (local.get 1)))
  (func (export "i64x2.mul") (param v128 v128) (result v128) (i64x2.mul (local.get 0) (local.get 1)))
  (func (export "i64x2.neg") (param v128) (result v128) (i64x2.neg (local.get 0)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i64x2.abs") (param v128) (result v128) (i64x2.abs (local.get 0)))
  (func (export "i64x2.abs_with_const_0") (result v128) (i64x2.abs (v128.const i64x2 -9223372036854775808 9223372036854775807)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "eq") (param $x v128) (param $y v128) (result v128) (i64x2.eq (local.get $x) (local.get $y)))
  (func (export "ne") (param $x v128) (param $y v128) (result v128) (i64x2.ne (local.get $x) (local.get $y)))
  (func (export "lt_s") (param $x v128) (param $y v128) (result v128) (i64x2.lt_s (local.get $x) (local.get $y)))
  (func (export "le_s") (param $x v128) (param $y v128) (result v128) (i64x2.le_s (local.get $x) (local.get $y)))
  (func (export "gt_s") (param $x v128) (param $y v128) (result v128) (i64x2.gt_s (local.get $x) (local.get $y)))
  (func (export "ge_s") (param $x v128) (param $y v128) (result v128) (i64x2.ge_s (local.get $x) (local.get $y)))`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(func (export "i64x2.extmul_low_i32x4_s") (param v128 v128) (result v128) (i64x2.extmul_low_i32x4_s (local.get 0) (local.get 1)))
  (func (export "i64x2.extmul_high_i32x4_s") (param v128 v128) (result v128) (i64x2.extmul_high_i32x4_s (local.get 0) (local.get 1)))
  (func (export "i64x2.extmul_low_i32x4_u") (param v128 v128) (result v128) (i64x2.extmul_low_i32x4_u (local.get 0) (local.get 1)))
  (func (export "i64x2.extmul_high_i32x4_u") (param v128 v128) (result v128) (i64x2.extmul_high_i32x4_u (local.get 0) (local.get 1)))`
  is(compile(parse(src)), wat2wasm(src).buffer)
})

t('feature: extended const', () => {
  let src
  src = `
  (global $x i32 (i32.add (i32.const 0) (i32.const 1)))
  (global $y i64 (i64.mul (i64.const 123) (i64.const 456)))
  `
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(module
    (memory 1)
    (data (i32.add (i32.const 0) (i32.const 42)))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(module
  (memory 1)
  (data (i32.sub (i32.const 42) (i32.const 0)))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(module
  (memory 1)
  (data (i32.mul (i32.const 1) (i32.const 2)))
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)

  src = `(module
    (global (import "spectest" "global_i32") i32)
    (memory 1)
    (data (i32.mul
            (i32.const 2)
            (i32.add
              (i32.sub (global.get 0) (i32.const 1))
              (i32.const 2)
            )
          )
    )
  )`
  is(compile(parse(src)), wat2wasm(src).buffer)

  // FIXME: funcref etc
  // src = `(module
  //   (table 10 funcref)
  //   (func (result i32) (i32.const 42))
  //   (func (export "call_in_table") (param i32) (result i32)
  //     (call_indirect (type 0) (local.get 0)))
  //   (elem (table 0) (offset (i32.add (i32.const 1) (i32.const 2))) funcref (ref.func 0))
  // )`
  // is(compile(parse(src)), wat2wasm(src).buffer)


  // (module
  //   (table 10 funcref)
  //   (func (result i32) (i32.const 42))
  //   (func (export "call_in_table") (param i32) (result i32)
  //     (call_indirect (type 0) (local.get 0)))
  //   (elem (table 0) (offset (i32.sub (i32.const 2) (i32.const 1))) funcref (ref.func 0))
  // )


  // (module
  //   (table 10 funcref)
  //   (func (result i32) (i32.const 42))
  //   (func (export "call_in_table") (param i32) (result i32)
  //     (call_indirect (type 0) (local.get 0)))
  //   (elem (table 0) (offset (i32.mul (i32.const 2) (i32.const 2))) funcref (ref.func 0))
  // )


  // (module
  //   (global (import "spectest" "global_i32") i32)
  //   (table 10 funcref)
  //   (func (result i32) (i32.const 42))
  //   (func (export "call_in_table") (param i32) (result i32)
  //     (call_indirect (type 0) (local.get 0)))
  //   (elem (table 0)
  //         (offset
  //           (i32.mul
  //             (i32.const 2)
  //             (i32.add
  //               (i32.sub (global.get 0) (i32.const 665))
  //               (i32.const 2))))
  //         funcref
  //         (ref.func 0))
  // )

})

t('feature: function refs', () => {
  // https://github.com/GoogleChromeLabs/wasm-feature-detect/blob/main/src/detectors/typed-function-references/index.js
  let src
  src = `
    (type (func (param i32) (result i32)))
    (type (func (param (ref 0)) (result i32)))
    (type (func (result i32)))
    (func (type 1) (param (ref 0)) (result i32)
      i32.const 10
      i32.const 42
      local.get 0
      call_ref 0
      i32.add
    )
    (func (type 0) (param i32) (result i32)
      local.get 0
      i32.const 1
      i32.add
    )
    (func (type 2) (result i32)
      ref.func 1
      call 0
    )
    (elem declare func 1)
  `
  inline(src)
  is(compile(parse(src)), Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 16, 3, 96, 1, 127, 1, 127, 96, 1, 100, 0, 1, 127, 96, 0, 1, 127, 3, 4, 3, 1, 0, 2, 9, 5, 1, 3, 0, 1, 1, 10, 28, 3, 11, 0, 65, 10, 65, 42, 32, 0, 20, 0, 106, 11, 7, 0, 32, 0, 65, 1, 106, 11, 6, 0, 210, 1, 16, 0, 11]))

  src = `
    (type $t (func (result i32)))

    (func $nn (param $r (ref $t)) (result i32)
      (call_ref $t
        (block $l (result (ref $t))
          (br_on_non_null $l (local.get $r))
          (return (i32.const -1))
        )
      )
    )
  `
  inline(src)

  src = `
    (type $t (func))
    (func (param $r (ref null $t)) (drop (block (result (ref $t)) (br_on_non_null 0 (local.get $r)) (unreachable))))
    (func (param $r (ref null func)) (drop (block (result (ref func)) (br_on_non_null 0 (local.get $r)) (unreachable))))
    (func (param $r (ref null extern)) (drop (block (result (ref extern)) (br_on_non_null 0 (local.get $r)) (unreachable))))
  `
  inline(src)

  src = `(type $t (func))
  (func $tf)
  (table $t (ref null $t) (elem $tf))
  (func (param i32) (result (ref null $t))
    (block $l1 (result (ref null $t))
      (br_table $l1 (table.get $t (i32.const 0)) (local.get 0))
    )
  )`
  inline(src)

  src = `
  (type $sig (func (param i32 i32 i32) (result i32)))
  (type $t (func))
  (func (param i32) (result (ref null func))
    (block $l1 (result (ref null func))
      (block $l2 (result (ref null $t))
        (br_table $l1 $l2 $l1 (ref.null $t) (local.get 0))
      )
    )
  )
  `
  inline(src)
})

// examples
t('/test/example/table.wat', async function () { await file(this.name) })
t('/test/example/types.wat', async function () { await file(this.name, { console }) })
t('/test/example/global.wat', async function () { await file(this.name, {js: {log: console.log, g1: new WebAssembly.Global({ value:'i32', mutable: true}, 1)}}) })
t('/test/example/multivar.wat', async function () {
  await file(this.name, {
    console, js: {
      mem: new WebAssembly.Memory({ initial: 1, maximum: 2 }),
      blockSize: new WebAssembly.Global({ value: 'i32', mutable: true }, 0)
    }
  })
})
t('/test/example/amp.wat', async function () {
  await file(this.name, {
    console,
    js: {
      mem: new WebAssembly.Memory({ initial: 1, maximum: 2 }),
      blockSize: new WebAssembly.Global({ value: 'i32', mutable: true }, 0)
    }
  })
})
t('/test/example/malloc.wat', async function () { await file(this.name) })
t('/test/example/brownian.wat', async function () { await file(this.name) })
t('/test/example/quine.wat', async function () { await file(this.name) })
t('/test/example/containers.wat', async function () { await file(this.name) })
t('/test/example/fire.wat', async function () { await file(this.name) })
t('/test/example/snake.wat', async function () { await file(this.name) })
t('/test/example/dino.wat', async function () { await file(this.name) })
t('/test/example/raytrace.wat', async function () { await file(this.name) })
t('/test/example/maze.wat', async function () { await file(this.name) })
t('/test/example/metaball.wat', async function () { await file(this.name) })
t('/test/example/loops.wat', async function () { await file(this.name, {console}) })
t('/test/example/memory.wat', async function () { await file(this.name, {js:{log:console.log, mem:new WebAssembly.Memory({maximum:2,shared:false,initial:2})}}) })
t('/test/example/stack.wat', async function () { await file(this.name) })
t('/test/example/raycast.wat', async function () { await file(this.name, { console, Math }) })

t.todo('gc cases', async t => {
  let src
  // src = `(module
  //   (type $t0 (array (ref 0)))
  //   (rec
  //     (type $s0 (array (ref $t0)))
  //     (type $s1 (array (ref $s1)))
  //     (type $s2 (array (ref $s0)))
  //   )
  //   (type $t1 (func))
  // )
  // `
  // // console.hex(compile(src))
  // inline(src)

  src = `
  (rec (type $f1 (func)) (type (struct (field (ref $f1)))))
  (func $f (type $f1))
  `
  console.hex(compile(src))
  inline(src)

})
