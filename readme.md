# <img src="./watr.svg" height="16"> watr [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=white&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr) [![test](https://github.com/dy/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/dy/watr/actions/workflows/test.js.yml)

<div align="left">

_Light & fast WAT compiler_

* [feature](https://webassembly.org/features/) & [spec](https://webassembly.github.io/spec/core/text/index.html)-complete, zero deps
* parse · compile · polyfill · print · minify
* instant wasm, JS interop, clear errors

**[docs](./docs.md)**  **·**  **[demo](https://dy.github.io/watr/play/)**


<!-- _Use for_: backends, compilers, DSLs, codegen, dev tools -->

</div>

## Usage

```js
import watr, { compile, parse, print } from 'watr'

// compile to binary
const binary = compile('(func (export "f") (result f64) (f64.const 1))')
const module = new WebAssembly.Module(binary)
const { f } = new WebAssembly.Instance(module).exports

// parse / print
parse('(i32.const 42)') // ['i32.const', 42]
print('(module(func(result i32)i32.const 42))') // (module\n  (func (result i32)\n    ...

// instant wasm function
const { add } = watr`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`
add(2, 3) // 5

// auto-import
const { test } = watr`(func (export "test") (call ${console.log} (i32.const 42)))`
test() // logs 42
```

## CLI

```sh
npx watr input.wat              # → input.wasm
npx watr input.wat -o out.wasm  # custom output
npx watr input.wat --print      # pretty-print
npx watr input.wat --minify     # minify
npx watr input.wat --polyfill   # polyfill newer features to MVP
```

## Features

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

**Polyfill legend**: `yes` = full support, `partial` = limited support noted, `no` = not feasible, `n/a` = already MVP or no runtime impact

## Metrics

&nbsp; | Size | Speed
---|---|---
**watr** | **10 KB** | **4,460 op/s**
[spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 2,185 op/s
[wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1,273 op/s
[binaryen](https://github.com/WebAssembly/binaryen) | 1,100 KB | 718 op/s
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 KB (MVP) | 539 op/s |


## Used by

* [jz](https://github.com/dy/jz) – minimal static JS subset


<p align="center"><a href="https://krishnized.github.io/license">ॐ</a></p>
