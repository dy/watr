// Loop strength reduction (src/optimize.js `lsr`): an address affine in a loop
// counter becomes a pointer advanced with the counter. Every case runs the module
// before and after on the same memory and compares the result, the trap and the
// final memory.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import optimize from '../src/optimize.js'
import { parse, print, compile } from './runner.js'

const exec = (ast, args) => {
  const e = new WebAssembly.Instance(new WebAssembly.Module(compile(ast))).exports
  const mem = new Uint8Array(e.memory.buffer)
  for (let i = 0; i < mem.length; i++) mem[i] = (i * 37 + 11) & 255
  let value
  try { value = e.f(...args) } catch (err) { value = 'trap ' + err.constructor.name }
  let h = 2166136261
  for (let i = 0; i < mem.length; i++) h = Math.imul(h ^ mem[i], 16777619)
  return [value, h >>> 0]
}
// optimize with `opts`, then check every call against the original module
const same = (src, calls, opts = 'lsr') => {
  const out = optimize(parse(src), opts)
  for (const args of calls) assert.deepEqual(exec(out, args), exec(parse(src), args), `f(${args})`)
  return print(out)
}
const loopOf = (wat) => wat.slice(wat.indexOf('(loop'))
const mod = (params, locals, body, result = '(local.get $s)') => `(module (memory (export "memory") 1)
  (func (export "f") ${params} (result i32) ${locals}
    ${body}
    ${result}))`

const SCALED = mod('(param $base i32) (param $o i32) (param $n i32)', '(local $i i32) (local $s i32)', `
  (block $out (loop $L
    (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
    (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $base) (i32.shl (i32.add (local.get $i) (local.get $o)) (i32.const 2))))))
    (i32.store offset=4 (i32.add (local.get $base) (i32.shl (i32.add (local.get $i) (local.get $o)) (i32.const 2))) (local.get $s))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br $L)))`)

test('lsr: a scaled index sum becomes a pointer advanced by the stride', () => {
  // the last call runs past the memory: both versions trap at the same store
  const wat = same(SCALED, [[0, 3, 100], [1000, 0, 37], [64000, 1, 299], [65000, 2, 300], [8, 5, 0], [-64, 16, 40]])
  assert.match(loopOf(wat), /\(i32\.add \(local\.get \$__lsr0\) \(i32\.const 4\)\)/, 'advanced by 4')
  assert.doesNotMatch(loopOf(wat), /i32\.shl/, 'no scaling left in the loop')
  assert.match(wat, /\(i32\.store offset=4\s+\(local\.get \$__lsr0\)/, 'the memarg offset stays')
})

test('lsr: a record stride through a multiply, its fields through the tee', () => {
  const src = mod('(param $base i32) (param $n i32)', '(local $i i32) (local $s i32) (local $r i32)', `
    (block $out (loop $L
      (br_if $out (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $s (i32.add (local.get $s)
        (i32.add (i32.load (local.tee $r (i32.add (local.get $base) (i32.mul (local.get $i) (i32.const 20)))))
                 (i32.load offset=8 (local.get $r)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))`)
  const wat = same(src, [[0, 50], [4, 3000], [100, 3300]])
  assert.doesNotMatch(loopOf(wat), /i32\.mul/)
  assert.match(loopOf(wat), /\(i32\.const 20\)/, 'advanced by the record size')
})

test('lsr: a descending counter and a negative scale', () => {
  const src = mod('(param $base i32) (param $i i32)', '(local $s i32)', `
    (loop $L
      (local.set $s (i32.xor (i32.rotl (local.get $s) (i32.const 5))
        (i32.load8_u (i32.add (local.get $base) (i32.mul (local.get $i) (i32.const -12))))))
      (i32.store8 offset=1 (i32.add (local.get $base) (i32.mul (local.get $i) (i32.const -12))) (local.get $i))
      (br_if $L (i32.gt_s (local.tee $i (i32.sub (local.get $i) (i32.const 3))) (i32.const 0))))`)
  const wat = same(src, [[60000, 1000], [40000, 3], [13000, 2000]])
  assert.doesNotMatch(loopOf(wat), /i32\.mul/)
  assert.match(loopOf(wat), /\(i32\.const 36\)/, 'the counter steps by -3, the address by +36')
})

test('lsr: addresses wrap modulo 2^32 exactly as the scaled index did', () => {
  // base = -64: base + 8*i wraps into low memory for i >= 8
  const src = mod('(param $base i32) (param $n i32)', '(local $i i32) (local $s i32)', `
    (local.set $i (i32.const 8))
    (block $out (loop $L
      (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $s (i32.add (local.get $s)
        (i32.add (i32.load (i32.add (local.get $base) (i32.shl (i32.add (local.get $i) (i32.const 1)) (i32.const 3))))
                 (i32.load (i32.add (local.get $base) (i32.shl (i32.add (local.get $i) (i32.const 2)) (i32.const 3)))))))
      (i32.store (i32.add (local.get $base) (i32.shl (i32.add (local.get $i) (i32.const 1)) (i32.const 3))) (local.get $s))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))`)
  const wat = same(src, [[-64, 40], [-8, 100], [-65536 * 1024, 30], [2147483640, 12]])
  assert.match(loopOf(wat), /\(i32\.add \(local\.get \$__lsr0\) \(i32\.const 8\)\)/, 'one pointer, the other address a constant away')
  assert.doesNotMatch(wat, /offset=8/, 'a constant away stays i32 arithmetic, never a memarg that cannot wrap')
})

test('lsr: an inner pointer starts from the outer loop\'s pointer', () => {
  const src = mod('(param $a i32) (param $n i32)', '(local $i i32) (local $j i32) (local $s i32)', `
    (block $o (loop $I
      (br_if $o (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $j (i32.const 0))
      (block $p (loop $J
        (br_if $p (i32.ge_s (local.get $j) (local.get $n)))
        (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $a)
          (i32.shl (i32.add (i32.mul (local.get $i) (i32.const 16)) (local.get $j)) (i32.const 2))))))
        (i32.store (i32.add (local.get $a) (i32.shl (i32.add (i32.mul (local.get $i) (i32.const 16)) (local.get $j)) (i32.const 2))) (local.get $s))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $J)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $I)))`)
  const wat = same(src, [[0, 16], [256, 10], [1024, 3]])
  assert.doesNotMatch(loopOf(wat), /i32\.mul|i32\.shl/, 'no index arithmetic in either loop')
  assert.match(loopOf(wat), /\(i32\.const 64\)/, 'the outer pointer advances by a row')
})

test('lsr: vector loads and stores', () => {
  const src = mod('(param $a i32) (param $b i32) (param $n i32)', '(local $i i32) (local $s i32)', `
    (block $o (loop $L
      (br_if $o (i32.ge_u (local.get $i) (local.get $n)))
      (v128.store (i32.add (local.get $b) (i32.shl (local.get $i) (i32.const 4)))
        (i32x4.add (v128.load (i32.add (local.get $a) (i32.shl (local.get $i) (i32.const 4))))
                   (v128.load offset=16 (i32.add (local.get $a) (i32.shl (local.get $i) (i32.const 4))))))
      (local.set $i (i32.add (local.get $i) (i32.const 2)))
      (br $L)))`, '(local.get $i)')
  const wat = same(src, [[0, 4096, 200], [32, 32768, 99], [100, 200, 64]])
  assert.match(loopOf(wat), /\(v128\.load offset=16 \(local\.get \$__lsr0\)\)/, 'the loads share a pointer')
  assert.match(loopOf(wat), /\(i32\.const 32\)/, 'two lanes per step: 32 bytes')
  // a scale of 16 is past an address mode's 8: the store's address is two instructions, its pointer one
  assert.doesNotMatch(loopOf(wat), /i32\.shl/)
})

test('lsr: a lone address one instruction forms keeps its index', () => {
  // base + i·8 is one x64 lea (or arm64 add with a shifted operand): a pointer's advance costs the same
  const src = mod('(param $a i32) (param $b i32) (param $n i32)', '(local $i i32) (local $s i32)', `
    (block $o (loop $L
      (br_if $o (i32.ge_u (local.get $i) (local.get $n)))
      (i64.store (i32.add (local.get $b) (i32.shl (local.get $i) (i32.const 3))) (i64.extend_i32_u (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))`, '(local.get $i)')
  assert.equal(print(optimize(parse(src), 'lsr')), print(parse(src)))
})

test('lsr: addresses sharing a temporary are reduced together, the temporary goes', () => {
  const src = mod('(param $a i32) (param $b i32) (param $j i32) (param $n i32)', '(local $i i32) (local $s i32) (local $t i32)', `
    (block $out (loop $L
      (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $a) (i32.shl (local.tee $t (i32.add (i32.add (local.get $i) (local.get $j)) (local.get $n))) (i32.const 2))))))
      (i32.store (i32.add (local.get $b) (i32.shl (local.get $t) (i32.const 2))) (local.get $s))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))`)
  const wat = same(src, [[0, 8192, 3, 500], [400, 4000, 0, 900], [4, 8, 100, 2]])
  assert.doesNotMatch(loopOf(wat), /\$t\b/, 'the shared index is gone')
  assert.match(loopOf(wat), /\(local\.get \$__lsr1\)/, 'two pointers')
})

test('lsr: a pointer that adds a live register past the register file declines', () => {
  // every base also takes a data-dependent index, so a pointer frees nothing: below the
  // register file the two-term addresses pay for pointers, past it they do not
  const loop = (k) => {
    const params = Array.from({ length: k }, (_, b) => `(param $b${b} i32)`).join(' ')
    const body = Array.from({ length: k }, (_, b) => `
      (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $b${b}) (i32.shl (i32.add (local.get $i) (local.get $o)) (i32.const 2))))))
      (local.set $s (i32.xor (local.get $s) (i32.load8_u (i32.add (local.get $b${b}) (i32.and (local.get $s) (i32.const 255))))))`).join('')
    return mod(`${params} (param $o i32) (param $n i32)`, '(local $i i32) (local $s i32)', `
      (block $out (loop $L
        (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
        ${body}
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $L)))`)
  }
  const few = same(loop(2), [[0, 4096, 1, 300]])
  assert.match(loopOf(few), /__lsr/, 'two bases: pointers')
  const many = same(loop(10), [[...Array.from({ length: 10 }, (_, b) => b * 4096), 1, 300]])
  assert.doesNotMatch(loopOf(many), /__lsr/, 'ten bases: the loop keeps its index')
})

test('lsr: copies placed before the loop are one base', () => {
  const src = mod('(param $base i32) (param $n i32)', '(local $i i32) (local $s i32) (local $p i32) (local $q i32)', `
    (local.set $p (local.get $base))
    (local.set $q (local.get $base))
    (block $out (loop $L
      (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $s (i32.add (local.get $s)
        (i32.add (i32.load (i32.add (local.get $p) (i32.mul (local.get $i) (i32.const 12))))
                 (i32.load offset=8 (i32.add (local.get $q) (i32.mul (local.get $i) (i32.const 12)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))`)
  const wat = same(src, [[0, 100], [400, 5000]])
  assert.match(loopOf(wat), /\(i32\.load offset=8 \(local\.get \$__lsr0\)\)/, 'one pointer for both fields')
  assert.doesNotMatch(wat, /__lsr1/)
})

test('lsr: an inner loop\'s pointer start and step are computed once outside the outer loop', () => {
  // the inner loop's stride is invariant in both loops: its scaled value leaves both
  const src = mod('(param $a i32) (param $n i32) (param $step i32)', '(local $i i32) (local $j i32) (local $k i32) (local $s i32)', `
    (block $o (loop $I
      (br_if $o (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $j (i32.const 0))
      (local.set $k (i32.const 0))
      (block $p (loop $J
        (br_if $p (i32.ge_s (local.get $j) (local.get $n)))
        (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $a) (i32.shl (i32.add (local.get $k) (local.get $i)) (i32.const 2))))))
        (i32.store offset=4 (i32.add (local.get $a) (i32.shl (i32.add (local.get $k) (local.get $i)) (i32.const 2))) (local.get $s))
        (local.set $k (i32.add (local.get $k) (local.get $step)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $J)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $I)))`)
  const wat = same(src, [[0, 20, 3], [64, 30, 1], [4, 5, 0]])
  const outer = wat.slice(wat.indexOf('(loop $I'))
  assert.doesNotMatch(outer, /i32\.shl/, 'no scaling left in either loop')
})

test('lsr: a byte stream keeps its index (a pointer would not pay)', () => {
  const src = mod('(param $base i32) (param $n i32)', '(local $i i32) (local $s i32)', `
    (block $out (loop $L
      (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $s (i32.add (i32.mul (local.get $s) (i32.const 31)) (i32.load8_u (i32.add (local.get $base) (local.get $i)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))`)
  assert.equal(print(optimize(parse(src), 'lsr')), print(parse(src)))
})

test('lsr: a step the loop never writes advances by its scaled value, computed once', () => {
  const src = mod('(param $w i32) (param $n i32) (param $step i32)', '(local $j i32) (local $k i32) (local $s i32)', `
    (block $out (loop $L
      (br_if $out (i32.ge_s (local.get $j) (local.get $n)))
      (local.set $s (i32.sub
        (i32.load (i32.add (local.get $w) (i32.shl (local.get $k) (i32.const 3))))
        (i32.load offset=4 (i32.add (local.get $w) (i32.shl (local.get $k) (i32.const 3))))))
      (i32.store (i32.add (local.get $w) (i32.shl (local.get $k) (i32.const 3))) (local.get $s))
      (local.set $k (i32.add (local.get $k) (i32.shl (local.get $step) (i32.const 1))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $L)))`)
  const wat = same(src, [[0, 100, 3], [800, 50, -2], [4, 9, 0], [64, 40, 100]])
  assert.doesNotMatch(loopOf(wat), /i32\.shl/, 'the scaled step is a local set before the loop')
  assert.doesNotMatch(loopOf(wat), /local\.set \$k/, 'a counter only its own step read is gone')
})

test('lsr: a conditional advance and a branch back mid-body', () => {
  const src = mod('(param $base i32) (param $c i32)', '(local $i i32) (local $s i32)', `
    (loop $L
      (if (i32.and (local.get $c) (i32.const 1)) (then (local.set $i (i32.add (local.get $i) (i32.const 1)))))
      (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $base) (i32.shl (local.get $i) (i32.const 2))))))
      (local.set $c (i32.sub (local.get $c) (i32.const 1)))
      (br_if $L (i32.and (i32.gt_s (local.get $c) (i32.const 0)) (i32.eqz (i32.and (local.get $c) (i32.const 6)))))
      (i32.store (i32.add (local.get $base) (i32.shl (local.get $i) (i32.const 2))) (local.get $c))
      (br_if $L (i32.gt_s (local.get $c) (i32.const 0))))`)
  const wat = same(src, [[0, 300], [400, 1000], [4, 7]])
  // the advance takes the write's place in the arm: nothing else read the counter
  assert.match(wat, /\(then\s+\(local\.set \$__lsr0\s+\(i32\.add \(local\.get \$__lsr0\) \(i32\.const 4\)\)/)
  assert.doesNotMatch(loopOf(wat), /local\.set \$i/)
})

test('lsr: temporaries read after the loop keep their values', () => {
  const src = mod('(param $base i32) (param $n i32)', '(local $i i32) (local $s i32) (local $t i32) (local $u i32)', `
    (block $out (loop $L
      (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $s (i32.add (local.get $s) (i32.load (local.tee $t (i32.add (local.get $base) (i32.shl (local.get $i) (i32.const 2)))))))
      (i32.store (local.get $t) (local.get $s))
      (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $base) (i32.shl (local.tee $u (i32.add (local.get $i) (i32.const 3))) (i32.const 2))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $L)))`, '(i32.add (local.get $s) (i32.add (local.get $t) (local.get $u)))')
  same(src, [[0, 100], [512, 7], [16, 1]])
  same(src, [[0, 100], [512, 7]], { lsr: true })
})

test('lsr: a handler or a counter written in an inner loop declines', () => {
  const tried = `(module (memory (export "memory") 1) (tag $e)
    (func (export "f") (param $base i32) (param $n i32) (result i32) (local $i i32) (local $s i32)
      (block $out (loop $L
        (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
        (try_table (catch_all $out) (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $base) (i32.shl (local.get $i) (i32.const 2)))))))
        (i32.store (i32.add (local.get $base) (i32.shl (local.get $i) (i32.const 2))) (local.get $s))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $L)))
      (local.get $s)))`
  assert.equal(print(optimize(parse(tried), 'lsr')), print(parse(tried)))
  const inner = mod('(param $base i32) (param $n i32)', '(local $i i32) (local $s i32)', `
    (block $out (loop $L
      (br_if $out (i32.ge_s (local.get $i) (local.get $n)))
      (local.set $s (i32.add (local.get $s) (i32.load (i32.add (local.get $base) (i32.shl (local.get $i) (i32.const 2))))))
      (i32.store (i32.add (local.get $base) (i32.shl (local.get $i) (i32.const 2))) (local.get $s))
      (loop $K (br_if $K (i32.lt_s (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.and (local.get $s) (i32.const 3)))))
      (br $L)))`)
  assert.doesNotMatch(print(optimize(parse(inner), 'lsr')), /__lsr/)
  same(inner, [[0, 200], [100, 50]])
})

test('lsr: generated loops agree before and after', () => {
  // xorshift: a fixed sequence, so a failure reproduces
  let r = 0x2545f491
  const rnd = (n) => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; return (r >>> 0) % n }
  const pick = (a) => a[rnd(a.length)]
  for (let t = 0; t < 120; t++) {
    const scale = pick([1, 2, 3, 4, 8, 12, 16, 20, -4, -8])
    const shl = scale > 0 && (scale & (scale - 1)) === 0 && rnd(2)
    const idx = (e) => shl ? `(i32.shl ${e} (i32.const ${31 - Math.clz32(scale)}))` : `(i32.mul ${e} (i32.const ${scale}))`
    const step = pick([1, 2, 3, -1, -2, 5])
    const offs = [0, pick([0, 1, 2, -1]), pick([0, 3])]
    const at = (d) => `(i32.add (local.get $base) ${idx(d ? `(i32.add (local.get $i) (i32.const ${d}))` : '(local.get $i)')})`
    const exit = step > 0 ? `(i32.ge_s (local.get $i) (local.get $n))` : `(i32.le_s (local.get $i) (local.get $n))`
    const src = mod('(param $base i32) (param $n i32) (param $i0 i32)', '(local $i i32) (local $s i32)', `
      (local.set $i (local.get $i0))
      (block $out (loop $L
        (br_if $out ${exit})
        (local.set $s (i32.add (i32.rotl (local.get $s) (i32.const 3)) (i32.load16_u ${at(offs[0])})))
        (local.set $s (i32.xor (local.get $s) (i32.load8_u offset=1 ${at(offs[1])})))
        (i32.store16 ${at(offs[2])} (local.get $s))
        (local.set $i (i32.add (local.get $i) (i32.const ${step})))
        (br $L)))`)
    const i0 = rnd(200), n = step > 0 ? i0 + rnd(300) : i0 - rnd(300)
    const base = scale > 0 ? rnd(20000) + 64 : 60000 + rnd(4000)
    same(src, [[base, n, i0], [-base, n, i0], [base + 65536 * 3, n, i0]])
    same(src, [[base, n, i0]], { lsr: true })
  }
})
