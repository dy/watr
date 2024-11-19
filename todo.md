
## plan

* [x] Basic compilation examples from wasm book
  * [x] Make sure they're compilable
* [x] Parsing samples from wat-compiler
* [x] Remove subscript, use own parsing loop
* [x] Avoid duplicating function signatures
* [x] Compilation samples from wat-compiler
* [x] Examples tests - existing & wat-compiler ones (ideally find failing table)
* [x] Normalize tree in parser, not in compiler - keep compiler small & fast
* [x] Basic parsing instructions from mdn & examples
* [x] Benchmark against wabt, wat-compiler
* [x] Build script
* [x] Test: assert function;
* [x] make sure compiler doesn't modify tree
* [x] Recognize all number formats
* [x] Format function
* [x] Refactor for flat instructions: consume into stack, rather than fixed signatures
* [x] Multiple results: block, if, loop, func
* [x] Multiple params
* [x] SIMD
* [x] nan:value
* [x] constant expressions
* [x] ~~bench wassemble~~ - broken
* [x] Floating hex
* [ ] Streamline compiler
  * [x] Remove duplication from import section
  * [ ] Each section may have a name in advance: remove it from per-section handler
  * [x] ~~Sort nodes by buckets, run single pass~~
  * [ ] Is block type same as fn type? Can fn type be flat?
* [ ] Tests: official set
* [ ] Enhance print: make it as nice as AI
* [ ] Feature: func-ref
* [ ] Feature: ref-types
* [ ] Feature: gc
* [ ] Tests: https://github.com/EmNudge/watlings
* [ ] Official test suite https://github.com/WebAssembly/testsuite
* [ ] Compiler: Named/multiple memory;
* [ ] Compiler: Named/multiple tables;
* [x] Relax no-inline limitation?
  ~ many examples use loop ... end, br 0 and other simple inliners
  ~ from code point things coming in loop/block node are not arguments, they're immediates-ish, or "body"
* [ ] make repl support switch of compiler
* [ ] better errors: should be safe to type in anything
* [ ] numeric values in data https://github.com/WebAssembly/wat-numeric-values/blob/main/proposals/wat-numeric-values/Overview.md
* [ ] extended-const (polyfill?) https://github.com/WebAssembly/extended-const

## Backlog

* [ ] reorganize OP so to store number of immediates
* [ ] wat-based wat-compiler
