import { test } from 'node:test'
import assert from 'node:assert'
import optimize, { treeshake, fold, deadcode, localReuse, count, binarySize } from '../src/optimize.js'
import { parse, print, compile } from './runner.js'

// The optimizer canonicalizes folded `i64.const` values to 16-digit hex (the raw
// bits — lossless for NaN-box / bit-pattern constants). Hex and decimal encode to
// identical bytes, so i64 fold tests assert on the VALUE, not the text form.
const toBig = (s) => s[0] === '-' ? -BigInt(s.slice(1)) : BigInt(s)   // BigInt() rejects '-0x1'
const i64has = (src, v) =>
  [...src.matchAll(/\(i64\.const\s+(-?(?:0x[0-9a-fA-F]+|\d+))\)/g)]
    .some(m => BigInt.asUintN(64, toBig(m[1])) === BigInt.asUintN(64, toBig(String(v))))

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
  assert(i64has(src, 300n), 'should fold i64 100+200 to 300')
})

test('fold: signed hex integer literals', () => {
  for (const [type, expr, expect] of [
    ['i32', '(i32.add (i32.const -0x1) (i32.const 2))', 1n],
    ['i64', '(i64.add (i64.const -0x1) (i64.const 1))', 0n],
    ['i64', '(i64.add (i64.const +0x2) (i64.const 3))', 5n],
  ]) {
    const ast = parse(`(module (func (result ${type}) ${expr}))`)
    const src = print(optimize(ast, 'fold'))
    const ok = type === 'i64' ? i64has(src, expect) : src.includes(`i32.const ${expect}`)
    assert(ok, `should fold ${expr}`)
  }
  // Round-trip: a bare `-0x1` must survive parse → optimize → compile and
  // evaluate to -1 at runtime. Guards getConst's negative-hex parse path so
  // downstream emitters don't need the unsigned-hex workaround.
  const ast = parse('(module (func (export "f") (result i64) (i64.const -0x1)))')
  const opt = optimize(ast, 'fold propagate treeshake')
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(), -1n, '(i64.const -0x1) round-trips to -1')
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
  const opt = optimize(ast, 'propagate fold')
  const src = print(opt)
  // Gets become constants, then fold reduces 10+10→20
  assert(src.includes('i32.const 20'), 'should propagate and fold to 20')
  assert(!src.includes('local.set $x'), 'should eliminate local')
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
  const opt = optimize(ast, 'inline fold')
  const src = print(opt)
  assert(!src.includes('call $add1'), 'should inline parameterized call')
})

test('inline: bare param body substitutes at root', () => {
  // The body is a single `(local.get $x)` — the root itself is what must be
  // substituted with the const arg. If the inner walk drops the root replacement,
  // the call site keeps an orphan `(local.get $x)` referencing a vanished param.
  const ast = parse(`(module
    (func $id (param $x i32) (result i32) (local.get $x))
    (func (export "main") (result i32) (call $id (i32.const 42)))
  )`)
  const opt = optimize(ast, 'inline treeshake')
  const src = print(opt)
  assert(!src.includes('call $id'), 'call should be inlined')
  assert(!src.includes('local.get $x'), 'no orphan param read left at the call site')
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.main(), 42)
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

// ==================== INLINE-ONCE ====================

test('inlineOnce: single-call function is inlined and removed', () => {
  const ast = parse(`(module
    (func $helper (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 1)))
    (func (export "f") (param $a i32) (result i32) (call $helper (local.get $a)))
  )`)
  const opt = optimize(ast, 'inlineOnce')
  const src = print(opt)
  assert(!src.includes('call $helper'), 'call should be inlined')
  assert(!src.includes('$helper'), 'callee should be removed')
  assert.doesNotThrow(() => new WebAssembly.Module(compile(opt)), 'must validate')
})

test('inlineOnce: leaves multi-call functions alone', () => {
  const ast = parse(`(module
    (func $h (result i32) (i32.const 7))
    (func (export "f") (result i32) (i32.add (call $h) (call $h)))
  )`)
  const opt = optimize(ast, 'inlineOnce')
  assert(print(opt).includes('call $h'), 'should not inline a function called twice')
})

test('inlineOnce: leaves exported / table / start functions alone', () => {
  const ast = parse(`(module
    (table 1 funcref) (elem (i32.const 0) $t)
    (func $e (export "e") (result i32) (i32.const 1))
    (func $t (result i32) (i32.const 2))
    (func $s)
    (start $s)
    (func (export "f") (result i32) (i32.add (call $e) (call $t)))
  )`)
  const opt = optimize(ast, 'inlineOnce')
  const src = print(opt)
  assert(src.includes('$e') && src.includes('$t') && src.includes('$s'), 'pinned funcs survive')
})

test('inlineOnce: renames callee labels to avoid shadowing the caller', () => {
  // Both functions use the label name `$l`. Naive inlining would nest two `$l`
  // blocks, and `br $l` inside the inlined body would resolve to the wrong depth.
  const ast = parse(`(module
    (func $inner (param $n i32) (result i32)
      (local $i i32) (local $acc i32)
      (block $l (loop $loop
        (br_if $l (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $acc (i32.add (local.get $acc) (local.get $i)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))
      (local.get $acc))
    (func (export "f") (param $m i32) (result i32)
      (local $r i32)
      (block $l (loop $loop
        (br_if $l (i32.ge_s (local.get $r) (i32.const 1)))
        (local.set $r (call $inner (local.get $m)))
        (br $loop)))
      (local.get $r))
  )`)
  const opt = optimize(ast, 'inlineOnce')
  assert(!print(opt).includes('call $inner'), 'inlined')
  const mod = new WebAssembly.Module(compile(opt))
  const { exports } = new WebAssembly.Instance(mod)
  assert.equal(exports.f(5), 10, '0+1+2+3+4 = 10')
})

test('inlineOnce: chains collapse to a fixpoint', () => {
  const ast = parse(`(module
    (func $c (param $x i32) (result i32) (i32.mul (local.get $x) (i32.const 2)))
    (func $b (param $x i32) (result i32) (call $c (i32.add (local.get $x) (i32.const 1))))
    (func $a (param $x i32) (result i32) (call $b (local.get $x)))
    (func (export "f") (param $x i32) (result i32) (call $a (local.get $x)))
  )`)
  const opt = optimize(ast, 'inlineOnce')
  const src = print(opt)
  assert(!/call \$[abc]\b/.test(src), 'all helpers inlined away')
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(3), 8, '(3+1)*2')
})

test('inlineOnce: void callee with early return', () => {
  const ast = parse(`(module
    (global $g (mut i32) (i32.const 0))
    (func $set (param $v i32)
      (if (i32.eqz (local.get $v)) (then (return)))
      (global.set $g (local.get $v)))
    (func (export "f") (param $v i32) (result i32)
      (call $set (local.get $v)) (global.get $g))
  )`)
  const opt = optimize(ast, 'inlineOnce')
  assert(!print(opt).includes('call $set'), 'inlined')
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(0), 0)
  assert.equal(exports.f(42), 42)
})

test('inlineOnce: skips callees with numeric branch labels', () => {
  // Depth-relative labels shift under the added block nesting — must be left alone.
  const ast = parse(`(module
    (func $h (result i32) (block (result i32) (br 0 (i32.const 5))))
    (func (export "f") (result i32) (call $h))
  )`)
  const opt = optimize(ast, 'inlineOnce')
  assert(print(opt).includes('call $h'), 'numeric-label callee left intact')
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
  const opt = optimize(ast, 'all')
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
  const opt = optimize(ast, 'all')
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

test('propagate: local.get tracked value survives an intervening call', () => {
  // `(local.set $copy (local.get $x))` followed by a call should still let
  // $copy propagate — callees can't touch caller locals, so the tracked
  // (local.get $x) is still valid after the call.
  const ast = parse(`(module
    (func $noop)
    (func (export "f") (result i32)
      (local $x i32) (local $copy i32)
      (local.set $x (i32.const 42))
      (local.set $copy (local.get $x))
      (call $noop)
      (local.get $copy)))`)
  const opt = optimize(ast, 'propagate treeshake')
  const src = print(opt)
  assert(!src.includes('$copy'), 'single-use $copy should be propagated through the call')
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)), {})
  assert.strictEqual(inst.exports.f(), 42)
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

test('propagate: does not propagate past inner re-write nested in non-scope op', () => {
  // Regression: substGets used to walkPost across nested blocks, so an outer
  // `(local.set $x C)` would clobber an inner `(local.set $x V) (local.get $x)`
  // when reached through a non-scope wrapper (e.g. `drop`/`f64.reinterpret_i64`).
  // The inner re-write must win; the outer tracking must not leak in.
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 1))
    (drop (block (result i32)
      (local.set $x (i32.const 99))
      (local.get $x)))
    (local.get $x)
  ))`)
  const opt = optimize(ast, 'propagate')
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)), {})
  // The function returns the last value of $x. Inner block writes 99 then reads
  // and drops it. The trailing `local.get $x` returns 99 (the latest write).
  assert.strictEqual(inst.exports.f(), 99)
})

test('propagate: load-then-store swap idiom not collapsed across intervening store', () => {
  // Regression: the swap-via-temp pattern
  //   (local.set $t (f64.load $p)) (f64.store $p (f64.load $q)) (f64.store $q (local.get $t))
  // must not be folded to two stores that round-trip the same value. `$t` reads
  // memory at `$p`; the first f64.store then overwrites `$p`, so propagating
  // `(f64.load $p)` into the second store reads the NEW value and the swap
  // becomes `a[p] = a[q]; a[q] = a[p]` — silent data loss. Caught by jz's
  // heap-sort bench (Float64Array swap inside the sift-down loop).
  const ast = parse(`(module
    (memory (export "mem") 1)
    (func (export "swap")
      (local $t f64)
      (f64.store (i32.const 0) (f64.const 2))             ;; a[0] = 2.0
      (f64.store (i32.const 8) (f64.const 3))             ;; a[1] = 3.0
      (local.set $t (f64.load (i32.const 0)))             ;; t = a[0] = 2.0
      (f64.store (i32.const 0) (f64.load (i32.const 8)))  ;; a[0] = a[1] = 3.0
      (f64.store (i32.const 8) (local.get $t))            ;; a[1] = t = 2.0
    )
  )`)
  const opt = optimize(ast, 'propagate mergeBlocks')
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)), {})
  inst.exports.swap()
  const mem = new Float64Array(inst.exports.mem.buffer, 0, 2)
  assert.strictEqual(mem[0], 3.0)
  assert.strictEqual(mem[1], 2.0)
})

test('propagate: tiny-const not leaked across sibling local.tee', () => {
  // Regression: substGets walked operand siblings with the *same* `known` map,
  // so a `(local.tee $x …)` in arg1 would update `$x` at runtime but propagate's
  // tracking still saw the pre-tee constant. arg2's `(local.get $x)` then got
  // substituted to the stale constant — diverging from arg1's tee result.
  //
  // Surfaces after `coalesceLocals` aliases an init-const local with a sibling
  // read role: e.g. `(call $alloc (local.tee $x (i32.shl $x 3)) (local.get $x))`
  // collapses to `(call $alloc 320 40)` instead of `(call $alloc 320 320)`,
  // since `$x` was tracked as the tiny init constant `40` and got substituted
  // into arg2 instead of seeing the tee'd `320`.
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 40))
    (i32.add
      (local.tee $x (i32.shl (local.get $x) (i32.const 3)))
      (local.get $x))
  ))`)
  const opt = optimize(ast, 'propagate')
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)), {})
  // arg1 evaluates to 40<<3=320 and tees $x=320; arg2 reads tee'd $x=320.
  // Result must be 320+320=640. A leak gives 320+40=360.
  assert.strictEqual(inst.exports.f(), 640)
})

test('propagate: tracked value invalidated by nested local.tee in next statement RHS', () => {
  // Forward propagation tracks `$ptr`'s value `(i64.reinterpret_f64 (local.get $ai0))`.
  // The next statement's RHS contains a nested `(local.tee $ai0 …)` that overwrites
  // `$ai0` before producing its result. Without invalidating tracked values that
  // read `$ai0`, propagate would later inline `$ptr`'s stale expression at its use
  // site — substituting the now-overwritten `$ai0`, yielding a wrong address (the
  // jz bytebeat "FM Arpeggio" miscompile: OOB at runtime).
  const ast = parse(`(module
    (memory (export "memory") 1)
    (func (export "f") (result i64)
      (local $ai0 f64) (local $ptr i64) (local $idx i32)
      (local.set $ai0 (f64.const nan:0x7FF8800000000048))
      (local.set $ptr (i64.reinterpret_f64 (local.get $ai0)))
      (local.set $idx (i32.wrap_i64 (i64.trunc_sat_f64_s
        (local.tee $ai0 (f64.const 1.5)))))
      (local.get $ptr)))`)
  const opt = optimize(ast, 'propagate')
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)), {})
  assert.strictEqual(inst.exports.f(), 0x7FF8800000000048n,
    '$ptr must keep the sentinel bits captured before the nested tee overwrote $ai0')
})

test('propagate+coalesce+inlineOnce+mergeBlocks: combined passes preserve semantics', () => {
  // Regression for the cascade that surfaced when mergeBlocks pattern-3 enabled
  // coalesce to alias an outer arena-cap local with an inner inlined-helper local.
  // Once aliased, propagate substGets used to leak the outer constant into the
  // inner-scope reads, producing memory access out of bounds at runtime.
  const ast = parse(`(module
    (memory (export "mem") 1)
    (func $h (param $p i32) (result i32)
      (local $t i32)
      (local.set $t (i32.load (local.get $p)))
      (if (i32.eq (local.get $t) (i32.const 99)) (then (i32.store (local.get $p) (i32.const 0))))
      (local.get $t))
    (func (export "f") (result i32)
      (local $cap i32)
      (local.set $cap (i32.const 4))
      (i32.store (i32.const 0) (i32.const 7))
      (i32.store (i32.const 4) (i32.const 99))
      (drop (call $h (i32.const 0)))
      (call $h (i32.const 4))
    )
  )`)
  const opt = optimize(ast, 'propagate inlineOnce mergeBlocks coalesce')
  const inst = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)), {})
  assert.strictEqual(inst.exports.f(), 99)
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
  const opt = optimize(ast, 'propagate fold')
  const src = print(opt)
  // Propagate + fold: local eliminated, 3+3→6
  assert(src.includes('i32.const 6'), 'should propagate and fold to 6')
  assert(!src.includes('local.set $c'), 'should eliminate local')
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
  const opt = optimize(ast, 'propagate')
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

test('propagate: descends into nested block/loop scopes', () => {
  // Single-use locals living entirely inside a block (the shape `inlineOnce` leaves)
  // collapse just like top-level ones.
  const ast = parse(`(module (func (export "f") (param $p i32) (result i32)
    (local $a i32) (local $b i32) (local $c i32)
    (block $x (result i32)
      (local.set $a (i32.const 10))
      (local.set $b (i32.const 20))
      (local.set $c (local.get $p))
      (i32.add (i32.add (local.get $a) (local.get $b)) (local.get $c))
    )
  ))`)
  const src = print(optimize(ast, 'propagate'))
  assert(!src.includes('local.set'), 'nested-scope single-use locals eliminated')
  const { f } = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(`(module (func (export "f") (param $p i32) (result i32)
    (local $a i32) (local $c i32)
    (block (result i32)
      (local.set $a (i32.const 10))
      (local.set $c (i32.add (local.get $p) (i32.const 1)))
      (i32.add (local.get $a) (local.get $c)))))`), 'propagate')))).exports
  assert.equal(f(5), 16, 'still correct after nested propagation')
})

test('propagate: keeps a value stale-safe when a referenced local is rewritten', () => {
  // $x = $y; $y = 99; use $x  →  $x must still read the OLD $y (here 1), not 99.
  const ast = parse(`(module (func (export "f") (result i32)
    (local $x i32) (local $y i32)
    (local.set $y (i32.const 1))
    (local.set $x (local.get $y))
    (local.set $y (i32.const 99))
    (local.get $x)
  ))`)
  const opt = optimize(ast, 'propagate')
  const { f } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt))).exports
  assert.equal(f(), 1, 'must not propagate the now-stale (local.get $y)')
})

test('propagate: never inflates a wide constant reused many times', () => {
  const ast = parse(`(module (func (export "f") (result i32)
    (local $k i32)
    (local.set $k (i32.const 1000000))
    (i32.add (i32.add (local.get $k) (local.get $k)) (i32.add (local.get $k) (local.get $k)))
  ))`)
  const before = binarySize(parse(`(module (func (export "f") (result i32)
    (local $k i32)
    (local.set $k (i32.const 1000000))
    (i32.add (i32.add (local.get $k) (local.get $k)) (i32.add (local.get $k) (local.get $k)))
  ))`))
  assert(binarySize(optimize(ast, 'propagate')) <= before, 'wide reused const not blown up')
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

test('peephole: idempotent bitwise ops', () => {
  for (const [type, op] of [['i32', 'and'], ['i32', 'or'], ['i64', 'and'], ['i64', 'or']]) {
    const instr = `${type}.${op}`
    const ast = parse(`(module (func (param $x ${type}) (result ${type}) (${instr} (local.get $x) (local.get $x))))`)
    const src = print(optimize(ast, 'peephole'))
    assert(!src.includes(instr), `should remove ${instr} x x`)
    assert(src.includes('local.get $x'), 'should keep the value')
  }
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

// ==================== MERGE BLOCKS ====================

test('mergeBlocks: unwraps unbranched labeled block', () => {
  const ast = parse('(module (func (block $l (i32.const 1) drop)))')
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(!src.includes('block'), 'should unwrap untargeted block')
})

test('mergeBlocks: keeps branched block', () => {
  const ast = parse('(module (func (block $l (br $l) (i32.const 1) drop)))')
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(src.includes('block'), 'should keep block whose label is targeted')
})

test('mergeBlocks: unwraps single-expr result-typed block', () => {
  // `(block (result i32) expr)` with no label use is equivalent to just `expr`.
  const ast = parse('(module (func (result i32) (block $l (result i32) (i32.const 7))))')
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(!src.includes('block'), 'pointless single-expr block wrapper removed')
  assert(src.includes('i32.const 7'), 'inner expression preserved')
})

test('mergeBlocks: unwraps multi-stmt result-typed block at scope level', () => {
  // Splicing is sound: body's net stack effect equals the block's declared type.
  const ast = parse('(module (memory 1) (func (result i32) (block (result i32) (i32.store (i32.const 0) (i32.const 1)) (i32.const 7))))')
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(!src.includes('block'), 'multi-stmt result-typed block unwraps when label unused')
  assert(src.includes('i32.store'), 'store stays')
  assert(src.includes('i32.const 7'), 'result expression stays')
})

test('mergeBlocks: keeps single-expr result-typed block when label targeted', () => {
  const ast = parse('(module (func (result i32) (block $l (result i32) (br $l (i32.const 7)))))')
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(src.includes('block'), 'block whose label is branched to must stay')
})

test('mergeBlocks: respects label shadowing', () => {
  // Inner block re-binds $l, so the inner `br $l` doesn't target the outer.
  // Outer is unwrappable; inner stays because its own label is targeted.
  const ast = parse('(module (func (block $l (block $l (br $l) (i32.const 1) drop))))')
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  // After unwrapping the outer, exactly one `block $l` remains.
  assert.equal((src.match(/block \$l/g) || []).length, 1, 'one block survives')
})

test('mergeBlocks: nested unwrap', () => {
  const ast = parse('(module (func (block $a (block $b (i32.const 1) drop))))')
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(!src.includes('block'), 'both untargeted blocks unwrap')
})

test('mergeBlocks: splices block out of (local.set X (block (result T) stmt* expr))', () => {
  // The inlineOnce pass leaves wrappers like this around inlined helper bodies
  // whose return value feeds a single consumer. Splicing flattens them into the
  // parent scope so the surrounding optimizer can see through them.
  const ast = parse(`(module (memory 1) (func (result i32)
    (local $x i32) (local $tmp i32)
    (local.set $x
      (block $L (result i32)
        (i32.store (i32.const 0) (i32.const 1))
        (local.set $tmp (i32.const 42))
        (local.get $tmp)))
    (local.get $x)))`)
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(!src.includes('block'), 'wrapper block unwraps')
  assert(src.includes('i32.store'), 'setup store stays')
  assert(src.includes('local.set $tmp'), 'setup local.set stays')
})

test('mergeBlocks: splices block out of (drop (block (result T) stmt* expr))', () => {
  const ast = parse(`(module (memory 1) (func
    (drop
      (block (result i32)
        (i32.store (i32.const 0) (i32.const 1))
        (i32.const 5)))))`)
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(!src.includes('block'), 'drop-wrapper block unwraps')
  assert(src.includes('i32.store'), 'setup stays')
})

test('mergeBlocks: keeps wrapper if block label is targeted', () => {
  // Early br $L escapes with a value — splicing would change semantics by
  // skipping later setup stmts.
  const ast = parse(`(module (func (result i32)
    (local $x i32)
    (local.set $x
      (block $L (result i32)
        (br $L (i32.const 1))
        (i32.const 2)))
    (local.get $x)))`)
  const opt = optimize(ast, 'mergeBlocks')
  const src = print(opt)
  assert(src.includes('block $L'), 'branched block must stay')
})

test('mergeBlocks: keeps block targeted by try_table catch clause', () => {
  // The block label is referenced only by a `try_table` catch clause. That is
  // still a branch target — unwrapping the block would orphan the clause.
  const ast = parse(`(module (tag $e (param f64)) (func (result f64)
    (block $catch (result f64)
      (try_table (catch $e $catch) (f64.const 1) drop)
      (f64.const 0))))`)
  const opt = optimize(ast, 'mergeBlocks')
  assert(print(opt).includes('block $catch'), 'catch-target block must stay')
})

test('mergeBlocks: keeps block targeted by try_table catch_all clause', () => {
  const ast = parse(`(module (func
    (block $h
      (try_table (catch_all $h) (nop)))))`)
  const opt = optimize(ast, 'mergeBlocks')
  assert(print(opt).includes('block $h'), 'catch_all-target block must stay')
})

// ==================== LOOPIFY ====================

test('loopify: collapses while-idiom into loop+if', () => {
  const wat = `(module (func (param i32)
    (block $exit (loop $continue
      (br_if $exit (i32.eqz (local.get 0)))
      (local.set 0 (i32.sub (local.get 0) (i32.const 1)))
      (br $continue))) ))`
  const opt = optimize(parse(wat), 'loopify')
  const src = print(opt)
  assert(!src.includes('block'), 'outer block removed')
  assert(!src.includes('br_if'), 'head br_if replaced by if')
  assert(!src.includes('i32.eqz'), 'cond eqz stripped (becomes if condition)')
  assert(src.includes('loop'), 'loop kept')
  assert(src.includes('if'), 'if introduced')
})

test('loopify: wraps non-eqz cond with eqz', () => {
  // br_if exits when cond≠0 — if-then runs when cond≠0, so we must negate.
  const wat = `(module (func (param i32)
    (block $exit (loop $continue
      (br_if $exit (local.get 0))
      (br $continue))) ))`
  const opt = optimize(parse(wat), 'loopify')
  const src = print(opt)
  assert(src.includes('i32.eqz'), 'bare cond wrapped in eqz on conversion')
})

test('loopify: keeps loop when block label re-used inside body', () => {
  const wat = `(module (func (param i32)
    (block $exit (loop $continue
      (br_if $exit (i32.eqz (local.get 0)))
      (br_if $exit (i32.const 1))
      (br $continue))) ))`
  const opt = optimize(parse(wat), 'loopify')
  const src = print(opt)
  assert(src.includes('block'), 'inner br_if to $exit blocks loopify')
})

test('loopify: skips when block contains more than the loop', () => {
  const wat = `(module (func (param i32)
    (block $exit
      (loop $continue (br_if $exit (i32.eqz (local.get 0))) (br $continue))
      (drop (i32.const 1)))) )`
  const opt = optimize(parse(wat), 'loopify')
  assert(print(opt).includes('block'), 'block stays — second child present')
})

test('loopify: skips typed block/loop', () => {
  const wat = `(module (func (result i32)
    (block $exit (result i32)
      (loop $continue
        (br_if $exit (i32.const 1))
        (br $continue))
      (i32.const 0))))`
  const opt = optimize(parse(wat), 'loopify')
  assert(print(opt).includes('block'), 'typed block stays')
})

test('loopify: round-trip compiles & runs', () => {
  const wat = `(module (func (export "f") (param $n i32) (result i32)
    (local $i i32)
    (block $exit (loop $continue
      (br_if $exit (i32.eqz (local.get $n)))
      (local.set $i (i32.add (local.get $i) (local.get $n)))
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (br $continue)))
    (local.get $i)))`
  const opt = optimize(parse(wat))
  const mod = new WebAssembly.Module(compile(opt))
  const inst = new WebAssembly.Instance(mod, {})
  assert.equal(inst.exports.f(5), 15, '5+4+3+2+1=15')
})

// ==================== COALESCE LOCALS ====================

test('coalesce: shares slot between non-overlapping same-type locals', () => {
  const ast = parse(`(module (func (export "f") (result i32)
    (local $a i32) (local $b i32)
    (local.set $a (i32.const 1))
    (drop (local.get $a))
    (local.set $b (i32.const 2))
    (local.get $b)
  ))`)
  const opt = optimize(ast, 'coalesce locals')
  const src = print(opt)
  // $b's references should rename to $a; the $b decl then becomes dead.
  assert(!src.includes('$b'), 'second local merged into first')
})

test('coalesce: keeps overlapping locals separate', () => {
  const ast = parse(`(module (func (export "f") (result i32)
    (local $a i32) (local $b i32)
    (local.set $a (i32.const 1))
    (local.set $b (i32.const 2))
    (i32.add (local.get $a) (local.get $b))
  ))`)
  const opt = optimize(ast, 'coalesce locals')
  const src = print(opt)
  assert(src.includes('$a') && src.includes('$b'), 'overlapping locals not coalesced')
})

test('coalesce: keeps different-type locals separate', () => {
  const ast = parse(`(module (func (export "f") (result i64)
    (local $a i32) (local $b i64)
    (local.set $a (i32.const 1))
    (drop (local.get $a))
    (local.set $b (i64.const 2))
    (local.get $b)
  ))`)
  const opt = optimize(ast, 'coalesce locals')
  const src = print(opt)
  assert(src.includes('$a') && src.includes('$b'), 'different-type locals not coalesced')
})

test('coalesce: extends live range over loops', () => {
  // $a is set before the loop and read inside it → its live range spans the loop;
  // $b is set/read inside the loop → ranges overlap → must NOT coalesce.
  const src = `(module (func (export "f") (result i32)
    (local $a i32) (local $b i32)
    (local.set $a (i32.const 1))
    (loop $l
      (drop (local.get $a))
      (local.set $b (i32.const 2))
      (drop (local.get $b))
    )
    (local.get $a)
  ))`
  const before = parse(src)
  const opt = optimize(before, 'coalesce locals')
  const out = print(opt)
  assert(out.includes('$a') && out.includes('$b'), 'loop-crossing locals stay separate')
})

test('coalesce: preserves execution semantics', () => {
  // Run the optimized code and check the result is unchanged.
  const src = `(module (func (export "f") (result i32)
    (local $a i32) (local $b i32) (local $c i32)
    (local.set $a (i32.const 10))
    (local.set $b (i32.add (local.get $a) (i32.const 5)))
    (local.set $c (i32.mul (local.get $b) (i32.const 2)))
    (local.get $c)
  ))`
  const ast = parse(src)
  const opt = optimize(ast)
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(), 30, 'coalesced module still returns 30')
})

test('coalesce: read-in-set-rhs is recognized as read-first', () => {
  // $h is read on the rhs of its own set: the read happens BEFORE the write
  // in execution order, so $h relies on the implicit zero on the first pass
  // and MUST NOT be coalesced into $tmp's slot (which holds a residue of 7).
  const src = `(module (func (export "f") (result i32)
    (local $tmp i32) (local $h i32)
    (local.set $tmp (i32.const 7))
    (local.set $tmp (i32.add (local.get $tmp) (i32.const 1)))
    (local.set $h (i32.xor (local.get $h) (i32.const 1)))
    (local.get $h)
  ))`
  const ast = parse(src)
  const opt = optimize(ast)
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(), 1, 'read-first local must not inherit prior slot residue')
})

test('inlineOnce+coalesce: zero-dependent callee local not merged into residue slot', () => {
  // inlineOnce hoists the callee's `$accum` into the caller's frame. Because
  // the body opens with a read of `$accum`, it depends on the per-call implicit
  // zero — coalesceLocals must not share its slot with `$tmp` (residue = 99),
  // or the inlined read sees 99 instead of 0 and returns 100 instead of 1.
  const src = `(module
    (func $helper (param $arg i32) (result i32) (local $accum i32)
      (local.set $accum (i32.add (local.get $accum) (local.get $arg)))
      (local.get $accum))
    (func (export "f") (result i32) (local $tmp i32)
      (local.set $tmp (i32.const 99))
      (drop (local.get $tmp))
      (call $helper (i32.const 1))))`
  const opt = optimize(parse(src), { inlineOnce: true, coalesce: true, propagate: false, treeshake: true })
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(), 1, 'hoisted callee local must keep its zero init')
})

test('coalesce: skips locals first referenced inside if/else', () => {
  // $b is first set inside the `then` arm — the `else` path would observe $a's
  // residue (=42) if they shared a slot, which would corrupt the implicit zero.
  const src = `(module (func (export "f") (param $c i32) (result i32)
    (local $a i32) (local $b i32)
    (local.set $a (i32.const 42))
    (if (local.get $c) (then (local.set $b (i32.const 5))))
    (local.get $b)
  ))`
  const ast = parse(src)
  const opt = optimize(ast)
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(0), 0, 'else-path local read still returns implicit zero')
  assert.equal(exports.f(1), 5, 'then-path local read returns explicit value')
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
  const opt = optimize(ast, 'inline fold')
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
  const opt = optimize(ast, 'inline fold')
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
  const opt = optimize(ast, 'all')
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
  const opt = optimize(ast, { dedupe: true, treeshake: false, vacuum: false, inlineOnce: false })
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
  const opt = optimize(ast, { reorder: true, treeshake: false })
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
  assert(i64has(src, -1n), 'should fold i64 extend8_s(255) to -1')
})

test('fold: i64.reinterpret_f64 of constant', () => {
  // 256.0 has IEEE 754 bit pattern 0x4070000000000000 = 4643211215818981376
  const ast = parse('(module (func (result i64) (i64.reinterpret_f64 (f64.const 256))))')
  const src = print(optimize(ast, 'fold'))
  assert(i64has(src, 4643211215818981376n), 'reinterpret f64→i64 folded')
  assert(!src.includes('reinterpret'), 'reinterpret op gone')
})

test('fold: f64.reinterpret_i64 round-trip', () => {
  const ast = parse('(module (func (result f64) (f64.reinterpret_i64 (i64.const 4643211215818981376))))')
  const src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const'), 'reinterpret i64→f64 folded to f64.const')
  assert(!src.includes('reinterpret'), 'reinterpret op gone')
})

test('fold: f64.convert_i32_s', () => {
  const ast = parse('(module (func (result f64) (f64.convert_i32_s (i32.const 65536))))')
  const src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const 65536'), 'convert i32→f64 folded')
})

test('fold: chained convert + reinterpret', () => {
  // 65536 as f64 bit pattern: 0x40F0000000000000 = 4679240012837945344
  const ast = parse('(module (func (result i64) (i64.reinterpret_f64 (f64.convert_i32_s (i32.const 65536)))))')
  const src = print(optimize(ast, 'fold'))
  assert(i64has(src, 4679240012837945344n), 'chained fold')
})

test('fold: i32.reinterpret_f32 of constant', () => {
  // 1.0 f32 bit pattern: 0x3F800000 = 1065353216
  const ast = parse('(module (func (result i32) (i32.reinterpret_f32 (f32.const 1))))')
  const src = print(optimize(ast, 'fold'))
  assert(src.includes('i32.const 1065353216'), 'reinterpret f32→i32 folded')
})

// Regression: `Number('nan:0xPAYLOAD')` is NaN, which collapses to canonical
// NaN bits when stored. NaN-boxing schemes (jz, etc.) encode pointer/sentinel
// bits in the payload — folding `(i64.reinterpret_f64 (f64.const nan:0x…))`
// must preserve them. getConst now parses nan literals bit-exactly via the
// shared buffer used for the reinterpret helpers.
test('fold: i64.reinterpret_f64 preserves NaN payload', () => {
  // 0x7FFA400300636261 is a jz NaN-boxed STRING pointer for "abc" — has both
  // tag bits (0x7FFA) and SSO payload (0x40030000_00636261). Canonical NaN is
  // 0x7FF8000000000000, so any collapse to canonical loses everything.
  // 0x7FFA400300636261 == 9221753568630104673
  const ast = parse('(module (func (result i64) (i64.reinterpret_f64 (f64.const nan:0x7FFA400300636261))))')
  const src = print(optimize(ast, 'fold'))
  assert(i64has(src, 9221753568630104673n), 'should preserve nan:0x7FFA400300636261 payload, got: ' + src)
})

test('fold: i32.reinterpret_f32 preserves NaN payload', () => {
  // 0x7FC12345: arithmetic NaN with payload 0x412345 → bits 2143363909
  const ast = parse('(module (func (result i32) (i32.reinterpret_f32 (f32.const nan:0x412345))))')
  const src = print(optimize(ast, 'fold'))
  assert(src.includes('i32.const 2143363909'), 'should preserve f32 nan payload, got: ' + src)
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
  const opt = optimize(ast, { dedupe: true, treeshake: false })
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

test('packData: trims a large data segment without overflowing', () => {
  // A multi-100KB segment: trimTrailingZeros used to `bytes.push(...parseDataString)`,
  // and spreading that many call arguments overflows ("Maximum call stack size exceeded").
  // Large programs (e.g. a self-hosted compiler's static data) hit exactly this.
  const N = 200_000
  const ast = parse(`(module (data (i32.const 0) "${'\\01'.repeat(N)}\\00\\00\\00"))`)
  let opt
  assert.doesNotThrow(() => { opt = optimize(ast, 'packData') }, 'must not overflow on large data')
  const src = print(opt)
  assert.equal((src.match(/\\01/g) || []).length, N, 'all non-zero bytes preserved')
  assert(!src.includes('\\00'), 'trailing zero bytes trimmed')
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
  const opt = optimize(ast, 'all')
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
  const opt = optimize(ast, 'all')
  const binary = compile(opt)
  const mod = new WebAssembly.Module(binary)
  const { test: fn } = new WebAssembly.Instance(mod).exports
  assert.equal(fn(), 20, 'integration: 5*2 + 10 = 20')
})

// ==================== SIZE REGRESSION GUARDS ====================

test('size: fast passes never inflate', () => {
  // All fast passes must be size-neutral or reductive.
  const src = `(module
    (global $g (mut i32) (i32.const 3))
    (global $h i32 (i32.const 7))
    (memory 1)
    (func $dead (unreachable) (i32.const 99) drop)
    (func (export "f") (result i32)
      (local $unused i32)
      (block $b
        (if (local.get $c)
          (then (br $b))
        )
        (i32.const 1)
        (return)
      )
      (i32.const 0)
    )
  )`
  const ast = parse(src)
  const before = count(ast)
  const opt = optimize(ast)
  const after = count(opt)
  assert(after <= before, `fast passes should not inflate (${before} → ${after})`)
})

test('size: heavy passes with guard', () => {
  // Even with 'all', the size guard should prevent catastrophic inflation.
  const src = `(module
    (func $id (param $x i32) (result i32) (local.get $x))
    (func (export "f") (result i32)
      (call $id (i32.const 42))
    )
  )`
  const ast = parse(src)
  const before = count(ast)
  const opt = optimize(ast, 'all')
  const after = count(opt)
  // inline should replace call+id with const, not balloon
  assert(after <= before + 2, `size should not balloon (${before} → ${after})`)
})

test('size: default propagates single-use locals & tiny consts', () => {
  // (local.set $x small-const) (local.get $x) → just the const: strictly smaller,
  // so the default (size-guarded) pipeline takes it.
  const src = `(module (func (export "f") (result i32)
    (local $x i32)
    (local.set $x (i32.const 42))
    (local.get $x)
  ))`
  assert(!print(optimize(parse(src))).includes('local.set'), 'default should propagate the single-use local')
  // A wide constant reused many times would inflate — left in its local by default.
  const reuse = `(module (func (export "g") (result i32)
    (local $k i32)
    (local.set $k (i32.const 1000000))
    (i32.add (i32.add (local.get $k) (local.get $k)) (i32.add (local.get $k) (local.get $k)))
  ))`
  assert(print(optimize(parse(reuse))).includes('local.set'), 'wide reused const stays in a local')
})

test('size: empty module not inflated', () => {
  const ast = parse('(module)')
  const before = count(ast)
  const opt = optimize(ast)
  const after = count(opt)
  assert.equal(after, before, 'empty module size unchanged')
})

test('size: binary size measurement', () => {
  const src = `(module
    (func (export "f") (result i32) (i32.const 42))
  )`
  const ast = parse(src)
  const before = binarySize(ast)
  const opt = optimize(ast)
  const after = binarySize(opt)
  assert(after <= before, `optimize should not increase binary size (${before} → ${after})`)
})

test('size: treeshake reduces size', () => {
  const src = `(module
    (func $used (export "f") (result i32) (i32.const 1))
    (func $unused1 (result i32) (i32.const 2))
    (func $unused2 (result i32) (i32.const 3))
    (func $unused3 (result i32) (i32.const 4))
  )`
  const ast = parse(src)
  const before = count(ast)
  const opt = optimize(ast)
  const after = count(opt)
  assert(after < before, 'treeshake reduces node count')
  assert(!print(opt).includes('$unused1'), 'unused funcs removed')
})

test('size: fast tier not slower than baseline', async () => {
  const src = `(module
    (memory 1)
    (func $a (export "a") (result i32) (i32.const 1))
    (func $b (export "b") (result i64) (i64.const 2))
    (func $c (export "c") (result f32) (f32.const 3))
    (func $d (export "d") (result f64) (f64.const 4))
  )`
  const ast = parse(src)

  // Warmup
  for (let i = 0; i < 10; i++) optimize(ast)

  const N = 100
  const start = performance.now()
  for (let i = 0; i < N; i++) optimize(ast)
  const elapsed = performance.now() - start

  // 100 ops should complete in under 500ms (5ms per op on slow hardware)
  assert(elapsed < 500, `fast optimize should be fast (${elapsed.toFixed(0)}ms for ${N} runs)`)
})

// ── Size contract: default optimize must NEVER inflate the binary ────────────
// The whole point of the optimizer is to not make output worse. The default
// (strict) optimize reverts any round that grows the encoded binary, and its
// default-on passes are size-non-increasing by construction. This locks that:
// if any pass ever inflates one of these shapes, the contract test fails.
test('optimize never inflates the binary (default size contract)', () => {
  const mods = [
    // constant folding / identity / strength / dead arithmetic
    '(module (func (result i32) (i32.mul (i32.add (i32.const 3) (i32.const 4)) (i32.const 1))))',
    '(module (func (result i64) (i64.add (i64.const 100) (i64.const 200))))',
    // dead code after return / unreachable, unused locals
    '(module (func (export "f") (param i32) (result i32) (local $u i32) (return (local.get 0)) (local.set $u (i32.const 9)) (local.get $u)))',
    // dead function + dead global (treeshake), immutable global (stripmut/globals)
    '(module (global $g (mut i32) (i32.const 7)) (func $dead (result i32) (i32.const 99)) (func (export "f") (result i32) (global.get $g)))',
    // while-idiom: block+loop+br_if+br (loopify), if-then-br (brif), redundant br (unbranch)
    `(module (func (export "g") (param i32) (result i32) (local $s i32)
      (block $b (loop $l
        (br_if $b (i32.eqz (local.get 0)))
        (local.set $s (i32.add (local.get $s) (local.get 0)))
        (local.set 0 (i32.sub (local.get 0) (i32.const 1)))
        (br $l)))
      (local.get $s)))`,
    // single-caller function (inlineOnce), load/store offset folding (offset)
    '(module (memory 1) (func $get (param i32) (result i32) (i32.load (i32.add (local.get 0) (i32.const 4)))) (func (export "f") (result i32) (call $get (i32.const 8))))',
    // nested blocks, nops, drop-of-pure (vacuum / mergeBlocks)
    '(module (func (export "f") (result i32) (block (block (nop) (drop (i32.const 5)))) (i32.const 1)))',
  ]
  for (const m of mods) {
    const ast = parse(m)
    const before = binarySize(ast)
    const after = binarySize(optimize(ast))          // default (strict) optimize
    assert(after <= before, `optimize inflated ${before}→${after} bytes for: ${m.replace(/\s+/g, ' ').slice(0, 60)}…`)
  }
})

// ── devirt: general constant-index call_indirect → direct call ───────────────
test('devirt: constant-index call_indirect becomes a direct call', () => {
  const src = `(module
    (type $bin (func (param i32 i32) (result i32)))
    (table 2 funcref)
    (elem (i32.const 0) $add $sub)
    (func $add (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
    (func $sub (param i32 i32) (result i32) (i32.sub (local.get 0) (local.get 1)))
    (func (export "f") (result i32) (call_indirect (type $bin) (i32.const 10) (i32.const 3) (i32.const 0)))
    (func (export "g") (result i32) (call_indirect (type $bin) (i32.const 10) (i32.const 3) (i32.const 1))))`
  const opt = optimize(parse(src), 'devirt')
  const out = print(opt)
  assert(!out.includes('call_indirect'), 'both constant-index calls devirtualized')
  assert(out.includes('(call $add'), 'slot 0 → direct $add')
  assert(out.includes('(call $sub'), 'slot 1 → direct $sub')
  const { exports } = new WebAssembly.Instance(new WebAssembly.Module(compile(opt)))
  assert.equal(exports.f(), 13, 'add(10,3)')
  assert.equal(exports.g(), 7, 'sub(10,3)')
})

test('devirt: leaves dynamic and signature-mismatched indices alone (sound)', () => {
  // Non-constant index → must stay a call_indirect.
  const dyn = `(module
    (type $un (func (param i32) (result i32)))
    (table 1 funcref) (elem (i32.const 0) $id)
    (func $id (param i32) (result i32) (local.get 0))
    (func (export "f") (param i32) (result i32) (call_indirect (type $un) (i32.const 5) (local.get 0))))`
  assert(print(optimize(parse(dyn), 'devirt')).includes('call_indirect'), 'dynamic index not devirtualized')
  // Constant index but the type at the call site disagrees with the target's sig
  // → must NOT rewrite (would be unsound / wrong call).
  const mism = `(module
    (type $bin (func (param i32 i32) (result i32)))
    (type $un (func (param i32) (result i32)))
    (table 1 funcref) (elem (i32.const 0) $bin2)
    (func $bin2 (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))
    (func (export "f") (param i32) (result i32) (call_indirect (type $un) (local.get 0) (i32.const 0))))`
  assert(print(optimize(parse(mism), 'devirt')).includes('call_indirect'), 'signature-mismatched index not devirtualized')
})
