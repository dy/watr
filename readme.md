# watr

> tiny WAT compiler

Main purpose is happy-path wat compiler at minimal size, providing a way to map unambiguous WAT to binary.
It doesn't support legacy aliases, custom secions, inline imports/exports and other edge-cases. For that use wabt.
It can be used as intermediate layer for compilation from hi-level languages, eg. [sonl](https://github.com/audio-lab/sonl).
Based on [subscript](https://github.com/spectjs/subscript).

Also it provides tiny _webassembly text (wabt) repl_: https://audio-lab.github.io/watr/repl.html.

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

* [mdn wat](https://developer.mozilla.org/en-US/docs/WebAssembly/Understanding_the_text_format)
* [wasm book](https://ontouchstart.pages.dev/chapter_wasm_binary)
* [hackernoon](https://web.archive.org/web/20210215171830/https://hackernoon.com/webassembly-binary-format-explained-part-2-hj1t33yp?source=rss)
* [wasm binary encoding](https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md)
* [webassemblyjs](https://github.com/xtuc/webassemblyjs)

-->

## Alternatives

* [wabt](https://www.npmjs.com/package/wabt) − port of WABT for the web.
* [wat-compiler](https://www.npmjs.com/package/wat-compiler) − compact alternative for WABT
