import t, { is, ok, same } from 'tst'
import polyfill, { detect, normalize, FEATURES } from '../src/polyfill.js'
import parse from '../src/parse.js'
import compile from '../src/compile.js'
import print from '../src/print.js'

t('polyfill: normalize options', () => {
  // true → all features
  same(normalize(true), {
    funcref: true, sign_ext: true, nontrapping: true, bulk_memory: true,
    return_call: true, i31ref: true, extended_const: true, multi_value: true,
    gc: true, ref_cast: true
  })

  // false → none
  same(normalize(false), {})

  // string → set
  same(normalize('funcref'), {
    funcref: true, sign_ext: false, nontrapping: false, bulk_memory: false,
    return_call: false, i31ref: false, extended_const: false, multi_value: false,
    gc: false, ref_cast: false
  })

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

// ============================================================================
// SIGN EXTENSION POLYFILL TESTS
// ============================================================================

t('polyfill: sign_ext → shift pairs', () => {
  const src = `(module
    (func (export "ext8") (param i32) (result i32) (i32.extend8_s (local.get 0)))
    (func (export "ext16") (param i32) (result i32) (i32.extend16_s (local.get 0)))
  )`

  const ast = polyfill(parse(src), 'sign_ext')
  const printed = print(ast)

  // Should transform to shift pairs
  ok(printed.includes('i32.shl'), 'uses shl')
  ok(printed.includes('i32.shr_s'), 'uses shr_s')
  ok(!printed.includes('extend8_s'), 'extend8_s removed')
  ok(!printed.includes('extend16_s'), 'extend16_s removed')
})

t('polyfill: sign_ext compiles and runs i32', () => {
  const src = `(module
    (func (export "ext8") (param i32) (result i32) (i32.extend8_s (local.get 0)))
    (func (export "ext16") (param i32) (result i32) (i32.extend16_s (local.get 0)))
  )`

  const ast = polyfill(parse(src), 'sign_ext')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { ext8, ext16 } = new WebAssembly.Instance(mod).exports

  // extend8_s: sign extend from 8 bits
  is(ext8(0x7f), 127, 'ext8(0x7f) = 127')
  is(ext8(0x80), -128, 'ext8(0x80) = -128')
  is(ext8(0xff), -1, 'ext8(0xff) = -1')
  is(ext8(0x100), 0, 'ext8(0x100) = 0 (overflow)')

  // extend16_s: sign extend from 16 bits
  is(ext16(0x7fff), 32767, 'ext16(0x7fff) = 32767')
  is(ext16(0x8000), -32768, 'ext16(0x8000) = -32768')
  is(ext16(0xffff), -1, 'ext16(0xffff) = -1')
})

t('polyfill: sign_ext compiles and runs i64', () => {
  const src = `(module
    (func (export "ext8") (param i64) (result i64) (i64.extend8_s (local.get 0)))
    (func (export "ext16") (param i64) (result i64) (i64.extend16_s (local.get 0)))
    (func (export "ext32") (param i64) (result i64) (i64.extend32_s (local.get 0)))
  )`

  const ast = polyfill(parse(src), 'sign_ext')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { ext8, ext16, ext32 } = new WebAssembly.Instance(mod).exports

  // i64.extend8_s
  is(ext8(0x7fn), 127n, 'ext8(0x7f) = 127')
  is(ext8(0xffn), -1n, 'ext8(0xff) = -1')

  // i64.extend16_s
  is(ext16(0x7fffn), 32767n, 'ext16(0x7fff) = 32767')
  is(ext16(0xffffn), -1n, 'ext16(0xffff) = -1')

  // i64.extend32_s
  is(ext32(0x7fffffffn), 2147483647n, 'ext32(0x7fffffff) = 2147483647')
  is(ext32(0xffffffffn), -1n, 'ext32(0xffffffff) = -1')
})

// ============================================================================
// NON-TRAPPING CONVERSIONS POLYFILL TESTS
// ============================================================================

t('polyfill: nontrapping → helper functions', () => {
  const src = `(module
    (func (export "test") (param f32) (result i32)
      (i32.trunc_sat_f32_s (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'nontrapping')
  const printed = print(ast)

  // Should have generated helper function
  ok(printed.includes('$__trunc'), 'helper function created')
  ok(printed.includes('call'), 'uses call to helper')
  ok(!printed.includes('trunc_sat'), 'trunc_sat removed')
})

t('polyfill: nontrapping i32.trunc_sat_f32_s', () => {
  const src = `(module
    (func (export "trunc") (param f32) (result i32)
      (i32.trunc_sat_f32_s (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'nontrapping')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { trunc } = new WebAssembly.Instance(mod).exports

  // Normal truncation
  is(trunc(1.5), 1, 'trunc(1.5) = 1')
  is(trunc(-1.5), -1, 'trunc(-1.5) = -1')
  is(trunc(0.0), 0, 'trunc(0) = 0')

  // Saturation cases
  is(trunc(1e30), 2147483647, 'trunc(1e30) = MAX_INT32')
  is(trunc(-1e30), -2147483648, 'trunc(-1e30) = MIN_INT32')

  // NaN returns 0
  is(trunc(NaN), 0, 'trunc(NaN) = 0')

  // Infinity saturates
  is(trunc(Infinity), 2147483647, 'trunc(+inf) = MAX_INT32')
  is(trunc(-Infinity), -2147483648, 'trunc(-inf) = MIN_INT32')
})

t('polyfill: nontrapping i32.trunc_sat_f32_u', () => {
  const src = `(module
    (func (export "trunc") (param f32) (result i32)
      (i32.trunc_sat_f32_u (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'nontrapping')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { trunc } = new WebAssembly.Instance(mod).exports

  // Normal
  is(trunc(1.5), 1, 'trunc(1.5) = 1')
  is(trunc(0.0), 0, 'trunc(0) = 0')

  // Saturation
  is(trunc(1e30) >>> 0, 4294967295, 'trunc(1e30) = MAX_UINT32')
  is(trunc(-1.0), 0, 'trunc(-1) = 0 (unsigned)')

  // NaN
  is(trunc(NaN), 0, 'trunc(NaN) = 0')
})

t('polyfill: nontrapping i32.trunc_sat_f64_s', () => {
  const src = `(module
    (func (export "trunc") (param f64) (result i32)
      (i32.trunc_sat_f64_s (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'nontrapping')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { trunc } = new WebAssembly.Instance(mod).exports

  is(trunc(1.5), 1)
  is(trunc(-1.5), -1)
  is(trunc(1e30), 2147483647)
  is(trunc(-1e30), -2147483648)
  is(trunc(NaN), 0)
})

t('polyfill: nontrapping i64.trunc_sat_f64_s', () => {
  const src = `(module
    (func (export "trunc") (param f64) (result i64)
      (i64.trunc_sat_f64_s (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'nontrapping')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { trunc } = new WebAssembly.Instance(mod).exports

  is(trunc(1.5), 1n, 'trunc(1.5) = 1')
  is(trunc(-1.5), -1n, 'trunc(-1.5) = -1')
  is(trunc(1e30), 9223372036854775807n, 'trunc(1e30) = MAX_INT64')
  is(trunc(-1e30), -9223372036854775808n, 'trunc(-1e30) = MIN_INT64')
  is(trunc(NaN), 0n, 'trunc(NaN) = 0')
})

t('polyfill: nontrapping i64.trunc_sat_f64_u', () => {
  const src = `(module
    (func (export "trunc") (param f64) (result i64)
      (i64.trunc_sat_f64_u (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'nontrapping')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { trunc } = new WebAssembly.Instance(mod).exports

  is(trunc(1.5), 1n, 'trunc(1.5) = 1')
  is(trunc(0.0), 0n, 'trunc(0) = 0')
  is(trunc(-1.0), 0n, 'trunc(-1) = 0 (unsigned clamps to 0)')
  is(trunc(NaN), 0n, 'trunc(NaN) = 0')
})

// ============================================================================
// BULK MEMORY POLYFILL TESTS
// ============================================================================

t('polyfill: bulk_memory → helper functions', () => {
  const src = `(module
    (memory 1)
    (func (export "copy")
      (memory.copy (i32.const 0) (i32.const 100) (i32.const 10))
    )
    (func (export "fill")
      (memory.fill (i32.const 0) (i32.const 0xff) (i32.const 64))
    )
  )`

  const ast = polyfill(parse(src), 'bulk_memory')
  const printed = print(ast)

  // Should have generated helper functions
  ok(printed.includes('$__memcpy'), 'memcpy helper created')
  ok(printed.includes('$__memset'), 'memset helper created')
  ok(!printed.includes('memory.copy'), 'memory.copy removed')
  ok(!printed.includes('memory.fill'), 'memory.fill removed')
})

t('polyfill: bulk_memory memory.copy compiles and runs', () => {
  const src = `(module
    (memory (export "mem") 1)
    (data (i32.const 0) "hello")
    (func (export "copy")
      (memory.copy (i32.const 100) (i32.const 0) (i32.const 5))
    )
    (func (export "get") (param i32) (result i32)
      (i32.load8_u (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'bulk_memory')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { copy, get, mem } = new WebAssembly.Instance(mod).exports

  // Before copy
  is(get(100), 0, 'dest initially 0')
  is(get(0), 104, 'src has "h" (104)')

  // After copy
  copy()
  is(get(100), 104, 'dest[0] = "h"')
  is(get(101), 101, 'dest[1] = "e"')
  is(get(102), 108, 'dest[2] = "l"')
  is(get(103), 108, 'dest[3] = "l"')
  is(get(104), 111, 'dest[4] = "o"')
})

t('polyfill: bulk_memory memory.fill compiles and runs', () => {
  const src = `(module
    (memory (export "mem") 1)
    (func (export "fill")
      (memory.fill (i32.const 0) (i32.const 0xAB) (i32.const 10))
    )
    (func (export "get") (param i32) (result i32)
      (i32.load8_u (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'bulk_memory')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { fill, get } = new WebAssembly.Instance(mod).exports

  // Before fill
  is(get(0), 0, 'initially 0')
  is(get(9), 0, 'initially 0')
  is(get(10), 0, 'boundary initially 0')

  // After fill
  fill()
  is(get(0), 0xAB, 'filled[0] = 0xAB')
  is(get(5), 0xAB, 'filled[5] = 0xAB')
  is(get(9), 0xAB, 'filled[9] = 0xAB')
  is(get(10), 0, 'boundary unchanged')
})

// ============================================================================
// RETURN CALL POLYFILL TESTS
// ============================================================================

t('polyfill: return_call → return + call', () => {
  const src = `(module
    (func $inner (result i32) (i32.const 42))
    (func (export "test") (result i32)
      (return_call $inner)
    )
  )`

  const ast = polyfill(parse(src), 'return_call')
  const printed = print(ast)

  // Should have converted return_call to return + call
  ok(!printed.includes('return_call'), 'return_call removed')
  ok(printed.includes('return'), 'return added')
  ok(printed.includes('call'), 'call added')
})

t('polyfill: return_call compiles and runs', () => {
  const src = `(module
    (func $factorial_tail (param $n i64) (param $acc i64) (result i64)
      (if (result i64) (i64.le_u (local.get $n) (i64.const 1))
        (then (local.get $acc))
        (else
          (return_call $factorial_tail
            (i64.sub (local.get $n) (i64.const 1))
            (i64.mul (local.get $n) (local.get $acc))
          )
        )
      )
    )
    (func (export "factorial") (param i64) (result i64)
      (call $factorial_tail (local.get 0) (i64.const 1))
    )
  )`

  const ast = polyfill(parse(src), 'return_call')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { factorial } = new WebAssembly.Instance(mod).exports

  is(factorial(0n), 1n, 'factorial(0) = 1')
  is(factorial(1n), 1n, 'factorial(1) = 1')
  is(factorial(5n), 120n, 'factorial(5) = 120')
  is(factorial(10n), 3628800n, 'factorial(10) = 3628800')
})

t('polyfill: return_call_indirect → return + call_indirect', () => {
  const src = `(module
    (type $fn (func (result i32)))
    (table funcref (elem $f1 $f2))
    (func $f1 (result i32) (i32.const 1))
    (func $f2 (result i32) (i32.const 2))
    (func (export "test") (param i32) (result i32)
      (return_call_indirect (type $fn) (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'return_call')
  const printed = print(ast)

  ok(!printed.includes('return_call_indirect'), 'return_call_indirect removed')
})

t('polyfill: return_call_indirect compiles and runs', () => {
  const src = `(module
    (type $fn (func (result i32)))
    (table funcref (elem $f1 $f2))
    (func $f1 (result i32) (i32.const 1))
    (func $f2 (result i32) (i32.const 2))
    (func (export "test") (param i32) (result i32)
      (return_call_indirect (type $fn) (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'return_call')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { test } = new WebAssembly.Instance(mod).exports

  is(test(0), 1, 'indirect call f1')
  is(test(1), 2, 'indirect call f2')
})

// ============================================================================
// COMBINED POLYFILLS TEST
// ============================================================================

t('polyfill: multiple features combined', () => {
  const src = `(module
    (memory 1)
    (func (export "ext8") (param i32) (result i32)
      (i32.extend8_s (local.get 0))
    )
    (func (export "fill")
      (memory.fill (i32.const 0) (i32.const 42) (i32.const 10))
    )
  )`

  const ast = polyfill(parse(src), 'sign_ext bulk_memory')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { ext8, fill } = new WebAssembly.Instance(mod).exports

  is(ext8(0xff), -1, 'sign_ext works')

  const mem = new Uint8Array(new WebAssembly.Instance(mod).exports.mem?.buffer || new ArrayBuffer(0))
  // Note: fill doesn't return, just test ext8 works
})

t('polyfill: all features auto-detect', () => {
  const src = `(module
    (func (export "ext") (param i32) (result i32) (i32.extend8_s (local.get 0)))
  )`

  // true should auto-detect and apply sign_ext
  const ast = polyfill(parse(src), true)
  const printed = print(ast)

  ok(printed.includes('i32.shl'), 'sign_ext auto-applied')
})

t('polyfill: detect all features', () => {
  const src = `(module
    (memory 1)
    (type $fn (func))
    (func $f)
    (func
      (i32.extend8_s (i32.const 1))
      (drop)
      (i32.trunc_sat_f32_s (f32.const 1.0))
      (drop)
      (memory.fill (i32.const 0) (i32.const 0) (i32.const 1))
      (return_call $f)
    )
    (func (call_ref $fn (ref.func $f)))
  )`

  const detected = detect(parse(src))
  ok(detected.has('sign_ext'), 'detects sign_ext')
  ok(detected.has('nontrapping'), 'detects nontrapping')
  ok(detected.has('bulk_memory'), 'detects bulk_memory')
  ok(detected.has('return_call'), 'detects return_call')
  ok(detected.has('funcref'), 'detects funcref')
})

// ============================================================================
// I31REF POLYFILL TESTS
// ============================================================================

t('polyfill: i31ref → i32 ops', () => {
  const src = `(module
    (func (export "make") (param i32) (result i32)
      (ref.i31 (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'i31ref')
  const printed = print(ast)

  // Should transform to i32.and
  ok(printed.includes('i32.and'), 'ref.i31 → i32.and')
  ok(!printed.includes('ref.i31'), 'ref.i31 removed')
})

t('polyfill: i31ref compiles and runs', () => {
  const src = `(module
    (func (export "make") (param i32) (result i32)
      (ref.i31 (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), 'i31ref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { make } = new WebAssembly.Instance(mod).exports

  // ref.i31 masks to 31 bits
  is(make(42), 42, 'make(42) = 42')
  is(make(0x7fffffff), 0x7fffffff, 'make(max) = max')
  is(make(0x80000000), 0, 'make(overflow) = 0 (masked)')
  is(make(-1), 0x7fffffff, 'make(-1) = 0x7fffffff (masked)')
})

t('polyfill: i31ref get_s sign extends', () => {
  const src = `(module
    (func (export "get_s") (param i32) (result i32)
      (i31.get_s (ref.i31 (local.get 0)))
    )
  )`

  const ast = polyfill(parse(src), 'i31ref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { get_s } = new WebAssembly.Instance(mod).exports

  is(get_s(42), 42, 'get_s(42) = 42')
  is(get_s(0x3fffffff), 0x3fffffff, 'get_s(max positive) = max positive')
  is(get_s(0x40000000), -0x40000000, 'get_s(sign bit set) = negative')
})

t('polyfill: i31ref get_u zero extends', () => {
  const src = `(module
    (func (export "get_u") (param i32) (result i32)
      (i31.get_u (ref.i31 (local.get 0)))
    )
  )`

  const ast = polyfill(parse(src), 'i31ref')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const { get_u } = new WebAssembly.Instance(mod).exports

  is(get_u(42), 42, 'get_u(42) = 42')
  is(get_u(0x7fffffff), 0x7fffffff, 'get_u(max) = max (masked)')
  // i31.get_u should not sign extend
  is(get_u(0x40000000) >>> 0, 0x40000000, 'get_u(sign bit) stays positive')
})

// ============================================================================
// EXTENDED CONST POLYFILL TESTS
// ============================================================================

t('polyfill: extended_const detection', () => {
  const src = `(module
    (global $base i32 (i32.const 100))
    (global $offset i32 (i32.add (global.get $base) (i32.const 50)))
  )`

  const detected = detect(parse(src))
  ok(detected.has('extended_const'), 'detects extended_const')
})

t('polyfill: extended_const evaluates', () => {
  const src = `(module
    (global $base i32 (i32.const 100))
    (global $offset (export "offset") i32 (i32.add (global.get $base) (i32.const 50)))
  )`

  const ast = polyfill(parse(src), 'extended_const')
  const printed = print(ast)

  // Should evaluate to constant
  ok(printed.includes('i32.const 150') || printed.includes('i32.const\n      150'), 'evaluated to 150')
})

t('polyfill: extended_const multiply', () => {
  const src = `(module
    (global $kb i32 (i32.const 1024))
    (global $mb (export "mb") i32 (i32.mul (global.get $kb) (i32.const 1024)))
  )`

  const ast = polyfill(parse(src), 'extended_const')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  is(inst.exports.mb.value, 1048576, 'mb = 1024 * 1024')
})

t('polyfill: extended_const i64', () => {
  const src = `(module
    (global $base i64 (i64.const 1000))
    (global $result (export "result") i64 (i64.mul (global.get $base) (i64.const 1000)))
  )`

  const ast = polyfill(parse(src), 'extended_const')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  is(inst.exports.result.value, 1000000n, 'result = 1000 * 1000')
})

// ============================================================================
// MULTI-VALUE POLYFILL TESTS
// ============================================================================

t('polyfill: multi_value detection', () => {
  const src = `(module
    (func $swap (param i32 i32) (result i32 i32)
      (local.get 1) (local.get 0)
    )
  )`

  const detected = detect(parse(src))
  ok(detected.has('multi_value'), 'detects multi_value')
})

t('polyfill: multi_value single result ok', () => {
  const src = `(module
    (func (export "f") (result i32) (i32.const 42))
  )`

  // Should not detect multi_value for single result
  const detected = detect(parse(src))
  ok(!detected.has('multi_value'), 'no multi_value for single result')
})

t('polyfill: multi_value transform', () => {
  const src = `(module
    (func $swap (param i32 i32) (result i32 i32)
      (local.get 1) (local.get 0)
    )
    (func (export "test") (result i32)
      (local $a i32) (local $b i32)
      (local.set $a (i32.const 10))
      (local.set $b (i32.const 20))
      (call $swap (local.get $a) (local.get $b))
      (drop)
    )
  )`

  const ast = polyfill(parse(src), 'multi_value')
  const printed = print(ast)

  // Should add globals for extra returns
  ok(printed.includes('global'), 'multi_value adds globals')
})

// ============================================================================
// GC POLYFILL TESTS (struct/array)
// ============================================================================

t('polyfill: gc struct detection', () => {
  const src = `(module
    (type $point (struct (field $x i32) (field $y i32)))
    (func (struct.new $point (i32.const 1) (i32.const 2)))
  )`
  ok(detect(parse(src)).has('gc'), 'detects gc from struct.new')
})

t('polyfill: gc array detection', () => {
  const src = `(module
    (type $arr (array i32))
    (func (array.new $arr (i32.const 0) (i32.const 10)))
  )`
  ok(detect(parse(src)).has('gc'), 'detects gc from array.new')
})

t('polyfill: gc struct transform', () => {
  const src = `(module
    (memory 1)
    (type $point (struct (field $x i32) (field $y i32)))
    (func (export "test") (result i32)
      (local $p (ref $point))
      (local.set $p (struct.new $point (i32.const 10) (i32.const 20)))
      (i32.add
        (struct.get $point $x (local.get $p))
        (struct.get $point $y (local.get $p))
      )
    )
  )`

  const ast = polyfill(parse(src), 'gc')
  const printed = print(ast)

  // Should have memory ops
  ok(printed.includes('i32.store'), 'struct.new → i32.store')
  ok(printed.includes('i32.load'), 'struct.get → i32.load')
})

t('polyfill: gc struct compiles and runs', () => {
  const src = `(module
    (memory (export "mem") 1)
    (type $point (struct (field $x i32) (field $y i32)))
    (func (export "test") (result i32)
      (local $p i32)
      (local.set $p (struct.new $point (i32.const 10) (i32.const 20)))
      (i32.add
        (struct.get $point $x (local.get $p))
        (struct.get $point $y (local.get $p))
      )
    )
  )`

  const ast = polyfill(parse(src), 'gc')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  is(inst.exports.test(), 30, 'struct field access works')
})

t('polyfill: gc struct.set', () => {
  const src = `(module
    (memory (export "mem") 1)
    (type $box (struct (field $val (mut i32))))
    (func (export "test") (result i32)
      (local $b i32)
      (local.set $b (struct.new $box (i32.const 5)))
      (struct.set $box $val (local.get $b) (i32.const 42))
      (struct.get $box $val (local.get $b))
    )
  )`

  const ast = polyfill(parse(src), 'gc')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  is(inst.exports.test(), 42, 'struct.set works')
})

t('polyfill: gc array compiles and runs', () => {
  const src = `(module
    (memory (export "mem") 1)
    (type $arr (array (mut i32)))
    (func (export "test") (result i32)
      (local $a i32)
      (local.set $a (array.new $arr (i32.const 99) (i32.const 5)))
      (array.get $arr (local.get $a) (i32.const 2))
    )
  )`

  const ast = polyfill(parse(src), 'gc')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  is(inst.exports.test(), 99, 'array.new fills with value')
})

t('polyfill: gc array.set and array.len', () => {
  const src = `(module
    (memory (export "mem") 1)
    (type $arr (array (mut i32)))
    (func (export "test") (result i32)
      (local $a i32)
      (local.set $a (array.new $arr (i32.const 0) (i32.const 3)))
      (array.set $arr (local.get $a) (i32.const 1) (i32.const 77))
      (i32.add
        (array.get $arr (local.get $a) (i32.const 1))
        (array.len (local.get $a))
      )
    )
  )`

  const ast = polyfill(parse(src), 'gc')
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  is(inst.exports.test(), 80, 'array.set=77, array.len=3, sum=80')
})

// ============================================================================
// REF_CAST POLYFILL TESTS
// ============================================================================

t('polyfill: ref_cast detection', () => {
  const src = `(module
    (type $a (struct))
    (func (param anyref) (drop (ref.test (ref $a) (local.get 0))))
  )`
  ok(detect(parse(src)).has('ref_cast'), 'detects ref_cast from ref.test')
})

t('polyfill: ref.test transform', () => {
  const src = `(module
    (memory 1)
    (type $a (struct))
    (func (export "test") (param i32) (result i32)
      (ref.test (ref $a) (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), { gc: true, ref_cast: true })
  const printed = print(ast)

  // Should have i32.load for type tag check
  ok(printed.includes('i32.load'), 'ref.test → i32.load type check')
  ok(printed.includes('i32.eq'), 'ref.test → i32.eq comparison')
})

t('polyfill: ref.test compiles and runs', () => {
  const src = `(module
    (memory (export "mem") 1)
    (type $point (struct (field i32) (field i32)))
    (type $box (struct (field i32)))

    (func (export "make_point") (result i32)
      (struct.new $point (i32.const 1) (i32.const 2))
    )
    (func (export "make_box") (result i32)
      (struct.new $box (i32.const 42))
    )
    (func (export "is_point") (param i32) (result i32)
      (ref.test (ref $point) (local.get 0))
    )
    (func (export "is_box") (param i32) (result i32)
      (ref.test (ref $box) (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), { gc: true, ref_cast: true })
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  const p = inst.exports.make_point()
  const b = inst.exports.make_box()

  is(inst.exports.is_point(p), 1, 'point is_point = true')
  is(inst.exports.is_point(b), 0, 'box is_point = false')
  is(inst.exports.is_box(p), 0, 'point is_box = false')
  is(inst.exports.is_box(b), 1, 'box is_box = true')
})

t('polyfill: ref.test null check', () => {
  const src = `(module
    (memory (export "mem") 1)
    (type $point (struct (field i32)))

    (func (export "is_point") (param i32) (result i32)
      (ref.test (ref $point) (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), { gc: true, ref_cast: true })
  const binary = compile(ast)
  const mod = new WebAssembly.Module(binary)
  const inst = new WebAssembly.Instance(mod)

  // null (0) should return 0
  is(inst.exports.is_point(0), 0, 'ref.test(null) = false')
})

t('polyfill: ref.cast transform', () => {
  const src = `(module
    (memory 1)
    (type $a (struct))
    (func (export "cast") (param i32) (result i32)
      (ref.cast (ref $a) (local.get 0))
    )
  )`

  const ast = polyfill(parse(src), { gc: true, ref_cast: true })
  const printed = print(ast)

  // Should have unreachable for failed cast
  ok(printed.includes('unreachable'), 'ref.cast has trap path')
})
