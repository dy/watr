# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr)

Fast WebAssembly Text (WAT) compiler. [All proposals](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md) ✓, [full spec](https://webassembly.github.io/spec/core/text/index.html) ✓, [official tests](https://github.com/WebAssembly/testsuite) ✓.

**[docs](./docs/index.md)** • **[repl](https://dy.github.io/watr/repl/)**

## Usage

Compile WAT to binary:

```js
import { compile } from 'watr'

const wasm = compile(`(func (export "double") (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2))
)`)

const { double } = new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports
double(108) // 216
```

Format (pretty-print or minify):

```js
import { print } from 'watr'

const src = `(func (export "double") (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2)))`

print(src) // pretty-print (default)
print(src, { indent: false, newline: false }) // minify
```

Parse WAT to syntax tree:

```js
import { parse } from 'watr'

parse('(i32.const 42)') // ['i32.const', 42]
```

See [docs](./docs/index.md) for complete API and examples.

## Benchmarks

Benchmarked on [brownian.wat](./test/example/brownian.wat) (N=500):

&nbsp; | Size | Speed
---|---|---
**watr** | **7.5 KB** | **4,278 op/s**
[spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 2,196 op/s
[wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1,279 op/s
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 KB | 517 op/s

<p align=center><a href="https://github.com/krsnzd/license/">ॐ</a></p>
