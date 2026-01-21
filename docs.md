# watr

Fast WebAssembly Text Format (WAT) compiler for JavaScript/Node.js.

Supports [finished (phase 5)](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md) + [planned (phase 4)](https://github.com/WebAssembly/proposals) features, full [spec syntax](https://webassembly.github.io/spec/core/text/index.html) and passes the [WebAssembly test suite](https://github.com/WebAssembly/testsuite).

Supports partial polyfills.


| Feature | Status | Polyfill |
|---------|--------|----------|
| [MVP](https://webassembly.org/docs/mvp/) | yes | n/a |
| [BigInt / i64](https://github.com/WebAssembly/JS-BigInt-integration) | yes | n/a |
| [Multi-value](https://github.com/WebAssembly/multi-value) | yes | partial (no blocks) |
| [Sign extension](https://github.com/WebAssembly/sign-extension-ops) | yes | yes |
| [Non-trapping conversions](https://github.com/WebAssembly/nontrapping-float-to-int-conversions) | yes | yes |
| [Bulk memory](https://github.com/WebAssembly/bulk-memory-operations) | yes | copy/fill only |
| [Reference types](https://github.com/WebAssembly/reference-types) | yes | funcref only |
| [Typed function refs](https://github.com/WebAssembly/function-references) | yes | yes |
| [Tail calls](https://github.com/WebAssembly/tail-call) | yes | yes |
| [Extended const](https://github.com/WebAssembly/extended-const) | yes | yes |
| [Multiple memories](https://github.com/WebAssembly/multi-memory) | yes | n/a |
| [Memory64](https://github.com/WebAssembly/memory64) | yes | no |
| [SIMD](https://github.com/WebAssembly/simd) | yes | no |
| [Relaxed SIMD](https://github.com/WebAssembly/relaxed-simd) | yes | no |
| [Threads](https://github.com/WebAssembly/threads) | yes | no |
| [GC](https://github.com/WebAssembly/gc) | yes | i31/struct/array/cast |
| [Exceptions](https://github.com/WebAssembly/exception-handling) | yes | no |
| [Annotations](https://github.com/WebAssembly/annotations) | yes | n/a |
| [Wide arithmetic](https://github.com/WebAssembly/wide-arithmetic) | yes | n/a |
| [JS string builtins](https://github.com/WebAssembly/js-string-builtins) | yes | n/a |

**Legend**: `yes` = full support, `partial` = limited, `no` = not feasible, `n/a` = MVP or no runtime impact


## Install

```bash
npm install watr
```

## API

### `` watr`...` ``

Compile and instantiate, returns exports.

```js
import watr from 'watr'

// basic
const { add } = watr`(func (export "add") (param i32 i32) (result i32) (i32.add (local.get 0) (local.get 1)))`
add(2, 3) // 5

// auto-import JS functions
const { test } = watr`(func (export "test") (call \${console.log} (i32.const 42)))`
test() // 42

// interpolate numbers
watr`(global (export "pi") f64 (f64.const \${Math.PI}))`       // f64
watr`(func (export "f") (result i64) (i64.const \${123n}))`    // i64 BigInt

// interpolate config
watr`(memory (export "mem") \${pages})`                        // memory size
watr`(func (export "f") (call \${0}))`                         // indices
watr`(func \${id} ...)`                                        // identifiers

// interpolate binary data
watr`(memory (export "mem") (data \${new Uint8Array([1,2,3])}))`
watr`(data (i32.const 0) \${[1, 2, 3, 4]})`

// interpolate code strings
const ops = '(i32.add (i32.const 1) (i32.const 2))'
watr`(func (export "f") (result i32) \${ops})`

// string argument
watr('(func (export "f") (result i32) (i32.const 42))')
```

### `compile(source, options?)`

Compile to binary. Accepts a string, AST, or template literal.

```js
import { compile } from 'watr'

compile(`(func (export "f"))`)                       // string
compile(['func', ['export', '"f"']])                 // AST
compile`(func (export "f") (f64.const \${Math.PI}))` // template
// Uint8Array

// polyfill newer features to MVP
compile(src, { polyfill: true })           // all features
compile(src, { polyfill: 'funcref' })      // specific features

// optimize
compile(src, { optimize: true })           // all optimizations
compile(src, { optimize: 'fold' })         // specific optimizations

// both
compile(src, { polyfill: true, optimize: true })
```

### `polyfill(ast, options?)`

Transform AST to polyfill newer WebAssembly features for older runtimes.

```js
import { polyfill, parse, compile } from 'watr'

// auto-detect and polyfill all
const ast = polyfill(parse(src))
compile(ast)

// specific features
polyfill(ast, 'funcref')              // space-separated string
polyfill(ast, { funcref: true })      // object
```

**Available polyfills:**

| Feature | Transforms | Notes |
|---------|------------|-------|
| `funcref` | `ref.func` → `i32.const`, `call_ref`/`return_call_ref` → `call_indirect` | Creates hidden table |
| `sign_ext` | `i32.extend8_s` → shift pairs, etc | Shift left + arithmetic shift right |
| `nontrapping` | `i32.trunc_sat_f32_s` → helper function, etc | Injects helper functions |
| `bulk_memory` | `memory.copy`/`fill` → loop helpers | Byte-by-byte loops |
| `return_call` | `return_call` → `return` + `call` | Loses tail call optimization |
| `i31ref` | `ref.i31` → `i32.and`, `i31.get_s/u` → shift/mask | 31-bit tagged integers |
| `extended_const` | `global.get` in initializers → evaluated constant | Compile-time evaluation |
| `multi_value` | Multiple results → single + globals | Partial: functions only, not blocks |
| `gc` | `struct.new/get/set`, `array.new/get/set/len` → memory ops | Bump allocator, type tags |
| `ref_cast` | `ref.test`, `ref.cast`, `br_on_cast` → type tag checks | Runtime tag comparison |

**Not polyfillable:**

| Feature | Reason |
|---------|--------|
| SIMD | Scalar emulation too slow |
| Threads/Atomics | Requires host support |
| Memory64 | Cannot emulate 64-bit address space |
| Exception handling | Complex control flow transforms |
| `externref` | Requires JS-side reference tracking |

### `optimize(ast, options?)`

Optimize AST for smaller size and better performance.

```js
import { optimize, parse, print, compile } from 'watr'

// auto-detect and apply all optimizations
const ast = optimize(parse(src))
compile(ast)

// specific optimizations
optimize(ast, 'fold')                   // constant folding only
optimize(ast, 'treeshake fold')         // multiple optimizations
optimize(ast, { fold: true })           // object form

// can accept string directly
print(optimize('(func (i32.add (i32.const 1) (i32.const 2)))'))
// (func (i32.const 3))
```

**Available optimizations:**

| Optimization | Description | Example |
|--------------|-------------|---------|
| `fold` | Constant folding | `(i32.add (i32.const 1) (i32.const 2))` → `(i32.const 3)` |
| `deadcode` | Remove unreachable code | Code after `unreachable`, `br`, `return` |
| `locals` | Remove unused locals | Locals never read/written |
| `treeshake` | Remove unused definitions | Functions/globals not exported or called |
| `identity` | Remove identity ops | `(i32.add x (i32.const 0))` → `x` |
| `strength` | Strength reduction | `(i32.mul x (i32.const 2))` → `(i32.shl x (i32.const 1))` |
| `branch` | Simplify constant branches | `(if (i32.const 1) A B)` → `A` |
| `propagate` | Constant propagation | `(local.set $x (i32.const 1)) (local.get $x)` → const |
| `inline` | Inline tiny functions | Single-expression functions without locals |

### `parse(source, options?)`

Parse to AST.

```js
import { parse } from 'watr'

parse('(i32.add (i32.const 1) (i32.const 2))')
// ['i32.add', ['i32.const', 1], ['i32.const', 2]]

// options: comments, annotations
parse('(func ;; note\n)', { comments: true })
// ['func', [';', ' note']]
```

### `print(tree, options?)`

Format WAT code or AST to string. Accepts a string or AST array.

```js
import { print } from 'watr'

// prettify string
print('(module(func(export "add")(param i32 i32)(result i32)local.get 0 local.get 1 i32.add))')
// (module
//   (func (export "add") (param i32 i32) (result i32)
//     local.get 0
//     local.get 1
//     i32.add))

// print AST
print(['module', ['func', ['export', '"f"'], ['result', 'i32'], ['i32.const', 42]]])
// (module
//   (func (export "f") (result i32)
//     (i32.const 42)))

// minify
print('(module\n  (func (result i32)\n    (i32.const 42)))', { indent: false, newline: false })
// (module (func (result i32) (i32.const 42)))

// options: indent (default '  '), newline (default '\n'), comments (default true)
```

## Syntax

```wat
;; folded
(i32.add (i32.const 1) (i32.const 2))

;; flat
i32.const 1
i32.const 2
i32.add

;; abbreviations
(func (export "f") ...)           ;; inline export
(func (import "m" "n") ...)       ;; inline import
(memory 1 (data "hello"))         ;; inline data

;; numbers
42  0x2a  0b101010                ;; integers
3.14  6.02e23  0x1.8p+1           ;; floats
inf  -inf  nan  nan:0x123         ;; special
1_000_000                         ;; underscores

;; comments
(; block ;)
```

## Features

#### [BigInt / i64](https://github.com/WebAssembly/JS-BigInt-integration)

```js
watr`(func (export "f") (result i64) (i64.const ${9007199254740993n}))`
watr`(func (export "g") (param i64) (result i64) (i64.mul (local.get 0) (i64.const 2n)))`
```

#### [Multi-value](https://github.com/WebAssembly/multi-value)

```wat
(func (result i32 i32) (i32.const 1) (i32.const 2))
(func (param i32 i32) (result i32 i32) (local.get 1) (local.get 0))  ;; swap
(block (result i32 i32) (i32.const 1) (i32.const 2))
```

#### [Sign extension](https://github.com/WebAssembly/sign-extension-ops)

```wat
(i32.extend8_s (i32.const 0xff))         ;; -1
(i32.extend16_s (i32.const 0xffff))      ;; -1
(i64.extend8_s (i64.const 0xff))         ;; -1
(i64.extend16_s (i64.const 0xffff))      ;; -1
(i64.extend32_s (i64.const 0xffffffff))  ;; -1
```

#### [Non-trapping conversions](https://github.com/WebAssembly/nontrapping-float-to-int-conversions)

```wat
(i32.trunc_sat_f32_s (f32.const 1e30))   ;; clamps instead of trapping
(i32.trunc_sat_f32_u (f32.const -1.0))   ;; 0 instead of trap
(i64.trunc_sat_f64_s (f64.const inf))    ;; max i64 instead of trap
```

#### [Bulk memory](https://github.com/WebAssembly/bulk-memory-operations)

```wat
(memory.copy (i32.const 0) (i32.const 100) (i32.const 10))  ;; dst src len
(memory.fill (i32.const 0) (i32.const 0xff) (i32.const 64)) ;; dst val len
(memory.init $data (i32.const 0) (i32.const 0) (i32.const 4))
(data.drop $data)
(table.copy (i32.const 0) (i32.const 1) (i32.const 2))
(table.init $elem (i32.const 0) (i32.const 0) (i32.const 2))
(elem.drop $elem)
```

#### [Multiple memories](https://github.com/WebAssembly/multi-memory)

```wat
(memory $a 1)
(memory $b 2)
(i32.load $a (i32.const 0))
(i32.store $b (i32.const 0) (i32.const 42))
(memory.copy $a $b (i32.const 0) (i32.const 0) (i32.const 10))
```

#### [Memory64](https://github.com/WebAssembly/memory64)

```wat
(memory i64 1)                           ;; 64-bit memory
(memory i64 1 100)                       ;; with max
(i64.load (i64.const 0))                 ;; 64-bit addresses
(i32.store (i64.const 0x100000000) (i32.const 42))
```

#### [SIMD](https://github.com/WebAssembly/simd)

```wat
(v128.const i32x4 1 2 3 4)
(v128.const f32x4 1.0 2.0 3.0 4.0)
(i32x4.add (local.get 0) (local.get 1))
(f32x4.mul (local.get 0) (local.get 1))
(i8x16.shuffle 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
  (local.get 0) (local.get 1))
(i32x4.extract_lane 0 (local.get 0))
(i32x4.replace_lane 0 (local.get 0) (i32.const 99))
```

#### [Relaxed SIMD](https://github.com/WebAssembly/relaxed-simd)

```wat
(i32x4.relaxed_trunc_f32x4_s (local.get 0))
(f32x4.relaxed_madd (local.get 0) (local.get 1) (local.get 2))  ;; a * b + c
(f32x4.relaxed_nmadd (local.get 0) (local.get 1) (local.get 2)) ;; -(a * b) + c
(i8x16.relaxed_swizzle (local.get 0) (local.get 1))
(f32x4.relaxed_min (local.get 0) (local.get 1))
```

#### [Tail calls](https://github.com/WebAssembly/tail-call)

```wat
(func $factorial (param $n i64) (param $acc i64) (result i64)
  (if (result i64) (i64.le_u (local.get $n) (i64.const 1))
    (then (local.get $acc))
    (else (return_call $factorial
      (i64.sub (local.get $n) (i64.const 1))
      (i64.mul (local.get $n) (local.get $acc))))))

(return_call_indirect (type $fn) (local.get 0) (i32.const 0))
```

#### [Extended const](https://github.com/WebAssembly/extended-const)

```wat
(global $base i32 (i32.const 1000))
(global $offset i32 (i32.add (global.get $base) (i32.const 100)))
(global i64 (i64.mul (i64.const 1024) (i64.const 1024)))
```

#### [Reference types](https://github.com/WebAssembly/reference-types)

```wat
(table $t 10 funcref)
(table.get $t (i32.const 0))
(table.set $t (i32.const 0) (ref.func $f))
(table.size $t)
(table.grow $t (ref.null func) (i32.const 5))
(table.fill $t (i32.const 0) (ref.null func) (i32.const 10))
(global $ext (mut externref) (ref.null extern))
(ref.is_null (local.get 0))
```

#### [Typed function refs](https://github.com/WebAssembly/function-references)

```wat
(type $fn (func (param i32) (result i32)))
(func $double (type $fn) (i32.mul (local.get 0) (i32.const 2)))
(call_ref $fn (i32.const 21) (ref.func $double))  ;; 42
(ref.null $fn)
(ref.is_null (ref.null $fn))
(block (result (ref null $fn)) (ref.null $fn))
```

#### [GC](https://github.com/WebAssembly/gc)

```wat
;; struct
(type $point (struct (field $x f64) (field $y f64)))
(struct.new $point (f64.const 1.0) (f64.const 2.0))
(struct.get $point $x (local.get $p))
(struct.set $point $y (local.get $p) (f64.const 3.0))

;; array
(type $arr (array (mut i32)))
(array.new $arr (i32.const 0) (i32.const 10))  ;; value, length
(array.get $arr (local.get $a) (i32.const 0))
(array.set $arr (local.get $a) (i32.const 0) (i32.const 42))
(array.len (local.get $a))

;; recursive types
(rec
  (type $node (struct (field $val i32) (field $next (ref null $node)))))

;; casts
(ref.cast (ref $point) (local.get 0))
(br_on_cast $label anyref (ref $point) (local.get 0))
```

#### [Exceptions](https://github.com/WebAssembly/exception-handling)

```wat
(tag $e (param i32))
(throw $e (i32.const 42))
(try_table (result i32) (catch $e 0)
  (call $might_throw)
  (i32.const 0))
(try_table (catch_all 0) (call $fn))
```

#### [JS string builtins](https://github.com/WebAssembly/js-string-builtins)

```wat
(import "wasm:js-string" "length" (func $strlen (param externref) (result i32)))
(import "wasm:js-string" "charCodeAt" (func $charAt (param externref i32) (result i32)))
(import "wasm:js-string" "fromCharCode" (func $fromChar (param i32) (result externref)))
(import "wasm:js-string" "concat" (func $concat (param externref externref) (result externref)))
```

#### [Threads](https://github.com/WebAssembly/threads)

```wat
(memory 1 10 shared)
(i32.atomic.load (i32.const 0))
(i32.atomic.store (i32.const 0) (i32.const 42))
(i32.atomic.rmw.add (i32.const 0) (i32.const 1))
(i32.atomic.rmw.cmpxchg (i32.const 0) (i32.const 0) (i32.const 1))
(memory.atomic.wait32 (i32.const 0) (i32.const 0) (i64.const -1))
(memory.atomic.notify (i32.const 0) (i32.const 1))
(atomic.fence)
```

#### [Wide arithmetic](https://github.com/WebAssembly/wide-arithmetic)

```wat
;; 128-bit addition: (a_lo, a_hi) + (b_lo, b_hi) -> (lo, hi)
(i64.add128 (local.get 0) (local.get 1) (local.get 2) (local.get 3))
(i64.sub128 (local.get 0) (local.get 1) (local.get 2) (local.get 3))
;; wide multiply: a * b -> (lo, hi)
(i64.mul_wide_s (local.get 0) (local.get 1))
(i64.mul_wide_u (local.get 0) (local.get 1))
```

#### [Annotations](https://github.com/WebAssembly/annotations)

```wat
(@custom "name" "content")
(@name "my_module")
(@metadata.code.branch_hint "\00") if ... end  ;; unlikely
(@metadata.code.branch_hint "\01") if ... end  ;; likely
```


## See Also

* [Examples](./test/example/)
* [REPL](https://dy.github.io/watr/play/)
* [WebAssembly Spec](https://webassembly.github.io/spec/)
