# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr)

Light & fast WAT compiler.<br/>
Useful for language backends, dynamic (in-browser) compilation, or inline WASM.

🧩 [phase 5](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md) + [phase 4](https://github.com/WebAssembly/proposals) features<br/>
✅ [spec syntax](https://webassembly.github.io/spec/core/text/index.html), [official tests](https://github.com/WebAssembly/testsuite)<br/>
⚡ 7.5 KB, 4× faster than [wabt](https://github.com/AnthumChris/wabt-online)

**[Docs](./docs.md)** • **[Repl](https://dy.github.io/watr/repl/)**

## Usage

```js
import watr, { compile, parse, print } from 'watr'

// instant wasm function
const { add } = watr`(func (export "add") (param i32 i32) (result i32)
  (i32.add (local.get 0) (local.get 1))
)`
add(2, 3) // 5

// interpolate values
const { pi } = watr`(global (export "pi") f64 (f64.const ${Math.PI}))`

// compile to binary
const binary = compile(`(func (export "f") (result f64) (f64.const 1))`)

// parse / print
parse('(i32.const 42)') // ['i32.const', 42]
print(ast, { indent: '  ', newline: '\n' })
```

## Metrics

&nbsp; | Size | Speed
---|---|---
**watr** | **7.5 KB** | **4,426 op/s**
[spec/wast.js](https://github.com/WebAssembly/spec) | 216 KB | 1,232 op/s
[wabt](https://github.com/WebAssembly/wabt) | 282 KB | 1,255 op/s
[binaryen](https://github.com/WebAssembly/binaryen) | 1,100 KB | 716 op/s
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 KB | 555 op/s

<!-- <small>Benchmarked on [brownian.wat](./test/example/brownian.wat) (N=500)</small> -->

<p align=center><a href="https://github.com/krsnzd/license/">ॐ</a></p>
