# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr)

Light & fast WAT compiler.<br/>
Useful for high-level languages or dynamic (in-browser) compilation.<br/>
Supports all [phase 5 features](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md), full [spec text syntax](https://webassembly.github.io/spec/core/text/index.html), curated subset of [official testsuite](https://github.com/WebAssembly/testsuite).

**[DOCS](./docs.md)** | **[REPL](https://dy.github.io/watr/repl/)**

## Quick start

### Compile

Compile wasm text or syntax tree into wasm binary.

```js
import { compile } from 'watr'

const buffer = compile(`(func (export "double")
  (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2))
)`)
const module = new WebAssembly.Module(buffer)
const instance = new WebAssembly.Instance(module)
const {double} = instance.exports

double(108) // 216
```

### Print

Format input wasm text or syntax tree into minified or pretty form.

```js
import { print } from 'watr'

const src = `(func (export "double")
  (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2))
)`

// pretty-print (default)
print(src, {
  indent: '  ',
  newline: '\n',
  comment: true
})
// (func
//   (export "double")
//   (param f64)
//   (result f64)
//   (f64.mul (local.get 0) (f64.const 2))
// )

// minify
print(src, {
  indent: false,
  newline: false,
  comments: false
})
// (func(export "double")(param f64)(result f64)(f64.mul(local.get 0)(f64.const 2)))
```


## Alternatives

&nbsp; | Size (gzipped) | Performance
---|---|---
watr | 7.5 kb | 6.0 op/s
[spec/wast.js](https://github.com/WebAssembly/spec/tree/main/interpreter#javascript-library) | 216 kb | 2.2 op/s
[wabt](https://github.com/WebAssembly/wabt) | 282 kb | 1.2 op/s
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 kb | 0.7 op/s


## Projects using watr

* [jz](https://github.com/dy/jz)
<!-- * [piezo](https://github.com/audio-lab/piezo) – audio processing language -->
-->

<p align=center><a href="https://github.com/krsnzd/license/">ॐ</a></p>
