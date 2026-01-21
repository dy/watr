# <img src="./watr.svg" height="16"> watr [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=white&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr) [![test](https://github.com/dy/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/dy/watr/actions/workflows/test.js.yml)

<div align="left">

_Light & fast WAT compiler_

* [feature](https://webassembly.org/features/) & [spec](https://webassembly.github.io/spec/core/text/index.html)-complete, zero deps
* [compile](./docs.md#compilesource-options) · [polyfill](./docs.md#polyfillast-options) · [optimize](./docs.md#optimizeast-options) · [parse](./docs.md#parsesource-options) · [prettify](./docs.md#printtree-options) · [minify](./docs.md#printtree-options)
* instant wasm, JS interop, CLI, clear errors

**[docs](./docs.md)**  **·**  **[demo](https://dy.github.io/watr/play/)**


<!-- _Use for_: backends, compilers, DSLs, codegen, dev tools -->

</div>

## Usage

```js
import watr, { compile, polyfill, optimize, parse, print } from 'watr'

// compile to binary
const binary = compile('(func (export "f") (result f64) (f64.const 1))')
const module = new WebAssembly.Module(binary)
const { f } = new WebAssembly.Instance(module).exports

// parse
parse('(i32.const 42)') // ['i32.const', 42]

// polyfill (transform newer features to MVP)
print(polyfill('(func (i32.extend8_s ...))')) // (func (i32.shr_s (i32.shl ...) ...))

// optimize (constant folding, treeshake, dead code elimination)
print(optimize('(func (i32.add (i32.const 1) (i32.const 2)))')) // (func (i32.const 3))

// print
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
npx watr input.wat -O           # optimize (fold, treeshake, deadcode)
npx watr input.wat --polyfill   # polyfill newer features to MVP
```

## Metrics

* **watr** — 10 KB, 4,460 op/s
* [spec/wast.js](https://github.com/WebAssembly/spec) — 216 KB, 2,185 op/s
* [wabt](https://github.com/WebAssembly/wabt) — 282 KB, 1,273 op/s
* [binaryen](https://github.com/WebAssembly/binaryen) — 1,100 KB, 718 op/s
* [wat-compiler](https://github.com/stagas/wat-compiler) — 7.7 KB (MVP), 539 op/s


## Used by

* [jz](https://github.com/dy/jz) – minimal static JS subset


<p align="center"><a href="https://krishnized.github.io/license">ॐ</a></p>
