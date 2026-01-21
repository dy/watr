import { test } from 'node:test'
import assert from 'node:assert'
import optimize, { treeshake, fold, deadcode, localReuse } from '../src/optimize.js'
import parse from '../src/parse.js'
import print from '../src/print.js'
import compile from '../src/compile.js'

// ==================== CONSTANT FOLDING ====================

test('fold: i32 arithmetic', () => {
  const ast = parse('(module (func (result i32) (i32.add (i32.const 1) (i32.const 2))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i32.const 3'), 'should fold 1+2 to 3')
})

test('fold: i32 nested', () => {
  const ast = parse('(module (func (result i32) (i32.mul (i32.add (i32.const 2) (i32.const 3)) (i32.const 4))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i32.const 20'), 'should fold (2+3)*4 to 20')
})

test('fold: i64 arithmetic', () => {
  const ast = parse('(module (func (result i64) (i64.add (i64.const 100) (i64.const 200))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i64.const 300'), 'should fold i64 100+200 to 300')
})

test('fold: comparison', () => {
  const ast = parse('(module (func (result i32) (i32.lt_s (i32.const 1) (i32.const 2))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i32.const 1'), 'should fold 1<2 to 1')
})

test('fold: unary ops', () => {
  const ast = parse('(module (func (result i32) (i32.eqz (i32.const 0))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i32.const 1'), 'should fold eqz(0) to 1')
})

test('fold: preserves non-const', () => {
  const ast = parse('(module (func (param i32) (result i32) (i32.add (local.get 0) (i32.const 1))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i32.add'), 'should preserve add with non-const')
  assert(src.includes('local.get'), 'should preserve local.get')
})

test('fold: f32', () => {
  const ast = parse('(module (func (result f32) (f32.add (f32.const 1.5) (f32.const 2.5))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('f32.const 4'), 'should fold f32 1.5+2.5')
})

// ==================== DEAD CODE ELIMINATION ====================

test('deadcode: after unreachable', () => {
  const ast = parse('(module (func unreachable (i32.const 42) drop))')
  const opt = optimize(ast, 'deadcode')
  const src = print(opt)
  assert(src.includes('unreachable'), 'should keep unreachable')
  assert(!src.includes('i32.const 42'), 'should remove code after unreachable')
})

test('deadcode: after return', () => {
  const ast = parse('(module (func (result i32) (return (i32.const 1)) (i32.const 2)))')
  const opt = optimize(ast, 'deadcode')
  const src = print(opt)
  assert(src.includes('i32.const 1'), 'should keep returned value')
  assert(!src.includes('i32.const 2'), 'should remove code after return')
})

test('deadcode: after br', () => {
  const ast = parse('(module (func (block $b (br $b) (i32.const 99) drop)))')
  const opt = optimize(ast, 'deadcode')
  const src = print(opt)
  assert(src.includes('br $b'), 'should keep br')
  assert(!src.includes('i32.const 99'), 'should remove code after br')
})

test('deadcode: preserves live code', () => {
  const ast = parse('(module (func (result i32) (i32.const 1) (i32.const 2) i32.add))')
  const opt = optimize(ast, 'deadcode')
  const src = print(opt)
  assert(src.includes('i32.const 1'), 'should keep first const')
  assert(src.includes('i32.const 2'), 'should keep second const')
  assert(src.includes('i32.add'), 'should keep add')
})

// ==================== IDENTITY REMOVAL ====================

test('identity: x + 0 → x', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 0))))')
  const opt = optimize(ast, 'identity')
  const src = print(opt)
  assert(!src.includes('i32.add'), 'should remove add with 0')
  assert(!src.includes('i32.const 0'), 'should remove const 0')
  assert(src.includes('local.get'), 'should keep local.get')
})

test('identity: x * 1 → x', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.mul (local.get $x) (i32.const 1))))')
  const opt = optimize(ast, 'identity')
  const src = print(opt)
  assert(!src.includes('i32.mul'), 'should remove mul with 1')
})

test('identity: x | 0 → x', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.or (i32.const 0) (local.get $x))))')
  const opt = optimize(ast, 'identity')
  const src = print(opt)
  assert(!src.includes('i32.or'), 'should remove or with 0')
})

test('identity: x << 0 → x', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.shl (local.get $x) (i32.const 0))))')
  const opt = optimize(ast, 'identity')
  const src = print(opt)
  assert(!src.includes('i32.shl'), 'should remove shift by 0')
})

// ==================== STRENGTH REDUCTION ====================

test('strength: x * 2 → x << 1', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.mul (local.get $x) (i32.const 2))))')
  const opt = optimize(ast, 'strength')
  const src = print(opt)
  assert(!src.includes('i32.mul'), 'should remove mul')
  assert(src.includes('i32.shl'), 'should have shift')
  assert(src.includes('i32.const 1'), 'should shift by 1')
})

test('strength: x * 8 → x << 3', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.mul (local.get $x) (i32.const 8))))')
  const opt = optimize(ast, 'strength')
  const src = print(opt)
  assert(src.includes('i32.shl'), 'should have shift')
  assert(src.includes('i32.const 3'), 'should shift by 3')
})

test('strength: x / 4 (unsigned) → x >> 2', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.div_u (local.get $x) (i32.const 4))))')
  const opt = optimize(ast, 'strength')
  const src = print(opt)
  assert(!src.includes('i32.div_u'), 'should remove div')
  assert(src.includes('i32.shr_u'), 'should have shift')
})

test('strength: x % 8 (unsigned) → x & 7', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.rem_u (local.get $x) (i32.const 8))))')
  const opt = optimize(ast, 'strength')
  const src = print(opt)
  assert(!src.includes('i32.rem_u'), 'should remove rem')
  assert(src.includes('i32.and'), 'should have and')
  assert(src.includes('i32.const 7'), 'should mask with 7')
})

// ==================== BRANCH SIMPLIFICATION ====================

test('branch: if const true → then', () => {
  const ast = parse('(module (func (result i32) (if (result i32) (i32.const 1) (then (i32.const 42)) (else (i32.const 0)))))')
  const opt = optimize(ast, 'branch')
  const src = print(opt)
  assert(src.includes('i32.const 42'), 'should keep then value')
  assert(!src.includes('i32.const 0'), 'should remove else value')
  assert(!src.includes('if'), 'should remove if')
})

test('branch: if const false → else', () => {
  const ast = parse('(module (func (result i32) (if (result i32) (i32.const 0) (then (i32.const 42)) (else (i32.const 99)))))')
  const opt = optimize(ast, 'branch')
  const src = print(opt)
  assert(!src.includes('i32.const 42'), 'should remove then value')
  assert(src.includes('i32.const 99'), 'should keep else value')
})

test('branch: br_if const false → nop', () => {
  const ast = parse('(module (func (block $b (br_if $b (i32.const 0)))))')
  const opt = optimize(ast, 'branch')
  const src = print(opt)
  assert(!src.includes('br_if'), 'should remove br_if')
})

test('branch: select const → chosen value', () => {
  const ast = parse('(module (func (result i32) (select (i32.const 1) (i32.const 2) (i32.const 1))))')
  const opt = optimize(ast, 'branch')
  const src = print(opt)
  assert(!src.includes('select'), 'should remove select')
  // Should keep the first value (condition is truthy)
})

// ==================== LOCAL REUSE ====================

test('locals: removes unused', () => {
  const ast = parse('(module (func (local $unused i32) (local $used i32) (local.get $used) drop))')
  const opt = optimize(ast, 'locals')
  const src = print(opt)
  assert(!src.includes('$unused'), 'should remove unused local')
  assert(src.includes('$used'), 'should keep used local')
})

test('locals: keeps params', () => {
  const ast = parse('(module (func (param $p i32) (local $unused i32)))')
  const opt = optimize(ast, 'locals')
  const src = print(opt)
  assert(src.includes('param $p'), 'should keep param')
  assert(!src.includes('$unused'), 'should remove unused local')
})

// ==================== TREESHAKE ====================

test('treeshake: removes unused func', () => {
  const ast = parse(`(module
    (func $used (export "f") (result i32) (i32.const 1))
    (func $unused (result i32) (i32.const 2))
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$used'), 'should keep exported func')
  assert(!src.includes('$unused'), 'should remove unused func')
})

test('treeshake: keeps called func', () => {
  const ast = parse(`(module
    (func $main (export "main") (call $helper))
    (func $helper (i32.const 1) drop)
    (func $unused (i32.const 2) drop)
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$main'), 'should keep exported')
  assert(src.includes('$helper'), 'should keep called func')
  assert(!src.includes('$unused'), 'should remove unused')
})

test('treeshake: keeps start func', () => {
  const ast = parse(`(module
    (func $init)
    (func $unused)
    (start $init)
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$init'), 'should keep start func')
  assert(!src.includes('$unused'), 'should remove unused')
})

test('treeshake: keeps elem-referenced', () => {
  const ast = parse(`(module
    (table 1 funcref)
    (func $indirect)
    (func $unused)
    (elem (i32.const 0) $indirect)
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$indirect'), 'should keep elem-referenced func')
})

test('treeshake: transitive deps', () => {
  const ast = parse(`(module
    (func $a (export "a") (call $b))
    (func $b (call $c))
    (func $c)
    (func $unused)
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$a'), 'should keep a')
  assert(src.includes('$b'), 'should keep b')
  assert(src.includes('$c'), 'should keep c')
  assert(!src.includes('$unused'), 'should remove unused')
})

// ==================== CONSTANT PROPAGATION ====================

test('propagate: local set then get', () => {
  const ast = parse('(module (func (result i32) (local $x i32) (local.set $x (i32.const 42)) (local.get $x)))')
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  // After propagation, the local.get should be replaced with the constant
  assert(src.includes('i32.const 42'), 'should propagate constant')
})

test('propagate: multiple uses', () => {
  const ast = parse('(module (func (result i32) (local $x i32) (local.set $x (i32.const 10)) (i32.add (local.get $x) (local.get $x))))')
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  // Both gets should become constants
  const matches = src.match(/i32\.const 10/g)
  assert(matches && matches.length >= 2, 'should propagate to multiple uses')
})

// ==================== FUNCTION INLINING ====================

test('inline: simple function', () => {
  const ast = parse(`(module
    (func $const42 (result i32) (i32.const 42))
    (func (export "f") (result i32) (call $const42))
  )`)
  const opt = optimize(ast, 'inline')
  const src = print(opt)
  // The call should be replaced with the inlined body
  assert(!src.includes('call $const42'), 'should inline the call')
  // The constant should appear in the exported func
})

test('inline: with params', () => {
  const ast = parse(`(module
    (func $add1 (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 1)))
    (func (export "f") (result i32) (call $add1 (i32.const 5)))
  )`)
  const opt = optimize(ast, 'inline')
  const src = print(opt)
  assert(!src.includes('call $add1'), 'should inline parameterized call')
})

test('inline: preserves exports', () => {
  const ast = parse(`(module
    (func $helper (export "h") (result i32) (i32.const 1))
    (func (export "f") (result i32) (call $helper))
  )`)
  const opt = optimize(ast, 'inline')
  const src = print(opt)
  // Exported functions should NOT be inlined at call site (they must remain callable)
  assert(src.includes('call $helper'), 'should not inline exported func')
})

// ==================== COMBINED ====================

test('all optimizations together', () => {
  const ast = parse(`(module
    (func $main (export "f") (result i32)
      (local $unused i32)
      (i32.add (i32.const 10) (i32.const 20))
    )
    (func $dead (unreachable) (i32.const 99) drop)
  )`)
  const opt = optimize(ast)
  const src = print(opt)
  assert(src.includes('i32.const 30'), 'should fold constants')
  assert(!src.includes('$unused'), 'should remove unused local')
  assert(!src.includes('$dead'), 'should treeshake unused func')
})

test('optimize compiles correctly', () => {
  const ast = parse(`(module
    (func (export "add") (result i32)
      (i32.add (i32.const 20) (i32.const 22))
    )
    (func $unused (result i32) (i32.const 0))
  )`)
  const opt = optimize(ast)
  const binary = compile(opt)
  const mod = new WebAssembly.Module(binary)
  const { add } = new WebAssembly.Instance(mod).exports
  assert.equal(add(), 42, 'optimized code should work')
})

test('optimize accepts string', () => {
  const opt = optimize('(module (func (result i32) (i32.add (i32.const 1) (i32.const 2))))')
  const src = print(opt)
  assert(src.includes('i32.const 3'), 'should accept and optimize string')
})

test('optimize with specific options', () => {
  const ast = parse('(module (func (result i32) (i32.add (i32.const 1) (i32.const 2))))')
  const opt = optimize(ast, { fold: true, treeshake: false })
  const src = print(opt)
  assert(src.includes('i32.const 3'), 'should fold with explicit option')
})

// ==================== EDGE CASES ====================

test('optimize: empty module', () => {
  const ast = parse('(module)')
  const opt = optimize(ast)
  const src = print(opt)
  assert(src.includes('module'), 'should handle empty module')
})

test('optimize: no exports keeps all', () => {
  const ast = parse('(module (func $a) (func $b))')
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  // No exports means keep everything (library module)
  assert(src.includes('$a'), 'should keep func a')
  assert(src.includes('$b'), 'should keep func b')
})

test('optimize: i64 identity', () => {
  const ast = parse('(module (func (param $x i64) (result i64) (i64.add (local.get $x) (i64.const 0))))')
  const opt = optimize(ast, 'identity')
  const src = print(opt)
  assert(!src.includes('i64.add'), 'should remove i64 add with 0')
})

test('optimize: i64 strength', () => {
  const ast = parse('(module (func (param $x i64) (result i64) (i64.mul (local.get $x) (i64.const 4))))')
  const opt = optimize(ast, 'strength')
  const src = print(opt)
  assert(src.includes('i64.shl'), 'should convert i64 mul to shift')
})

test('optimize: nested blocks deadcode', () => {
  const ast = parse('(module (func (block (block (return) (i32.const 1) drop))))')
  const opt = optimize(ast, 'deadcode')
  const src = print(opt)
  assert(!src.includes('i32.const 1'), 'should remove dead code in nested blocks')
})

test('optimize: chained optimizations', () => {
  // propagate → fold → identity chain
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 0))
    (i32.add (local.get $x) (i32.const 5))
  ))`)
  const opt = optimize(ast)
  const src = print(opt)
  // propagate: local.get $x → i32.const 0
  // fold: i32.add 0 5 → i32.const 5
  assert(src.includes('i32.const 5'), 'should chain optimizations')
})

test('optimize: compile and run complex', () => {
  const ast = parse(`(module
    (func $double (param $x i32) (result i32) (i32.mul (local.get $x) (i32.const 2)))
    (func (export "test") (result i32)
      (local $a i32)
      (local.set $a (i32.const 10))
      (call $double (local.get $a))
    )
  )`)
  const opt = optimize(ast)
  const binary = compile(opt)
  const mod = new WebAssembly.Module(binary)
  const { test: fn } = new WebAssembly.Instance(mod).exports
  assert.equal(fn(), 20, 'complex optimized code should work')
})
