import t, { is, ok, same } from 'tst'
import compile from '../src/compile.js'
import parse from '../src/parse.js'
import Wabt from './lib/wabt.js'

// wat-compiler
t('wat-compiler: minimal function', t => {
  let src = '(module (func (export "answer") (result i32) (i32.const 42)))'

  console.time('watr')
  let tree = parse(src)
  compile(tree)
  console.timeEnd('watr')

  is(compile(parse(src)), wat(src).buffer)
})

t('wat-compiler: function with 1 param', t => {
  let src = '(func (export "answer") (param i32) (result i32) (local.get 0))'
  // console.log(compile(parse(src)),wat(src))
  is(compile(parse(src)), wat(src).buffer)
})

t('wat-compiler: function with 1 param', () => {
  let src = `
    (func (export "answer") (param i32) (result i32) (local.get 0))
  `
  let buffer = compile(parse(src))
  is(buffer, wat(src).buffer)

  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)
  let {answer} = instance.exports
  is(answer(42), 42)
})

t('wat-compiler: function with 2 params', () => {
  let src = `
    (func (export "answer") (param i32 i32) (result i32)
      (local.get 0)
      (local.get 1)
      (i32.add)
      )
  `
  let buffer = compile(parse(src))
  is(buffer, wat(src).buffer)

  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)
  let {answer} = instance.exports
  is(answer(20,22), 42)
})

t('wat-compiler: function with 2 params 2 results', () => {
  let src = `
    (func (export "answer") (param i32 i32) (result i32 i32)
      (local.get 0)
      (local.get 1)
      (i32.add)
      (i32.const 666)
      )
  `

  let buffer = compile(parse(src))
  // console.log(wat(src))
  is(buffer, wat(src).buffer)

  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)
  let {answer} = instance.exports
  is(answer(20,22), [42,666])
})

t('wat-compiler: named function named param', () => {
  let src = `
    (func $dbl (export "dbl") (param $a i32) (result i32)
      (i32.add (local.get $a) (local.get $a))
    )
  `

  let buffer = compile(parse(src))
  is(buffer, wat(src).buffer)

  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)
  let {dbl} = instance.exports
  is(dbl(21), 42)
})


t('wat-compiler: call function direct', () => {
  let src = `
  (func $dbl (param $a i32) (result i32)
    (i32.add (local.get $a) (local.get $a))
  )
  (func (export "call_function_direct") (param $a i32) (result i32)
    (call $dbl (local.get $a))
  )
  `

  let buffer = compile(parse(src))
  // console.log(wat(src))
  is(buffer, wat(src).buffer)

  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)
  let {call_function_direct} = instance.exports
  is(call_function_direct(333), 666)
})

t.only('wat-compiler: function param + local', () => {
  let src = `
    (func (export "add") (param $a i32) (result i32)
      (local $b i32)
      (local.tee $b (i32.const 20))
      (i32.add (local.get $a))
    )
  `

  let buffer = compile(parse(src))
  // console.log(wat(src))
  is(buffer, wat(src).buffer)

  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)
  let {add} = instance.exports
  is(add(22), 42)
})

t.todo('wat-compiler: call function indirect (table)', () => buffers(`
  (type $return_i32 (func (result i32)))
  (table 2 funcref)
    (elem (i32.const 0) $f1 $f2)
    (func $f1 (result i32)
      i32.const 42)
    (func $f2 (result i32)
      i32.const 13)
  (func (export "call_function_indirect") (param $a i32) (result i32)
    (call_indirect (type $return_i32) (local.get $a))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(exp)).call_function_indirect(1)).to.equal(13)
  expect((await wasm(act)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(act)).call_function_indirect(1)).to.equal(13)
}))

t.todo('wat-compiler: call function indirect (table) non zero indexed ref types', () => buffers(`
  (type $return_i32 (func (result i32)))
  (type $return_i64 (func (result i64)))
  (table 2 funcref)
    (elem (i32.const 0) $f1 $f2)
    (func $xx (result i32)
      i32.const 42)
    (func $f1 (result i32)
      i32.const 42)
    (func $f2 (result i32)
      i32.const 13)
  (func (export "call_function_indirect") (param $a i32) (result i32)
    (call_indirect (type $return_i32) (local.get $a))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(exp)).call_function_indirect(1)).to.equal(13)
  expect((await wasm(act)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(act)).call_function_indirect(1)).to.equal(13)
}))

t.todo('wat-compiler: 1 global const (immutable)', () => buffers(`
  (global $answer i32 (i32.const 42))
  (func (export "get") (result i32)
    (global.get $answer)
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))

t.todo('wat-compiler: 1 global var (mut)', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (func (export "get") (result i32)
    (global.get $answer)
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))

t.todo('wat-compiler: 1 global var (mut) + mutate', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (func (export "get") (result i32)
    (global.set $answer (i32.const 666))
    (global.get $answer)
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(666)
  expect((await wasm(act)).get()).to.equal(666)
}))

t.todo('wat-compiler: memory.grow', () => buffers(String.raw`
  (memory 1)
  (func (export "main") (result i32)
    (memory.grow (i32.const 2))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo('wat-compiler: local memory page min 1 - data 1 offset 0 i32', () => buffers(String.raw`
  (memory 1)
  (data (i32.const 0) "\2a")
  (func (export "get") (result i32)
    (i32.load (i32.const 0))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))

t.todo('wat-compiler: local memory page min 1 max 2 - data 1 offset 0 i32', () => buffers(String.raw`
  (memory 1 2)
  (data (i32.const 0) "\2a")
  (func (export "get") (result i32)
    i32.const 1
    i32.const 2
    drop
    drop
    i32.const 0
    i32.load offset=0 align=4
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))

t.todo('wat-compiler: import function', () => buffers(`
  (import "math" "add" (func $add (param i32 i32) (result i32)))
  (func (export "call_imported_function") (result i32)
    (call $add (i32.const 20) (i32.const 22))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  const math = { add: (a, b) => a + b }
  expect((await wasm(exp, { math })).call_imported_function()).to.equal(42)
  expect((await wasm(act, { math })).call_imported_function()).to.equal(42)
}))

t.todo('wat-compiler: import memory 1', () => buffers(`
  (import "env" "mem" (memory 1))
`)
.then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo('wat-compiler: import memory 1 2', () => buffers(`
  (import "env" "mem" (memory 1 2))
`)
.then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo('wat-compiler: import memory 1 2 shared', () => buffers(`
  (import "env" "mem" (memory 1 2 shared))
`)
.then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo('wat-compiler: import memory $foo 1 2 shared', () => buffers(`
  (import "env" "mem" (memory $foo 1 2 shared))
`)
.then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo('wat-compiler: set a start function', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (start $main)
  (func $main
    (global.set $answer (i32.const 666))
  )
  (func (export "get") (result i32)
    (global.get $answer)
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(666)
  expect((await wasm(act)).get()).to.equal(666)
}))

t.todo('wat-compiler: if else', () => buffers(`
  (func $dummy)
  (func (export "foo") (param i32) (result i32)
    (if (result i32) (local.get 0)
      (then (call $dummy) (i32.const 1))
      (else (call $dummy) (i32.const 0))
    )
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).foo(0)).to.equal(0)
  expect((await wasm(exp)).foo(1)).to.equal(1)
  expect((await wasm(act)).foo(0)).to.equal(0)
  expect((await wasm(act)).foo(1)).to.equal(1)
}))

t.todo('wat-compiler: block', () => buffers(`
  (func (export "answer") (result i32)
    (block (nop))
    (block (result i32) (i32.const 42))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).answer()).to.equal(42)
  expect((await wasm(act)).answer()).to.equal(42)
}))

t.todo('wat-compiler: block multi', () => buffers(`
  (func $dummy)
  (func (export "multi") (result i32)
    (block (call $dummy) (call $dummy) (call $dummy) (call $dummy))
    (block (result i32) (call $dummy) (call $dummy) (call $dummy) (i32.const 8))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).multi()).to.equal(8)
  expect((await wasm(act)).multi()).to.equal(8)
}))

t.todo('wat-compiler: br', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (func $set
    (global.set $answer (i32.const 666))
  )
  (func (export "main") (result i32)
    (block (br 0) (call $set))
    (global.get $answer)
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(42)
  expect((await wasm(act)).main()).to.equal(42)
}))

t.todo('wat-compiler: br mid', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (func $set
    (global.set $answer (i32.const 666))
  )
  (func (export "main") (result i32)
    (block (call $set) (br 0) (global.set $answer (i32.const 0)))
    (global.get $answer)
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(666)
  expect((await wasm(act)).main()).to.equal(666)
}))

t.todo('wat-compiler: block named + br', () => buffers(`
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
      (global.set $answer (i32.const 0))
    )
    (global.get $answer)
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(0)
  expect((await wasm(act)).main()).to.equal(0)
}))

t.todo('wat-compiler: block named 2 + br', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(0)
  expect((await wasm(act)).main()).to.equal(0)
}))

t.todo('wat-compiler: br_table', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main(0)).to.equal(22)
  expect((await wasm(exp)).main(1)).to.equal(20)
  expect((await wasm(act)).main(0)).to.equal(22)
  expect((await wasm(act)).main(1)).to.equal(20)
}))

t.todo('wat-compiler: br_table multiple', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main(0)).to.equal(103)
  expect((await wasm(exp)).main(1)).to.equal(102)
  expect((await wasm(exp)).main(2)).to.equal(101)
  expect((await wasm(exp)).main(3)).to.equal(100)
  expect((await wasm(exp)).main(4)).to.equal(104)
  expect((await wasm(act)).main(0)).to.equal(103)
  expect((await wasm(act)).main(1)).to.equal(102)
  expect((await wasm(act)).main(2)).to.equal(101)
  expect((await wasm(act)).main(3)).to.equal(100)
  expect((await wasm(act)).main(4)).to.equal(104)
}))

t.todo('wat-compiler: loop', () => buffers(`
  (func (export "main") (result i32)
    (loop (nop))
    (loop (result i32) (i32.const 42))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(42)
  expect((await wasm(act)).main()).to.equal(42)
}))

t.todo('wat-compiler: break-value', () => buffers(`
  (func (export "main") (result i32)
    (block (result i32)
      (loop (result i32) (br 1 (i32.const 18)) (br 0) (i32.const 19))
    )
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(18)
  expect((await wasm(act)).main()).to.equal(18)
}))

t.todo('wat-compiler: br_if', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(18)
  expect((await wasm(act)).main()).to.equal(18)
}))

t.todo('wat-compiler: while', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(1)
  expect((await wasm(act)).main()).to.equal(1)
}))

t.todo('wat-compiler: select', () => buffers(`
  (func (export "main") (result i32)
    (select (loop (result i32) (i32.const 1)) (i32.const 2) (i32.const 3))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(1)
  expect((await wasm(act)).main()).to.equal(1)
}))

t.todo('wat-compiler: select mid', () => buffers(`
  (func (export "main") (result i32)
    (select (i32.const 2) (loop (result i32) (i32.const 1)) (i32.const 3))
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(2)
  expect((await wasm(act)).main()).to.equal(2)
}))

t.todo('wat-compiler: block labels', () => buffers(`
  (func (export "main") (result i32)
    (block $exit (result i32)
      (br $exit (i32.const 1))
      (i32.const 0)
    )
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(1)
  expect((await wasm(act)).main()).to.equal(1)
}))

t.todo('wat-compiler: loop labels', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(5)
  expect((await wasm(act)).main()).to.equal(5)
}))

t.todo('wat-compiler: loop labels 2', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(8)
  expect((await wasm(act)).main()).to.equal(8)
}))

t.todo('wat-compiler: switch', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main(0)).to.equal(50)
  expect((await wasm(exp)).main(1)).to.equal(20)
  expect((await wasm(exp)).main(3)).to.equal(3)
  expect((await wasm(act)).main(0)).to.equal(50)
  expect((await wasm(act)).main(1)).to.equal(20)
  expect((await wasm(act)).main(3)).to.equal(3)
}))

t.todo('wat-compiler: label redefinition', () => buffers(`
  (func (export "main") (result i32)
    (block $l1 (result i32)
      (i32.add
        (block $l1 (result i32) (i32.const 2))
        (block $l1 (result i32) (br $l1 (i32.const 3)))
      )
    )
  )
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).main()).to.equal(5)
  expect((await wasm(act)).main()).to.equal(5)
}))

t.todo('wat-compiler: address', () => buffers(`
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
`)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).a()).to.equal(97)
  expect((await wasm(exp)).b()).to.equal(98)
  expect((await wasm(exp)).ab()).to.equal(25185)
  expect((await wasm(exp)).cd()).to.equal(25699)
  expect((await wasm(exp)).z()).to.equal(122)

  expect((await wasm(act)).a()).to.equal(97)
  expect((await wasm(act)).b()).to.equal(98)
  expect((await wasm(act)).ab()).to.equal(25185)
  expect((await wasm(act)).cd()).to.equal(25699)
  expect((await wasm(act)).z()).to.equal(122)
}))

t.todo('wat-compiler: int literals', () => buffers(`
  (func (export "i32.test") (result i32) (return (i32.const 0x0bAdD00D)))
  (func (export "i32.umax") (result i32) (return (i32.const 0xffffffff)))
  (func (export "i32.smax") (result i32) (return (i32.const 0x7fffffff)))
  (func (export "i32.neg_smax") (result i32) (return (i32.const -0x7fffffff)))
  (func (export "i32.smin") (result i32) (return (i32.const -0x80000000)))
  (func (export "i32.alt_smin") (result i32) (return (i32.const 0x80000000)))
  (func (export "i32.inc_smin") (result i32) (return (i32.add (i32.const -0x80000000) (i32.const 1))))
  (func (export "i32.neg_zero") (result i32) (return (i32.const -0x0)))
  (func (export "i32.not_octal") (result i32) (return (i32.const 010)))
  (func (export "i32.unsigned_decimal") (result i32) (return (i32.const 4294967295)))
  (func (export "i32.plus_sign") (result i32) (return (i32.const +42)))
  (func (export "i64.test") (result i64) (return (i64.const 0x0CABBA6E0ba66a6e)))
  (func (export "i64.umax") (result i64) (return (i64.const 0xffffffffffffffff)))
  (func (export "i64.smax") (result i64) (return (i64.const 0x7fffffffffffffff)))
  (func (export "i64.neg_smax") (result i64) (return (i64.const -0x7fffffffffffffff)))
  (func (export "i64.smin") (result i64) (return (i64.const -0x8000000000000000)))
  (func (export "i64.alt_smin") (result i64) (return (i64.const 0x8000000000000000)))
  (func (export "i64.inc_smin") (result i64) (return (i64.add (i64.const -0x8000000000000000) (i64.const 1))))
  (func (export "i64.neg_zero") (result i64) (return (i64.const -0x0)))
  (func (export "i64.not_octal") (result i64) (return (i64.const 010)))
  (func (export "i64.unsigned_decimal") (result i64) (return (i64.const 18446744073709551615)))
  (func (export "i64.plus_sign") (result i64) (return (i64.const +42)))
  (func (export "i32-dec-sep1") (result i32) (i32.const 1_000_000))
  (func (export "i32-dec-sep2") (result i32) (i32.const 1_0_0_0))
  (func (export "i32-hex-sep1") (result i32) (i32.const 0xa_0f_00_99))
  (func (export "i32-hex-sep2") (result i32) (i32.const 0x1_a_A_0_f))
  (func (export "i64-dec-sep1") (result i64) (i64.const 1_000_000))
  (func (export "i64-dec-sep2") (result i64) (i64.const 1_0_0_0))
  (func (export "i64-hex-sep1") (result i64) (i64.const 0xa_f00f_0000_9999))
  (func (export "i64-hex-sep2") (result i64) (i64.const 0x1_a_A_0_f))
`)
.then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo('wat-compiler: float literals', () => buffers(`
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
  (func (export "f32-dec-sep1") (result f32) (f32.const 1_000_000))
  (func (export "f32-dec-sep2") (result f32) (f32.const 1_0_0_0))
  (func (export "f32-dec-sep3") (result f32) (f32.const 100_3.141_592))
  (func (export "f32-dec-sep4") (result f32) (f32.const 99e+1_3))
  (func (export "f32-dec-sep5") (result f32) (f32.const 122_000.11_3_54E0_2_3))
  (func (export "f32-hex-sep1") (result f32) (f32.const 0xa_0f_00_99))
  (func (export "f32-hex-sep2") (result f32) (f32.const 0x1_a_A_0_f))
  (func (export "f32-hex-sep3") (result f32) (f32.const 0xa0_ff.f141_a59a))
  (func (export "f32-hex-sep4") (result f32) (f32.const 0xf0P+1_3))
  (func (export "f32-hex-sep5") (result f32) (f32.const 0x2a_f00a.1f_3_eep2_3))
  (func (export "f64-dec-sep1") (result f64) (f64.const 1_000_000))
  (func (export "f64-dec-sep2") (result f64) (f64.const 1_0_0_0))
  (func (export "f64-dec-sep3") (result f64) (f64.const 100_3.141_592))
  (func (export "f64-dec-sep4") (result f64) (f64.const 99e-1_23))
  (func (export "f64-dec-sep5") (result f64) (f64.const 122_000.11_3_54e0_2_3))
  (func (export "f64-hex-sep1") (result f64) (f64.const 0xa_f00f_0000_9999))
  (func (export "f64-hex-sep2") (result f64) (f64.const 0x1_a_A_0_f))
  (func (export "f64-hex-sep3") (result f64) (f64.const 0xa0_ff.f141_a59a))
  (func (export "f64-hex-sep4") (result f64) (f64.const 0xf0P+1_3))
  (func (export "f64-hex-sep5") (result f64) (f64.const 0x2a_f00a.1f_3_eep2_3))
`)
.then(([exp,act]) => hexAssertEqual(exp,act)))

// e2e
const e2e = [
  'malloc',
  'brownian',
  'containers',
  'quine',
  'fire',
  'metaball',
  'raytrace',
  'snake',
  'maze',
  'dino',
  'raycast',
]

e2e.forEach(name => {
  t.todo('wat-compiler: e2e: '+name, () =>
    fetch('/test/fixtures/e2e/'+name+'.wat')
    .then(res => res.text())
    .then(text => buffers(text))
    .then(([exp,act]) => hexAssertEqual(exp,act)))
})



t.todo(`1 function
      0 params, 1 results [i32]
      0 locals
      not exported`, () => buffers(`
  (func (result i32)
    (i32.const 42)
  )
`, mod => mod

  .func('value', [], ['i32'],
    [],
    [...i32.const(42)],
    )

).then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo(`2 functions
      a, b: 0 params, 1 results [i32]
      a, b: 0 locals
      a, b: exported`, () => buffers(`
  (func (export "value") (result i32)
    (i32.const 42)
  )
  (func (export "another") (result i32)
    (i32.const 666)
  )
`, mod => mod

  .func('value', [], ['i32'],
    [],
    [...i32.const(42)],
    true)
  .func('another', [], ['i32'],
    [],
    [...i32.const(666)],
    true)

).then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo(`2 functions
      a, b: 0 params, 1 results [i32]
      a, b: 0 locals
      a: exported
      b: not exported`, () => buffers(`
  (func (export "value") (result i32)
    (i32.const 42)
  )
  (func (result i32)
    (i32.const 666)
  )
`, mod => mod

  .func('value', [], ['i32'],
    [],
    [...i32.const(42)],
    true)
  .func('another', [], ['i32'],
    [],
    [...i32.const(666)],
    )

).then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo(`2 functions
          a: 0 params, 1 results [i32],
          b: 1 params [i32], 1 results [i32]
      a, b: 0 locals
      a, b: exported`, () => buffers(`
  (func (export "value") (result i32)
    (i32.const 42)
  )
  (func (export "another") (param i32) (result i32)
    (i32.const 666)
  )
`, mod => mod

  .func('value', [], ['i32'],
    [],
    [...i32.const(42)],
    true)
  .func('another', ['i32'], ['i32'],
    [],
    [...i32.const(666)],
    true)

).then(([exp,act]) => hexAssertEqual(exp,act)))


t.todo(`1 function
      0 params, 1 results [i32]
      1 locals [i32]
      exported`, () => buffers(`
  (func (export "value") (result i32)
    (local i32)
    (i32.const 42)
  )
`, mod => mod

  .func('value', [], ['i32'],
    ['i32'],
    [...i32.const(42)],
    true)

).then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo(`1 function
      0 params, 1 results [i32]
      2 locals [i32, i64] (different)
      exported`, () => buffers(`
  (func (export "value") (result i32)
    (local i32)
    (local i64)
    (i32.const 42)
  )
`, mod => mod

  .func('value', [], ['i32'],
    ['i32','i64'],
    [...i32.const(42)],
    true)

).then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo(`1 function
      0 params, 1 results [i32]
      3 locals [i32, i64, i32] (disjointed)
      exported`, () => buffers(`
  (func (export "value") (result i32)
    (local i32)
    (local i64)
    (local i32)
    (i32.const 42)
  )
`, mod => mod

  .func('value', [], ['i32'],
    ['i32','i64','i32'],
    [...i32.const(42)],
    true)

).then(([exp,act]) => hexAssertEqual(exp,act)))

t.todo(`1 function
      0 params, 1 results [i32]
      3 locals [i32, i32, i64] (joined)
      exported`, () => buffers(`
  (func (export "value") (result i32)
    (local i32)
    (local i32)
    (local i64)
    (i32.const 42)
  )
`, mod => mod

  .func('value', [], ['i32'],
    ['i32','i32','i64'],
    [...i32.const(42)],
    true)

).then(([exp,act]) => hexAssertEqual(exp,act)))


t.todo(`1 function - add 2 numbers (s-expression)
      2 params, 1 results [i32]
      0 locals
      exported`, () => buffers(`
  (func (export "add") (param $a i32) (param $b i32) (result i32)
    (i32.add (local.get $a) (local.get $b))
  )
`, mod => mod

  .func('add', ['i32','i32'], ['i32'],
    [],
    [
      ...i32.add([], [local.get(0), local.get(1)]),
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).add(20,22)).to.equal(42)
  expect((await wasm(act)).add(20,22)).to.equal(42)
}))

t.todo(`1 function - add 2 numbers (stack)
      2 params, 1 results [i32]
      0 locals
      exported`, () => buffers(`
  (func (export "add") (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add
  )
`, mod => mod

  .func('add', ['i32','i32'], ['i32'],
    [],
    [
      ...local.get(0),
      ...local.get(1),
      ...i32.add(),
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).add(20,22)).to.equal(42)
  expect((await wasm(act)).add(20,22)).to.equal(42)
}))

t.todo(`1 function - add 2 numbers (tee + s-expression)
      1 params, 1 results [i32]
      1 locals
      exported`, () => buffers(`
  (func (export "add") (param $a i32) (result i32)
    (local $b i32)
    (local.tee $b (i32.const 20))
    (i32.add (local.get $a))
  )
`, mod => mod

  .func('add', ['i32'], ['i32'],
    ['i32'],
    [
      ...local.tee(1, [i32.const(20)]),
      ...i32.add([], [local.get(0)]),
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).add(22)).to.equal(42)
  expect((await wasm(act)).add(22)).to.equal(42)
}))

t.todo(`1 function - add 2 numbers (tee + s-expression)
      2 params, 1 results [i32]
      0 locals
      exported`, () => buffers(`
  (func (export "add") (param i32 i32) (result i32)
    (local.get 0)
    (local.get 1)
    (i32.add)
  )
`, mod => mod

  .func('add', ['i32','i32'], ['i32'],
    [],
    [
      ...local.get(0),
      ...local.get(1),
      ...i32.add()
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).add(20, 22)).to.equal(42)
  expect((await wasm(act)).add(20, 22)).to.equal(42)
}))



t.todo('call function direct', () => buffers(`
  (func $dbl (param $a i32) (result i32)
    (i32.add (local.get $a) (local.get $a))
  )
  (func (export "call_function_direct") (param $a i32) (result i32)
    (call $dbl (local.get $a))
  )
`, mod => mod

  .func('dbl', ['i32'], ['i32'],
    [],
    [
      ...i32.add([], [local.get(0), local.get(0)]),
    ]
    )

  .func('call_function_direct', ['i32'], ['i32'],
    [],
    [
      ...INSTR.call(mod.getFunc('dbl').idx, [local.get(0)])
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).call_function_direct(333)).to.equal(666)
  expect((await wasm(act)).call_function_direct(333)).to.equal(666)
}))

//
t.todo('call function indirect (table)', () => buffers(`
  (type $return_i32 (func (result i32)))
  (table 2 funcref)
    (elem (i32.const 0) $f1 $f2)
    (func $f1 (result i32)
      i32.const 42)
    (func $f2 (result i32)
      i32.const 13)
  (func (export "call_function_indirect") (param $a i32) (result i32)
    (call_indirect (type $return_i32) (local.get $a))
  )
`, mod => mod

    .type('return_i32', [], ['i32'])

    .table('funcref', 2)

    .elem([...i32.const(0)], ['f1','f2'])

    .func('f1', [], ['i32'],
      [],
      [...i32.const(42)])

    .func('f2', [], ['i32'],
      [],
      [...i32.const(13)])

  .func('call_function_indirect', ['i32'], ['i32'],
    [],
    [
      ...INSTR.call_indirect(
        [mod.getType('return_i32'), 0],
        [local.get(0)])
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(exp)).call_function_indirect(1)).to.equal(13)
  expect((await wasm(act)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(act)).call_function_indirect(1)).to.equal(13)
}))

//
t.todo('call function indirect (table) non zero indexed ref types', () => buffers(`
  (type $return_i64 (func (result i64)))
  (type $return_i32 (func (result i32)))
  (table 2 funcref)
    (elem (i32.const 0) $f1 $f2)
    (func $xx (result i64)
      i64.const 42)
    (func $f1 (result i32)
      i32.const 42)
    (func $f2 (result i32)
      i32.const 13)
  (func (export "call_function_indirect") (param $a i32) (result i32)
    (call_indirect (type $return_i32) (local.get $a))
  )
`, mod => mod

    .table('funcref', 2)

    .elem([...i32.const(0)], ['f1','f2'])

    .func('xx', [], ['i64'],
      [],
      [...i64.const(42)])

    .func('f1', [], ['i32'],
      [],
      [...i32.const(42)])

    .func('f2', [], ['i32'],
      [],
      [...i32.const(13)])

  .func('call_function_indirect', ['i32'], ['i32'],
    [],
    [
      ...INSTR.call_indirect(
        // call_indirect takes 2 arguments: typeidx, tableidx
        [mod.getFunc('f1').type_idx, 0],
        // and a reference table element index from the stack
        [local.get(0)])
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(exp)).call_function_indirect(1)).to.equal(13)
  expect((await wasm(act)).call_function_indirect(0)).to.equal(42)
  expect((await wasm(act)).call_function_indirect(1)).to.equal(13)
}))


t.todo('1 global const (immutable)', () => buffers(`
  (global $answer i32 (i32.const 42))
  (func (export "get") (result i32)
    (global.get $answer)
  )
`, mod => mod

  .global('answer', 'const', 'i32', [...i32.const(42)])

  .func('get', [], ['i32'],
    [],
    [
      ...INSTR.global.get(mod.getGlobalIndexOf('answer'))
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))

//
t.todo('1 global var (mut)', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (func (export "get") (result i32)
    (global.get $answer)
  )
`, mod => mod

  .global('answer', 'var', 'i32', [...i32.const(42)])

  .func('get', [], ['i32'],
    [],
    [
      ...INSTR.global.get(mod.getGlobalIndexOf('answer'))
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))

//
t.todo('1 global var (mut) + mutate', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (func (export "get") (result i32)
    (global.set $answer (i32.const 666))
    (global.get $answer)
  )
`, mod => mod

  .global('answer', 'var', 'i32', [...i32.const(42)])

  .func('get', [], ['i32'],
    [],
    [
      ...INSTR.global.set(mod.getGlobalIndexOf('answer'), [i32.const(666)]),
      ...INSTR.global.get(mod.getGlobalIndexOf('answer'))
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(666)
  expect((await wasm(act)).get()).to.equal(666)
}))


t.todo('local memory page min 1 - data 1 offset 0 i32', () => buffers(String.raw`
  (memory 1)
  (data (i32.const 0) "\2a")
  (func (export "get") (result i32)
    (i32.load (i32.const 0))
  )
`, mod => mod

  .memory(null, 1)

  .data([...i32.const(0)], [0x2a])

  .func('get', [], ['i32'],
    [],
    [
      ...i32.load([2,0], i32.const(0))
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))

//
t.todo('local memory page min 1 max 2 - data 1 offset 0 i32', () => buffers(String.raw`
  (memory 1 2)
  (data (i32.const 0) "\2a")
  (func (export "get") (result i32)
    i32.const 1
    i32.const 2
    drop
    drop
    i32.const 0
    i32.load offset=0 align=4
  )
`, mod => mod

  .memory(null, 1, 2)

  .data([...i32.const(0)], [0x2a])

  .func('get', [], ['i32'],
    [],
    [
      ...i32.const(1),
      ...i32.const(2),
      ...INSTR.drop(),
      ...INSTR.drop(),
      ...i32.const(0),
      ...i32.load([2,0])
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(42)
  expect((await wasm(act)).get()).to.equal(42)
}))



t.todo('import function', () => buffers(`
  (import "math" "add" (func $add (param i32 i32) (result i32)))
  (func (export "call_imported_function") (result i32)
    (call $add (i32.const 20) (i32.const 22))
  )
`, mod => mod

  .import('func', 'math.add', 'math', 'add', ['i32','i32'], ['i32'])

  .func('call_imported_function', [], ['i32'],
    [],
    [
      ...INSTR.call(mod.getFunc('math.add').idx, [i32.const(20), i32.const(22)])
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  const math = { add: (a, b) => a + b }
  expect((await wasm(exp, { math })).call_imported_function()).to.equal(42)
  expect((await wasm(act, { math })).call_imported_function()).to.equal(42)
}))

//
t.todo('import memory min 1 max 2', () => buffers(`
  (import "env" "mem" (memory 1 2))
`, mod => mod

  .import('memory', 'env.mem', 'env', 'mem', [1,2])

)
.then(([exp,act]) => hexAssertEqual(exp,act)))

//
t.todo('import memory min 1 max 2', () => buffers(`
  (import "env" "mem" (memory 1 2 shared))
`, mod => mod

  .import('memory', 'env.mem', 'env', 'mem', [1,2,true])

)
.then(([exp,act]) => hexAssertEqual(exp,act)))

//
t.todo('import memory min 3', () => buffers(`
  (import "env" "mem" (memory 3))
`, mod => mod

  .import('memory', 'env.mem', 'env', 'mem', [3])

)
.then(([exp,act]) => hexAssertEqual(exp,act)))

//
t.todo('import memory min 3 max 3', () => buffers(`
  (import "env" "mem" (memory 3 3))
`, mod => mod

  .import('memory', 'env.mem', 'env', 'mem', [3,3])

)
.then(([exp,act]) => hexAssertEqual(exp,act)))


t.todo('set a start function', () => buffers(`
  (global $answer (mut i32) (i32.const 42))
  (start $main)
  (func $main
    (global.set $answer (i32.const 666))
  )
  (func (export "get") (result i32)
    (global.get $answer)
  )
`, mod => mod

  .global('answer', 'var', 'i32', [...i32.const(42)])

  .start('main')

  .func('main', [], [],
    [],
    [
      ...INSTR.global.set(mod.getGlobalIndexOf('answer'), [i32.const(666)]),
    ],
    )

  .func('get', [], ['i32'],
    [],
    [
      ...INSTR.global.get(mod.getGlobalIndexOf('answer'))
    ],
    true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).get()).to.equal(666)
  expect((await wasm(act)).get()).to.equal(666)
}))

t.todo('dummy function', () => buffers(`
  (memory 1)
  (func $dummy)
  (func (export "store") (param i32)
    (if (result i32) (local.get 0)
      (then (call $dummy) (i32.const 1))
      (else (call $dummy) (i32.const 0))
    )
    (i32.const 2)
    (i32.store)
  )
`, mod => mod

  .memory(null, 1)

  .func('dummy')

  .func('store', ['i32'], [],
    [],
    [
      ...INSTR.if([INSTR.type.i32()], [local.get(0)]),
        ...INSTR.call(mod.getFunc('dummy').idx),
        ...i32.const(1),
      ...INSTR.else(),
        ...INSTR.call(mod.getFunc('dummy').idx),
        ...i32.const(0),
      ...INSTR.end(),

      ...i32.const(2),
      ...i32.store([2,0]),
    ]
    , true)

)
.then(([exp,act]) => hexAssertEqual(exp,act))
.then(async ([exp,act]) => {
  expect((await wasm(exp)).store()).to.equal(undefined)
  expect((await wasm(act)).store()).to.equal(undefined)
}))





let wabt = await Wabt()

function wat (code) {
  const parsed = wabt.parseWat('inline', code, {})
  console.time('wabt build')
  const binary = parsed.toBinary({
    log: true,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: false,
  })
  parsed.destroy()
  console.timeEnd('wabt build')

  return binary
}
