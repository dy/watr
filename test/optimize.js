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

test('treeshake: keeps imported memory used by i32.load/store', () => {
  // Repro: jz shared-memory mode. Memory ops (i32.load/i32.store) reference memory 0
  // implicitly without naming it — without explicit anchoring the import is wrongly dropped.
  const ast = parse(`(module
    (import "env" "memory" (memory 1))
    (func $f (export "f") (param $p i32) (result i32)
      (i32.store (i32.const 0) (i32.const 42))
      (i32.load (local.get $p))
    )
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('(import'), 'should keep memory import (used by i32.load/store)')
  assert(src.includes('"memory"'), 'should keep memory item name')
})

test('treeshake: keeps imported memory used by memory.copy', () => {
  const ast = parse(`(module
    (import "env" "memory" (memory 1))
    (func $f (export "f") (param $p i32)
      (memory.copy (i32.const 0) (local.get $p) (i32.const 16))
    )
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('(import'), 'should keep memory import (used by memory.copy)')
})

test('treeshake: keeps imported memory used by active data segment', () => {
  const ast = parse(`(module
    (import "env" "memory" (memory 1))
    (data (i32.const 0) "hello")
    (func $f (export "f") (result i32) (i32.const 0))
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('(import'), 'should keep memory import (active data segment writes to it)')
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

test('inline: callee with return is NOT inlined into different-typed caller', () => {
  // `(return X)` transfers control out of the enclosing function. If we inline
  // such a callee body into a different-typed caller, the `return` would
  // return from the CALLER with the callee's value type — type error at validation.
  // The inliner must refuse such callees (or rewrite returns to block-exits).
  const ast = parse(`(module
    (func $inner (result i32) (return (i32.const 1)))
    (func (export "wrap") (result f64)
      (f64.convert_i32_s (call $inner)))
  )`)
  const opt = optimize(ast, 'inline')
  // Validate via WebAssembly.Module (compile() returns bytes regardless of validity).
  assert.doesNotThrow(() => new WebAssembly.Module(compile(opt)), 'inlined module must validate')
})

test('inline: callee with return_call is NOT inlined into different-typed caller', () => {
  // Same hazard with `return_call` (tail call): control transfers to the called
  // function with the result returning to the caller's caller.
  const ast = parse(`(module
    (func $eq (param $a f64) (param $b f64) (result i32) (i32.const 0))
    (func $inner (result i32) (return_call $eq (f64.const 1) (f64.const 2)))
    (func (export "wrap") (result f64)
      (f64.convert_i32_s (call $inner)))
  )`)
  const opt = optimize(ast, 'inline')
  assert.doesNotThrow(() => new WebAssembly.Module(compile(opt)), 'inlined module must validate')
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

// ==================== PROPAGATE: SINGLE-USE LOCAL ELIMINATION ====================

test('propagate: inlines pure single-use local', () => {
  // local set once, read once, pure expr → inline and eliminate
  const ast = parse(`(module (func (export "f") (param $a i32) (result i32)
    (local $tmp i32)
    (local.set $tmp (i32.add (local.get $a) (i32.const 1)))
    (i32.mul (local.get $tmp) (i32.const 2))
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(!src.includes('$tmp'), 'should eliminate single-use local')
  assert(src.includes('i32.add'), 'should inline the add expression')
  assert(src.includes('i32.mul'), 'should keep the mul')
})

test('propagate: does not inline impure single-use', () => {
  // call is impure → must not inline
  const ast = parse(`(module
    (func $side (result i32) (i32.const 1))
    (func (export "f") (result i32)
      (local $tmp i32)
      (local.set $tmp (call $side))
      (local.get $tmp)
    )
  )`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  // call should remain — impure exprs can't be inlined/moved
  assert(src.includes('call'), 'should not inline impure expression')
})

test('propagate: removes dead stores', () => {
  // local set but never read → remove the set
  const ast = parse(`(module (func (export "f") (result i32)
    (local $dead i32)
    (local.set $dead (i32.const 99))
    (i32.const 42)
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(!src.includes('$dead'), 'should remove dead local')
  assert(!src.includes('i32.const 99'), 'should remove dead store value')
  assert(src.includes('i32.const 42'), 'should keep live code')
})

test('propagate: removes unused local declarations', () => {
  const ast = parse(`(module (func (export "f")
    (local $unused i32)
    (local $also_unused f64)
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(!src.includes('$unused'), 'should remove unused local decl')
  assert(!src.includes('$also_unused'), 'should remove all unused local decls')
})

test('propagate: invalidates at block boundary', () => {
  // local set before block, read inside block — block invalidates knowledge
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 10))
    (block (result i32) (local.get $x))
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  // After block boundary, propagation should be invalidated
  assert(src.includes('block'), 'block structure preserved')
})

test('propagate: invalidates at loop boundary', () => {
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 5))
    (loop (result i32) (local.get $x))
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(src.includes('loop'), 'loop structure preserved')
})

test('propagate: invalidates at if boundary', () => {
  const ast = parse(`(module (func (export "f") (param $c i32) (result i32)
    (local $x i32)
    (local.set $x (i32.const 7))
    (if (result i32) (local.get $c)
      (then (local.get $x))
      (else (i32.const 0))
    )
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(src.includes('if'), 'if structure preserved')
})

test('propagate: multi-use local not inlined as non-const', () => {
  // local read twice → can't inline non-const expr (would duplicate side-effect-free work)
  const ast = parse(`(module (func (export "f") (param $a i32) (result i32)
    (local $tmp i32)
    (local.set $tmp (i32.add (local.get $a) (i32.const 1)))
    (i32.add (local.get $tmp) (local.get $tmp))
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  // With 2 gets + 1 set, not single-use → should keep local
  assert(src.includes('local.get'), 'should keep multi-use local reads')
})

test('propagate: constant propagates to many uses', () => {
  const ast = parse(`(module (func (export "f") (result i32)
    (local $c i32)
    (local.set $c (i32.const 3))
    (i32.add (local.get $c) (local.get $c))
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  const matches = src.match(/i32\.const 3/g)
  assert(matches && matches.length >= 2, 'should propagate constant to all uses')
})

test('propagate: does not remove param-related sets', () => {
  const ast = parse(`(module (func (export "f") (param $p i32) (result i32)
    (local.get $p)
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(src.includes('param'), 'should preserve params')
})

test('propagate: compile and run single-use elimination', () => {
  const ast = parse(`(module (func (export "f") (param $a i32) (result i32)
    (local $tmp i32)
    (local.set $tmp (i32.add (local.get $a) (i32.const 10)))
    (i32.mul (local.get $tmp) (i32.const 3))
  ))`)
  const opt = optimize(ast)
  const binary = compile(opt)
  const mod = new WebAssembly.Module(binary)
  const { f } = new WebAssembly.Instance(mod).exports
  assert.equal(f(5), 45, 'single-use elimination should produce correct result')
})

test('propagate: constants survive across calls', () => {
  const ast = parse(`(module
    (func $side)
    (func (export "f") (result i32)
      (local $x i32)
      (local.set $x (i32.const 7))
      (call $side)
      (local.get $x)
    )
  )`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  // Constants should propagate across call boundaries
  assert(!src.includes('local.get'), 'should propagate constant past call')
})

// ==================== FOLD: f32/f64.nearest (roundTiesToEven) ====================

test('fold: f64.nearest rounds half to even (bankers rounding)', () => {
  // 0.5 → 0 (round to even)
  let ast = parse('(module (func (result f64) (f64.nearest (f64.const 0.5))))')
  let src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 0'), '0.5 → 0 (even)')

  // 1.5 → 2 (round to even)
  ast = parse('(module (func (result f64) (f64.nearest (f64.const 1.5))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 2'), '1.5 → 2 (even)')

  // 2.5 → 2 (round to even)
  ast = parse('(module (func (result f64) (f64.nearest (f64.const 2.5))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 2'), '2.5 → 2 (even)')

  // 3.5 → 4 (round to even)
  ast = parse('(module (func (result f64) (f64.nearest (f64.const 3.5))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 4'), '3.5 → 4 (even)')
})

test('fold: f64.nearest non-half values', () => {
  // 1.3 → 1
  let ast = parse('(module (func (result f64) (f64.nearest (f64.const 1.3))))')
  let src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 1'), '1.3 → 1')

  // 1.7 → 2
  ast = parse('(module (func (result f64) (f64.nearest (f64.const 1.7))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 2'), '1.7 → 2')

  // -1.5 → -2 (round to even, negative)
  ast = parse('(module (func (result f64) (f64.nearest (f64.const -1.5))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const -2'), '-1.5 → -2 (even)')

  // -2.5 → -2 (round to even, negative)
  ast = parse('(module (func (result f64) (f64.nearest (f64.const -2.5))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const -2'), '-2.5 → -2 (even)')
})

test('fold: f32.nearest rounds half to even (bankers rounding)', () => {
  // 0.5 → 0
  let ast = parse('(module (func (result f32) (f32.nearest (f32.const 0.5))))')
  let src = print(optimize(ast, 'fold'))
  assert(src.includes('f32.const 0'), '0.5 → 0 (even)')

  // 1.5 → 2
  ast = parse('(module (func (result f32) (f32.nearest (f32.const 1.5))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f32.const 2'), '1.5 → 2 (even)')

  // 2.5 → 2
  ast = parse('(module (func (result f32) (f32.nearest (f32.const 2.5))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f32.const 2'), '2.5 → 2 (even)')
})

test('fold: f64.nearest special values', () => {
  // already integer → unchanged
  let ast = parse('(module (func (result f64) (f64.nearest (f64.const 4))))')
  let src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 4'), '4.0 → 4')

  // 0 → 0
  ast = parse('(module (func (result f64) (f64.nearest (f64.const 0))))')
  src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 0'), '0 → 0')
})


// ==================== VACUUM ====================

test('vacuum: drop of pure const', () => {
  const ast = parse('(module (func (drop (i32.const 42))))')
  const opt = optimize(ast, 'vacuum')
  const src = print(opt)
  assert(!src.includes('i32.const 42'), 'should remove drop of pure const')
  assert(!src.includes('drop'), 'should remove drop')
})

test('vacuum: drop of local.get', () => {
  const ast = parse('(module (func (param $x i32) (drop (local.get $x))))')
  const opt = optimize(ast, 'vacuum')
  const src = print(opt)
  assert(!src.includes('drop'), 'should remove drop of local.get')
})

test('vacuum: select identical arms', () => {
  const ast = parse('(module (func (param $x i32) (param $c i32) (result i32) (select (local.get $x) (local.get $x) (local.get $c))))')
  const opt = optimize(ast, 'vacuum')
  const src = print(opt)
  assert(!src.includes('select'), 'should remove select with identical arms')
  assert(src.includes('local.get $x'), 'should keep the value')
})

test('vacuum: if with empty branches', () => {
  const ast = parse('(module (func (param $c i32) (if (local.get $c) (then) (else))))')
  const opt = optimize(ast, 'vacuum')
  const src = print(opt)
  assert(!src.includes('if'), 'should remove empty if')
})

test('vacuum: removes nop', () => {
  const ast = parse('(module (func nop (i32.const 1) drop))')
  const opt = optimize(ast, 'vacuum')
  const src = print(opt)
  assert(!src.includes('nop'), 'should remove nop')
})

// ==================== PEEPHOLE ====================

test('peephole: x - x → 0', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.sub (local.get $x) (local.get $x))))')
  const opt = optimize(ast, 'peephole')
  const src = print(opt)
  assert(src.includes('i32.const 0'), 'should fold x-x to 0')
  assert(!src.includes('i32.sub'), 'should remove sub')
})

test('peephole: x ^ x → 0', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.xor (local.get $x) (local.get $x))))')
  const opt = optimize(ast, 'peephole')
  const src = print(opt)
  assert(src.includes('i32.const 0'), 'should fold x^x to 0')
})

test('peephole: x & 0 → 0', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.and (local.get $x) (i32.const 0))))')
  const opt = optimize(ast, 'peephole')
  const src = print(opt)
  assert(src.includes('i32.const 0'), 'should fold x&0 to 0')
  assert(!src.includes('i32.and'), 'should remove and')
})

test('peephole: x | -1 → -1', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.or (local.get $x) (i32.const -1))))')
  const opt = optimize(ast, 'peephole')
  const src = print(opt)
  assert(src.includes('i32.const -1'), 'should fold x|-1 to -1')
  assert(!src.includes('i32.or'), 'should remove or')
})

test('peephole: x == x → 1', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.eq (local.get $x) (local.get $x))))')
  const opt = optimize(ast, 'peephole')
  const src = print(opt)
  assert(src.includes('i32.const 1'), 'should fold x==x to 1')
  assert(!src.includes('i32.eq'), 'should remove eq')
})

test('peephole: x < x → 0', () => {
  const ast = parse('(module (func (param $x i32) (result i32) (i32.lt_s (local.get $x) (local.get $x))))')
  const opt = optimize(ast, 'peephole')
  const src = print(opt)
  assert(src.includes('i32.const 0'), 'should fold x<x to 0')
})

test('peephole: redundant local.set', () => {
  const ast = parse('(module (func (param $x i32) (local.set $x (local.get $x))))')
  const opt = optimize(ast, 'peephole')
  const src = print(opt)
  assert(!src.includes('local.set'), 'should remove redundant set')
})

// ==================== GLOBAL CONSTANT PROPAGATION ====================

test('globals: replaces immutable global.get', () => {
  const ast = parse('(module (global $g i32 (i32.const 42)) (func (result i32) (global.get $g)))')
  const opt = optimize(ast, 'globals')
  const src = print(opt)
  assert(src.includes('i32.const 42'), 'should replace global.get with const')
  assert(!src.includes('global.get'), 'should remove global.get')
})

test('globals: preserves mutable global', () => {
  const ast = parse('(module (global $g (mut i32) (i32.const 42)) (func (result i32) (global.get $g)))')
  const opt = optimize(ast, 'globals')
  const src = print(opt)
  assert(src.includes('global.get $g'), 'should keep mutable global.get')
})

test('globals: preserves written global', () => {
  const ast = parse('(module (global $g (mut i32) (i32.const 42)) (func (global.set $g (i32.const 1)) (global.get $g)))')
  const opt = optimize(ast, 'globals')
  const src = print(opt)
  assert(src.includes('global.get $g'), 'should keep written global.get')
})

// ==================== LOAD/STORE OFFSET FOLDING ====================

test('offset: load add+const', () => {
  const ast = parse('(module (memory 1) (func (param $p i32) (result i32) (i32.load (i32.add (local.get $p) (i32.const 4)))))')
  const opt = optimize(ast, 'offset')
  const src = print(opt)
  assert(src.includes('offset=4'), 'should fold const into load offset')
  assert(!src.includes('i32.add'), 'should remove add')
})

test('offset: store add+const', () => {
  const ast = parse('(module (memory 1) (func (param $p i32) (i32.store (i32.add (local.get $p) (i32.const 8)) (i32.const 99))))')
  const opt = optimize(ast, 'offset')
  const src = print(opt)
  assert(src.includes('offset=8'), 'should fold const into store offset')
  assert(!src.includes('i32.add'), 'should remove add')
  assert(src.includes('i32.const 99'), 'should keep store value')
})

test('offset: accumulates existing offset', () => {
  const ast = parse('(module (memory 1) (func (param $p i32) (result i32) (i32.load offset=4 (i32.add (local.get $p) (i32.const 8)))))')
  const opt = optimize(ast, 'offset')
  const src = print(opt)
  assert(src.includes('offset=12'), 'should accumulate offsets')
})

// ==================== REDUNDANT BR REMOVAL ====================

test('unbranch: removes redundant br at end of block', () => {
  const ast = parse('(module (func (block $l (i32.const 1) drop (br $l))))')
  const opt = optimize(ast, 'unbranch')
  const src = print(opt)
  assert(!src.includes('br $l'), 'should remove redundant br')
})

test('unbranch: keeps meaningful br', () => {
  const ast = parse('(module (func (block $l (br $l) (i32.const 1) drop)))')
  const opt = optimize(ast, 'unbranch')
  const src = print(opt)
  assert(src.includes('br $l'), 'should keep non-terminal br')
})

// ==================== TYPE TREESHAKE ====================

test('treeshake: removes unused types', () => {
  const ast = parse(`(module
    (type $used (func (result i32)))
    (type $unused (func (param i32)))
    (func $f (export "f") (type $used) (result i32) (i32.const 1))
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$used'), 'should keep used type')
  assert(!src.includes('$unused'), 'should remove unused type')
})

// ==================== SMARTER INLINING ====================

test('inline: up to 4 params', () => {
  const ast = parse(`(module
    (func $add4 (param $a i32) (param $b i32) (param $c i32) (param $d i32) (result i32)
      (i32.add (i32.add (local.get $a) (local.get $b)) (i32.add (local.get $c) (local.get $d)))
    )
    (func (export "f") (result i32) (call $add4 (i32.const 1) (i32.const 2) (i32.const 3) (i32.const 4)))
  )`)
  const opt = optimize(ast, 'inline')
  const src = print(opt)
  assert(!src.includes('call $add4'), 'should inline 4-param function')
})

test('inline: multi-instruction body up to 3 instrs', () => {
  const ast = parse(`(module
    (func $triple (param $x i32) (result i32)
      (i32.add (local.get $x) (local.get $x))
    )
    (func (export "f") (result i32) (call $triple (i32.const 5)))
  )`)
  const opt = optimize(ast, 'inline')
  const src = print(opt)
  assert(!src.includes('call $triple'), 'should inline multi-instr function')
})

// ==================== SET+GET ELIMINATION ====================

test('propagate: adjacent set+get elimination', () => {
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 42))
    (local.get $x)
  ))`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(!src.includes('local.set'), 'should remove set')
  assert(!src.includes('local.get'), 'should remove get')
  assert(src.includes('i32.const 42'), 'should keep the expression')
})

test('propagate: adjacent set+get with impure expr', () => {
  const ast = parse(`(module
    (func $side (result i32) (i32.const 1))
    (func (export "f") (result i32)
      (local $x i32)
      (local.set $x (call $side))
      (local.get $x)
    )
  )`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(!src.includes('local.set'), 'should remove set even for impure')
  assert(!src.includes('local.get'), 'should remove get')
  assert(src.includes('call $side'), 'should keep the call')
})

// ==================== CONVERGENCE ====================

test('convergence: chained optimizations across rounds', () => {
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 0))
    (i32.add (local.get $x) (i32.const 5))
    (drop)
  ))`)
  const opt = optimize(ast)
  const src = print(opt)
  // propagate → fold → vacuum chain across rounds
  assert(!src.includes('local.set'), 'should eliminate local')
  assert(!src.includes('drop'), 'should vacuum drop')
  assert(!src.includes('i32.add'), 'should fold add')
})

test('convergence: global const enables fold', () => {
  const ast = parse(`(module
    (global $g i32 (i32.const 10))
    (func (export "f") (result i32)
      (i32.add (global.get $g) (i32.const 5))
    )
  )`)
  const opt = optimize(ast)
  const src = print(opt)
  assert(src.includes('i32.const 15'), 'should fold global+const')
})


// ==================== STRIP MUT FROM GLOBALS ====================

test('stripmut: removes mut from never-written global', () => {
  const ast = parse('(module (global $g (mut i32) (i32.const 42)) (func (result i32) (global.get $g)))')
  const opt = optimize(ast, 'stripmut')
  const src = print(opt)
  assert(src.includes('global $g i32'), 'should strip mut')
  assert(!src.includes('(mut i32)'), 'mut should be gone')
})

test('stripmut: preserves mut on written global', () => {
  const ast = parse('(module (global $g (mut i32) (i32.const 0)) (func (global.set $g (i32.const 1))))')
  const opt = optimize(ast, 'stripmut')
  const src = print(opt)
  assert(src.includes('(mut i32)'), 'should keep mut when written')
})

test('stripmut: enables global const propagation', () => {
  const ast = parse('(module (global $g (mut i32) (i32.const 7)) (func (result i32) (global.get $g)))')
  const opt = optimize(ast)
  const src = print(opt)
  assert(src.includes('i32.const 7'), 'should propagate after stripping mut')
  assert(!src.includes('global.get'), 'should eliminate global.get')
})

// ==================== BR_IF SIMPLIFICATION ====================

test('brif: if-then-br → br_if', () => {
  const ast = parse('(module (func (block $done (if (local.get $c) (then (br $done))) (i32.const 1)))))')
  const opt = optimize(ast, 'brif')
  const src = print(opt)
  assert(!/\(if\b/.test(src), 'should remove if')
  assert(src.includes('br_if $done'), 'should introduce br_if')
})

test('brif: if-else-br → br_if with inverted condition', () => {
  const ast = parse('(module (func (block $done (if (local.get $c) (then) (else (br $done))) (i32.const 1)))))')
  const opt = optimize(ast, 'brif')
  const src = print(opt)
  assert(!/\(if\b/.test(src), 'should remove if')
  assert(src.includes('br_if $done'), 'should introduce br_if')
})

test('brif: keeps multi-instruction arms', () => {
  const ast = parse('(module (func (block $done (if (local.get $c) (then (i32.const 1) drop (br $done))) (i32.const 2)))))')
  const opt = optimize(ast, 'brif')
  const src = print(opt)
  assert(src.includes('if'), 'should keep if when arm has extra instructions')
})

// ==================== MERGE IDENTICAL IF ARMS ====================

test('foldarms: identical trailing instructions hoisted', () => {
  const ast = parse(`(module (func (param $c i32) (result i32)
    (if (result i32) (local.get $c)
      (then (i32.const 1) (i32.const 10) (i32.add))
      (else (i32.const 2) (i32.const 10) (i32.add))
    )
  )))`)
  const opt = optimize(ast, 'foldarms')
  const src = print(opt)
  // The common suffix (const 10 + add) should be hoisted outside the if
  // so the if arms should only contain the distinct constants
  const thenMatch = src.match(/\(then[^)]*\)/)
  const elseMatch = src.match(/\(else[^)]*\)/)
  assert(thenMatch && !thenMatch[0].includes('i32.const 10'), 'then arm should not have hoisted code')
  assert(elseMatch && !elseMatch[0].includes('i32.const 10'), 'else arm should not have hoisted code')
  assert(src.includes('if'), 'should keep if')
})

test('foldarms: no change when arms differ', () => {
  const ast = parse(`(module (func (param $c i32) (result i32)
    (if (result i32) (local.get $c)
      (then (i32.const 1))
      (else (i32.const 2))
    )
  )))`)
  const opt = optimize(ast, 'foldarms')
  const src = print(opt)
  assert(src.includes('i32.const 1'), 'should preserve then value')
  assert(src.includes('i32.const 2'), 'should preserve else value')
})

test('foldarms: does not break void if with drop suffix', () => {
  // Regression: foldarms used to hoist `drop` from void if branches,
  // leaving value-producing branches in a result-less if.
  const ast = parse(`(module (func (param $c i32)
    (if (local.get $c)
      (then (block (result f64) (f64.const 1)) drop)
      (else (block (result f64) (f64.const 2)) drop)
    )
  ))`)
  const opt = optimize(ast, 'foldarms')
  const bin = compile(opt)
  // Should compile to valid WASM (no type mismatch)
  const mod = new WebAssembly.Module(bin)
  assert(mod instanceof WebAssembly.Module, 'should produce valid wasm')
})

test('foldarms: strips inner result when hoisting common tail to outer block', () => {
  // Regression (from jz __dyn_get): when `(if (result f64) ...)` has a common
  // trailing `(f64.const ...)` in both arms but the else has prefix statements
  // (local.set, block, ...), foldarms hoists the const into a wrapping block.
  // The new wrapping block carries `(result f64)`, but the inner `if` must lose
  // it — its branches are now void (their value-producing tails just moved out).
  // Previously the result annotation stayed on the inner if, breaking validation
  // since both branches now fall through with no value.
  const ast = parse(`(module (func $f (param $x f64) (result f64)
    (local $bits i64)
    (if (result f64) (f64.eq (local.get $x) (f64.const 0))
      (then (f64.const nan:0x7FF8000000000001))
      (else
        (local.set $bits (i64.reinterpret_f64 (local.get $x)))
        (block $b (loop $l (br_if $b (i64.eq (local.get $bits) (i64.const 0))) (br $l)))
        (f64.const nan:0x7FF8000000000001)))
    ) (export "f" (func $f)))`)
  const opt = optimize(ast, 'foldarms')
  const bin = compile(opt)
  const mod = new WebAssembly.Module(bin)
  assert(mod instanceof WebAssembly.Module, 'should produce valid wasm after foldarms hoist')
})

// ==================== DUPLICATE FUNCTION ELIMINATION ====================

test('dedupe: removes identical functions', () => {
  const ast = parse(`(module
    (func $a (i32.const 1) drop)
    (func $b (i32.const 1) drop)
    (func (export "f") (call $b))
  )`)
  const opt = optimize(ast, 'dedupe treeshake')
  const src = print(opt)
  assert(src.includes('$a'), 'should keep first occurrence')
  assert(!src.includes('$b'), 'should remove duplicate')
  assert(src.includes('call $a'), 'should redirect call to canonical')
})

test('dedupe: preserves different functions', () => {
  const ast = parse(`(module
    (func $a (i32.const 1) drop)
    (func $b (i32.const 2) drop)
    (func (export "f") (call $b))
  )`)
  const opt = optimize(ast, 'dedupe')
  const src = print(opt)
  assert(src.includes('$a'), 'should keep a')
  assert(src.includes('$b'), 'should keep b')
  assert(src.includes('call $b'), 'should keep original call')
})

test('dedupe: works with params', () => {
  const ast = parse(`(module
    (func $add1 (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 1)))
    (func $add1_copy (param $y i32) (result i32) (i32.add (local.get $y) (i32.const 1)))
    (func (export "f") (result i32) (call $add1_copy (i32.const 5)))
  )`)
  const opt = optimize(ast, 'dedupe treeshake')
  const src = print(opt)
  assert(src.includes('$add1'), 'should keep first')
  assert(!src.includes('$add1_copy'), 'should remove duplicate')
  assert(src.includes('call $add1'), 'should redirect call')
})

// ==================== REORDER FUNCTIONS ====================

test('reorder: hot functions come first', () => {
  const ast = parse(`(module
    (func $cold (i32.const 1) drop)
    (func $hot (i32.const 2) drop)
    (func $caller (call $hot) (call $hot) (call $cold))
  )`)
  const opt = optimize(ast, 'reorder')
  const src = print(opt)
  const hotIdx = src.indexOf('func $hot')
  const coldIdx = src.indexOf('func $cold')
  assert(hotIdx < coldIdx, 'hot function should appear before cold')
})

test('reorder: preserves module structure', () => {
  const ast = parse(`(module
    (global $g i32 (i32.const 0))
    (func $f (i32.const 1) drop)
    (export "f" (func $f))
  )`)
  const opt = optimize(ast, 'reorder')
  const src = print(opt)
  assert(src.includes('global $g'), 'should preserve globals')
  assert(src.includes('export "f"'), 'should preserve exports')
})

// ==================== SIGN-EXTENSION FOLDING ====================

test('fold: i32.extend8_s', () => {
  const ast = parse('(module (func (result i32) (i32.extend8_s (i32.const 255))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i32.const -1'), 'should fold extend8_s(255) to -1')
})

test('fold: i32.extend16_s', () => {
  const ast = parse('(module (func (result i32) (i32.extend16_s (i32.const 65535))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i32.const -1'), 'should fold extend16_s(65535) to -1')
})

test('fold: i64.extend8_s', () => {
  const ast = parse('(module (func (result i64) (i64.extend8_s (i64.const 255))))')
  const opt = optimize(ast, 'fold')
  const src = print(opt)
  assert(src.includes('i64.const -1'), 'should fold i64 extend8_s(255) to -1')
})

// ==================== VACUUM: EMPTY ELSE REMOVAL ====================

test('vacuum: removes empty else branch', () => {
  const ast = parse(`(module (func (param $c i32)
    (if (local.get $c)
      (then (i32.const 1) drop)
      (else)
    )
  ))`)
  const opt = optimize(ast, 'vacuum')
  const src = print(opt)
  assert(!src.includes('(else)'), 'should remove empty else')
})

// ==================== DEDUPE: REF.FUNC / ELEM / CALL_INDIRECT ====================

test('dedupe: updates ref.func references', () => {
  const ast = parse(`(module
    (func $a (i32.const 1) drop)
    (func $b (i32.const 1) drop)
    (func (export "f") (result funcref) (ref.func $b))
  )`)
  const opt = optimize(ast, 'dedupe')
  const src = print(opt)
  assert(src.includes('ref.func $a'), 'should redirect ref.func to canonical')
})

test('dedupe: updates elem segment references', () => {
  const ast = parse(`(module
    (table 2 funcref)
    (func $a (i32.const 1) drop)
    (func $b (i32.const 1) drop)
    (elem (i32.const 0) $b)
  )`)
  const opt = optimize(ast, 'dedupe')
  const src = print(opt)
  assert(src.includes('$a'), 'should redirect elem to canonical')
})

// ==================== TREESHAKE: UNUSED IMPORT REMOVAL ====================

test('treeshake: removes unused function imports', () => {
  const ast = parse(`(module
    (import "env" "used" (func $used (result i32)))
    (import "env" "unused" (func $unused (result i32)))
    (func (export "f") (result i32) (call $used))
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('"used"'), 'should keep used import')
  assert(!src.includes('"unused"'), 'should remove unused import')
})

// ==================== TYPE DEDUPLICATION ====================

test('dedupTypes: merges identical types', () => {
  const ast = parse(`(module
    (type $t1 (func (param i32) (result i32)))
    (type $t2 (func (param i32) (result i32)))
    (func $f (type $t2) (param i32) (result i32) (local.get 0))
    (func (export "main") (call_indirect (type $t2) (i32.const 0) (i32.const 1)))
  )`)
  const opt = optimize(ast, 'dedupTypes')
  const src = print(opt)
  assert(src.includes('$t1'), 'should keep first type')
  assert(!src.includes('$t2'), 'should remove duplicate type')
  assert(src.includes('(type $t1)'), 'should redirect func type ref')
  assert(src.includes('(type $t1)'), 'should redirect call_indirect type ref')
})

test('dedupTypes: preserves different types', () => {
  const ast = parse(`(module
    (type $t1 (func (param i32)))
    (type $t2 (func (param f32)))
    (func $f (type $t1) (param i32) drop)
  )`)
  const opt = optimize(ast, 'dedupTypes')
  const src = print(opt)
  assert(src.includes('$t1'), 'should keep t1')
  assert(src.includes('$t2'), 'should keep t2')
})

// ==================== DATA SEGMENT PACKING ====================

test('packData: trims trailing zeros', () => {
  const ast = parse(`(module
    (data (i32.const 0) "\\01\\02\\00\\00")
  )`)
  const opt = optimize(ast, 'packData')
  const src = print(opt)
  assert(!src.includes('\\00\\00"'), 'should trim trailing zeros')
  assert(src.includes('\\01\\02"'), 'should keep non-zero content')
})

test('packData: merges adjacent constant-offset segments', () => {
  const ast = parse(`(module
    (data (i32.const 0) "\\01\\02")
    (data (i32.const 2) "\\03\\04")
  )`)
  const opt = optimize(ast, 'packData')
  const src = print(opt)
  assert(!src.includes('(i32.const 2)'), 'should merge second segment')
  assert(src.includes('\\01\\02\\03\\04'), 'should have merged content')
})

// ==================== IMPORT FIELD MINIFICATION ====================

test('minifyImports: shortens module and field names', () => {
  const ast = parse(`(module
    (import "long_module_name" "long_field_name" (func $f (result i32)))
    (import "another_module" "another_field" (func $g (result i32)))
  )`)
  const opt = optimize(ast, 'minifyImports')
  const src = print(opt)
  assert(!src.includes('long_module_name'), 'should minify module name')
  assert(!src.includes('long_field_name'), 'should minify field name')
  assert(src.includes('"a"'), 'should use short module name')
})

// ==================== PROPAGATE: LOCAL.TEE CREATION ====================

test('propagate: set+get with extra uses becomes tee', () => {
  const ast = parse(`(module
    (func $impure (result i32) (i32.const 1))
    (func (export "f") (param $p i32) (result i32)
      (local $x i32)
      (local.set $x (call $impure))
      (local.get $x)
      (drop)
      (local.get $x)
    )
  )`)
  const opt = optimize(ast, 'propagate')
  const src = print(opt)
  assert(src.includes('local.tee'), 'should create local.tee for set+get with extra uses')
})

// ==================== INTEGRATION: COMBINATIONS ====================

test('integration: dedupe then treeshake removes orphan', () => {
  const ast = parse(`(module
    (func $a (i32.const 1) drop)
    (func $b (i32.const 1) drop)
    (func (export "f") (call $a))
  )`)
  const opt = optimize(ast)
  const src = print(opt)
  assert(!src.includes('$b'), 'should remove deduped+treeshaken function')
})

test('integration: stripmut + globals + fold', () => {
  const ast = parse(`(module
    (global $g (mut i32) (i32.const 3))
    (func (export "f") (result i32)
      (i32.add (global.get $g) (i32.const 2))
    )
  )`)
  const opt = optimize(ast)
  const src = print(opt)
  assert(src.includes('i32.const 5'), 'should fold 3+2 after global propagation')
})

test('integration: brif + unbranch + vacuum', () => {
  const ast = parse(`(module (func (param $c i32) (result i32)
    (block $done
      (if (local.get $c)
        (then (br $done))
      )
      (i32.const 1)
      (return)
    )
    (i32.const 0)
  ))`)
  const opt = optimize(ast)
  const src = print(opt)
  assert(src.includes('br_if'), 'should use br_if')
  assert(!/\(if\b/.test(src), 'should eliminate if')
})

test('integration: compile and run after all opts', () => {
  const ast = parse(`(module
    (global $g (mut i32) (i32.const 10))
    (func $double (param $x i32) (result i32)
      (i32.mul (local.get $x) (i32.const 2))
    )
    (func $double2 (param $y i32) (result i32)
      (i32.mul (local.get $y) (i32.const 2))
    )
    (func (export "test") (result i32)
      (local $a i32)
      (local.set $a (call $double2 (i32.const 5)))
      (i32.add (local.get $a) (global.get $g))
    )
  )`)
  const opt = optimize(ast)
  const binary = compile(opt)
  const mod = new WebAssembly.Module(binary)
  const { test: fn } = new WebAssembly.Instance(mod).exports
  assert.equal(fn(), 20, 'integration: 5*2 + 10 = 20')
})
