// ;;@ file:line:col source-location annotations → .sourceMap (issue #11)
// Conventions verified differentially against binaryen 132.0.0 (wasm-as/emitBinary):
// generated column = absolute byte offset in the binary, single generated line;
// ;;@ line is 1-based (stored 0-based in the map), column stored as-is;
// bare ;;@ emits a 1-field (mapped-to-nothing) segment; 4th `:symbol` field → names.
// Divergence (documented): watr keeps a location sticky until the next ;;@ (#line
// semantics) and closes it at the end of the code section; binaryen auto-clears
// after each annotated expression.
import t, { is, ok, same, throws } from 'tst'
import compile, { size, sourceMapURL } from '../src/compile.js'
import parse from '../src/parse.js'
import print from '../src/print.js'
import { compile as tcompile } from '../watr.js'
import { compile as wasmCompile, isWasm } from './runner.js'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// independent source-map v3 mappings decoder (single generated line):
// → [[byteOffset, srcIdx, line0, col0, nameIdx?] | [byteOffset]]
const decode = (mappings) => {
  const segs = []
  let f = [0, 0, 0, 0, 0]
  for (const chunk of mappings.split(',')) {
    if (!chunk) continue
    const vals = []
    let val = 0, shift = 0
    for (const ch of chunk) {
      const d = B64.indexOf(ch)
      val |= (d & 31) << shift
      if (d & 32) shift += 5
      else vals.push(val & 1 ? -(val >>> 1) : val >>> 1), val = 0, shift = 0
    }
    f[0] += vals[0]
    if (vals.length === 1) segs.push([f[0]])
    else {
      f[1] += vals[1], f[2] += vals[2], f[3] += vals[3]
      segs.push(vals.length > 4 ? [f[0], f[1], f[2], f[3], f[4] += vals[4]] : [f[0], f[1], f[2], f[3]])
    }
  }
  return segs
}

t('sourcemap: binaryen differential fixture', () => {
  // binaryen 132.0.0 for this module emits mappings "yBACG,EAEE,C,OCMJ,E" —
  // decoded [[25,0,1,3],[27,0,3,5],[28],[35,1,9,1],[37]]. watr matches except the
  // final clear: sticky location closes at end of code section (39), not at the
  // instruction after the annotated one (37).
  const wasm = compile(`(module
    (func $f (result i32)
      ;;@ src.ts:2:3
      (i32.const 42)
      ;;@ src.ts:4:5
      drop
      ;;@
      (i32.const 7)
    )
    (func $g (result i32)
      (i32.const 1)
      ;;@ other.ts:10:1
      (i32.const 2)
      i32.add
    )
  )`)

  const map = wasm.sourceMap
  is(map.version, 3)
  same(map.sources, ['src.ts', 'other.ts'])
  same(map.names, [])

  const segs = decode(map.mappings)
  is(segs.length, 5)
  // ;;@ src.ts:2:3 → i32.const 42
  same(segs[0].slice(1), [0, 1, 3], 'line 1-based → 0-based, col as-is')
  is(wasm[segs[0][0]], 0x41), is(wasm[segs[0][0] + 1], 42)
  // ;;@ src.ts:4:5 → drop
  same(segs[1].slice(1), [0, 3, 5])
  is(wasm[segs[1][0]], 0x1a)
  // bare ;;@ → 1-field clear at i32.const 7
  is(segs[2].length, 1)
  is(wasm[segs[2][0]], 0x41), is(wasm[segs[2][0] + 1], 7)
  // ;;@ other.ts:10:1 → i32.const 2 in $g ($f's clear stays: i32.const 1 unmapped)
  same(segs[3].slice(1), [1, 9, 1])
  is(wasm[segs[3][0]], 0x41), is(wasm[segs[3][0] + 1], 2)
  // final clear right past the code section (last byte before it = $g's end opcode)
  is(segs[4].length, 1)
  is(wasm[segs[4][0] - 1], 0x0b)

  // annotated build is still a valid, working module
  const { exports: e } = new WebAssembly.Instance(new WebAssembly.Module(wasm))
  is(e ? 1 : 0, 1)
})

t('sourcemap: symbol names → names array (5-field segments)', () => {
  const wasm = compile(`(func (result i32)
    ;;@ a.ts:5:1:foo.bar
    (i32.const 1)
    ;;@ a.ts:6:2:baz
    drop
    ;;@ a.ts:7:3:foo.bar
    (i32.const 2))`)
  same(wasm.sourceMap.names, ['foo.bar', 'baz'], 'deduped, first-use order')
  const segs = decode(wasm.sourceMap.mappings)
  same(segs.slice(0, 3).map(s => s[4]), [0, 1, 0], 'name index per segment')
})

t('sourcemap: sticky #line semantics — one segment covers following instructions', () => {
  const wasm = compile(`(func (export "f") (result i32)
    ;;@ a.ts:1:0
    i32.const 1
    i32.const 2
    i32.add)`)
  const segs = decode(wasm.sourceMap.mappings)
  is(segs.length, 2, 'one mapping + final clear')
  same(segs[0].slice(1), [0, 0, 0])
})

t('sourcemap: folded expression — mapping starts at first child (binaryen parity)', () => {
  // binaryen 132.0.0: [[24,0,4,1],[29]] — annotation before (i32.add …) covers
  // the whole subtree from the first emitted child opcode
  const wasm = compile(`(module (func $f (result i32)
    ;;@ a.ts:5:1
    (i32.add (i32.const 1) (i32.const 2))
  ))`)
  const segs = decode(wasm.sourceMap.mappings)
  same(segs[0].slice(1), [0, 4, 1])
  is(wasm[segs[0][0]], 0x41, 'starts at first i32.const, not at i32.add')
  is(wasm[segs[0][0] + 4], 0x6a, 'i32.add within the covered range')
})

t('sourcemap: module-level ;;@ flows into next defined function', () => {
  const wasm = compile(`(module
    (import "e" "imp" (func))
    ;;@ a.ts:3:0
    (func $f (result i32)
      (local i64)
      (i32.const 5)
    )
  )`)
  const segs = decode(wasm.sourceMap.mappings)
  same(segs[0].slice(1), [0, 2, 0])
  is(wasm[segs[0][0]], 0x41, 'past locals vec, lands on first instruction')
  is(wasm[segs[0][0] + 1], 5)
})

t('sourcemap: ;;@ between func head and params', () => {
  const wasm = compile(`(func ;;@ a.ts:1:1
    (param i32) (result i32)
    local.get 0)`)
  const segs = decode(wasm.sourceMap.mappings)
  same(segs[0].slice(1), [0, 0, 1])
  is(wasm[segs[0][0]], 0x20)
})

t('sourcemap: no annotations → no .sourceMap; plain/malformed comments dropped', () => {
  is(compile(`(func (result i32) i32.const 1)`).sourceMap, undefined)
  const wasm = compile(`(func (result i32)
    ;; plain comment
    ;;@ not-an-annotation
    ;;@ missing:col
    (; block ;) i32.const 1)`)
  is(wasm.sourceMap, undefined, 'non-matching ;;@ stays an ordinary comment')
  is(new WebAssembly.Instance(new WebAssembly.Module(wasm)) ? 1 : 0, 1)
})

t('sourcemap: repeated clears collapse, leading clear ignored', () => {
  const wasm = compile(`(func (result i32)
    ;;@
    i32.const 1
    ;;@ a.ts:1:0
    drop
    ;;@
    i32.const 2
    ;;@
    drop
    (i32.const 3))`)
  const segs = decode(wasm.sourceMap.mappings)
  is(segs.length, 2, 'leading + repeated clears emit nothing extra')
  same(segs[0].slice(1), [0, 0, 0])
  is(segs[1].length, 1)
})

t('sourcemap: size() parity with annotated source', () => {
  const src = `(module (func (export "f") (param i32) (result i32)
    (local f64)
    ;;@ a.ts:1:0
    local.get 0
    ;;@ a.ts:2:0
    (i32.add (i32.const 1))))`
  is(size(src), compile(src).length)
})

t('sourcemap: sourceMapURL appends spec-shaped custom section', () => {
  const wasm = compile(`(func (export "f") (result i32) ;;@ a.ts:1:0
    (i32.const 42))`)
  const w2 = sourceMapURL(wasm, 'module.wasm.map')
  // binaryen 132.0.0 emits the same tail: 00 <size> 10 "sourceMappingURL" 0f <url>
  const name = 'sourceMappingURL', url = 'module.wasm.map'
  same([...w2.slice(wasm.length)], [
    0, 1 + name.length + 1 + url.length,
    name.length, ...[...name].map(c => c.charCodeAt(0)),
    url.length, ...[...url].map(c => c.charCodeAt(0)),
  ])
  const { exports: e } = new WebAssembly.Instance(new WebAssembly.Module(w2))
  is(e.f(), 42, 'appended section keeps the module valid')
})

t('sourcemap: compile error reports original position from nearest ;;@', () => {
  throws(() => compile(`(func (result i32)
    ;;@ src.ts:3:7
    (i32.wrong 1))`), /src\.ts:3:7/)
  // bare ;;@ clears — no original-position suffix
  try {
    compile(`(func (result i32)
      ;;@ src.ts:3:7
      i32.const 1
      ;;@
      (i32.wrong 1))`)
    ok(false, 'should have thrown')
  } catch (e) {
    ok(!/src\.ts/.test(e.message), 'cleared annotation not reported')
  }
})

t('sourcemap: survives print roundtrip and AST/template paths', () => {
  const src = `(module (func $f (result i32)
    ;;@ a.ts:2:1
    (i32.const 42)))`
  const direct = compile(src)
  // AST path (no source string)
  same(compile(parse(src)).sourceMap, direct.sourceMap)
  // template/main-entry path
  same(tcompile(src).sourceMap, direct.sourceMap)
  // print keeps ;;@ comments → recompile maps identically
  same(compile(print(parse(src), { indent: '  ', newline: '\n' })).sourceMap, direct.sourceMap)
})

t('sourcemap: wasm-backend compile of annotated source matches JS bytes', () => {
  const src = `(module (func (export "f") (result i32)
    ;;@ a.ts:2:1
    (i32.const 42)))`
  const js = compile(src), other = wasmCompile(parse(src))
  is(isWasm ? 'wasm' : 'js', isWasm ? 'wasm' : 'js') // label which backend ran
  same([...other], [...js])
})
