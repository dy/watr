import { test } from 'node:test'
import assert from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { clone } from '../src/util.js'
import optimize, { treeshake, fold, deadcode, localReuse, count, binarySize, normalize, devirt } from '../src/optimize.js'
import { parse, print, compile } from './runner.js'
import srcCompile, { size } from '../src/compile.js'

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

test('identity: reinterpret round-trip → x', () => {
  for (const [outer, inner] of [['i64.reinterpret_f64', 'f64.reinterpret_i64'], ['f64.reinterpret_i64', 'i64.reinterpret_f64'], ['i32.reinterpret_f32', 'f32.reinterpret_i32'], ['f32.reinterpret_i32', 'i32.reinterpret_f32']]) {
    const t = outer.slice(0, 3)
    const opt = optimize(parse(`(module (func (param $x ${t}) (result ${t}) (${outer} (${inner} (local.get $x)))))`), 'identity')
    assert(!print(opt).includes('reinterpret'), `${outer}∘${inner} folds to x`)
  }
})

test('identity: wrap∘extend and boxPtr round-trip → x', () => {
  for (const inner of ['i64.extend_i32_u', 'i64.extend_i32_s']) {
    const opt = optimize(parse(`(module (func (param $x i32) (result i32) (i32.wrap_i64 (${inner} (local.get $x)))))`), 'identity')
    assert(!print(opt).match(/wrap_i64|extend_i32/), `wrap∘${inner} folds to x`)
  }
  // NaN-box (un)box chain: wrap∘reinterpret∘reinterpret∘extend collapses fully in one walk.
  const box = optimize(parse('(module (func (param $x i32) (result i32) (i32.wrap_i64 (i64.reinterpret_f64 (f64.reinterpret_i64 (i64.extend_i32_u (local.get $x)))))))'), 'identity')
  assert.equal(print(box).match(/wrap_i64|reinterpret|extend_i32/), null, 'boxPtr round-trip collapses to (local.get $x)')
})

test('identity: trunc∘convert exact round-trips through f64', () => {
  // i32 result: same-sign pairs vanish entirely
  for (const [outer, inner] of [
    ['i32.trunc_sat_f64_s', 'f64.convert_i32_s'], ['i32.trunc_f64_s', 'f64.convert_i32_s'],
    ['i32.trunc_sat_f64_u', 'f64.convert_i32_u'], ['i32.trunc_f64_u', 'f64.convert_i32_u'],
  ]) {
    const opt = optimize(parse(`(module (func (param $x i32) (result i32) (${outer} (${inner} (local.get $x)))))`), 'identity')
    assert(!print(opt).match(/trunc|convert/), `${outer}∘${inner} folds to x`)
  }
  // i64 result: drops to a register extend (incl. the trunc_s∘convert_u mix — u-converted
  // values are non-negative and fit i64 signed)
  for (const [outer, inner, ext] of [
    ['i64.trunc_sat_f64_s', 'f64.convert_i32_s', 'i64.extend_i32_s'],
    ['i64.trunc_sat_f64_s', 'f64.convert_i32_u', 'i64.extend_i32_u'],
    ['i64.trunc_sat_f64_u', 'f64.convert_i32_u', 'i64.extend_i32_u'],
  ]) {
    const opt = optimize(parse(`(module (func (param $x i32) (result i64) (${outer} (${inner} (local.get $x)))))`), 'identity')
    const src = print(opt)
    assert(!src.match(/trunc|convert/) && src.includes(ext), `${outer}∘${inner} → ${ext}`)
  }
  // NOT identities: sign mixes that saturate/clamp
  for (const [outer, inner] of [
    ['i32.trunc_sat_f64_s', 'f64.convert_i32_u'],   // 0xffffffff would clamp to INT32_MAX
    ['i64.trunc_sat_f64_u', 'f64.convert_i32_s'],   // negative would clamp to 0
    ['i32.trunc_sat_f32_s', 'f32.convert_i32_s'],   // f32 mantissa loses wide i32s
  ]) {
    const opt = optimize(parse(`(module (func (param $x i32) (result ${outer.slice(0, 3)}) (${outer} (${inner} (local.get $x)))))`), 'identity')
    assert(print(opt).match(/trunc/), `${outer}∘${inner} must stay`)
  }
})

test('identity: f64 eq/ne of convert_i32 vs impossible const → known', () => {
  const F = (cst, op = 'f64.ne', conv = 'f64.convert_i32_s') =>
    print(optimize(parse(`(module (func (param $x i32) (result i32) (${op} (${conv} (local.get $x)) (f64.const ${cst}))))`), 'identity'))
  for (const cst of ['inf', '-inf', 'nan', '5.5', '4294967296', '-2147483649']) {
    assert(F(cst).includes('i32.const 1'), `ne vs ${cst} → 1`)
    assert(F(cst, 'f64.eq').includes('i32.const 0'), `eq vs ${cst} → 0`)
  }
  // representable values and hex-float text must NOT fold
  for (const cst of ['8', '0', '-2147483648', '0x1p3']) {
    assert(F(cst).includes('f64.ne'), `ne vs ${cst} stays`)
  }
  // u-converted range differs: 4e9 is reachable via convert_i32_u
  assert(F('4000000000', 'f64.ne', 'f64.convert_i32_u').includes('f64.ne'), 'u: 4e9 reachable, stays')
  assert(F('-1', 'f64.ne', 'f64.convert_i32_u').includes('i32.const 1'), 'u: -1 impossible → 1')
  // impure operand keeps the compare (the operand would be dropped)
  const impure = print(optimize(parse('(module (func (result i32) (f64.ne (f64.convert_i32_s (call $g)) (f64.const inf))) (func $g (result i32) (i32.const 1)))'), 'identity'))
  assert(impure.includes('f64.ne'), 'impure convert operand stays')
})

test('identity: trailing convert hoists out of a label-less block', () => {
  const src = `(module (func (param $n i32) (result f64)
    (local $s f64)
    (block (result f64)
      (local.set $s (f64.const 1))
      (f64.convert_i32_s (local.get $n)))))`
  const out = print(optimize(parse(src), 'identity')).replace(/\s+/g, ' ')
  assert(out.includes('(f64.convert_i32_s (block (result i32)'), 'convert hoisted, block retyped i32')
  // labeled block: a br could produce the result — must NOT hoist
  const src2 = `(module (func (param $n i32) (param $c i32) (result f64)
    (block $B (result f64)
      (br_if $B (f64.const 2.5) (local.get $c))
      (f64.convert_i32_s (local.get $n)))))`
  const out2 = print(optimize(parse(src2), 'identity')).replace(/\s+/g, ' ')
  assert(out2.includes('(block $B (result f64)'), 'labeled block keeps its type')
})

test('narrow: f64 local written only by exact i32 converts retypes to i32', () => {
  const src = `(module (func (param $n i32) (result f64)
    (local $x f64)
    (local.set $x (f64.convert_i32_s (i32.const 7)))
    (local.set $x (f64.convert_i32_s (i32.add (i32.trunc_sat_f64_s (local.get $x)) (local.get $n))))
    (local.get $x)))`
  const out = print(optimize(optimize(parse(src), 'narrow'), 'identity'))
  assert(out.includes('(local $x i32)'), 'x retyped i32')
  assert(!out.match(/trunc_sat/), 'trunc of the re-boxed read folds away')
  assert(out.includes('f64.convert_i32_s (local.get $x)'), 'f64-context read re-boxes')
  // a single non-convert writer keeps the local f64
  const src2 = `(module (func (param $v f64) (result f64)
    (local $y f64)
    (local.set $y (f64.convert_i32_s (i32.const 1)))
    (local.set $y (local.get $v))
    (local.get $y)))`
  assert(print(optimize(parse(src2), 'narrow')).includes('(local $y f64)'), 'mixed writers keep f64')
  // tee form: the i32 tee re-boxes for its f64 expression context
  const src3 = `(module (func (result f64)
    (local $z f64)
    (f64.add (local.tee $z (f64.convert_i32_s (i32.const 3))) (local.get $z))))`
  const out3 = print(optimize(parse(src3), 'narrow')).replace(/\s+/g, ' ')
  assert(out3.includes('(local $z i32)') && out3.includes('(f64.convert_i32_s (local.tee $z (i32.const 3)'), 'tee re-boxes around the i32 tee')
  // profit gate: reads consumed as plain f64 (stores, arithmetic) outnumber the
  // single stripped write — narrowing would ADD converts in the hot path; skip
  const src4 = `(module (memory 1) (func (param $p i32) (result f64)
    (local $w f64)
    (local.set $w (f64.convert_i32_s (i32.const 5)))
    (f64.store (local.get $p) (local.get $w))
    (f64.store offset=8 (local.get $p) (local.get $w))
    (f64.mul (local.get $w) (f64.const 2))))`
  assert(print(optimize(parse(src4), 'narrow')).includes('(local $w f64)'), 'f64-consumed reads outweigh the write — no churn')
})

test('seltree: dense br_table of cheap pure arms → branchless select tree', () => {
  const ladder = (arm2 = '(i32.xor (local.get $a) (local.get $b))') => `(module (func $d (export "d") (param $i i32) (param $a i32) (param $b i32) (result i32)
    (block $out (result i32)
      (block $dflt
        (block $l3
          (block $l2
            (block $l1
              (block $l0
                (br_table $l0 $l1 $l2 $l3 $dflt (local.get $i)))
              (br $out (i32.add (local.get $a) (local.get $b))))
            (br $out (i32.sub (local.get $a) (local.get $b))))
          (br $out ${arm2}))
        (br $out (i32.and (i32.add (local.get $a) (i32.const 7)) (local.get $b))))
      (i32.const 99))))`
  const out = print(optimize(parse(ladder()), 'seltree'))
  assert(!out.includes('br_table'), 'br_table replaced')
  assert((out.match(/select/g) || []).length === 3, 'three selects for four arms')
  assert(out.includes('i32.lt_u'), 'in-range test guards the generic path')
  // trapping arm (div) keeps the br_table
  const out2 = print(optimize(parse(ladder('(i32.div_s (local.get $a) (local.get $b))')), 'seltree'))
  assert(out2.includes('br_table'), 'trapping arm keeps the branchy form')
  // behavioral: compile both forms and compare results across all indices
  const mod = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(ladder()), 'seltree'))), {}).exports
  const ref = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(ladder()))), {}).exports
  for (let i = 0; i < 6; i++) assert.equal(mod.d(i, 29, 13), ref.d(i, 29, 13), `idx ${i}`)
})

test('chainTable: dense same-scrutinee if/else-if chain → br_table', () => {
  // the interpreter-dispatch shape: a result-typed chain (each arm yields the
  // next pc) inside a tee — C lowers exactly this to a jump table
  const chain = `(module (memory 1) (func (export "f") (param $op i32) (param $pc i32) (result i32)
    (local.tee $pc
      (if (result i32) (i32.eq (local.get $op) (i32.const 0))
        (then (i32.add (local.get $pc) (i32.const 1)))
        (else (if (result i32) (i32.eq (local.get $op) (i32.const 1))
          (then (i32.store (i32.const 0) (i32.const 11)) (i32.add (local.get $pc) (i32.const 1)))
          (else (if (result i32) (i32.eq (local.get $op) (i32.const 2))
            (then (i32.add (local.get $pc) (i32.const 2)))
            (else (if (result i32) (i32.eq (local.get $op) (i32.const 3))
              (then (i32.add (local.get $pc) (i32.const 3)))
              (else (if (result i32) (i32.eq (local.get $op) (i32.const 4))
                (then (i32.add (local.get $pc) (i32.const 4)))
                (else (i32.const 99))))))))))))))`
  const out = print(optimize(parse(chain), 'chainTable'))
  assert(out.includes('br_table'), 'chain became a table')
  assert(!/i32\.eq/.test(out), 'no comparison ladder remains')
  const mod = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(chain), 'chainTable'))), {}).exports
  const ref = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(chain))), {}).exports
  for (let op = -1; op <= 6; op++) for (const pc of [0, 5])
    assert.equal(mod.f(op, pc), ref.f(op, pc), `op ${op} pc ${pc}`)
  // short chain (< 5 arms) keeps the branchy form
  const short = `(module (func (export "g") (param $op i32) (result i32)
    (if (result i32) (i32.eq (local.get $op) (i32.const 0)) (then (i32.const 1))
      (else (if (result i32) (i32.eq (local.get $op) (i32.const 1)) (then (i32.const 2))
        (else (i32.const 3)))))))`
  assert(!print(optimize(parse(short), 'chainTable')).includes('br_table'), 'short chain untouched')
  // mixed scrutinee breaks the chain at the mismatch — the inner run still converts
  const mixed = `(module (func (export "h") (param $x i32) (param $op i32) (result i32)
    (if (result i32) (i32.eq (local.get $x) (i32.const 0)) (then (i32.const 100))
      (else (if (result i32) (i32.eq (local.get $op) (i32.const 0)) (then (i32.const 0))
        (else (if (result i32) (i32.eq (local.get $op) (i32.const 1)) (then (i32.const 1))
          (else (if (result i32) (i32.eq (local.get $op) (i32.const 2)) (then (i32.const 2))
            (else (if (result i32) (i32.eq (local.get $op) (i32.const 3)) (then (i32.const 3))
              (else (if (result i32) (i32.eq (local.get $op) (i32.const 4)) (then (i32.const 4))
                (else (i32.const 99)))))))))))))))`
  const outM = print(optimize(parse(mixed), 'chainTable'))
  assert(outM.includes('br_table'), 'inner run converts')
  const modM = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(mixed), 'chainTable'))), {}).exports
  const refM = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(mixed))), {}).exports
  for (let x = 0; x <= 1; x++) for (let op = -1; op <= 5; op++)
    assert.equal(modM.h(x, op), refM.h(x, op), `x ${x} op ${op}`)
})

test('intguard: ToInt32 guard select over exact i32 convert → raw value', () => {
  const guarded = (tail = '') => `(module (func (param $e i32) (result ${tail ? 'f64' : 'i32'})
    (local $t f64)
    ${tail ? '(drop ' : ''}(select
      (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t (f64.convert_i32_s (local.get $e)))))
      (i32.const 0)
      (f64.ne (local.get $t) (f64.const inf)))${tail ? ')' : ''}
    ${tail}))`
  const out = print(optimize(parse(guarded()), 'intguard'))
  assert(!out.includes('select') && !out.includes('trunc'), 'collapses to the raw i32')
  // $t read elsewhere → the tee must survive, guard stays
  const out2 = print(optimize(parse(guarded('(local.get $t)')), 'intguard'))
  assert(out2.includes('select'), 'extra reader keeps the guard')
  // non-convert teed value → not provably int, guard stays
  const raw = `(module (func (param $v f64) (result i32)
    (local $t f64)
    (select
      (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t (f64.mul (local.get $v) (f64.const 2)))))
      (i32.const 0)
      (f64.ne (local.get $t) (f64.const inf)))))`
  assert(print(optimize(parse(raw), 'intguard')).includes('select'), 'non-convert value keeps the guard')
})

test('intguard: ToInt32 guard over an exact-int {+,−} ring tree → i32 ops', () => {
  const sum = (guard = 'inf') => `(module (func $f (export "f") (param $a i32) (param $b i32) (result i32)
    (local $t f64)
    (select
      (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t
        (f64.add (f64.convert_i32_s (local.get $a)) (f64.convert_i32_s (local.get $b))))))
      (i32.const 0)
      (f64.ne (local.get $t) (f64.const ${guard})))))`
  const out = print(optimize(parse(sum()), 'intguard'))
  assert(!out.includes('select') && !out.includes('f64.add'), 'ring folds to i32.add')
  assert(out.includes('i32.add'), 'i32 op emitted')
  // guard const an in-range INT: a sum can equal it — impossible-for-one-convert is not enough
  assert(print(optimize(parse(sum('3000000000')), 'intguard')).includes('select'), 'int-valued guard const keeps the guard')
  // behavioral: ToInt32 wrap semantics preserved at the i32 boundary
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(sum()), 'intguard'))), {}).exports
  const r = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(sum()))), {}).exports
  for (const [a, b] of [[1, 2], [2147483647, 1], [-2147483648, -1], [2147483647, 2147483647]])
    assert.equal(m.f(a, b), r.f(a, b), `wrap ${a}+${b}`)
})

test('intguard: multi-use ToInt32 pair collapses whole-temp to raw i32', () => {
  // a body using the coerced value TWICE: one defining guard (tee) + one
  // secondary guard (get) + a bare trunc — per-site counts refuse (rule 1),
  // the atomic whole-temp rewrite retires all three: fresh i32 tee + gets,
  // no guard, no trunc, no convert
  const src = `(module (func $f (export "f") (param $e i32) (result i32)
    (local $t f64)
    (i32.add
      (i32.xor
        (select (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t (f64.convert_i32_s (local.get $e))))) (i32.const 0) (f64.ne (local.get $t) (f64.const inf)))
        (select (i32.wrap_i64 (i64.trunc_sat_f64_s (local.get $t))) (i32.const 0) (f64.ne (local.get $t) (f64.const inf))))
      (i32.trunc_sat_f64_s (local.get $t)))))`
  const out = print(optimize(parse(src), 'intguard'))
  assert(!out.includes('select') && !out.includes('trunc') && !out.includes('convert'), 'all three sites raw')
  assert(out.includes('(local $__ig0 i32)'), 'fresh i32 temp declared')
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), 'intguard'))), {}).exports
  assert.equal(m.f(21), (21 ^ 21) + 21, 'x^x + x through the collapsed temp')
  // a stray NON-guard f64 read of t keeps everything (tally mismatch)
  const stray = src.replace('(i32.trunc_sat_f64_s (local.get $t))',
    '(i32.trunc_sat_f64_s (f64.add (local.get $t) (f64.const 1)))')
  assert(print(optimize(parse(stray), 'intguard')).includes('select'), 'unclassified reader keeps the guards')
})

test('intguard: ToNumber fast path t==t over a never-NaN convert → the value, dead else dropped', () => {
  // tee form: the write is preserved by returning the tee itself
  const teeForm = `(module (func $f (export "f") (param $e i32) (result f64)
    (local $t f64)
    (f64.add
      (if (result f64)
        (f64.eq (local.tee $t (f64.convert_i32_s (local.get $e))) (local.get $t))
        (then (local.get $t))
        (else (f64.const nan)))
      (local.get $t))))`
  const out = print(optimize(parse(teeForm), 'intguard'))
  assert(!out.includes('(if'), 'if collapsed')
  assert(out.includes('local.tee'), 'tee write preserved for the later reader')
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(teeForm), 'intguard'))), {}).exports
  assert.equal(m.f(21), 42, 'value flows through both reads')
  // single-def set form
  const setForm = `(module (func (param $e i32) (result f64)
    (local $t f64)
    (local.set $t (f64.convert_i32_s (local.get $e)))
    (if (result f64)
      (f64.eq (local.get $t) (local.get $t))
      (then (local.get $t))
      (else (f64.const nan)))))`
  assert(!print(optimize(parse(setForm), 'intguard')).includes('(if'), 'single-def convert local collapses')
  // NOT provably non-NaN (param) → stays
  const unknown = `(module (func (param $v f64) (result f64)
    (if (result f64)
      (f64.eq (local.get $v) (local.get $v))
      (then (local.get $v))
      (else (f64.const 0)))))`
  assert(print(optimize(parse(unknown), 'intguard')).includes('(if'), 'unproven value keeps the NaN test')
  // a PARAM's one write is NOT a single-def fact: reads before `p = convert(…)`
  // see the CALLER's value (fuzz seed 794 — fractional f64 through `p = ~p`)
  const paramWrite = `(module (func $f (export "f") (param $p f64) (result i32)
    (i32.add
      (i32.trunc_sat_f64_s (local.get $p))
      (block (result i32)
        (local.set $p (f64.convert_i32_s (i32.const 7)))
        (if (result i32)
          (f64.eq (local.get $p) (local.get $p))
          (then (i32.trunc_sat_f64_s (local.get $p)))
          (else (i32.const -1)))))))`
  const pw = print(optimize(parse(paramWrite), 'intguard'))
  assert(pw.includes('(if'), 'param single-write does not fold the NaN test')
  const mf = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(paramWrite), 'intguard'))), {}).exports
  assert.equal(mf.f(3.75), 3 + 7, 'pre-write param read keeps the caller value')
})

test('intguard: checked-read collapse — guard/undef consts resolve through the global pool', () => {
  // The -Os shape: bounds-guarded element read (undefined NaN box when OOB)
  // under the ToInt32 guard, both consts pooled into immutable f64 globals.
  const mod = `(module
    (memory 1)
    (global $undef f64 (f64.const nan:0x8000200000000))
    (global $unused f64 (f64.const nan))
    (global $inf f64 (f64.const inf))
    (func $f (export "f") (param $i i32) (param $len i32) (result i32)
      (local $t f64)
      (select
        (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t
          (if (result f64) (i32.lt_u (local.get $i) (local.get $len))
            (then (f64.convert_i32_u (i32.load8_u (local.get $i))))
            (else (global.get $undef))))))
        (i32.const 0)
        (f64.ne (local.get $t) (global.get $inf)))))`
  const out = print(optimize(parse(mod), 'intguard'))
  assert(!out.includes('select') && !out.includes('convert'), 'cluster collapses')
  assert(out.includes('(if') && out.includes('i32.load8_u'), 'i32 if-form with the raw load')
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(mod), 'intguard'))), {}).exports
  const r = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(mod))), {}).exports
  for (const [i, len] of [[0, 4], [5, 4], [3, 4]]) assert.equal(m.f(i, len), r.f(i, len), `read ${i}<${len}`)
})

test('intguard: shared scratch temp — every cluster self-contained collapses per-site', () => {
  // murmur-gather shape: one f64 temp tee'd by FOUR independent guard clusters
  // (plus a guarded const init). Rule 4's one-def model refuses; the per-cluster
  // sweep collapses each (its ne reads its own tee).
  const read = (k) => `(select
      (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t
        (if (result f64) (i32.lt_u (local.tee $bi (i32.add (local.get $i) (i32.const ${k}))) (local.get $len))
          (then (f64.convert_i32_u (i32.load8_u (local.get $bi))))
          (else (f64.const nan))))))
      (i32.const 0)
      (f64.ne (local.get $t) (f64.const inf)))`
  const mod = `(module
    (memory 1)
    (func $f (export "f") (param $i i32) (param $len i32) (result i32)
      (local $t f64) (local $bi i32)
      (i32.or (i32.or ${read(0)} (i32.shl ${read(1)} (i32.const 8)))
              (i32.shl ${read(2)} (i32.const 16)))))`
  const out = print(optimize(parse(mod), 'intguard'))
  assert(!out.includes('select') && !out.includes('convert'), 'all clusters collapse')
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(mod), 'intguard'))), {}).exports
  const r = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(mod))), {}).exports
  for (const [i, len] of [[0, 8], [6, 8], [7, 8], [9, 2]]) assert.equal(m.f(i, len), r.f(i, len), `gather @${i} len ${len}`)
})

test('intguard: single-read ring — OOB NaN propagates, bounds condition hoists', () => {
  // buf[j] + 1 under ToInt32: leaf-narrowing would give 1 on the OOB path
  // (0+1) where ToInt32(NaN+1) is 0 — the ring keeps the raw X and hoists C.
  const mod = (c = '1') => `(module
    (memory 1)
    (func $f (export "f") (param $j i32) (param $len i32) (result i32)
      (local $t f64)
      (select
        (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t
          (f64.add
            (if (result f64) (i32.lt_u (local.get $j) (local.get $len))
              (then (f64.convert_i32_u (i32.load8_u (local.get $j))))
              (else (f64.const nan)))
            (f64.const ${c})))))
        (i32.const 0)
        (f64.ne (local.get $t) (f64.const inf)))))`
  const out = print(optimize(parse(mod()), 'intguard'))
  assert(!out.includes('select') && !out.includes('f64.add'), 'ring collapses')
  assert(out.includes('i32.add'), 'i32 ring emitted')
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(mod()), 'intguard'))), {}).exports
  const r = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(mod()))), {}).exports
  for (const [j, len] of [[0, 4], [9, 4]]) assert.equal(m.f(j, len), r.f(j, len), `ring @${j} len ${len} (OOB → 0, not 1)`)
  // fractional const leaf → sum not int-exact, guard stays
  assert(print(optimize(parse(mod('0.5')), 'intguard')).includes('select'), 'fractional leaf keeps the guard')
})

test('intguard: guarded const init folds; bare trunc over checked read collapses', () => {
  const constInit = `(module (func $f (export "f") (result i32)
    (local $t f64)
    (select
      (i32.wrap_i64 (i64.trunc_sat_f64_s (local.tee $t (f64.const 2538058380))))
      (i32.const 0)
      (f64.ne (local.get $t) (f64.const inf)))))`
  const out = print(optimize(parse(constInit), 'intguard'))
  assert(!out.includes('select'), 'const init folds')
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(constInit), 'intguard'))), {}).exports
  assert.equal(m.f(), 2538058380 | 0, 'ToInt32 of the const')
  // index context: trunc_sat_f64_s directly over a checked u8 read (no guard select)
  const idx = `(module
    (memory 1)
    (func $f (export "f") (param $i i32) (param $len i32) (result i32)
      (i32.trunc_sat_f64_s
        (if (result f64) (i32.lt_u (local.get $i) (local.get $len))
          (then (f64.convert_i32_u (i32.load8_u (local.get $i))))
          (else (f64.const nan))))))`
  const io = print(optimize(parse(idx), 'intguard'))
  assert(!io.includes('trunc') && !io.includes('convert'), 'trunc∘checked-read collapses (u8 fits s-domain)')
  const mi = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(idx), 'intguard'))), {}).exports
  const ri = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(idx))), {}).exports
  for (const [i, len] of [[0, 4], [7, 4]]) assert.equal(mi.f(i, len), ri.f(i, len), `idx ${i} len ${len}`)
})

test('identity: and-mask dead before a narrowing store', () => {
  const mod = (mask) => `(module
    (memory 1)
    (func $f (export "f") (param $v i32)
      (i32.store8 (i32.const 0) (i32.and (local.get $v) (i32.const ${mask})))))`
  const out = print(optimize(parse(mod('255')), 'identity'))
  assert(!out.includes('i32.and'), '& 0xff before store8 stripped')
  // mask narrower than the store keeps bits out — must survive
  assert(print(optimize(parse(mod('127')), 'identity')).includes('i32.and'), '& 0x7f is load-bearing')
})

test('identity: f64 compare distributes into a checked-read if-form', () => {
  // the interpreter JNZ shape: `reg[a] !== 0` over an if-form checked read —
  // hit arm convert_i32(load) → raw i32.ne, UNDEF-NaN miss arm → const 1;
  // the outer f64.ne, the convert and the NaN materialization all die.
  const mod = `(module
    (memory 1)
    (func $f (export "f") (param $a i32) (param $n i32) (result i32)
      (f64.ne
        (if (result f64) (i32.lt_u (local.get $a) (local.get $n))
          (then (f64.convert_i32_s (i32.load (i32.shl (local.get $a) (i32.const 2)))))
          (else (f64.const nan:0x7FF8000200000000)))
        (f64.const 0))))`
  const out = print(optimize(parse(mod), 'identity'))
  assert(!out.includes('f64.ne'), 'outer f64 compare gone')
  assert(!out.includes('f64.convert_i32_s'), 'convert gone')
  assert(!out.includes('nan:'), 'NaN materialization gone')
  assert(out.includes('i32.ne'), 'raw i32 compare in the hit arm')
  assert(/\(if\s+\(result i32\)/.test(out), 'if retyped i32')
  // eq twin: NaN arm folds to 0
  const eq = print(optimize(parse(mod.replace('f64.ne', 'f64.eq')), 'identity'))
  assert(eq.includes('i32.eq'), 'eq twin: raw i32 compare')
  assert(!eq.includes('f64.eq'), 'eq twin: outer compare gone')
  // fail-closed: a fractional const cannot map to i32 in the hit arm — the
  // convert-arm is statically unequal, the const arm still folds
  const frac = print(optimize(parse(mod.replace('(f64.const 0)', '(f64.const 0.5)')), 'identity'))
  assert(!frac.includes('f64.ne'), 'fractional const: both arms fold static')
  // fail-closed: an opaque f64 arm (no convert, not a const) keeps the original
  const opaque = `(module
    (func $g (export "g") (param $c i32) (param $x f64) (result i32)
      (f64.ne
        (if (result f64) (local.get $c)
          (then (local.get $x))
          (else (f64.const nan:0x7FF8000200000000)))
        (f64.const 0))))`
  assert(print(optimize(parse(opaque), 'identity')).includes('f64.ne'), 'opaque arm: untouched')
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

test('branch: constant select must NOT drop a side-effecting discarded arm', () => {
  // `select` evaluates BOTH arms before choosing (they are on the stack). Folding a
  // constant-condition select to the kept arm is only sound when the DISCARDED arm is
  // pure. Here the discarded (else) arm `(local.tee $p (f64.const 0))` writes $p — a
  // real side effect (jz compiles `p = 0` as the else arm of `cond ? 0 : p`). Dropping
  // it left `$p` at its incoming value → wrong result. Regression: the fold must
  // preserve the write. (jz fuzz seed=2833 miscompiled before this guard.)
  const src0 = '(module (func (export "f") (param $p f64) (result f64) (drop (select (f64.const 0) (local.tee $p (f64.const 0)) (i32.const 1))) (local.get $p)))'
  // the WRITE's effect must survive whatever shape the pipeline settles on — assert
  // behavior, not syntax: f(5) must be 0 (the discarded arm's tee wrote 0), never 5
  assert.equal(run(src0).f(5), 0, 'discarded select arm side effect observed by the later read')
})

test('coalesce: zero-trip loop write must not join a dead slot (implicit-zero read)', () => {
  // $dead is written before the loop and never used after — its interval ends pre-loop.
  // $out's FIRST use is a write INSIDE the loop; its read comes after. A zero-trip loop
  // (n=0) skips the write, so the read must observe $out's implicit ZERO — but interval
  // coalescing joined $out into $dead's slot and the read leaked $dead's residue (7).
  // The rotated-loop shape jz emits: (block (…inits…) (br_if $exit) (loop …)); the jz
  // mat4 `iters=0` miscompile read matmul residue through exactly this join. Pinned at
  // the pass level ('coalesce'-only) — the full default pipeline reshapes the decoy away.
  const src = `(module (memory 1) (func (export "f") (param $n i32) (result f64)
    (local $dead f64) (local $out f64) (local $i i32)
    (local.set $dead (f64.add (f64.convert_i32_s (local.get $n)) (f64.const 7)))
    (f64.store (i32.const 0) (local.get $dead))
    (block $b
      (br_if $b (i32.ge_s (local.get $i) (local.get $n)))
      (loop $l
        (local.set $out (f64.const 3))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $l (i32.lt_s (local.get $i) (local.get $n)))))
    (local.get $out)))`
  const before = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(src)))).exports.f
  const after = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), 'coalesce')))).exports.f
  assert.equal(before(0), 0, 'unoptimized zero-trip reads the implicit zero')
  assert.equal(after(0), before(0), 'coalesced zero-trip must also read zero, not the dead slot residue')
  assert.equal(after(2), before(2), 'looping case unchanged')
  // Full default pipeline stays correct too (whatever passes run around coalesce).
  const full = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src))))).exports.f
  assert.equal(full(0), before(0))
  assert.equal(full(3), before(3))
})

// ==================== LOOP-INVARIANT CODE MOTION ====================

// A loop recomputing an invariant guard pair (`select` over `f64.ne` of an unwritten
// local) every iteration — the raytrace hot-loop shape. licm must hoist the whole
// subtree to a single pre-loop local.set and leave one local.get inside.
const LICM_GUARD = `(module (func (export "f") (param $x f64) (param $n i32) (result f64)
  (local $i i32) (local $acc f64)
  (block $b (loop $l
    (br_if $b (i32.ge_s (local.get $i) (local.get $n)))
    (local.set $acc (f64.add (local.get $acc)
      (select (f64.const 1) (f64.const 2) (f64.ne (local.get $x) (local.get $x)))))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br $l)))
  (local.get $acc)))`

test('licm: invariant select guard hoists out of the loop', () => {
  const src = print(optimize(parse(LICM_GUARD), { licm: true }))
  // The guard now computes once, before the loop, into a fresh local.
  const loopBody = src.slice(src.indexOf('(loop'))
  assert(!loopBody.includes('f64.ne'), 'guard compare must leave the loop body')
  assert(src.includes('f64.ne'), 'guard compare must still exist (hoisted, not deleted)')
  // Bit-exact: run it.
  const before = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(LICM_GUARD)))).exports.f
  const after = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(LICM_GUARD), { licm: true })))).exports.f
  assert.equal(after(3.5, 4), before(3.5, 4))
  assert.equal(after(NaN, 4), before(NaN, 4))       // the guard's whole point
  assert.equal(after(1.0, 0), before(1.0, 0))       // zero-trip loop: hoist runs, result identical
})

test('licm: loop-varying expression stays; loads, calls, and trapping ops never hoist', () => {
  // 'licm' string form: run ONLY this pass — the default pipeline would legitimately
  // inlineOnce+fold `call $g` first, which is not what this test pins.
  const src = print(optimize(parse(`(module
    (memory 1)
    (func $g (result f64) (f64.const 7))
    (func (export "f") (param $x f64) (param $n i32) (result f64)
      (local $i i32) (local $acc f64)
      (block $b (loop $l
        (br_if $b (i32.ge_s (local.get $i) (local.get $n)))
        ;; varies with $i — must stay
        (local.set $acc (f64.add (local.get $acc) (f64.mul (f64.convert_i32_s (local.get $i)) (f64.const 2))))
        ;; invariant ADDRESS but a LOAD — no alias analysis, must stay
        (local.set $acc (f64.add (local.get $acc) (f64.load (i32.const 8))))
        ;; invariant args but a CALL — must stay
        (local.set $acc (f64.add (local.get $acc) (call $g)))
        ;; invariant operands but TRAPPING (div by zero possible) — must stay
        (local.set $acc (f64.add (local.get $acc) (f64.convert_i32_s (i32.div_s (i32.const 10) (local.get $n)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
      (local.get $acc)))`), 'licm'))
  const loopBody = src.slice(src.indexOf('(loop'))
  assert(loopBody.includes('f64.load'), 'load must stay in the loop')
  assert(loopBody.includes('call $g'), 'call must stay in the loop')
  assert(loopBody.includes('i32.div_s'), 'trapping div must stay in the loop')
  assert(loopBody.includes('f64.convert_i32_s (local.get $i)') || /convert_i32_s\s*\(local\.get \$i\)/.test(loopBody.replace(/\n\s*/g, ' ')), 'loop-varying compute must stay')
})

test('licm: identical invariant subtrees share one hoisted local (loop-level CSE)', () => {
  const src = print(optimize(parse(`(module (func (export "f") (param $x f64) (param $n i32) (result f64)
    (local $i i32) (local $a f64) (local $b f64)
    (block $bl (loop $l
      (br_if $bl (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $a (f64.mul (f64.add (local.get $x) (f64.const 1)) (f64.const 3)))
      (local.set $b (f64.mul (f64.add (local.get $x) (f64.const 1)) (f64.const 3)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $l)))
    (f64.add (local.get $a) (local.get $b))))`), { licm: true }))
  // the hoisted local may be renamed into a dead param slot by coalesce — assert
  // substance: the invariant is computed exactly once, and the result is right
  const muls = (src.match(/f64\.mul/g) || []).length
  assert.equal(muls, 1, `identical invariant exprs must compute once, got ${muls}`)
  const { f } = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(src)))).exports
  assert.equal(f(2, 3), 18, 'hoisted invariant behaves')
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
    (global $g (mut i32) (i32.const 0))
    (func $init (global.set $g (i32.const 1)))
    (func $unused)
    (start $init)
    (func (export "f") (result i32) (global.get $g))
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$init'), 'should keep effectful start func')
  assert(!src.includes('$unused'), 'should remove unused')
})

test('treeshake: empty start func is a no-op and drops with its root', () => {
  const src = print(optimize(parse('(module (func $init) (start $init))'), 'treeshake'))
  assert(!src.includes('start') && !src.includes('$init'), 'empty start + func removed')
})

test('treeshake: keeps elem-referenced', () => {
  const ast = parse(`(module
    (table (export "t") 1 funcref)
    (func $indirect)
    (func $unused)
    (elem (i32.const 0) $indirect)
  )`)
  const opt = optimize(ast, 'treeshake')
  const src = print(opt)
  assert(src.includes('$indirect'), 'should keep elem-referenced func of a live table')
  assert(!src.includes('$unused'), 'unreferenced func removed')
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

test('inline: opts.pin keeps named callees intact (caller-supplied no-inline list)', () => {
  // A consumer may need a single-caller helper's call node to SURVIVE optimization — e.g.
  // jz's auto-vectorizer rewrites $math.exp/log calls to f64x2 mirrors AFTER optimize, so the
  // calls must not be dissolved first. `pin` lets the caller own that policy (no consumer
  // names hardcoded in watr). Accepts an array or a Set.
  const src = `(module
    (func $keep (param $x i32) (result i32) (i32.add (local.get $x) (i32.const 1)))
    (func (export "f") (result i32) (call $keep (i32.const 5)))
  )`
  assert(!print(optimize(parse(src))).includes('call $keep'), 'a single-caller helper is inlined by default')
  assert(print(optimize(parse(src), { pin: ['$keep'] })).includes('call $keep'), 'opts.pin keeps the pinned call')
  assert(print(optimize(parse(src), { pin: new Set(['$keep']) })).includes('call $keep'), 'opts.pin accepts a Set')
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

test('inlineOnce: numeric branch labels splice correctly', () => {
  // Splicing preserves internal depths verbatim, and a function-frame branch (depth
  // past every callee block) lands exactly on buildInline's single wrapper block —
  // the same return-to-exit meaning. So numeric labels are no reason to refuse.
  const src = `(module
    (func $h (result i32) (block (result i32) (br 0 (i32.const 5))))
    (func $g (result i32) (block (br 1 (i32.const 7))) (i32.const 0))
    (func (export "f") (result i32) (call $h))
    (func (export "g") (result i32) (call $g)))`
  const opt = optimize(parse(src), 'inlineOnce')
  const txt = print(opt)
  assert(!txt.includes('call $h') && !txt.includes('call $g'), 'numeric-label callees inlined')
  const x = run(src, 'inlineOnce')
  assert.equal(x.f(), 5)
  assert.equal(x.g(), 7)
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
  const opt = optimize('(module (func (export "f") (result i32) (i32.add (i32.const 1) (i32.const 2))))')
  const src = print(opt)
  assert(src.includes('i32.const 3'), 'should accept and optimize string')
})

test('optimize with specific options', () => {
  const ast = parse('(module (func (result i32) (i32.add (i32.const 1) (i32.const 2))))')
  const opt = optimize(ast, { fold: true, treeshake: false })
  const src = print(opt)
  assert(src.includes('i32.const 3'), 'should fold with explicit option')
})

// ==================== PROFILES ====================

test('profile: speed disables outline/tailmerge/rettail, overridable, opt-in only', () => {
  const speed = normalize('speed')
  assert.equal(speed.outline, false, 'speed disables outline')
  assert.equal(speed.tailmerge, false, 'speed disables tailmerge')
  assert.equal(speed.rettail, false, 'speed disables rettail')
  assert.equal(speed.treeshake, true, 'unrelated passes still fill to their normal default')

  const objForm = normalize({ profile: 'speed' })
  assert.equal(objForm.outline, false, 'object form selects the same preset')
  assert.equal(objForm.tailmerge, false, 'object form selects the same preset')

  const overridden = normalize({ profile: 'speed', outline: true })
  assert.equal(overridden.outline, true, 'an explicit key overrides the profile')
  assert.equal(overridden.tailmerge, false, 'the rest of the profile still applies')

  assert.equal(normalize(true).outline, true, 'plain optimize(ast) never consults a profile (outline stays on)')
  assert.equal(normalize(true).tailmerge, true, 'plain optimize(ast) never consults a profile (tailmerge stays on)')
})

test('profile: speed keeps a repeated pure expression inline instead of sharing it', () => {
  // Same shape as 'outline: repeated pure expressions extract into one shared
  // helper' above — three occurrences across two functions, big enough for
  // outline's byte-profit heuristic to fire under the default pipeline.
  const H = '(i32.xor (i32.mul (i32.and (local.get $$) (i32.const 16777215)) (i32.const 2654435761)) (i32.const 40503))'
  const at = (v) => H.replaceAll('$$', v)
  const src = `(module (memory 1)
    (func (export "f") (param $a i32) (param $b i32) (result i32)
      (i32.add ${at('$a')} ${at('$b')}))
    (func (export "g") (param $x i32) (result i32) ${at('$x')}))`
  const h = (v) => (Math.imul(v & 16777215, 2654435761) ^ 40503) | 0
  const { f, g } = run(src, 'speed')
  assert.equal(f(2, 3), (h(2) + h(3)) | 0, 'speed-profiled output stays correct')
  assert.equal(g(300), h(300), 'speed-profiled output stays correct')

  const plainTxt = print(optimize(parse(src)))
  const speedTxt = print(optimize(parse(src), 'speed'))
  assert.equal((plainTxt.match(/i32\.mul/g) || []).length, 1, 'default optimize shares the repeated expression into one helper (outline is on)')
  assert.equal((speedTxt.match(/i32\.mul/g) || []).length, 3, 'speed profile keeps every occurrence inline (outline is off)')
})

// ==================== EDGE CASES ====================

test('optimize: empty module', () => {
  const ast = parse('(module)')
  const opt = optimize(ast)
  const src = print(opt)
  assert(src.includes('module'), 'should handle empty module')
})

test('optimize: unexported funcs are unreachable and removed', () => {
  // Export-rooted liveness (wasm-opt's model): with no export/start/live-elem root,
  // nothing can ever invoke these — the module reduces to its shell.
  const ast = parse('(module (func $a) (func $b))')
  const src = print(optimize(ast, 'treeshake'))
  assert(!src.includes('$a') && !src.includes('$b'), 'unreachable funcs removed')
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

test('vacuum: select identical IMPURE arms is NOT collapsed (side effect runs twice)', () => {
  // select evaluates BOTH arms, so identical arms with a side effect run it twice. Collapsing
  // `select(tee, tee, c) → tee` would run it once — a semantics change. Keep the select unless
  // the arm is pure. (Sibling of the constant-select side-effect guard above.)
  // read $x afterwards so the tee writes stay observable (an unread tee is now
  // soundly demoted, which would make the arms pure and the select collapsible)
  const src0 = '(module (func (export "f") (param $x i32) (param $c i32) (result i32) (i32.add (select (local.tee $x (i32.const 7)) (local.tee $x (i32.const 8)) (local.get $c)) (local.get $x))))'
  const { f } = run(src0)
  assert.equal(f(0, 1), 7 + 8, 'both arms evaluate: pick=7, but $x holds the later-evaluated 8')
  assert.equal(f(0, 0), 8 + 8)
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
  const ast = parse('(module (global $g (mut i32) (i32.const 7)) (func (export "f") (result i32) (global.get $g)))')
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

test('brif: merges adjacent same-label br_if pair when the second is pure and trap-free', () => {
  const ast = parse('(module (func (param $a i32) (param $b i32) (block $done (br_if $done (local.get $a)) (br_if $done (local.get $b)) (i32.const 1) drop)))')
  const opt = optimize(ast, 'brif')
  const src = print(opt)
  assert(src.includes('i32.or'), 'should merge the pair into one br_if (i32.or a b)')
  assert((src.match(/br_if/g) || []).length === 1, 'one br_if after the merge')
})

test('brif: NEVER merges a br_if pair when the second condition loads — the first br_if is its bounds guard', () => {
  // A dict/array scan: `br_if $exit (i >= cap)` guards `br_if $skip (load slot(i))`.
  // Merging evaluates the load unconditionally — past the guard — and traps OOB
  // (the jz for-in-over-dictionary miscompile). Loads are isPure (value-pure
  // between stores) and hasTrap misses them; readsMemory must gate the merge.
  const ast = parse('(module (memory 1) (func (param $i i32) (param $cap i32) (block $done (br_if $done (i32.ge_u (local.get $i) (local.get $cap))) (br_if $done (i32.load (local.get $i))) (i32.const 1) drop)))')
  const opt = optimize(ast, 'brif')
  const src = print(opt)
  assert(!src.includes('i32.or'), 'must NOT merge across the bounds guard')
  assert((src.match(/br_if/g) || []).length === 2, 'both br_ifs survive')
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

test('fold: i64.reinterpret_f64 of constant stays monotone', () => {
  // 256.0's bit pattern 0x4070000000000000 slebs to 10 B — folding would grow the
  // 10-B op+f64.const to an 11-B i64.const, so fold must leave it (never-inflate
  // invariant; NaN-payload reinterprets keep their own dedicated, ungated fold).
  const src0 = '(module (func (result i64) (i64.reinterpret_f64 (f64.const 256))))'
  const src = print(optimize(parse(src0), 'fold'))
  assert(src.includes('reinterpret'), 'inflating reinterpret fold skipped')
  assert(compile(optimize(parse(src0), 'fold')).length <= compile(parse(src0)).length)
})

test('fold: f64.reinterpret_i64 round-trip', () => {
  const ast = parse('(module (func (result f64) (f64.reinterpret_i64 (i64.const 4643211215818981376))))')
  const src = print(optimize(ast, 'fold'))
  assert(src.includes('f64.const'), 'reinterpret i64→f64 folded to f64.const')
  assert(!src.includes('reinterpret'), 'reinterpret op gone')
})

test('fold: f64.convert_i32_s stays monotone', () => {
  // 1-B op + 4-B i32.const → 9-B f64.const would inflate; fold must skip it
  const src0 = '(module (func (result f64) (f64.convert_i32_s (i32.const 65536))))'
  const src = print(optimize(parse(src0), 'fold'))
  assert(src.includes('f64.convert_i32_s'), 'inflating convert fold skipped')
  assert(compile(optimize(parse(src0), 'fold')).length <= compile(parse(src0)).length)
})

test('fold: chained convert + reinterpret stays monotone', () => {
  // the whole chain (6 B) is smaller than the folded 11-B i64.const — kept as-is
  const src0 = '(module (func (result i64) (i64.reinterpret_f64 (f64.convert_i32_s (i32.const 65536)))))'
  assert(compile(optimize(parse(src0), 'fold')).length <= compile(parse(src0)).length)
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
    (memory 1)
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
  const ast = parse(`(module (memory 4) (data (i32.const 0) "${'\\01'.repeat(N)}\\00\\00\\00"))`)
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
  const ast = parse(`(module (func (export "f") (param $c i32) (result i32)
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
  // the wide const must materialize exactly once (as a set or a tee), never per use
  assert.equal(print(optimize(parse(reuse))).split('1000000').length - 1, 1, 'wide reused const written once')
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

// ── guard: false — caller waives the size-revert guard ───────────────────────
// Contract: `guard: false` produces byte-for-byte what a guarded run that never
// unwinds produces (i.e. unbounded tolerance) — it only skips the guard's
// bookkeeping (pristine clone, round-start clones, the two exit encodes).
test('guard:false equals an unbounded-tolerance guarded run, and stays correct', () => {
  // Inlining-heavy shape: single-caller callee with conditionally-initialized
  // locals, called from a loop — inlineOnce must emit per-entry re-zeroes, the
  // classic (small) inflation source the guard exists to police.
  const src = `(module
    (func $f (param $p i32) (result i32)
      (local $a i32) (local $b i32) (local $c i32) (local $d i32)
      (if (local.get $p) (then
        (local.set $a (i32.const 7)) (local.set $b (i32.const 8))
        (local.set $c (i32.const 9)) (local.set $d (i32.const 10))))
      (i32.add (i32.add (local.get $a) (local.get $b)) (i32.add (local.get $c) (local.get $d))))
    (func (export "g") (result i32)
      (local $i i32) (local $s i32)
      (loop $L
        (local.set $s (i32.add (local.get $s) (call $f (i32.and (local.get $i) (i32.const 1)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $L (i32.lt_u (local.get $i) (i32.const 4))))
      (local.get $s)))`
  const O = { inline: true }
  const binOff = compile(optimize(parse(src), { ...O, guard: false }))
  const binBig = compile(optimize(parse(src), { ...O, tolerance: 1e9 }))
  assert.deepEqual([...binOff], [...binBig], 'guard:false must match a never-unwinding guarded run byte-for-byte')
  // Semantics: iterations 3 and 4 re-enter the (inlined) callee — its locals
  // must read as freshly zeroed, not carry iteration-2 residue. 0+34+0+34.
  const g = new WebAssembly.Instance(new WebAssembly.Module(binOff)).exports.g
  assert.equal(g(), 68, 'inlined callee locals must re-zero on loop re-entry')
  // And the guarded default still yields the same observable result.
  const gOn = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), O)))).exports.g
  assert.equal(gOn(), 68)
})

// ── inlineWrappers: adapter frames dissolve into their target ────────────────
test('inlineWrappers: conversion-wrapped forward inlines; standalone target survives', () => {
  const src = `(module
    (func $work (param $x i32) (param $y i32) (result i32)
      (i32.add (i32.mul (local.get $x) (i32.const 3)) (local.get $y)))
    ;; closure-ABI-style trampoline: f64 slots in, i32 worker, f64 rebox out
    (func $tramp (export "t") (param $a f64) (param $b f64) (result f64)
      (f64.convert_i32_s (call $work
        (i32.trunc_sat_f64_s (local.get $a))
        (i32.trunc_sat_f64_s (local.get $b)))))
    ;; a second, direct caller keeps $work alive standalone
    (func (export "d") (param $x i32) (result i32) (call $work (local.get $x) (i32.const 5))))`
  // structural: the pass alone (selector string) — wrapper stops calling, target stays
  const solo = print(optimize(parse(src), 'inlineWrappers'))
  const trampBody = solo.slice(solo.indexOf('$tramp'), solo.indexOf('(func', solo.indexOf('$tramp') + 1))
  assert(!trampBody.includes('call $work'), 'wrapper must not call the target anymore')
  assert(solo.includes('func $work'), 'standalone target survives for its direct caller')
  // semantic: full defaults + the pass (inlineOnce may then dissolve the worker — fine)
  const x = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), { inlineWrappers: true })))).exports
  assert.equal(x.t(4, 2), 14, 'inlined wrapper computes 4*3+2')
  assert.equal(x.d(4), 17, 'direct path computes 4*3+5')
})

// ── guardRefine: arm-local ne-facts must not leak past the join ──────────────
// Regression (found via jz's valueOf-override corpus): restore() handed the
// snapshot's inner neFact Sets back as the live sets; an else-arm's addFacts
// then mutated the snapshot itself, and the second restore resurrected the
// arm-local fact after the if — a SIBLING tag compare folded on a fact that
// only held inside one arm. For a tag-1 input the final compare below is true
// (42); the aliasing bug folded it to 0 (7).
test('guardRefine: else-arm fact does not leak to a sibling compare', () => {
  const src = `(module
    (func (export "f") (param $bits i64) (result i32)
      (local $o f64) (local $t i32)
      (local.set $o (f64.reinterpret_i64 (local.get $bits)))
      (local.set $t (i32.and (i32.wrap_i64 (i64.shr_u (i64.reinterpret_f64 (local.get $o)) (i64.const 47))) (i32.const 15)))
      (if (i32.eqz (i32.eq (local.get $t) (i32.const 4)))   ;; pre-existing ne{4} on $o
        (then
          (if (i32.eq (local.get $t) (i32.const 1))          ;; else-arm records ne{1}
            (then (nop))
            (else (nop)))
          (if (i32.eq (local.get $t) (i32.const 1))          ;; sibling AFTER the join
            (then (return (i32.const 42))))
          (return (i32.const 7))))
      (i32.const 9)))`
  const f = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), { guardRefine: true })))).exports.f
  assert.equal(f(1n << 47n), 42, 'tag-1 input must reach the folded-away branch')
  assert.equal(f(4n << 47n), 9, 'tag-4 input takes the outer else')
  assert.equal(f(7n << 47n), 7, 'tag-7 input falls through both')
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

// ==================== SIZE-ONLY binarySize (measure mode) ====================

test('size(nodes) equals full compile(nodes).length across features', () => {
  const mods = [
    '(module (func (export "a") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1))))',
    '(module (memory 1) (func (param i32) (result i32) (i32.load offset=16 (local.get 0)) (i32.const 999999) (i32.add)))',
    '(module (global $g (mut i64) (i64.const 0)) (func (result i64) (global.get $g) (i64.const 0x123456789abc) (i64.mul)))',
    '(module (func (result f64) (f64.const 3.14159265358979) (f64.const 2.0) (f64.mul) (f64.sqrt)))',
    '(module (func (param i32) (result i32) (local i32 i32 f64) (block (result i32) (br_if 0 (local.get 0)) (i32.const 5))))',
    '(module (type $t (func (param i32) (result i32))) (table 1 funcref) (func (param i32)(result i32)(local.get 0)) (func (param i32)(result i32) (call_indirect (type $t) (local.get 0) (i32.const 0))))',
    '(module (func (param i32)(result i32) (i32.const 0) (local.get 0) (select)) (func (param v128)(result v128)(local.get 0)(i8x16.splat (i32.const 7))(i8x16.add)))',
    '(module (memory 1)(data (i32.const 0) "hello world") (func (result i32)(memory.size)))',
    '(module (func (param i32)(result i32)(local.get 0)(if (result i32)(then (i32.const 1))(else (i32.const 2)))))',
    '(module (func (param i32)(result i32)(block(block(block(br_table 0 1 2 (local.get 0))(i32.const 10))(i32.const 20))(i32.const 30))))',
    '(module binary "\\00asm" "\\01\\00\\00\\00")',   // binary abbreviation → measure returns bytes.length (the {bytes} early-return path)
  ]
  for (const src of mods) {
    const exact = srcCompile(parse(src)).length                // full materialize
    const measured = size(parse(src))                          // size-only peer function
    assert.equal(measured, exact, `measure ${measured} !== compile().length ${exact} for ${src.slice(0, 50)}`)
  }
  // the whole example corpus, raw and optimized — the strongest drift guard for
  // the width-only size handlers
  const dir = new URL('./example/', import.meta.url)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.wat'))) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    for (const ast of [parse(src), optimize(parse(src))]) {
      assert.equal(size(clone(ast)), srcCompile(clone(ast)).length, `size↔compile drift on ${f}`)
    }
  }
})

// ==================== REGRESSIONS (optimizer soundness) ====================
// Each test pins a repro-confirmed miscompile; the shapes are minimal versions of
// the corpus failures (dino/brownian/maze/raycast/types) that exposed them.

const run = (src, opts = true) => new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), opts)))).exports

test('deadcode: flat block/end br_table arms survive (Duff dispatch)', () => {
  const src = `(module (memory (export "m") 1) (func (export "f") (param $x i32)
    block $b0 block $b1 (br_table $b1 $b0 (local.get $x)) end $b1
      (i32.store (i32.const 0) (i32.const 11))
    end $b0
      (i32.store (i32.const 4) (i32.const 22))))`
  const { f, m } = run(src, 'deadcode')
  f(0)
  const b = new Int32Array(m.buffer)
  assert.equal(b[0], 11, 'arm 0 executed')
  assert.equal(b[1], 22, 'fallthrough arm executed')
})

test('brif: numeric branch label survives losing the if nesting level', () => {
  // (br 2) escapes if→loop→func; brif dissolves the if, so the numeral must drop to 1
  const src = `(module (func (export "f") (local $i i32)
    (local.set $i (i32.const 3))
    (loop
      (if (i32.eqz (local.get $i)) (then (br 2)))
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (br 0))))`
  run(src, 'brif').f() // used to throw Bad label 2 at compile; also must terminate
})

test('fold: int→float const conversion never inflates', () => {
  const src = '(module (func (export "f") (result f32) (f32.convert_i32_s (i32.const 22))))'
  const base = compile(parse(src)).length
  assert(compile(optimize(parse(src))).length <= base, 'optimize must not grow the binary')
  assert.equal(run(src).f(), 22)
})

test('module passes fire under a leading top-level comment', () => {
  const src = ';; banner\n(module (func $dead (result i32) (i32.const 1)) (func (export "f") (result i32) (i32.const 2)))'
  const opt = optimize(parse(src))
  assert(!print(opt).includes('$dead'), 'treeshake removes the dead func despite the comment wrapper')
  assert.equal(run(src).f(), 2)
})

test('treeshake: numeric refs renumber across removals', () => {
  const src = `(module (global $g (mut i32) (i32.const 0))
    (func $dead0 (result i32) (i32.const 9))
    (func $init (global.set $g (i32.const 7)))
    (start 1)
    (func $dead2 (result i32) (i32.const 8))
    (func (export "get") (result i32) (global.get $g)))`
  const txt = print(optimize(parse(src)))
  assert(!txt.includes('$dead0') && !txt.includes('$dead2'), 'both dead funcs removed')
  assert(txt.includes('start 0') || txt.includes('start $init'), 'numeric start ref renumbered past the removal')
  assert.equal(run(src).get(), 7, 'start still reaches $init')
})

test('treeshake: write-only global dies, its sets neutered', () => {
  const src = `(module (global $w (mut i32) (i32.const 0))
    (func (export "f") (result i32) (global.set $w (i32.const 5)) (i32.const 3)))`
  const opt = optimize(parse(src))
  assert(!print(opt).includes('global'), 'set-only global removed')
  assert.equal(run(src).f(), 3)
})

test('sinkSets: a loop statement is opaque to first-eval sinking', () => {
  // sinking (local.set $i 3) into the loop head would re-init $i every iteration
  const src = `(module (func (export "f") (result i32) (local $i i32) (local $s i32)
    (local.set $i (i32.const 3))
    (loop $l
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $l (i32.and (i32.ne (local.get $i) (i32.const 0)) (i32.lt_s (local.get $s) (i32.const 100)))))
    (local.get $s)))`
  assert.equal(run(src).f(), 3)
})

test('propagate: copy fan-out cannot orphan a multi-use local', () => {
  const src = `(module (func (export "f") (result i32) (local $a i32) (local $b i32) (local $c i32)
    (local.set $a (i32.const 5))
    (local.set $b (local.get $a))
    (local.set $c (i32.add (local.get $b) (i32.const 1)))
    (i32.add (local.get $c) (local.get $b))))`
  assert.equal(run(src).f(), 11)
})

test('unbranch: func-tail return kept when it discards stack values', () => {
  const src = '(module (func (export "f") (result i32) (i32.const 99) (return (i32.const 7))))'
  assert.equal(run(src).f(), 7)
})

test('packData: interior zero runs split without changing memory image', () => {
  const src = `(module (memory (export "m") 1)
    (data (i32.const 0) "ab${'\\00'.repeat(40)}cd"))`
  const base = compile(parse(src)).length
  assert(compile(optimize(parse(src))).length < base, 'zero run replaced by a second segment')
  const b = new Uint8Array(run(src).m.buffer)
  assert.equal(String.fromCharCode(b[0], b[1], b[42], b[43]), 'abcd')
  assert.equal(b[20], 0)
})

test('packData: a split segment whose content starts with ";" is not mistaken for a comment', () => {
  // jz self-host repro (2026-07): packData splits a zero run inside jz's interned static-
  // string table (src/compile/index.js buildInternTable, self-host scale only), and the
  // surviving byte run of one split-off segment happened to start with ';' — a WAT-text
  // stdlib template's own embedded comment, interned as static data. compile.js's
  // isDroppable() treated ANY string with n[1]===';' as a `(;` block-comment token without
  // also checking n[0]==='(' — a plain data string always starts with n[0]==='"', so this
  // matched it too and cleanup() silently dropped the whole segment's content, corrupting
  // the kernel's own OPCODE table lookups ("Unknown instruction f64.nearest") at runtime.
  // packData's own trim/merge/split logic is not at fault (proven via a memory-image diff
  // against the real self-host kernel, both single-pass-isolated and full-pipeline) — this
  // pins the true root cause at the encoder layer that packData's fragmentation exposes.
  const src = `(module (memory (export "m") 1)
    (data (i32.const 0) "ab${'\\00'.repeat(40)}; cd"))`
  const base = compile(parse(src)).length
  assert(compile(optimize(parse(src))).length < base, 'zero run replaced by a second segment')
  const b = new Uint8Array(run(src).m.buffer)
  assert.equal(String.fromCharCode(b[0], b[1]), 'ab', 'first segment intact')
  assert.equal(b[20], 0, 'interior zero run still reads zero')
  assert.equal(String.fromCharCode(b[42], b[43], b[44], b[45]), '; cd',
    'second segment, starting with ";", is NOT dropped as a comment token')
})

test('packData: many-segment split with varied first-byte shapes stays byte-exact (self-host-density regression)', () => {
  // The class-1 fix above was found via a memory-image diff at REAL self-host scale
  // (~600KB, ~1800 segments split from jz's interned-string table) — a lone small repro
  // doesn't reproduce density-dependent encoder bugs by chance (jz self-host groundtruth,
  // "packData-on residual": a 20/20-passing scratch-mirror kernel and a from-scratch
  // isolated packData run over the REAL ~600KB/1827-segment pre-watr kernel AST both come
  // back byte-image-identical against current watr HEAD — root-caused instead to jz's
  // package.json pinning a published watr release cut BEFORE this fix, so a plain `npm
  // install` silently reinstalled the pre-fix isDroppable). This test generalizes the
  // minimal ';'-prefix repro into a many-segment, many-shape regression, so a future
  // packData change gets caught locally instead of needing a multi-minute self-host
  // rebuild to notice: islands separated by long zero runs (forces the split path), each
  // island's surviving content deliberately shaped to look like a comment ('; …', the
  // original repro), a non-comment paren token ('(a…' — must NOT match the same '(' + ';'
  // guard), a bare WAT keyword ('i32.const …'), a bare number ('1234567890 …'), and a raw
  // escape-needing byte run (a literal backslash byte immediately followed by literal '0'
  // '0' text) — every "unguarded token-shape assumption" the encoder could plausibly
  // mistake a plain data string for. Asserts the FULL reconstructed memory image (not
  // hand-picked offsets) is byte-identical with packData on vs off.
  const islands = [
    '; not a comment, a literal data string',
    '(a fake-paren token, no leading ;',
    'i32.const 4 looks like an opcode+immediate',
    '1234567890 looks like a bare number',
    '\\5c00 raw backslash byte then literal zero-zero text',
  ]
  const gap = '\\00'.repeat(24) // well over packData's split-worth threshold at these offsets
  const content = islands.join(gap)
  const src = `(module (memory (export "m") 1) (data (i32.const 0) "${content}"))`

  const opt = optimize(parse(src))
  const segCount = opt.filter(n => Array.isArray(n) && n[0] === 'data').length
  assert.equal(segCount, islands.length, `one lone segment split into one per island (got ${segCount})`)

  const rawBytes = new Uint8Array(run(src, false).m.buffer)
  const optBytes = new Uint8Array(run(src, true).m.buffer)
  assert.equal(optBytes.length, rawBytes.length, 'memory size unchanged')
  for (let i = 0; i < rawBytes.length; i++) {
    assert.equal(optBytes[i], rawBytes[i], `byte ${i}: raw ${rawBytes[i]} vs optimized ${optBytes[i]}`)
  }
})

test('inlineOnce: callee with bare trailing return inlines correctly', () => {
  const src = `(module
    (func $inc (param $p i32) (result i32) (i32.add (local.get $p) (i32.const 1)) return)
    (func (export "f") (result i32) (call $inc (i32.const 4))))`
  const opt = optimize(parse(src))
  assert(!print(opt).includes('call'), 'single-caller callee inlined')
  assert.equal(run(src).f(), 5)
})

test('vacuum: empty-then if inverts into the else arm', () => {
  const src = `(module (func (export "f") (param i32) (result i32) (local $r i32)
    (if (local.get 0) (then) (else (local.set $r (i32.const 9))))
    (local.get $r)))`
  assert(print(optimize(parse(src), 'vacuum')).includes('i32.eqz'), 'condition inverted, else promoted')
  const { f } = run(src)
  assert.equal(f(0), 9)
  assert.equal(f(1), 0)
})

test('treeshake: dead table + its segments go; ref.func declarations survive', () => {
  const src = `(module
    (table $dead 2 funcref)
    (elem (table $dead) (i32.const 0) funcref $f)
    (func $f (result i32) (i32.const 1))
    (func (export "g") (result i32) (i32.const 2)))`
  const txt = print(optimize(parse(src)))
  assert(!txt.includes('table'), 'unread table and its segment removed')
  assert.equal(run(src).g(), 2)

  // a passive segment is the DECLARATION an in-code ref.func needs — it must stay
  const decl = `(module
    (import "m" "l" (func $log))
    (elem func 0)
    (func (export "f") (result funcref) (ref.func 0)))`
  const w = compile(optimize(parse(decl)))
  assert(new WebAssembly.Module(w) instanceof WebAssembly.Module, 'declaring segment kept — module validates')
})

test('dedupe: canonical positional hash — merges naming clones, never operand swaps', () => {
  const src = `(module
    (func $a (param $x i32) (param $y i32) (result i32) (i32.sub (local.get $x) (local.get $y)))
    (func $b (param $p i32) (param $q i32) (result i32) (i32.sub (local.get $p) (local.get $q)))
    (func $c (param $x i32) (param $y i32) (result i32) (i32.sub (local.get $y) (local.get $x)))
    (func (export "u") (param i32 i32) (result i32) (i32.sub (local.get 0) (local.get 1)))
    (func (export "a") (result i32) (call $a (i32.const 7) (i32.const 3)))
    (func (export "b") (result i32) (call $b (i32.const 7) (i32.const 3)))
    (func (export "c") (result i32) (call $c (i32.const 7) (i32.const 3))))`
  const x = run(src)
  assert.equal(x.a(), 4)
  assert.equal(x.b(), 4)
  assert.equal(x.c(), -4, 'operand-swapped func must NOT be merged with its mirror')
  assert.equal(x.u(7, 3), 4)
  const txt = print(optimize(parse(src)))
  assert((txt.match(/i32\.sub/g) || []).length <= 3, 'naming clones merged')
})

test('dedupe: defers a single-caller duplicate pair to inlineOnce instead of merging', () => {
  // helperA/helperB differ only in a param that specializeParams (spec) bakes in as
  // the same constant (7) at their one respective call site — spec then makes the
  // two bodies byte-identical. dedupe must NOT redirect one to the other here: both
  // are some other function's SOLE caller, so inlineOnce (which runs right after
  // dedupe in the same round) can dissolve each into its own call site for free.
  // Merging first would leave one shared function with two surviving `call`s —
  // strictly worse than zero.
  const src = `(module
    (func $helperA (param $x i32) (param $tag i32) (result i32)
      (i32.add (i32.mul (local.get $x) (local.get $x)) (local.get $tag)))
    (func $helperB (param $y i32) (param $tag i32) (result i32)
      (i32.add (i32.mul (local.get $y) (local.get $y)) (local.get $tag)))
    (func (export "f") (param $a i32) (param $b i32) (result i32)
      (i32.add (call $helperA (local.get $a) (i32.const 7)) (call $helperB (local.get $b) (i32.const 7)))))`
  assert.equal(run(src).f(3, 4), 39, '3*3+7 + 4*4+7 = 16 + 23')
  const txt = print(optimize(parse(src)))
  assert(!/\bcall\s+\$helper/.test(txt), `both calls should fully inline away, got:\n${txt}`)
})

test('dedupe: still merges a duplicate when NOT every member is single-caller', () => {
  // helperA/helperB are identical from the start (no specializeParams involved) —
  // helperA already has TWO callers (f and g), so it was never an inlineOnce
  // candidate on its own; deferring the pair would just leave two duplicate bodies
  // unmerged for no benefit. dedupe must still merge this pair.
  const src = `(module
    (func $helperA (param $x i32) (result i32) (i32.mul (local.get $x) (local.get $x)))
    (func $helperB (param $y i32) (result i32) (i32.mul (local.get $y) (local.get $y)))
    (func (export "f") (param $a i32) (param $b i32) (result i32)
      (i32.add (call $helperA (local.get $a)) (call $helperB (local.get $b))))
    (func (export "g") (param $a i32) (result i32) (call $helperA (local.get $a))))`
  const x = run(src)
  assert.equal(x.f(3, 4), 25, '3*3 + 4*4')
  assert.equal(x.g(5), 25, '5*5')
  const txt = print(optimize(parse(src)))
  assert(!txt.includes('$helperB'), 'helperB should merge into helperA (treeshaken away as a dead duplicate)')
  assert.equal((txt.match(/call \$helperA/g) || []).length, 3, 'f (x2, its own + the redirected helperB call) and g (x1) all call the merged canonical')
})

test('loop-entry DSE: dead pre-loop init dies; zero-trip-observable init survives', () => {
  // every path through the loop rewrites $s before reading it, and $s is never read
  // outside — the pre-loop init is unobservable
  const dead = `(module (func (export "f") (param $n i32) (result i32) (local $i i32) (local $s i32) (local $r i32)
    (local.set $s (i32.const 7))
    (loop $l
      (local.set $s (i32.add (local.get $i) (i32.const 1)))
      (local.set $r (i32.add (local.get $r) (local.get $s)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $l (i32.lt_s (local.get $i) (local.get $n))))
    (local.get $r)))`
  assert(!print(optimize(parse(dead))).includes('i32.const 7'), 'unobservable pre-loop init removed')
  assert.equal(run(dead).f(3), 6)
  // the verifier counterexample: an inner zero-trip loop can skip the write while the
  // value is read after — the reset is OBSERVABLE and must survive
  const live = `(module (func (export "f") (result i32) (local $x i32) (local $i i32) (local $j i32)
    (loop $outer
      (local.set $j (i32.sub (i32.const 1) (local.get $i)))
      (local.set $x (i32.const 0))
      (loop $inner
        (if (i32.gt_s (local.get $j) (i32.const 0))
          (then (local.set $x (i32.const 1))
                (local.set $j (i32.sub (local.get $j) (i32.const 1)))
                (br $inner))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $outer (i32.lt_s (local.get $i) (i32.const 3))))
    (local.get $x)))`
  assert.equal(run(live).f(), 0, 'zero-trip-observable reset preserved')
})

test('dead comparison around a live tee collapses to the bare store', () => {
  const src = `(module (memory 1) (func (export "f") (result i32) (local $d i32) (local $l i32)
    (local.set $d (i32.eq (local.tee $l (i32.const 42)) (i32.const 5)))
    (local.get $l)))`
  const out = print(optimize(parse(src)))
  assert(!out.includes('i32.eq'), 'dead comparison dropped, tee store kept')
  assert.equal(run(src).f(), 42)
})

test('impure trap-free dead store reduces to its side-effect core', () => {
  const src = `(module (global $g (mut i32) (i32.const 0)) (func (export "f") (result i32) (local $d i32)
    (local.set $d (i32.add (local.tee $d (i32.const 1)) (block (result i32) (global.set $g (i32.const 9)) (i32.const 2))))
    (global.get $g)))`
  assert.equal(run(src).f(), 9, 'global.set inside the dead store still runs')
})

test('flat control skeleton: pre-loop constant must not freeze a loop-carried local', () => {
  // wax shape: folded exprs inside a bare-token control skeleton. Propagating the
  // pre-loop 0 into the flat loop body folds the exit guard away — infinite loop.
  const src = `(module (func (export "f") (result i32) (local $i i32)
    (local.set $i (i32.const 0))
    block $B loop $L
      (br_if $B (i32.ge_s (local.get $i) (i32.const 3)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      br $L
    end end
    (local.get $i)))`
  assert.equal(run(src).f(), 3)
  // a single-write closed constant may legitimately cross the flat loop header
  const stable = `(module (func (export "g") (result i32) (local $c i32) (local $i i32)
    (local.set $c (i32.const 5))
    block $B loop $L
      (br_if $B (i32.ge_s (local.get $i) (local.get $c)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      br $L
    end end
    (local.get $i)))`
  assert.equal(run(stable).g(), 5)
})

test('flat block: binding created inside a skippable block dies at its end', () => {
  // br_if can skip the write; the get after `end` must not see the inner constant
  const src = `(module (func (export "f") (param $p i32) (result i32) (local $x i32)
    block $B
      (br_if $B (local.get $p))
      (local.set $x (i32.const 5))
    end
    (local.get $x)))`
  const { f } = run(src)
  assert.equal(f(1), 0, 'skipping path reads the default 0')
  assert.equal(f(0), 5)
})

test('tracked memory read goes stale after a narrow store (store8)', () => {
  const src = `(module (memory 1) (func (export "f") (result i32) (local $x i32) (local $y i32)
    (i32.store (i32.const 0) (i32.const 0x01010101))
    (local.set $x (i32.load (i32.const 0)))
    (i32.store8 (i32.const 0) (i32.const 0xff))
    (local.set $y (local.get $x))
    (i32.sub (local.get $y) (i32.load (i32.const 0)))))`
  assert.equal(run(src).f(), 0x01010101 - 0x010101ff)
})

test('inlineOnce: bare stack-style return in the callee exits the inline block, not the caller', () => {
  const src = `(module
    (global $g (mut i32) (i32.const 0))
    (func $helper (param $x i32)
      block $b
        (br_if $b (i32.eqz (local.get $x)))
        (global.set $g (i32.const 1))
        return
      end
      (global.set $g (i32.const 2)))
    (func (export "f") (param $x i32) (result i32)
      (call $helper (local.get $x))
      (global.set $g (i32.add (global.get $g) (i32.const 10)))
      (global.get $g)))`
  const { f } = run(src)
  assert.equal(f(1), 11, 'statements after the inlined call still execute')
  assert.equal(f(0), 12)
})

test('rettail: void trailing loop with if-nested returns lifts to a typed loop', () => {
  const src = `(module (func (export "find") (param $n i32) (result i32) (local $i i32)
    (loop $L
      (if (i32.ge_s (local.get $i) (i32.const 10)) (then (return (i32.const -1))))
      (if (i32.eq (local.get $i) (local.get $n)) (then (return (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L))
    (i32.const 0)))`
  const { find } = run(src)
  assert.equal(find(3), 3)
  assert.equal(find(50), -1, 'exhausted loop returns the -1 arm, never the dead filler')
  // a loop with an escaping branch to an outer label must NOT be lifted
  const escape = `(module (func (export "g") (param $n i32) (result i32) (local $i i32)
    block $out
      (loop $L
        (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $i (i32.add (local.get $i) (i32.const 2)))
        (br $L))
    end
    (local.get $i)))`
  assert.equal(run(escape).g(5), 6)
})

test('const-chain reassociation folds through a variable', () => {
  const src = `(module (func (export "f") (param $x i32) (result i32)
    (i32.sub (i32.sub (i32.add (i32.add (local.get $x) (i32.const 5)) (i32.const 3)) (i32.const 2)) (i32.const 1))))`
  assert.equal(run(src).f(10), 15)
  const txt = print(optimize(parse(src)))
  assert.equal((txt.match(/i32\.const/g) || []).length, 1, 'four constants collapse into one')
})

test('data zero-trim fences: overlap, OOB trap, imported memory all preserved', () => {
  // a later segment's zero run deliberately clears an earlier segment's bytes
  const overlap = `(module (memory (export "m") 1)
    (data (i32.const 0) "\\ff\\ff\\ff\\ff")
    (data (i32.const 2) "\\00\\00"))`
  const m = run(overlap).m
  assert.deepEqual([...new Uint8Array(m.buffer, 0, 4)], [255, 255, 0, 0], 'zero-clear tail survives')
  // an out-of-bounds segment must still trap at instantiation
  const oob = `(module (memory 1) (data (i32.const 65533) "\\01\\02\\03\\00\\00"))`
  assert.throws(() => run(oob), /bounds|out of/i, 'OOB data segment still traps')
  // an imported memory is not guaranteed zero — segment length must not shrink
  const imported = `(module (import "env" "mem" (memory 1)) (data (i32.const 10) "\\01\\02\\00\\00\\00"))`
  const mem = new WebAssembly.Memory({ initial: 1 })
  new Uint8Array(mem.buffer)[13] = 0xab
  const bin = compile(optimize(parse(imported)))
  new WebAssembly.Instance(new WebAssembly.Module(bin), { env: { mem } })
  assert.deepEqual([...new Uint8Array(mem.buffer, 10, 5)], [1, 2, 0, 0, 0], 'zero bytes still overwrite host content')
})

test('sinkIntoBranch: pre-branch value moves into its sole consuming arm', () => {
  const src = `(module (memory 1)
    (func $ro (param $p i32) (result i32) (i32.load (local.get $p)))
    (func (export "f") (param $a i32) (result i32) (local $x i32)
      (local.set $x (i32.add (local.get $a) (i32.const 100)))
      (if (result i32) (call $ro (local.get $a))
        (then (local.get $x))
        (else (i32.const -1)))))`
  const { f } = run(src)
  assert.equal(f(0), -1, 'zero at address 0: else arm')
  // a condition CALL that writes memory the value reads must block the sink
  const clash = `(module (memory 1) (global $g (mut i32) (i32.const 0))
    (func $w (param $p i32) (result i32) (i32.store (local.get $p) (i32.const 7)) (i32.const 1))
    (func (export "f") (result i32) (local $x i32)
      (local.set $x (i32.load (i32.const 0)))
      (if (result i32) (call $w (i32.const 0))
        (then (local.get $x))
        (else (i32.const -1)))))`
  assert.equal(run(clash).f(), 0, 'x captures the PRE-call load, not the stored 7')
})

test('mergeCopyThroughTee: copy fuses into a dominating tee; same-statement reads block', () => {
  const src = `(module (memory 1)
    (func (export "f") (param $p i32) (result i32) (local $a i32) (local $b i32)
      (i32.store (i32.const 0) (local.tee $b (i32.add (local.get $p) (i32.const 5))))
      (local.set $a (local.get $b))
      (i32.add (local.get $a) (i32.load (i32.const 0)))))`
  assert.equal(run(src).f(10), 30)
  // $a read within the tee's own statement AFTER the tee — renaming would corrupt it
  const evalOrder = `(module (memory 1)
    (func (export "g") (param $p i32) (result i32) (local $a i32) (local $b i32)
      (local.set $a (i32.const 3))
      (i32.store (local.tee $b (local.get $p)) (local.get $a))
      (local.set $a (local.get $b))
      (i32.add (local.get $a) (i32.load (local.get $p)))))`
  assert.equal(run(evalOrder).g(8), 11, 'store writes 3 (old $a), not the renamed value')
})

test('call effect summary is transitive through the call graph', () => {
  // h→g→store: sinking h's result across a load must NOT happen
  const src = `(module (memory 1)
    (func $g (i32.store (i32.const 0) (i32.const 9)))
    (func $h (result i32) (call $g) (i32.const 1))
    (func (export "f") (result i32) (local $x i32) (local $y i32)
      (local.set $x (call $h))
      (local.set $y (i32.load (i32.const 0)))
      (i32.sub (local.get $y) (local.get $x))))`
  assert.equal(run(src).f(), 8, 'y loads post-call 9: 9 - 1')
})

test('if→select: arm must not read state the condition writes; no speculated loads', () => {
  // the if evaluated its CONDITION first; select evaluates arms first — an arm
  // reading a local the condition tees would see the stale pre-tee value
  // (jz self-host kernel: a NaN-boxed pointer read before its tee → one wrong byte)
  const teeCond = `(module
    (func $id (param $v i32) (result i32) (local.get $v))
    (func (export "f") (result i32) (local $x i32)
      (if (result i32) (local.tee $x (call $id (i32.const 7)))
        (then (local.get $x))
        (else (i32.const -1)))))`
  assert.equal(run(teeCond).f(), 7, 'arm reads the post-tee value')
  // select runs BOTH arms — an out-of-bounds load in the untaken arm is a new trap
  const specLoad = `(module (memory 1) (func (export "g") (param $p i32) (result i32)
    (if (result i32) (local.get $p)
      (then (i32.load (i32.const 500000)))
      (else (i32.const -1)))))`
  assert.equal(run(specLoad).g(0), -1, 'untaken OOB load must not trap')
})

test('propagate: in-place if-cond substitution reports change — no stale-count orphan', () => {
  // jz self-host kernel reduction: FP substitutes a copy into an if CONDITION
  // (interior mutation, same root — a root compare misses it and skips the
  // use-count refresh), then sinkSets judged the copy source single-use on stale
  // counts and deleted its store, orphaning the freshly-substituted read (which
  // then read 0 — the kernel dispatched a numeric key as a string key).
  const src = `(module (memory 1)
    (func $k (param $v f64) (result i32) (i32.store (i32.const 4) (i32.const 1)) (f64.lt (local.get $v) (f64.const 5)))
    (func $ga (param $v f64) (result f64) (i32.store (i32.const 8) (i32.const 1)) (f64.add (local.get $v) (f64.const 10)))
    (func $gb (param $v f64) (result f64) (f64.load (i32.const 0)))
    (func (export "f") (param $av f64) (result f64)
      (local $inl f64) (local $t f64) (local $r f64)
      (block $exit
        (loop $L
          (if (call $k
                (block (result f64)
                  (local.set $inl (local.get $av))
                  (block (result f64)
                    (local.set $t (local.get $inl))
                    (if (result f64) (call $k (local.get $t))
                      (then (call $ga (local.get $t)))
                      (else (call $gb (local.get $t)))))))
            (then (local.set $r (f64.const 100)) (br $exit))
            (else (local.set $r (f64.const 200))))
          (br $exit)))
      (local.get $r)))`
  assert.equal(run(src).f(7), 100, 'k(7)=0 → gb → load(0)=0 → k(0)=1 → then-arm')
})

test('outline: repeated pure expressions extract into one shared helper', () => {
  const H = '(i32.xor (i32.mul (i32.and (local.get $$) (i32.const 16777215)) (i32.const 2654435761)) (i32.const 40503))'
  const at = (v) => H.replaceAll('$$', v)
  const src = `(module (memory 1)
    (func (export "f") (param $a i32) (param $b i32) (result i32)
      (i32.add ${at('$a')} ${at('$b')}))
    (func (export "g") (param $x i32) (result i32) ${at('$x')}))`
  const { f, g } = run(src)
  const h = (v) => (Math.imul(v & 16777215, 2654435761) ^ 40503) | 0
  assert.equal(f(2, 3), (h(2) + h(3)) | 0)
  assert.equal(g(300), h(300))
  const txt = print(optimize(parse(src)))
  assert((txt.match(/i32\.mul/g) || []).length <= 1, 'the repeated hash shape computes in one place')
  // an effectful expression must never be shared — each site's tee is its own
  const impure = `(module
    (func (export "h") (param $a i32) (result i32) (local $t i32)
      (i32.add (i32.add (local.tee $t (i32.const 5)) (i32.const 300009))
               (i32.add (local.tee $t (i32.const 6)) (i32.const 300009)))))`
  assert.equal(run(impure).h(0), 5 + 300009 + 6 + 300009)
})

test('cse: an effect-clean call dedupes like any pure subtree', () => {
  // The callee reads only its args — the interprocedural summary proves it
  // writes nothing, so two identical calls compute once (colorpq's duplicated
  // spow(L/10000, nv) numerator/denominator pair).
  const src = `(module
    (func $sq (param $x f64) (result f64) (f64.mul (local.get $x) (local.get $x)))
    (func (export "f") (param $a f64) (result f64)
      (f64.div
        (f64.add (f64.const 1) (call $sq (f64.mul (local.get $a) (f64.const 0.0001))))
        (f64.add (f64.const 2) (call $sq (f64.mul (local.get $a) (f64.const 0.0001)))))))`
  const { f } = run(src)
  const ref = (a) => { const s = (a * 0.0001) * (a * 0.0001); return (1 + s) / (2 + s) }
  assert.equal(f(3), ref(3))
  const txt = print(optimize(parse(src)))
  const calls = (txt.match(/call \$sq/g) || []).length
  assert.ok(calls <= 1, `identical effect-clean calls compute once (got ${calls})`)
})

test('cse: a global-writing callee never dedupes (each call observes state)', () => {
  const src = `(module
    (global $n (mut i32) (i32.const 0))
    (func $next (result i32)
      (global.set $n (i32.add (global.get $n) (i32.const 1)))
      (global.get $n))
    (func (export "f") (result i32)
      (i32.add (call $next) (call $next))))`
  const { f } = run(src)
  assert.equal(f(), 3, 'two distinct calls: 1 + 2')
  const opt = run(print(optimize(parse(src))))
  assert.equal(opt.f(), 3, 'still 3 after optimize — the pair must NOT collapse')
})

test('cse: a memory-reading callee is fenced by an intervening store', () => {
  const src = `(module (memory 1)
    (func $rd (param $p i32) (result i32) (i32.load (local.get $p)))
    (func (export "f") (param $p i32) (result i32)
      (local $a i32)
      (local.set $a (call $rd (local.get $p)))
      (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.const 5)))
      (i32.add (local.get $a) (call $rd (local.get $p)))))`
  const { f } = run(src)
  assert.equal(f(0), 5, '0 + (0+5)')
  const opt = run(print(optimize(parse(src))))
  assert.equal(opt.f(0), 5, 'the second read sees the store — no stale reuse')
})

test('cse: a value live before an if is reused inside both arms (cross-block GVN)', () => {
  const src = `(module (memory 1)
    (func (export "f") (param $p i32) (param $q i32) (result i32)
      (i32.store (i32.const 0) (i32.mul (i32.add (local.get $p) (i32.const 12345)) (i32.const 7)))
      (if (result i32) (local.get $q)
        (then (i32.mul (i32.add (local.get $p) (i32.const 12345)) (i32.const 7)))
        (else (i32.sub (i32.const 0) (i32.mul (i32.add (local.get $p) (i32.const 12345)) (i32.const 7)))))))`
  const { f } = run(src)
  const v = (p) => Math.imul((p + 12345) | 0, 7)
  assert.equal(f(3, 1), v(3))
  assert.equal(f(3, 0), -v(3))
  const txt = print(optimize(parse(src)))
  assert.equal((txt.match(/i32\.mul/g) || []).length, 1, 'the repeated expression computes once, arms reuse it')
  // a loop body must NOT inherit: the tee'd value goes stale on iteration 2
  const loop = `(module (func (export "g") (param $n i32) (result i32) (local $x i32) (local $s i32)
    (local.set $s (i32.add (i32.mul (local.get $x) (i32.const 33333)) (i32.const 5)))
    (loop $L
      (local.set $s (i32.add (local.get $s) (i32.add (i32.mul (local.get $x) (i32.const 33333)) (i32.const 5))))
      (local.set $x (i32.add (local.get $x) (i32.const 1)))
      (br_if $L (i32.lt_s (local.get $x) (local.get $n))))
    (local.get $s)))`
  assert.equal(run(loop).g(3), 5 + (0 * 33333 + 5) + (1 * 33333 + 5) + (2 * 33333 + 5))
})

test('cse inheritance: a condition that rewrites a local kills the inherited value', () => {
  const src = `(module (memory 1)
    (func (export "f") (param $p i32) (result i32) (local $x i32)
      (local.set $x (i32.const 2))
      (i32.store (i32.const 0) (i32.mul (i32.add (local.get $x) (i32.const 30000)) (i32.const 7)))
      (if (result i32) (i32.eqz (local.tee $x (local.get $p)))
        (then (i32.mul (i32.add (local.get $x) (i32.const 30000)) (i32.const 7)))
        (else (i32.const -1)))))`
  const { f } = run(src)
  assert.equal(f(0), (0 + 30000) * 7, 'arm recomputes with the post-tee value, never reuses pre-cond')
  assert.equal(f(9), -1)
})

test('devirt: hoisted slot extraction (producer LICM) + param-coalesced closure local', () => {
  // jz -O3 shape: the closure select is register-coalesced onto a PARAM, and the
  // slot extraction is LICM-hoisted into a single-assignment local the loop reads.
  // Devirt must resolve the index local through its one assignment and guard on
  // INDEX equality (the exact dispatch value) — behavior-identical for any value.
  const src = `(module
    (type $sig (func (param f64) (result f64)))
    (func $dbl (param $x f64) (result f64) (f64.mul (local.get $x) (f64.const 2)))
    (func $sqr (param $x f64) (result f64) (f64.mul (local.get $x) (local.get $x)))
    (table 2 funcref)
    (elem (i32.const 0) func $dbl $sqr)
    (func (export "main") (param $n i32) (param $m f64) (result f64)
      (local $i i32) (local $s f64) (local $idx i32)
      (local.set $m (f64.reinterpret_i64 (select
        (i64.const 0x7ffd000000000000) (i64.const 0x7ffd000100000000)
        (f64.gt (local.get $m) (f64.const 0)))))
      (local.set $idx (i32.wrap_i64 (i64.and (i64.shr_u
        (i64.reinterpret_f64 (local.get $m)) (i64.const 32)) (i64.const 32767))))
      (block $brk (loop $l
        (br_if $brk (i32.ge_s (local.get $i) (local.get $n)))
        (local.set $s (f64.add (local.get $s)
          (call_indirect (type $sig) (f64.convert_i32_s (local.get $i)) (local.get $idx))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
      (local.get $s)))`
  // devirt in isolation: the full pipeline's propagate may fold the select into
  // the extraction before devirt sees it (a different, conservative-skip shape);
  // the producer-real split shape is what this pins.
  const opt = devirt(parse(src))
  const txt = print(opt)
  assert.ok(/\(call \$dbl/.test(txt) && /\(call \$sqr/.test(txt), 'both candidates direct-called under index guards')
  assert.ok(/call_indirect/.test(txt), 'original call_indirect kept as the fallback arm')
  const { main } = run(print(opt))
  assert.equal(main(100, 1), 9900, 'dbl arm: 2*(0+..+99)')
  assert.equal(main(100, -1), 328350, 'sqr arm: sum of squares 0..99')
  assert.equal(main(0, 1), 0)
})

test('cse: a re-tee between two sites of one statement kills the group (intra-statement write order)', () => {
  // jz's Math.round(x) + Math.round(-x) shape after local coalescing: ONE statement
  // holds two textually-identical `(f64.eq (get $n) (f64.sub (get $t) 0.5))` subtrees,
  // but the second select's own true-arm RE-TEES $t/$n between them. Statement-level
  // invalidation runs after the whole statement, so only the evaluation-order write
  // clock can see it — grouping the two would reuse the FIRST comparison for the
  // second (bump-misrouting: round(3.5)+round(-3.5) returned 0/2, never 1).
  const src = `(module
    (func (export "f") (param $x f64) (result f64) (local $t f64) (local $n f64)
      (f64.add
        (select
          (f64.add (local.tee $n (f64.nearest (local.tee $t (local.get $x)))) (f64.const 1))
          (local.get $n)
          (f64.eq (local.get $n) (f64.sub (local.get $t) (f64.const 0.5))))
        (select
          (f64.add (local.tee $n (f64.nearest (local.tee $t (f64.neg (local.get $x))))) (f64.const 1))
          (local.get $n)
          (f64.eq (local.get $n) (f64.sub (local.get $t) (f64.const 0.5)))))))`
  const { f } = run(src)
  assert.equal(f(3.5), 1, 'round-half-up pair: 4 + -3 (stale shared condition gives 0 or 2)')
  assert.equal(f(2), 0, 'integer input: 2 + -2, no bumps')
  assert.equal(f(-3.5), 1, 'sign-flipped pair: -3 + 4')
})

test('deadset: const store overwritten in every dispatch arm before any read drops', () => {
  // the inliner zero-init shape: temps zeroed at loop-body top, every READ
  // sits inside the one arm that overwrites them first
  const src = `(module (func (export "f") (param $n i32) (result i32)
    (local $t i32) (local $s i32) (local $i i32)
    (block $B (loop $L
      (br_if $B (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $t (i32.const 0))
      (if (i32.and (local.get $i) (i32.const 1))
        (then
          (local.set $t (i32.mul (local.get $i) (i32.const 3)))
          (local.set $s (i32.add (local.get $s) (local.get $t))))
        (else
          (local.set $t (i32.add (local.get $i) (i32.const 5)))
          (local.set $s (i32.add (local.get $s) (local.get $t)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))
    (local.get $s)))`
  const out = print(optimize(parse(src), 'deadset')).replace(/\s+/g, ' ')
  assert(!out.includes('(local.set $t (i32.const 0))'), 'dead zero-init dropped')
  // behavior: sum over 0..5 of (odd ? 3i : i+5)
  const ref = (n) => { let s = 0; for (let i = 0; i < n; i++) s += (i & 1) ? i * 3 : i + 5; return s }
  const run = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), 'deadset')))).exports
  assert.equal(run.f(6), ref(6), 'values exact')
})

test('deadset: a read-first arm keeps the store (the zero IS the else-value)', () => {
  const src = `(module (func (export "g") (param $n i32) (result i32)
    (local $t i32)
    (local.set $t (i32.const 0))
    (if (i32.gt_s (local.get $n) (i32.const 2))
      (then (local.set $t (i32.const 9))))
    (local.get $t)))`
  const out = print(optimize(parse(src), 'deadset')).replace(/\s+/g, ' ')
  assert(out.includes('(local.set $t (i32.const 0))'), 'live zero kept — one arm never writes')
  const run = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), 'deadset')))).exports
  assert.equal(run.g(1), 0)
  assert.equal(run.g(3), 9)
})

test('deadset: loop back-edge counts the body-top re-store as the killer', () => {
  // t zeroed at body top, read AFTER the loop → the back-edge path is killed
  // by the re-execution of the store itself, but the EXIT path reads t → keep
  const src = `(module (func (export "h") (param $n i32) (result i32)
    (local $t i32) (local $i i32)
    (block $B (loop $L
      (br_if $B (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $t (i32.const 0))
      (local.set $t (local.get $i))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))
    (local.get $t)))`
  const out = print(optimize(parse(src), 'deadset')).replace(/\s+/g, ' ')
  // the zero-init IS dead: overwritten by the very next statement on every path
  assert(!out.includes('(local.set $t (i32.const 0))'), 'zero killed by immediate overwrite')
  const run = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), 'deadset')))).exports
  assert.equal(run.h(4), 3, 'last iteration value survives')
})

test('deadset: store read through a br_if exit path stays', () => {
  const src = `(module (func (export "k") (param $n i32) (result i32)
    (local $t i32) (local $i i32)
    (local.set $t (i32.const 7))
    (block $B
      (br_if $B (i32.eqz (local.get $n)))
      (local.set $t (i32.const 1)))
    (local.get $t)))`
  const out = print(optimize(parse(src), 'deadset')).replace(/\s+/g, ' ')
  assert(out.includes('(local.set $t (i32.const 7))'), 'exit path reads the 7')
  const run = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), 'deadset')))).exports
  assert.equal(run.k(0), 7)
  assert.equal(run.k(2), 1)
})

test('deadset: exception edge to a reading catch keeps the store', () => {
  // `set x 1e6 → try { call (throws) → set x 0 } catch → get x`: the linear
  // scan reaches the killer store, but the call's exception edge lands at the
  // catch label with 1e6 LIVE. Both the scan-through case (candidate before
  // the try) and the inside-candidate case (candidate within the body) keep.
  const src = `(module
    (tag $e)
    (func $boom (throw $e))
    (func (export "f") (result i32)
      (local $x i32)
      (local.set $x (i32.const 1000000))
      (block $catch
        (try_table (catch_all $catch)
          (call $boom)
          (local.set $x (i32.const 0))))
      (local.get $x)))`
  const out = print(optimize(parse(src), 'deadset')).replace(/\s+/g, ' ')
  assert(out.includes('(local.set $x (i32.const 1000000))'), 'catch path reads the pre-try value')
  const run = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src))))).exports
  assert.equal(run.f(), 1000000, 'exception path observes the first store')
  // control: with no read after the catch join, both stores are dead → drop
  const dead = `(module
    (tag $e)
    (func $boom (throw $e))
    (func (export "g") (result i32)
      (local $x i32)
      (local.set $x (i32.const 1000000))
      (block $catch
        (try_table (catch_all $catch)
          (call $boom)
          (local.set $x (i32.const 0))))
      (i32.const 3)))`
  const out2 = print(optimize(parse(dead), 'deadset')).replace(/\s+/g, ' ')
  assert(!out2.includes('1000000'), 'no read anywhere — the store still drops')
})

test('branch: constant-index br_table folds to the selected br (unsigned, OOR → default)', () => {
  // a chainTable'd dispatch whose scrutinee folds post-inline must keep
  // folding like the if-chain it replaced — dead arms must not freeze
  const mk = (k) => `(module (func (export "f") (result i32)
    (block $out (result i32)
      (block $d
        (block $l2
          (block $l1
            (block $l0
              (br_table $l0 $l1 $l2 $d (i32.const ${k})))
            (br $out (i32.const 10)))
          (br $out (i32.const 11)))
        (br $out (i32.const 12)))
      (i32.const 99))))`
  for (const [k, want] of [[0, 10], [1, 11], [2, 12], [3, 99], [7, 99], [-1, 99]]) {
    const out = print(optimize(parse(mk(k)), 'branch'))
    assert(!out.includes('br_table'), `k=${k}: table folded`)
    const run = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(mk(k)))))).exports
    assert.equal(run.f(), want, `k=${k}`)
  }
})

test('unclamp+intguard: convert-wrapped select-read with a DEFINING tee guard collapses fully', () => {
  // The interpreter register-file shape: ToInt32(checked reg[a]) where the
  // select-form read wraps its load in f64.convert (int elements) and the
  // clamp's guard slot is the defining `local.tee $tbn (i32.lt_u a (tee $o
  // len))` — with $o REUSED by the arm's store guard. unclamp moves the tee
  // into the if condition (5.7.1); intguard rule 5 then retires the whole
  // f64 detour. End state is C's: one bounds branch + a raw i32 load.
  const src = `(module
    (memory (export "memory") 1)
    (func (export "f") (param $reg i32) (param $a i32) (param $b i32) (result i32)
      (local $tbn i32) (local $o i32) (local $inf f64) (local $tw i32) (local $tbi i32)
      (local.set $tw
        (i32.mul
          (select
            (i32.wrap_i64 (i64.trunc_sat_f64_s
              (local.tee $inf
                (select
                  (f64.convert_i32_s (i32.load (i32.add (local.get $reg)
                    (i32.shl (select (local.get $a) (i32.const 0)
                      (local.tee $tbn (i32.lt_u (local.get $a)
                        (local.tee $o (i32.shr_u (i32.load (i32.sub (local.get $reg) (i32.const 8))) (i32.const 2))))))
                      (i32.const 2)))))
                  (f64.const nan:0x7FF8000200000000)
                  (local.get $tbn)))))
            (i32.const 0)
            (f64.ne (local.get $inf) (f64.const inf)))
          (local.get $b)))
      (if (i32.lt_u (local.tee $tbi (local.get $a)) (local.get $o))
        (then (i32.store (i32.add (local.get $reg) (i32.shl (local.get $tbi) (i32.const 2))) (local.get $tw))))
      (local.get $tw)))`
  const out = print(optimize(parse(src), { profile: 'speed' }))
  assert(!out.includes('select'), 'no select survives')
  assert(!out.includes('trunc_sat'), 'no ToInt32 machinery survives')
  assert(!out.includes('convert'), 'no f64 detour survives')
  assert(out.includes('i32.lt_u'), 'the bounds branch remains')
  // behavioral: in-bounds read×mul + guarded store; OOB → 0 (ToInt32(undefined))
  const mk = (m) => new WebAssembly.Instance(new WebAssembly.Module(compile(m)), {}).exports
  const init = (e) => { const mem = new Int32Array(e.memory.buffer); mem[0] = 4 << 2; mem[2] = 7; mem[3] = 9 } // len header at reg−8 (reg=8): 4 elems
  for (const [a, b] of [[0, 3], [1, 5], [9, 5]]) {
    const A = mk(optimize(parse(src), { profile: 'speed' })), B = mk(parse(src))
    init(A); init(B)
    assert.equal(A.f(8, a, b), B.f(8, a, b), `f(8,${a},${b})`)
  }
})

test('fold: hex-float constants parse exactly (0x1p-1022 · 0x1p53 ≠ NaN)', () => {
  // Number('0x1p-1022') is NaN in JS — getConst must read WAT hex-float text
  // through f64.parse or the fold poisons the product (broke $math.pow's
  // subnormal scaling in jz-compiled modules).
  const src = `(module (func (export "f") (result f64)
    (f64.mul (f64.const 0x1p-1022) (f64.const 0x1p53))))`
  const run = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), 'fold')))).exports
  assert.equal(run.f(), 2 ** -969, 'hex-float product folds bit-exactly')
  const src32 = `(module (func (export "g") (result f32)
    (f32.mul (f32.const 0x1p-64) (f32.const 0x1p32))))`
  const run2 = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src32), 'fold')))).exports
  assert.equal(run2.g(), 2 ** -32, 'f32 hex-float product folds')
})

test('unclamp: select-clamped checked read → if-form (speed profile; default off)', () => {
  const src = `(module
    (memory 1)
    (func $f (export "f") (param $i i32) (param $len i32) (param $base i32) (result f64)
      (local $bi i32) (local $bn i32)
      (local.set $bn (i32.lt_u (local.tee $bi (local.get $i)) (local.get $len)))
      (select
        (f64.load (i32.add (local.get $base)
          (i32.shl (select (local.get $bi) (i32.const 0) (local.get $bn)) (i32.const 3))))
        (f64.const nan)
        (local.get $bn))))`
  const on = print(optimize(parse(src), { profile: 'speed' }))
  assert(!on.includes('select'), 'speed profile unclamps')
  assert(on.includes('(if'), 'if-form emitted')
  const off = print(optimize(parse(src)))
  assert(off.includes('select'), 'default keeps the branch-free form')
  // behavioral: in-bounds reads the element, OOB yields the else arm
  const m = new WebAssembly.Instance(new WebAssembly.Module(compile(optimize(parse(src), { profile: 'speed' }))), {}).exports
  const r = new WebAssembly.Instance(new WebAssembly.Module(compile(parse(src))), {}).exports
  for (const [i, len] of [[0, 4], [9, 4]]) {
    const a = m.f(i, len, 0), b = r.f(i, len, 0)
    assert((Number.isNaN(a) && Number.isNaN(b)) || a === b, `f(${i},${len})`)
  }
})
