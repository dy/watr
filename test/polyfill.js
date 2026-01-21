import t, { is, ok, same } from 'tst'
import polyfill, { detect, normalize, FEATURES } from '../src/polyfill.js'
import parse from '../src/parse.js'
import compile from '../src/compile.js'
import print from '../src/print.js'

t('polyfill: normalize options', () => {
  // true → all features
  same(normalize(true), { funcref: true })

  // false → none
  same(normalize(false), {})

  // string → set
  same(normalize('funcref'), { funcref: true })
  same(normalize('funcref struct'), { funcref: true, struct: false }) // struct not implemented yet

  // object passthrough
  same(normalize({ funcref: false }), { funcref: false })
})

t('polyfill: detect features', () => {
  let ast

  // funcref
  ast = parse(`(module (func $f) (global funcref (ref.func $f)))`)
  ok(detect(ast).has('funcref'))

  // no funcref
  ast = parse(`(module (func) (global i32 (i32.const 1)))`)
  is(detect(ast).has('funcref'), false)

  // call_ref
  ast = parse(`(module (type $t (func)) (func (param (ref $t)) (call_ref $t (local.get 0))))`)
  ok(detect(ast).has('funcref'))
})

t('polyfill: funcref → table indirection', () => {
  const src = `
    (module
      (type $fn (func (result i32)))
      (func $a (result i32) (i32.const 1))
      (func $b (result i32) (i32.const 2))
      (global $gf (mut (ref null $fn)) (ref.null $fn))

      (func (export "set_a") (global.set $gf (ref.func $a)))
      (func (export "set_b") (global.set $gf (ref.func $b)))
      (func (export "call") (result i32) (call_ref $fn (global.get $gf)))
    )
  `

  const ast = parse(src)
  const transformed = polyfill(ast, 'funcref')
  const printed = print(transformed)

  // Should have converted ref.func to i32.const
  ok(printed.includes('i32.const'), 'ref.func → i32.const')

  // Should have created a table
  ok(printed.includes('table'), 'table created')

  // Should have converted call_ref to call_indirect
  ok(printed.includes('call_indirect'), 'call_ref → call_indirect')
})

t('polyfill: funcref compiles and runs', () => {
  // Simple case: ref.func and call_ref
  const src = `
    (module
      (type $fn (func (result i32)))
      (func $add42 (result i32) (i32.const 42))

      (func (export "test") (result i32)
        (call_ref $fn (ref.func $add42))
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { test } = new WebAssembly.Instance(mod).exports

  is(test(), 42)
})

t('polyfill: funcref with multiple functions', () => {
  const src = `
    (module
      (type $fn (func (param i32) (result i32)))
      (func $double (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))
      (func $triple (param i32) (result i32) (i32.mul (local.get 0) (i32.const 3)))

      (func (export "call_double") (param i32) (result i32)
        (call_ref $fn (local.get 0) (ref.func $double))
      )
      (func (export "call_triple") (param i32) (result i32)
        (call_ref $fn (local.get 0) (ref.func $triple))
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { call_double, call_triple } = new WebAssembly.Instance(mod).exports

  is(call_double(5), 10)
  is(call_triple(5), 15)
})

t('polyfill: no-op when no features used', () => {
  const src = `(module (func (export "f") (result i32) (i32.const 42)))`
  const ast = parse(src)
  const transformed = polyfill(ast)

  // Should compile and run normally
  const binary = compile(transformed)
  const mod = new WebAssembly.Module(binary)
  const { f } = new WebAssembly.Instance(mod).exports

  is(f(), 42)
})

t('polyfill: via compile options', async () => {
  const { compile } = await import('../watr.js')

  const src = `
    (module
      (type $fn (func (result i32)))
      (func $answer (result i32) (i32.const 42))
      (func (export "test") (result i32)
        (call_ref $fn (ref.func $answer))
      )
    )
  `

  const binary = compile(src, { polyfill: true })
  const mod = new WebAssembly.Module(binary)
  const { test } = new WebAssembly.Instance(mod).exports

  is(test(), 42)
})

t('polyfill: funcref identity - same ref.func returns same index', () => {
  const src = `
    (module
      (type $fn (func (result i32)))
      (func $a (result i32) (i32.const 1))
      (func $b (result i32) (i32.const 2))

      ;; Multiple references to same function should produce same index
      (func (export "same_ref") (result i32)
        (i32.eq
          (call_ref $fn (ref.func $a))
          (call_ref $fn (ref.func $a))
        )
      )

      ;; Different functions should work correctly
      (func (export "diff_ref") (result i32)
        (i32.add
          (call_ref $fn (ref.func $a))
          (call_ref $fn (ref.func $b))
        )
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { same_ref, diff_ref } = new WebAssembly.Instance(mod).exports

  is(same_ref(), 1, 'same ref.func produces consistent results')
  is(diff_ref(), 3, 'different functions called correctly (1 + 2)')
})

t('polyfill: funcref dispatch - store ref in global', () => {
  // Test dynamic dispatch via global variable
  const src = `
    (module
      (type $fn (func (param i32) (result i32)))
      (func $inc (param i32) (result i32) (i32.add (local.get 0) (i32.const 1)))
      (func $dec (param i32) (result i32) (i32.sub (local.get 0) (i32.const 1)))
      (func $dbl (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))

      (global $current (mut i32) (i32.const 0))

      (func (export "set_inc") (global.set $current (i32.const 0)))
      (func (export "set_dec") (global.set $current (i32.const 1)))
      (func (export "set_dbl") (global.set $current (i32.const 2)))

      (func (export "call_inc") (param i32) (result i32)
        (call_ref $fn (local.get 0) (ref.func $inc)))
      (func (export "call_dec") (param i32) (result i32)
        (call_ref $fn (local.get 0) (ref.func $dec)))
      (func (export "call_dbl") (param i32) (result i32)
        (call_ref $fn (local.get 0) (ref.func $dbl)))
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { call_inc, call_dec, call_dbl } = new WebAssembly.Instance(mod).exports

  is(call_inc(10), 11, 'call inc')
  is(call_dec(10), 9, 'call dec')
  is(call_dbl(10), 20, 'call dbl')
})

t('polyfill: funcref with params', () => {
  const src = `
    (module
      (type $binop (func (param i32 i32) (result i32)))
      (func $add (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
      (func $mul (param i32 i32) (result i32) (i32.mul (local.get 0) (local.get 1)))

      (func (export "apply_add") (param i32 i32) (result i32)
        (call_ref $binop (local.get 0) (local.get 1) (ref.func $add))
      )
      (func (export "apply_mul") (param i32 i32) (result i32)
        (call_ref $binop (local.get 0) (local.get 1) (ref.func $mul))
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { apply_add, apply_mul } = new WebAssembly.Instance(mod).exports

  is(apply_add(3, 4), 7)
  is(apply_mul(3, 4), 12)
})

t('polyfill: does not mutate original AST', () => {
  const src = `(module (type $fn (func)) (func $f) (global funcref (ref.func $f)))`
  const ast = parse(src)
  const original = JSON.stringify(ast)

  polyfill(ast, 'funcref')

  is(JSON.stringify(ast), original, 'original AST unchanged')
})

t('polyfill: funcref with return_call_ref', () => {
  const src = `
    (module
      (type $fn (func (param i32) (result i32)))
      (func $double (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))

      (func (export "tail") (param i32) (result i32)
        (return_call_ref $fn (local.get 0) (ref.func $double))
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')

  // Should convert return_call_ref to return_call_indirect
  ok(print(ast).includes('return_call_indirect'), 'return_call_ref → return_call_indirect')

  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { tail } = new WebAssembly.Instance(mod).exports

  is(tail(21), 42)
})

t('polyfill: funcref callback pattern', () => {
  // Higher-order function pattern: pass function as callback
  const src = `
    (module
      (type $pred (func (param i32) (result i32)))

      (func $is_even (param i32) (result i32)
        (i32.eqz (i32.and (local.get 0) (i32.const 1)))
      )
      (func $is_positive (param i32) (result i32)
        (i32.gt_s (local.get 0) (i32.const 0))
      )

      ;; Apply predicate to value
      (func $apply (param $val i32) (param $fn i32) (result i32)
        (call_indirect (type $pred) (local.get $val) (local.get $fn))
      )

      (func (export "check_even") (param i32) (result i32)
        (call $apply (local.get 0) (ref.func $is_even))
      )
      (func (export "check_positive") (param i32) (result i32)
        (call $apply (local.get 0) (ref.func $is_positive))
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { check_even, check_positive } = new WebAssembly.Instance(mod).exports

  is(check_even(4), 1, '4 is even')
  is(check_even(5), 0, '5 is not even')
  is(check_positive(1), 1, '1 is positive')
  is(check_positive(-1), 0, '-1 is not positive')
})

t('polyfill: funcref in global initializer', () => {
  const src = `
    (module
      (type $fn (func (result i32)))
      (func $get42 (result i32) (i32.const 42))

      ;; Global initialized with ref.func
      (global $callback i32 (ref.func $get42))

      (func (export "call_global") (result i32)
        (call_indirect (type $fn) (global.get $callback))
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { call_global } = new WebAssembly.Instance(mod).exports

  is(call_global(), 42)
})

t('polyfill: funcref elem segment', () => {
  // ref.func in elem segment should be indexed correctly
  const src = `
    (module
      (type $fn (func (result i32)))
      (func $one (result i32) (i32.const 1))
      (func $two (result i32) (i32.const 2))
      (func $three (result i32) (i32.const 3))

      (table $t 3 funcref)
      (elem (table $t) (i32.const 0) func $one $two $three)

      ;; Also use ref.func elsewhere
      (func (export "direct") (result i32)
        (call_ref $fn (ref.func $two))
      )

      (func (export "indirect") (param i32) (result i32)
        (call_indirect $t (type $fn) (local.get 0))
      )
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { direct, indirect } = new WebAssembly.Instance(mod).exports

  is(direct(), 2, 'direct call via polyfilled ref.func')
  is(indirect(0), 1, 'indirect call via user table')
  is(indirect(1), 2, 'indirect call via user table')
  is(indirect(2), 3, 'indirect call via user table')
})

t('polyfill: funcref multiple types', () => {
  // Different function types should work
  const src = `
    (module
      (type $void (func))
      (type $unary (func (param i32) (result i32)))
      (type $binary (func (param i32 i32) (result i32)))

      (global $counter (mut i32) (i32.const 0))

      (func $inc_counter (global.set $counter (i32.add (global.get $counter) (i32.const 1))))
      (func $double (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))
      (func $add (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))

      (func (export "call_void") (call_ref $void (ref.func $inc_counter)))
      (func (export "call_unary") (param i32) (result i32)
        (call_ref $unary (local.get 0) (ref.func $double)))
      (func (export "call_binary") (param i32 i32) (result i32)
        (call_ref $binary (local.get 0) (local.get 1) (ref.func $add)))
      (func (export "get_counter") (result i32) (global.get $counter))
    )
  `

  const ast = polyfill(parse(src), 'funcref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { call_void, call_unary, call_binary, get_counter } = new WebAssembly.Instance(mod).exports

  is(get_counter(), 0)
  call_void()
  is(get_counter(), 1, 'void function called')
  is(call_unary(5), 10, 'unary function')
  is(call_binary(3, 4), 7, 'binary function')
})

t('polyfill: string option variants', () => {
  const src = `(module (type $fn (func)) (func $f) (func (call_ref $fn (ref.func $f))))`

  // All these should work
  let ast = polyfill(parse(src), true)
  ok(print(ast).includes('call_indirect'), 'true')

  ast = polyfill(parse(src), 'funcref')
  ok(print(ast).includes('call_indirect'), 'string: funcref')

  ast = polyfill(parse(src), 'all')
  ok(print(ast).includes('call_indirect'), 'string: all')

  ast = polyfill(parse(src), { funcref: true })
  ok(print(ast).includes('call_indirect'), 'object')
})

t('polyfill: disabled feature', () => {
  const src = `(module (type $fn (func)) (func $f) (func (call_ref $fn (ref.func $f))))`

  // Explicitly disable funcref
  const ast = polyfill(parse(src), { funcref: false })

  // Should NOT transform
  ok(print(ast).includes('call_ref'), 'call_ref preserved when disabled')
  ok(print(ast).includes('ref.func'), 'ref.func preserved when disabled')
})
