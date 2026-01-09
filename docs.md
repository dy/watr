# watr

Fast WebAssembly Text Format compiler.<br/>
Supports [finished](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md) + [phase 4](https://github.com/WebAssembly/proposals) proposals, full [spec syntax](https://webassembly.github.io/spec/core/text/index.html).

## Install

```bash
npm install watr
```

## API

### `` watr`...` ``

Compile and instantiate, return exports.

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

### `compile(source)`

Compile to binary. Accepts string, AST, or template literal.

```js
import { compile } from 'watr'

compile(`(func (export "f"))`)                       // string
compile(['func', ['export', '"f"']])                 // AST
compile`(func (export "f") (f64.const \${Math.PI}))` // template
// Uint8Array
```

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

Print AST to string.

```js
import { print } from 'watr'

print(['func', ['param', 'i32'], ['i32.const', 42]])
// (func
//   (param i32)
//   (i32.const 42))

// options: indent (default '  '), newline (default '\n')
print(tree, { indent: false, newline: false })  // minify
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

<table>
<tr><th>Feature</th><th>Example</th></tr>
<tr><td><a href="https://github.com/WebAssembly/JS-BigInt-integration">BigInt / i64</a></td><td>

```js
watr`(func (export "f") (result i64) (i64.const ${9007199254740993n}))`
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/multi-value">Multi-value</a></td><td>

```wat
(func (result i32 i32) (i32.const 1) (i32.const 2))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/sign-extension-ops">Sign extension</a></td><td>

```wat
(i32.extend8_s (i32.const 0xff))
(i64.extend32_s (i64.const 0xffffffff))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/nontrapping-float-to-int-conversions">Non-trapping conversions</a></td><td>

```wat
(i32.trunc_sat_f32_s (f32.const 1e30))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/bulk-memory-operations">Bulk memory</a></td><td>

```wat
(memory.copy (i32.const 0) (i32.const 100) (i32.const 10))
(memory.fill (i32.const 0) (i32.const 0xff) (i32.const 64))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/multi-memory">Multiple memories</a></td><td>

```wat
(memory $a 1)
(memory $b 2)
(i32.store $b (i32.const 0) (i32.const 42))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/memory64">Memory64</a></td><td>

```wat
(memory i64 1)
(i64.load (i64.const 0))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/simd">SIMD</a></td><td>

```wat
(v128.const i32x4 1 2 3 4)
(i32x4.add (local.get 0) (local.get 1))
(i8x16.shuffle 0 1 2 3 ... (local.get 0) (local.get 1))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/relaxed-simd">Relaxed SIMD</a></td><td>

```wat
(i32x4.relaxed_trunc_f32x4_s (local.get 0))
(f32x4.relaxed_madd (local.get 0) (local.get 1) (local.get 2))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/tail-call">Tail calls</a></td><td>

```wat
(return_call $factorial (i32.sub (local.get 0) (i32.const 1)))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/extended-const">Extended const</a></td><td>

```wat
(global i32 (i32.add (i32.const 1) (i32.const 2)))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/reference-types">Reference types</a></td><td>

```wat
(table 10 funcref)
(table.set (i32.const 0) (ref.func $f))
(global externref (ref.null extern))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/function-references">Typed function refs</a></td><td>

```wat
(type $fn (func (param i32) (result i32)))
(call_ref $fn (i32.const 42) (local.get 0))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/gc">GC</a></td><td>

```wat
(type $point (struct (field $x f64) (field $y f64)))
(struct.new $point (f64.const 1.0) (f64.const 2.0))
(array.new $arr (i32.const 0) (i32.const 10))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/exception-handling">Exceptions</a></td><td>

```wat
(tag $e (param i32))
(try_table (catch $e 0) (throw $e (i32.const 42)))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/js-string-builtins">JS string builtins</a></td><td>

```wat
(import "wasm:js-string" "length"
  (func $len (param externref) (result i32)))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/threads">Threads</a></td><td>

```wat
(memory 1 1 shared)
(i32.atomic.load (i32.const 0))
(memory.atomic.wait32 (i32.const 0) (i32.const 0) (i64.const -1))
(memory.atomic.notify (i32.const 0) (i32.const 1))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/wide-arithmetic">Wide arithmetic</a></td><td>

```wat
(i64.add128 (local.get 0) (local.get 1) (local.get 2) (local.get 3))
(i64.mul_wide_s (local.get 0) (local.get 1))
```
</td></tr>
<tr><td><a href="https://github.com/WebAssembly/annotations">Annotations</a></td><td>

```wat
(@custom "name" "content")
(@metadata.code.branch_hint "\00")
```
</td></tr>
</table>

## See Also

* [Examples](./test/example/)
* [REPL](https://dy.github.io/watr/repl/)
* [WebAssembly Spec](https://webassembly.github.io/spec/)
