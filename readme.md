# <img src="./watr.svg" height="16"> watr [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr) [![test](https://github.com/dy/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/dy/watr/actions/workflows/test.js.yml)


_Light & fast WAT compiler_

* [feature](https://webassembly.org/features/?categories=browsers%2Cstandalones%2Ctools) & [spec](https://webassembly.github.io/spec/core/text/index.html)-complete, zero deps
* [compile](./docs.md#compilesource) · [polyfill](./docs.md#polyfillast-options) · [optimize](./docs.md#optimizeast-options) · [parse](./docs.md#parsesource-options) · [prettify](./docs.md#printtree-options) · [minify](./docs.md#printtree-options)
* instant wasm, JS interop, CLI, clear errors

**[docs](./docs.md)**  **·**  **[demo](https://dy.github.io/watr/play/)**


<!-- _Use for_: backends, compilers, DSLs, codegen, dev tools -->


## Usage

```js
import watr, { compile, parse, print } from 'watr'

// compile to binary
const src = '(func (export "f") (result f64) (f64.const 1))'
const binary = compile(src)
const module = new WebAssembly.Module(binary)
const { f } = new WebAssembly.Instance(module).exports

// optional, heavy transforms ship as separate entries — compose them
import optimize from 'watr/optimize'   // fold constants, treeshake, eliminate dead code …
import polyfill from 'watr/polyfill'   // newer features → MVP
compile(optimize(polyfill(src)))

// parse
parse('(i32.const 42)') // ['i32.const', 42]

// print
print('(module(func(result i32)i32.const 42))') // (module\n  (func (result i32)\n  ...

// instant wasm function
const { add } = watr`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`
add(2, 3) // 5

// instant wasm: interpolate, auto-import ...
const { test } = watr`(func (export "test") (call ${console.log} (i32.const 42)))`
test() // logs 42
```

## CLI

```sh
npx watr input.wat              # → input.wasm
npx watr input.wat -o out.wasm  # custom output
npx watr input.wat --print      # pretty-print
npx watr input.wat --minify     # minify
npx watr input.wat --optimize   # fold, treeshake, inline, coalesce, …
npx watr input.wat --polyfill   # newer features → MVP
```

## Metrics

* **watr** — ~43 KB minified (~14 KB gzipped), 4,460 op/s
* [spec/wast.js](https://github.com/WebAssembly/spec) — 216 KB, 2,185 op/s
* [wabt](https://github.com/WebAssembly/wabt) — 282 KB, 1,273 op/s
* [binaryen](https://github.com/WebAssembly/binaryen) — 1,100 KB, 718 op/s
* [wat-compiler](https://github.com/stagas/wat-compiler) — ~152 KB (+ wabt dep), 539 op/s

### Optimizer vs binaryen (wasm-opt 128)

Measured on [test/example](./test/example) (21 modules, `optimize(src)` defaults vs `wasm-opt -all`):

|  | size (total) | time (batch) | footprint |
|---|---|---|---|
| **watr/optimize** | **19,737 B** | **138 ms** in-process | 143 KB min (44 KB gz) |
| `wasm-opt -Oz` | 19,852 B | 990 ms CLI | ~1.1 MB js / native binary |
| `wasm-opt -O3` | 22,302 B | — | — |

Smaller than `-O3` on every module and than `-Oz` in aggregate (19,737 vs 19,852 B); ties or beats `-Oz` on 18 of 20 files.
Binaryen's native core outruns watr on multi-MB single modules (a 5.5 MB module: 0.4 s vs 2.5 s, sizes within 3%) —
watr's edge is batch/in-process use with no process spawn and a ~25× smaller footprint.


## Used by

* [jz](https://github.com/dy/jz) – minimal static JS subset


<p align="center"><a href="https://krishnized.github.io/license">ॐ</a></p>
