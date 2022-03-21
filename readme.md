# watr

Set of experiments with wasm text format.

Main goal is to get very fluent with wasm text and to know it.

Also it provides tiny _wasm repl_: https://audio-lab.github.io/watr/repl.html.

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
