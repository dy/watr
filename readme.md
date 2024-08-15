# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr) [![npm](https://img.shields.io/npm/v/watr?color=red)](https://npmjs.org/watr)


Bare minimum wasm text compiler & formatter, light & fast alternative for [wat2wasm](https://github.com/AssemblyScript/wabt.js).<br/>
Useful for hi-level languages or dynamic (in-browser) compilation.<br>

<!-- See [REPL](https://audio-lab.github.io/watr/repl.html).-->

&nbsp; | Size (gzipped) | Performance (op/s) | Features
---|---|---|---
watr | 3.8 kb | 6000 |
[wat-compiler](https://github.com/stagas/wat-compiler) | 6 kb | 348 |
[wassemble](https://github.com/wingo/wassemble) | ? kb | ? |
[wabt](https://github.com/AssemblyScript/wabt.js) | 300 kb | 574 |

## Usage

### Compile

Compile wasm text or syntax tree into wasm binary.

```js
import compile from 'watr' // or `import { compile } from 'watr'`

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

## Status

* [x] wasm core
* [x] [multi-value](https://github.com/WebAssembly/spec/blob/master/proposals/multi-value/Overview.md)
* [x] [bulk memory ops](https://github.com/WebAssembly/bulk-memory-operations/blob/master/proposals/bulk-memory-operations/Overview.md)
* [x] [simd](https://github.com/WebAssembly/simd/blob/master/proposals/simd/SIMD.md)
* [ ] [multiple memories](https://github.com/WebAssembly/multi-memory/blob/master/proposals/multi-memory/Overview.md)
* [ ] [func refs](https://github.com/WebAssembly/function-references/blob/main/proposals/function-references/Overview.md)
* [ ] [gc](https://github.com/WebAssembly/gc)


<!--
## Projects using watr

* [auro](https://github.com/audio-lab/auro) – audio processing language
-->

## Useful links

* [watlings](https://github.com/EmNudge/watlings) – learn Wasm text by examples.
* [MDN: control flow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Control_flow)
* [WASM reference manual](https://github.com/sunfishcode/wasm-reference-manual/blob/master/WebAssembly.md#loop)
* [WASM binary encoding](https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md)

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

## Alternatives

* [wabt](https://www.npmjs.com/package/wabt) − port of WABT for the web, de-facto standard.
* [wat-compiler](https://www.npmjs.com/package/wat-compiler) − compact alternative for WABT, older brother of _watr_.
* [wassemble](https://github.com/wingo/wassemble)
* [web49](https://github.com/FastVM/Web49)

<p align=center><a href="https://github.com/krsnzd/license/">🕉</a></p>
