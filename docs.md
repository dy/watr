# watr Documentation

Fast WebAssembly Text Format (WAT) compiler for JavaScript/Node.js. Supports the full [official spec](https://webassembly.github.io/spec/core/text/index.html) and passes the [WebAssembly test suite](https://github.com/WebAssembly/testsuite).

**Jump to:** [Quick Start](#quick-start) • [API](#api) • [Features](#language-features) • [Examples](#common-patterns) • [Performance](#performance)

## Quick Start

```bash
npm install watr
```

```js
import { compile } from 'watr'

const wasm = compile(`
  (func (export "add") (param i32 i32) (result i32)
    (i32.add (local.get 0) (local.get 1))
  )
`)

const { add } = new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports
add(2, 3) // 5
```

## API

### compile(source)

Compiles WAT text or syntax tree into binary wasm.

**Input:** String (WAT text) or Array (parsed syntax tree)
**Returns:** Uint8Array (wasm binary)

```js
compile('(func (export "double") (param f64) (result f64) (f64.mul (local.get 0) (f64.const 2)))')
compile(['func', ['export', '"double"'], ['param', 'f64'], ['result', 'f64'],
        ['f64.mul', ['local.get', 0], ['f64.const', 2]]])
```

### parse(source, options?)

Parses WAT text into syntax tree.

**Options:**
- `comments: boolean` - Preserve comments (default: false)
- `annotations: boolean` - Preserve annotations (default: false)

```js
parse('(i32.const 42)')
// ['i32.const', 42]

parse('(func $f (param $x i32) ;; comment\n (local.get $x))', { comments: true })
// ['func', '$f', ['param', '$x', 'i32'], [';', ' comment'], ['local.get', '$x']]
```

### print(source, options?)

Formats WAT text or syntax tree.

**Options:**
- `indent: string | false` - Indentation string (default: '  ')
- `newline: string | false` - Line separator (default: '\n')
- `comments: boolean` - Include comments (default: true)

```js
// Pretty print
print('(func(param i32)(i32.const 42))')
// (func
//   (param i32)
//   (i32.const 42)
// )

// Minify
print(src, { indent: false, newline: false, comments: false })
// (func(param i32)(i32.const 42))
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

### Working with Memory
```js
const wasm = compile(`
  (memory (export "mem") 1)
  (func (export "write") (param i32 i32)
    (i32.store (local.get 0) (local.get 1))
  )
  (func (export "read") (param i32) (result i32)
    (i32.load (local.get 0))
  )
`)

const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm))
const memory = new Uint32Array(instance.exports.mem.buffer)

instance.exports.write(0, 42)
memory[1] = 100
instance.exports.read(4) // 100
```

### Import & Export
```js
const wasm = compile(`
  (import "env" "log" (func $log (param i32)))
  (import "env" "mem" (memory 1))

  (func (export "test") (param i32)
    (call $log (local.get 0))
  )
`)

const instance = new WebAssembly.Instance(
  new WebAssembly.Module(wasm),
  {
    env: {
      log: (x) => console.log('Value:', x),
      mem: new WebAssembly.Memory({ initial: 1 })
    }
  }
)
```

### Function Tables
```js
const wasm = compile(`
  (type $callback (func (param i32) (result i32)))
  (table 2 funcref)
  (elem (i32.const 0) $double $square)

  (func $double (param i32) (result i32)
    (i32.mul (local.get 0) (i32.const 2))
  )
  (func $square (param i32) (result i32)
    (i32.mul (local.get 0) (local.get 0))
  )
  (func (export "apply") (param i32 i32) (result i32)
    (call_indirect (type $callback) (local.get 1) (local.get 0))
  )
`)

const { apply } = new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports
apply(0, 5) // 10 (double)
apply(1, 5) // 25 (square)
```

### GC Types
```js
const wasm = compile(`
  (type $vec (struct (field $x (mut f64)) (field $y (mut f64))))

  (func (export "make") (param f64 f64) (result (ref $vec))
    (struct.new $vec (local.get 0) (local.get 1))
  )
  (func (export "getX") (param (ref $vec)) (result f64)
    (struct.get $vec $x (local.get 0))
  )
  (func (export "setX") (param (ref $vec) f64)
    (struct.set $vec $x (local.get 0) (local.get 1))
  )
`)
```

### SIMD Operations
```js
const wasm = compile(`
  (func (export "addVectors") (param v128 v128) (result v128)
    (i32x4.add (local.get 0) (local.get 1))
  )
`)
```

## Syntax Forms

watr supports both folded and flat instruction syntax:

**Folded (S-expression style):**
```wat
(i32.add (i32.const 1) (i32.const 2))
```

**Flat (stack-based):**
```wat
i32.const 1
i32.const 2
i32.add
```

**Mixed:**
```wat
(func (param i32) (result i32)
  local.get 0
  i32.const 10
  i32.add
)
```

## Number Formats

All standard WebAssembly number formats:
```wat
;; Integers
42          ;; decimal
0x2a        ;; hexadecimal
-1000       ;; negative
0xffff_ffff ;; underscores allowed

;; Floats
3.14
-0.5
6.022e23    ;; scientific notation
0x1.8p+1    ;; hexadecimal float
nan
inf
-inf
nan:0x123   ;; NaN with payload
```

## Comments & Annotations

```wat
;; Line comment

(; Block comment ;)

(func (; inline comment ;) (param i32))

;; Annotations (preserved with parse({annotations: true}))
(@custom "section_name" "data")
(@name "debug_name")
```

## Module Abbreviations

Short forms for common patterns:

```wat
;; Function with inline export
(func (export "add") (param i32 i32) (result i32) ...)

;; Import abbreviation
(import "env" "log" (func $log (param i32)))
;; Same as:
(func $log (import "env" "log") (param i32))

;; Memory with data
(memory 1)
(data (i32.const 0) "Hello")
;; Or:
(memory 1 (data "Hello"))
```

## Performance

Benchmarked on official test suite:

| Compiler | Size (gzipped) | Speed |
|----------|---------------|-------|
| **watr** | **7.5 KB** | **6.0 op/s** |
| [spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 2.2 op/s |
| [wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1.2 op/s |
| [wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 KB | 0.7 op/s |

## Limitations & Known Issues

watr implements **all 20 finished/standardized WebAssembly proposals**. Not yet implemented:

- **Threads** (Phase 4) - atomic operations, shared memory
- **JS Promise Integration** (Phase 4) - async integration
- **Web Content Security Policy** (Phase 4) - CSP integration
- **Custom page size** - not yet standardized

See [todo.md](../todo.md) for complete roadmap.

## Resources

- [REPL](https://dy.github.io/watr/docs/repl) - Try watr in your browser
- [WebAssembly Spec](https://webassembly.github.io/spec/)
- [MDN WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly)
- [Detailed Examples](../test/example/)

## Support

- Report issues: [GitHub Issues](https://github.com/audio-lab/watr/issues)
- Official testsuite: All passing ✓
- Node.js: ✓ (v16+)
- Browsers: ✓ (modern browsers)
- Deno: ✓

---

**Need something specific?** Check the [test suite](../test/) for working examples of every feature.
