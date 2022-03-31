# watr

Light & fast embeddable WAT compiler.

## Comparison

&nbsp; | Size | Compile | Parse
---|---|---|---
watr | | |
wat-compiler | | |
wabt | | |

See _[WebAssembly text REPL](https://audio-lab.github.io/watr/repl.html)_.

## Usage

```js
import wat from 'watr'

// compile text to binary
const buffer = wat('(func (export "double") (param f64) (result f64) (f64.mul (local.get 0) (f64.const 2)))')

// create instance
const module = new WebAssembly.Module(buffer)
const instance = new WebAssembly.Instance(module)

// use API
const {double} = instance.exports
double(108) // 216
```

## Compiler

WAT tree can be compiled directly. That can be useful as WASM API layer for hi-level languages, to bypass text parsing (eg. used by [sonl](https://github.com/audio-lab/sonl)):

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

<!--
Main goal is to get very fluent with wasm text and to know it from within.

Experiments:

* [x] global read/write use in function
* [x] scopes: refer, goto
* [x] stack: understanding named and full references
* [x] memory: reading/writing global memory
* [x] memory: creating arrays on the go
* [x] memory: passing pointer to a function
* [x] benchmark array setting agains js loop
  → it's faster almost twice

## Useful links

* [MDN: control flow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Control_flow)
* [WASM reference manual](https://github.com/sunfishcode/wasm-reference-manual/blob/master/WebAssembly.md#loop)

## Refs

* [mdn wasm text format](https://developer.mozilla.org/en-US/docs/WebAssembly/Understanding_the_text_format)
* [wasm reference manual](https://github.com/sunfishcode/wasm-reference-manual/blob/master/WebAssembly.md)
* [wabt source search](https://github.com/WebAssembly/wabt/search?p=5&q=then)
* [wat control flow](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/Control_flow)
* [wasm binary encoding](https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md)
* [ontouchstart wasm book](https://ontouchstart.pages.dev/chapter_wasm_binary)
* [wat-compiler](https://github.com/stagas/wat-compiler/)
* [hackernoon](https://web.archive.org/web/20210215171830/https://hackernoon.com/webassembly-binary-format-explained-part-2-hj1t33yp?source=rss)
* [webassemblyjs](https://github.com/xtuc/webassemblyjs)

-->

## Alternatives

* [wabt](https://www.npmjs.com/package/wabt) − port of WABT for the web.
* [wat-compiler](https://www.npmjs.com/package/wat-compiler) − compact alternative for WABT

<p align=center><a href="https://github.com/krsnzd/license/">🕉</a></p>
