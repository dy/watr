# watr [![Test](https://github.com/audio-lab/watr/actions/workflows/test.js.yml/badge.svg)](https://github.com/audio-lab/watr/actions/workflows/test.js.yml)

> Light & fast WAT compiler.

Provides bare minimum WAT to WASM compilation.<br/>
Useful as WASM API layer, eg. for hi-level languages or for dynamic (in-browser?) compilation.
<!--, eg. [sonl](https://github.com/audio-lab/sonl). -->

<!-- See [REPL](https://audio-lab.github.io/watr/repl.html).-->

<!--
&nbsp; | watr | wat-compiler | wabt
---|---|---|---
Size (gzipped) | 2.8kb | 6kb | 300kb
Performance (op/s) | 45000 | 2500 | 3100
-->

&nbsp; | Size (gzipped) | Performance (op/s)
---|---|---
watr | 3.8 kb | 1900
[wat-compiler](https://github.com/stagas/wat-compiler) | 6 kb | 135
[wabt](https://github.com/AssemblyScript/wabt.js) | 300 kb | 250

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

Parser converts input Wasm text string to syntax tree.

```js
import { parse } from 'watr

parse(`(func (export "double") (param f64) (result f64) (f64.mul (local.get 0) (f64.const 2)))`)

// [
//   'func', ['export', '"double"'], ['param', 'f64'], ['result', 'f64'],
//   ['f64.mul', ['local.get', 0], ['f64.const', 2]]
// ]
```

### Compile

Compiles Wasm tree or text into wasm binary. Lightweight alternative to [wabt/wat2wasm](https://github.com/WebAssembly/wabt).

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

// minify (default)
const str = print(tree, {
  indent: false,
  newline: false,
  pad: false
})
// (func (export "double")(param f64)(result f64)(f64.mul (local.get 0)(f64.const 2)))

// pretty-print
const str = print(tree, {
  indent: '  ',   // indentation step
  newline: '\n',  // new line
  pad: '',        // pad each newline with chars
})
// (func (export "double")
//   (param f64) (result f64)
//     (f64.mul
//       (local.get 0)
//       (f64.const 2)))
```

<!--
## Limitations

It may miss some edge cases and nice error messages.
For better REPL/dev experience use [wabt](https://github.com/AssemblyScript/wabt.js).


Ambiguous syntax is prohibited in favor of explicit lispy notation. Each instruction must have prefix signature with parenthesized immediates and arguments.

```wast
(func (result i32)
  i32.const 1                 ;; ✘ stacked arguments
  drop
  i32.const 0
  i32.load offset=0 align=4   ;; ✘ ungrouped immediates
)

(func (result i32)
  (drop (i32.const 1))                        ;; ✔ nested arguments
  (i32.load offset=0 align=4 (i32.const 0))   ;; ✔ grouped immediates
)
```

```wast
(local.get 0)     ;; ✘ stacked argument
if (result i32)   ;; ✘ inline instruction
  (i32.const 1)
end

(if (result i32) (local.get 0)  ;; ✔ explicit signature
  (i32.const 1)
)
```

```wast
(f32.const 0x1.fffffep+127)  ;; ✘ floating HEX - not supported
```
-->



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
* [wat-compiler](https://github.com/stagas/wat-compiler/)
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
* [web49](https://github.com/FastVM/Web49)

<p align=center><a href="https://github.com/krsnzd/license/">🕉</a></p>
