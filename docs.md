# watr

Fast WebAssembly Text Format (WAT) compiler for JavaScript/Node.js.<br/>
Supports [phase 5](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md) + [phase 4](https://github.com/WebAssembly/proposals) features, full [spec syntax](https://webassembly.github.io/spec/core/text/index.html), [official tests](https://github.com/WebAssembly/testsuite).

**Jump to:** [Quick Start](#quick-start) • [API](#api) • [Features](#language-features) • [Examples](#common-patterns) • [Performance](#performance)

## Quick Start

```bash
npm install watr
```

```js
import watr from 'watr'

const { add } = watr`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`

add(2, 3) // 5
```

## API

### `watr`\`...\`

Tagged template for inline WebAssembly with interpolation and instant instantiation.

**Returns:** WebAssembly.Exports

```js
import watr from 'watr'

// Instant exports
const { add } = watr`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`

// Interpolate values
const { pi } = watr`(global (export "pi") f64 (f64.const ${Math.PI}))`  // precise
const { mem } = watr`(memory (export "mem") ${pages})`                  // dynamic
const { fn } = watr`(func (export "fn") (call ${idx}))`                 // indices

// Embed binary data
const { mem } = watr`(memory (export "mem") (data ${new Uint8Array([1,2,3])}))`

// Generate code
const lanes = [0,1,2,3].map(i => `i32.const ${i}`).join(' ')
watr`(func (export "v") (result v128) (v128.const ${lanes}))`
```

### `compile(source)`

Compiles WAT source into binary.

**Input:** `string` (WAT text) or `Array` (syntax tree)
**Returns:** `Uint8Array`

```js
import { compile } from 'watr'

const binary = compile(`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`)
const { add } = new WebAssembly.Instance(new WebAssembly.Module(binary)).exports
```

### `parse(source, options?)`

Parses WAT text into syntax tree.

**Options:**
- `comments` - Preserve comments (default: `false`)
- `annotations` - Preserve annotations (default: `false`)

```js
import { parse } from 'watr'

parse('(i32.add (i32.const 1) (i32.const 2))')
// ['i32.add', ['i32.const', 1], ['i32.const', 2]]

parse('(func ;; comment\n)', { comments: true })
// ['func', [';', ' comment']]
```

### `print(source, options?)`

Formats WAT source.

**Options:**
- `indent` - Indentation (default: `'  '`, `false` to disable)
- `newline` - Line separator (default: `'\n'`, `false` to disable)

```js
import { print } from 'watr'

print('(func(param i32)(i32.const 42))')
// (func
//   (param i32)
//   (i32.const 42)
// )

print(src, { indent: false, newline: false })  // minify
```

## Language Features

### Core (MVP)
All base WebAssembly 1.0 features including:
- Control flow: `block`, `loop`, `if/else`, `br`, `br_if`, `br_table`
- Functions: `call`, `call_indirect`, locals, parameters
- Memory: load/store operations, `memory.size`, `memory.grow`
- Tables: indirect function calls
- Globals: mutable and immutable

### Numbers & Types
- **Multi-value** - Multiple function results `(result i32 i32)`
- **BigInt/i64** - JavaScript BigInt ↔ i64 integration
- **Sign extension** - `i32.extend8_s`, `i64.extend16_s`, etc.
- **Non-trapping conversions** - `i32.trunc_sat_f32_s`, etc.

### Memory
- **Bulk operations** - `memory.copy`, `memory.fill`, `memory.init`, `data.drop`
- **Multiple memories** - Multiple memory instances with indices
- **Memory64** - 64-bit memory addressing (4GB+ memories)

### SIMD
- **Fixed-width SIMD** - 128-bit vector operations (`v128`, `i8x16`, `f32x4`, etc.)
- **Relaxed SIMD** - Performance-oriented relaxed semantics for SIMD

### Functions & Control Flow
- **Tail calls** - `return_call`, `return_call_indirect`
- **Extended const** - More operations in constant expressions

### References & GC
- **Reference types** - `externref`, `funcref`
- **Typed function references** - `(ref $type)`, `call_ref`, `ref.func`
- **Garbage collection** - Structs, arrays, recursive types
  ```wat
  (type $point (struct (field f64) (field f64)))
  (type $array (array (mut i32)))
  ```

### Strings & Exceptions
- **Exception handling** - `try`, `catch`, `throw`, `try_table`
- **JS String Builtins** - Efficient JavaScript string operations via `wasm:js-string`
  ```wat
  (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern))))
  ```

### Text Format
- **Annotations** - Custom metadata `(@custom "name" data)`
- **Branch hints** - Performance hints `(@metadata.code.branch_hint)`

### Numeric Extensions
- **Wide arithmetic** - 128-bit operations: `i64.add128`, `i64.mul_wide_s`

## Common Patterns

### One-liners
```js
// Quick math
const { clamp } = watr`(func (export "clamp") (param f64 f64 f64) (result f64)
  (f64.max (local.get 1) (f64.min (local.get 2) (local.get 0)))
)`

// Bit operations
const { popcount } = watr`(func (export "popcount") (param i32) (result i32)
  (i32.popcnt (local.get 0))
)`
```

### Memory
```js
const { mem, read, write } = watr`
  (memory (export "mem") 1)
  (func (export "read") (param i32) (result i32) (i32.load (local.get 0)))
  (func (export "write") (param i32 i32) (i32.store (local.get 0) (local.get 1)))
`
write(0, 42)
new Uint32Array(mem.buffer)[0]  // 42
```

### Code Generation
```js
// SIMD shuffle from array
const pattern = [3,2,1,0, 7,6,5,4, 11,10,9,8, 15,14,13,12]
watr`(func (export "rev") (param v128) (result v128)
  (i8x16.shuffle ${pattern.join(' ')} (local.get 0) (local.get 0))
)`

// Unrolled stores
const stores = Array(4).fill().map((_, i) =>
  `(f32.store offset=${i*4} (local.get 0) (f32.const ${i}))`
).join(' ')
watr`(memory 1) (func (export "init") (param i32) ${stores})`
```

### Imports
```js
const wasm = compile(`
  (import "env" "log" (func $log (param i32)))
  (func (export "test") (param i32) (call $log (local.get 0)))
`)

new WebAssembly.Instance(new WebAssembly.Module(wasm), {
  env: { log: x => console.log(x) }
})
```

### Tables
```js
const { apply } = watr`
  (type $fn (func (param i32) (result i32)))
  (table 2 funcref)
  (elem (i32.const 0) $dbl $sqr)
  (func $dbl (param i32) (result i32) (i32.mul (local.get 0) (i32.const 2)))
  (func $sqr (param i32) (result i32) (i32.mul (local.get 0) (local.get 0)))
  (func (export "apply") (param i32 i32) (result i32)
    (call_indirect (type $fn) (local.get 1) (local.get 0)))
`
apply(0, 5)  // 10 (double)
apply(1, 5)  // 25 (square)
```

### GC Types
```js
const { make, getX } = watr`
  (type $vec (struct (field $x f64) (field $y f64)))
  (func (export "make") (param f64 f64) (result (ref $vec))
    (struct.new $vec (local.get 0) (local.get 1)))
  (func (export "getX") (param (ref $vec)) (result f64)
    (struct.get $vec $x (local.get 0)))
`
getX(make(3.0, 4.0))  // 3.0
```

## Syntax

Folded, flat, or mixed:
```wat
(i32.add (i32.const 1) (i32.const 2))  ;; folded

i32.const 1                            ;; flat
i32.const 2
i32.add

(func (result i32)                     ;; mixed
  i32.const 1
  i32.const 2
  i32.add)
```

## Numbers

```wat
42            ;; decimal
0x2a          ;; hex
-1000         ;; negative
0xffff_ffff   ;; underscores

3.14          ;; float
6.022e23      ;; scientific
0x1.8p+1      ;; hex float
nan inf -inf  ;; special
nan:0x123     ;; NaN payload
```

## Comments

```wat
;; line comment
(; block comment ;)
(func (; inline ;) (param i32))
```

## Abbreviations

```wat
(func (export "add") ...)              ;; inline export
(func $log (import "env" "log") ...)   ;; inline import
(memory 1 (data "Hello"))              ;; memory with data
```

## Performance

| Compiler | Size | Speed |
|----------|------|-------|
| **watr** | **7.5 KB** | **4,426 op/s** |
| [spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 1,232 op/s |
| [wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1,255 op/s |
| [binaryen](https://github.com/WebAssembly/binaryen) | 1,100 KB | 716 op/s |

## Resources

- [REPL](https://dy.github.io/watr/repl/) - Try in browser
- [WebAssembly Spec](https://webassembly.github.io/spec/)
- [Examples](./test/example/)
- [GitHub](https://github.com/dy/watr)
