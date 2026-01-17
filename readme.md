# watr [![test](https://github.com/dy/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/dy/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=white&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr) [![demo](https://img.shields.io/badge/play-%F0%9F%9A%80-white)](https://dy.github.io/watr/play/)  [![ॐ](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://krishnized.github.io/license)

Light & fast WAT compiler: **[docs](./docs.md)**, **[play](https://dy.github.io/watr/play/)**

* [feature](https://webassembly.org/features/) & [spec](https://webassembly.github.io/spec/core/text/index.html)-complete, zero deps
* parse · compile · print · minify
* instant wasm, JS interop, clear errors

Useful for backends, JIT compilers, DSLs, code generators, dev tools.


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

## CLI

```sh
npx watr input.wat              # → input.wasm
npx watr input.wat -o out.wasm  # custom output
npx watr input.wat --print      # pretty-print
npx watr input.wat --minify     # minify
```

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
