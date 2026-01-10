# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr)

Light & fast WAT compiler.

* [Feature](https://webassembly.org/features/) & [spec](https://webassembly.github.io/spec/core/text/index.html)-complete, zero deps
* Inline WASM, auto-import, JS interpolation
* Parse, print, transform
* Backends, JIT, metaprogramming, DSLs, tooling

**[Docs](./docs.md)** · **[Repl](https://dy.github.io/watr/repl/)**

## Usage

```js
import watr, { compile, parse, print } from 'watr'

// instant wasm function
const { add } = watr`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`
add(2, 3) // 5

// auto-import functions
const { test } = watr`(func (export "test") (call ${console.log} (i32.const 42)))`
test() // logs 42

// interpolate values
const { pi } = watr`(global (export "pi") f64 (f64.const ${Math.PI}))`

// compile to binary
const binary = compile(`(func (export "f") (result f64) (f64.const 1))`)
const module = new WebAssembly.Module(binary)
const { f } = new WebAssembly.Instance(module).exports

// parse / print
parse('(i32.const 42)') // ['i32.const', 42]
print('(module(func(result i32)i32.const 42))') // (module\n  (func (result i32)\n    ...
```

## Metrics

&nbsp; | Size | Speed | &nbsp;
---|---|---|---
**watr** | **10 KB** | **4,460 op/s** |
[spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 2,185 op/s |
[wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1,273 op/s |
[binaryen](https://github.com/WebAssembly/binaryen) | 1,100 KB | 718 op/s |
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 KB | 539 op/s | MVP only

<p align=center><a href="https://github.com/krsnzd/license/">ॐ</a></p>
