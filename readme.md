# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr)

Light & fast WAT compiler.<br/>
Useful for high-level languages or dynamic (in-browser) compilation.<br/>
Supports all [phase 5 features](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md), full [spec text syntax](https://webassembly.github.io/spec/core/text/index.html), practical subset of [official testsuite](https://github.com/WebAssembly/testsuite).

**[docs](./docs/index.md)** • **[repl](https://dy.github.io/watr/repl/)**

## Usage

**Compile** WAT to binary:

```js
import { compile } from 'watr'

const wasm = compile(`(func (export "double") (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2))
)`)

const { double } = new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports
double(108) // 216
```

**Print** (pretty-print or minify):

```js
import { print } from 'watr'

const src = `(func (export "double") (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2)))`

print(src) // pretty-print (default)
print(src, { indent: false, newline: false }) // minify
```

**Parse** WAT to syntax tree:

```js
import { parse } from 'watr'

parse('(i32.const 42)') // ['i32.const', 42]
```

See [docs](./docs/index.md) for complete API and examples.

## Metrics

&nbsp; | Size | Speed | Features
---|---|---|---
**watr** | **7.5 KB** | **3,894 op/s** | **MVP + GC + SIMD + Threads**
[spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 2,170 op/s | MVP + GC + SIMD + Threads
[wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1,268 op/s | MVP + GC + SIMD + Threads
[binaryen](https://github.com/WebAssembly/binaryen) | 1,100 KB | 718 op/s | MVP + GC + SIMD + Threads
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 KB | 537 op/s | MVP only

<!-- <small>Benchmarked on [brownian.wat](./test/example/brownian.wat) (N=500)</small> -->

<p align=center><a href="https://github.com/krsnzd/license/">ॐ</a></p>
