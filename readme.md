# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr)

Light & fast WAT compiler.<br/>
Useful for high-level languages or dynamic (in-browser) compilation.<br/>
Supports all [phase 5 features](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md), full [spec text syntax](https://webassembly.github.io/spec/core/text/index.html), practical subset of [official testsuite](https://github.com/WebAssembly/testsuite).

## Usage

```js
import watr, { compile, parse, print } from 'watr'

// instant wasm function
const { add } = watr`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`
add(2, 3) // 5

// interpolate values (eg. precise floats)
const { pi } = watr`(global (export "pi") f64 (f64.const ${Math.PI}))`

// compile to binary
const binary = compile(`(func (export "double") (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2))
)`)

// parse to syntax tree
parse('(i32.const 42)') // ['i32.const', 42]

// pretty-print or minify
print(src)
print(src, { indent: false, newline: false, comments: false })
```

See **[docs](./docs.md)** or **[repl](https://dy.github.io/watr/repl/)**

## Metrics

&nbsp; | Size | Speed | Features
---|---|---|---
**watr** | **7.5 KB** | **4,426 op/s** | **MVP + GC + SIMD + Threads**
[spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 1,232 op/s | MVP + GC + SIMD + Threads
[wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1,255 op/s | MVP + GC + SIMD + Threads
[binaryen](https://github.com/WebAssembly/binaryen) | 1,100 KB | 716 op/s | MVP + GC + SIMD + Threads
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 KB | 555 op/s | MVP only

<!-- <small>Benchmarked on [brownian.wat](./test/example/brownian.wat) (N=500)</small> -->

<p align=center><a href="https://github.com/krsnzd/license/">ॐ</a></p>
