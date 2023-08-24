# watr [![test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/watr/latest?color=brightgreen&label=gzip)](https://bundlephobia.com/package/watr)

> WAT parser, compiler and printer.

Light & fast alternative for [wabt/wat2wasm](https://github.com/AssemblyScript/wabt.js).<br/>
Provides bare minimum WAT to WASM compiler, parser and formatter (to pretty-print or minify).<br/>
Useful for hi-level languages or dynamic (in-browser?) compilation (see [lino](https://github.com/audio-lab/lino)).

<!-- See [REPL](https://audio-lab.github.io/watr/repl.html).-->

&nbsp; | Size (gzipped) | Performance (op/s)
---|---|---
watr | 3.8 kb | 5950
[wat-compiler](https://github.com/stagas/wat-compiler) | 6 kb | 348
[wabt](https://github.com/AssemblyScript/wabt.js) | 300 kb | 574

## Usage

```js
import wat from 'watr'

// compile text to binary
const buffer = wat(`(func
  (export "double") (param f64) (result f64)
  (f64.mul (local.get 0) (f64.const 2))
)`)

// create instance
const module = new WebAssembly.Module(buffer)
const instance = new WebAssembly.Instance(module)

// use API
const {double} = instance.exports
double(108) // 216
```

## API

### Parse

Parse input Wasm text string into syntax tree.

```js
import { parse } from 'watr'

parse(`(func (export "double") (param f64) (result f64) (f64.mul (local.get 0) (f64.const 2)))`)

// [
//   'func', ['export', '"double"'], ['param', 'f64'], ['result', 'f64'],
//   ['f64.mul', ['local.get', 0], ['f64.const', 2]]
// ]
```

### Compile

Compiles Wasm tree or string into wasm binary.

```js
import { compile } from 'watr'

const buffer = compile([
  'func', ['export', '"double"'], ['param', 'f64'], ['result', 'f64'],
  ['f64.mul', ['local.get', 0], ['f64.const', 2]]
])
const module = new WebAssembly.Module(buffer)
const instance = new WebAssembly.Instance(module)
const {double} = instance.exports

double(108) // 216
```

### Print

Format input Wasm text string or tree into minified or pretty form.

```js
import { print } from 'watr'

const tree = [
  'func', ['export', '"double"'], ['param', 'f64'], ['result', 'f64'],
  ['f64.mul', ['local.get', 0], ['f64.const', 2]]
]

// pretty-print (default)
const str = print(tree, {
  indent: '  ',   // indentation chars
  newline: '\n',  // new line chars
})
// (func (export "double")
//   (param f64) (result f64)
//     (f64.mul
//       (local.get 0)
//       (f64.const 2)))

// minify
const str = print(tree, {
  indent: false,
  newline: false
})
// (func (export "double")(param f64)(result f64)(f64.mul (local.get 0)(f64.const 2)))
```

## Limitations

It may miss some edge cases and nice error messages.<br>
For better REPL/dev experience use [wabt](https://github.com/AssemblyScript/wabt.js).<br>
Also floating HEX, eg. `(f32.const 0x1.fffffep+127)` is not supported.<br>

## Useful links

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
