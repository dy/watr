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
