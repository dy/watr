# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=red)](https://npmjs.org/watr)

Light & fast WASM compiler. An alternative to [wabt/wat2wasm](https://github.com/AssemblyScript/wabt.js).<br/>
Useful for high-level languages or dynamic (in-browser) compilation.<br>
Supports complete [standard text syntax](https://webassembly.github.io/spec/core/text/index.html) and [official testsuite](https://github.com/WebAssembly/testsuite).

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
// (func (export "double")
//   (param f64) (result f64)
//     (f64.mul
//       (local.get 0)
//       (f64.const 2)))

// minify
print(src, {
  indent: false,
  newline: false
})
// (func (export "double")(param f64)(result f64)(f64.mul (local.get 0)(f64.const 2)))
```

<!-- See [REPL](https://audio-lab.github.io/watr/repl.html).-->

## Status

* [x] core
* [x] [mutable_globals](https://github.com/WebAssembly/mutable-global)
* [x] [extended const](https://github.com/WebAssembly/extended-const/blob/main/proposals/extended-const/Overview.md)
* [ ] [sat_float_to_int](https://github.com/WebAssembly/nontrapping-float-to-int-conversions)
* [ ] [sign_extension](https://github.com/WebAssembly/sign-extension-ops)
* [x] [multi-value](https://github.com/WebAssembly/spec/blob/master/proposals/multi-value/Overview.md)
* [x] [bulk memory ops](https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md)
* [ ] [memory64](https://github.com/WebAssembly/memory64)
* [x] [multiple memories](https://github.com/WebAssembly/multi-memory/blob/master/proposals/multi-memory/Overview.md)
* [x] [simd](https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md)
* [ ] [relaxed_simd](https://github.com/WebAssembly/relaxed-simd)
* [x] [ref types](https://github.com/WebAssembly/reference-types/blob/master/proposals/reference-types/Overview.md)
* [x] [func refs](https://github.com/WebAssembly/function-references/blob/main/proposals/function-references/Overview.md)
* [ ] [gc](https://github.com/WebAssembly/gc)
* [ ] [exceptions](https://github.com/WebAssembly/exception-handling)
* [ ] [threads](https://github.com/WebAssembly/threads)
* [ ] [tail_call](https://github.com/WebAssembly/tail-call)
* [ ] [annotations](https://github.com/WebAssembly/annotations)
* [ ] [code_metadata](https://github.com/WebAssembly/tool-conventions/blob/main/CodeMetadata.md)

## Alternatives

&nbsp; | Size (gzipped) | Performance (op/s)
---|---|---
watr | 5 kb | 6000
[wabt](https://github.com/AssemblyScript/wabt.js) | 300 kb | 574
[wat-compiler](https://github.com/stagas/wat-compiler) | 6 kb | 348
<!-- [wassemble](https://github.com/wingo/wassemble) | ? kb | ? -->

<!-- Watr has better syntax support than wabt & produces more compact output due to types squash. -->

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

<!--
## Refs

* [mdn wasm text format](https://developer.mozilla.org/en-US/docs/WebAssembly/Understanding_the_text_format)
* [wasm reference manual](https://github.com/sunfishcode/wasm-reference-manual/blob/master/WebAssembly.md)
* [wabt source search](https://github.com/WebAssembly/wabt/search?p=5&q=then)
* [wat control flow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Control_flow)
* [ontouchstart wasm book](https://ontouchstart.pages.dev/chapter_wasm_binary)
* [hackernoon](https://web.archive.org/web/20210215171830/https://hackernoon.com/webassembly-binary-format-explained-part-2-hj1t33yp?source=rss)
* [webassemblyjs](https://github.com/xtuc/webassemblyjs)
* [chasm](https://github.com/ColinEberhardt/chasm/blob/master/src/encoding.ts)
* [WebBS](https://github.com/j-s-n/WebBS)
* [leb128a](https://github.com/minhducsun2002/leb128/blob/master/src/index.ts)
* [leb128b](https://github.com/shmishtopher/wasm-LEB128/tree/master/esm)
-->

<p align=center><a href="https://github.com/krsnzd/license/">🕉</a></p>
