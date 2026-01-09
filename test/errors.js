import t from 'tst'
import { compile } from '../watr.js'

t.demo('Unknown instruction', () => {
  compile(`(module
  (func (result i32)
    (i32.unknown 42)
  )
)`)
})

t.demo('Duplicate function name', () => {
  compile(`(module
  (func $test (result i32) (i32.const 1))
  (func $test (result i32) (i32.const 2))
)`)

})

t.demo('Unknown function reference', () => {
  compile(`(module
  (func $add (param i32 i32) (result i32)
    (i32.add (local.get 0) (local.get 1)))
  (func (export "test")
    (call $missing (i32.const 42)))
)`)

})

t.demo('Bad type reference', () => {
  compile(`(module
  (func (param unknown) (result i32)
    (i32.const 42))
)`)

})

t.demo('Unknown local variable', () => {
  compile(`(module
  (func (param i32) (result i32)
    (local.get $nonexistent))
)`)

})

t.demo('Duplicate local name', () => {
  compile(`(module
  (func (param i32)
    (local $x i32)
    (local $x i32)
    (i32.const 0))
)`)

})

t.demo('Invalid memory reference', () => {
  compile(`(module
  (memory 1)
  (func
    (i32.load (i32.const 0))
    (i32.store $invalid (i32.const 0) (i32.const 42)))
)`)

})

t.demo('Unknown table', () => {
  compile(`(module
  (func
    (call_indirect $nonexistent (type 0) (i32.const 0)))
)`)

})

t.demo('Bad label reference', () => {
  compile(`(module
  (func
    (block $outer
      (br $inner)))
)`)

})

t.demo('Unknown global', () => {
  compile(`(module
  (func (result i32)
    (global.get $undefined))
)`)

})

t.demo('Unbalanced parenthesis', () => {
  compile(`(module
  (func (result i32)
    (i32.const 42)
  (;; missing closing paren
)`)

})

t.demo('Complex nested error', () => {
  compile(`(module
  (type $sig (func (param i32) (result i32)))
  (table 10 funcref)
  (func $double (param i32) (result i32)
    (i32.mul (local.get 0) (i32.const 2)))
  (func (export "test") (param i32) (result i32)
    (call_indirect (type $sig)
      (local.get 0)
      (i32.const 5))
    (call $triple (i32.const 10)))
  (func $main
    (drop (call $double (i32.const 21))))
)`)

})
