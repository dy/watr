import t, { is, ok, same } from 'tst'
import compile from '../src/compile.js'
import parse from '../src/parse.js'
import Wabt from '../lib/wabt.js'

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


t.todo('compiler: reexport', () => {
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

t('compiler: memory $foo (import "a" "b" ) 1 2 shared', () => {
  let src = `(memory $foo (import "env" "mem") 1 2 shared)`
  run(src, {env:{mem: new WebAssembly.Memory({initial:1, maximum: 1, shared: 1})}})
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
      (local.get 0)
      (local.get 1)
      (i32.add)
      )
  `).exports
  is(answer(20,22), 42)
})

t('wat-compiler: function with 2 params 2 results', () => {
  let {answer} = run(`
    (func (export "answer") (param i32 i32) (result i32 i32)
      (local.get 0)
      (local.get 1)
      (i32.add)
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
      (local.tee $b (i32.const 20))
      (i32.add (local.get $a))
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
        i32.const 42)
      (func $f2 (result i32)
        i32.const 13)
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
        i32.const 42)
      (func $f1 (result i32)
        i32.const 42)
      (func $f2 (result i32)
        i32.const 13)
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
      i32.const 1
      i32.const 2
      drop
      drop
      i32.const 0
      i32.load offset=0 align=4
    )
  `).exports

  is(get(), 42)
})

t('wat-compiler: import function', () => {
  let {call_imported_function} = run(`
    (import "math" "add" (func $add (param i32 i32) (result i32)))
    (func (export "call_imported_function") (result i32)
      (call $add (i32.const 20) (i32.const 22))
    )
  `, {math:{ add: (a, b) => a + b }}).exports

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

t.todo('wat-compiler: if else', () => {
  let src = `
    (func $dummy)
    (func (export "foo") (param i32) (result i32)
      (if (result i32) (local.get 0)
        (then (call $dummy) (i32.const 1))
        (else (call $dummy) (i32.const 0))
      )
    )
  `
  wat(src)
  let {foo} = run(src).exports
  is(foo(0), 0)
  is(foo(1), 1)
})

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

const hex = (str, ...fields) =>
  new Uint8Array(
    String.raw.call(null, str, fields)
    .trim()
    .replace(/;[^\n]*/g,'')
    .split(/[\s\n]+/)
    .filter(n => n !== '')
    .map(n => parseInt(n, 16))
  )

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

// run test case against wabt, return instance
// FIXME: rename to something more meaningful? testCase?
const run = (src, importObj) => {
  let buffer = compile(parse(src))
  is(buffer, wat(src).buffer)
  const mod = new WebAssembly.Module(buffer)
  return new WebAssembly.Instance(mod, importObj)
}
