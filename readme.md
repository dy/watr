# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=white)](https://npmjs.org/watr)

Light & fast WAT compiler.<br/>
Useful for high-level languages or dynamic (in-browser) compilation.<br/>
Supports full [spec text syntax](https://webassembly.github.io/spec/core/text/index.html) and [official testsuite](https://github.com/WebAssembly/testsuite).

## Usage

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

### Parse

Parse input wasm text into syntax tree.

```js
import { parse } from 'watr'

parse(`(func (export "double") (param f64) (result f64) (f64.mul (local.get 0) (f64.const 2)))`)
// [
//   'func', ['export', '"double"'], ['param', 'f64'], ['result', 'f64'],
//   ['f64.mul', ['local.get', 0], ['f64.const', 2]]
// ]
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
  newline: false
})
// (func(export "double")(param f64)(result f64)(f64.mul(local.get 0)(f64.const 2)))
```

<!-- See [REPL](https://audio-lab.github.io/watr/repl.html).-->

## Status

* [x] core
* [x] [mutable globals](https://github.com/WebAssembly/mutable-global), [extended const](https://github.com/WebAssembly/extended-const/blob/main/proposals/extended-const/Overview.md), [nontrapping float to int](https://github.com/WebAssembly/nontrapping-float-to-int-conversions), [sign extension](https://github.com/WebAssembly/sign-extension-ops)
* [x] [multi-value](https://github.com/WebAssembly/spec/blob/master/proposals/multi-value/Overview.md), [bulk memory ops](https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md), [multiple memories](https://github.com/WebAssembly/multi-memory/blob/master/proposals/multi-memory/Overview.md)
* [x] [simd](https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md), [relaxed simd](https://github.com/WebAssembly/relaxed-simd), [fixed-width simd](https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md)
* [x] [tail_call](https://github.com/WebAssembly/tail-call)
* [x] [ref types](https://github.com/WebAssembly/reference-types/blob/master/proposals/reference-types/Overview.md), [func refs](https://github.com/WebAssembly/function-references/blob/main/proposals/function-references/Overview.md)
* [ ] [gc](https://github.com/WebAssembly/gc)
* [ ] [exceptions](https://github.com/WebAssembly/exception-handling)
* [ ] [memory64](https://github.com/WebAssembly/memory64)
* [ ] [annotations](https://github.com/WebAssembly/annotations), [code_metadata](https://github.com/WebAssembly/tool-conventions/blob/main/CodeMetadata.md)
* [ ] [js strings](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md)

## Alternatives

&nbsp; | Size (gzipped) | Performance
---|---|---
watr | 6.2 kb | 11.6 op/s
[spec/wast.js](https://github.com/WebAssembly/spec/tree/main/interpreter#javascript-library) | 216 kb | 7.1 op/s
[wabt](https://github.com/WebAssembly/wabt) | 282 kb | 2.3 op/s
[wat-compiler](https://github.com/stagas/wat-compiler) | 7.7 kb | 1.34 op/s

<!--
## Projects using watr

* [piezo](https://github.com/audio-lab/piezo) – audio processing language
-->

<!--
## Useful links

* [watlings](https://github.com/EmNudge/watlings) – learn Wasm text by examples.
* [MDN: control flow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Control_flow)
* [WASM reference manual](https://github.com/sunfishcode/wasm-reference-manual/blob/master/WebAssembly.md#loop)
* [WASM binary encoding](https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md)
-->

<p align=center><a href="https://github.com/krsnzd/license/">🕉</a></p>
