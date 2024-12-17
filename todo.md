
## goal

* must be working nicely

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
* [x] Streamline compiler
  * [x] Remove duplication from import section
  * [x] Each section may have a name in advance: remove it from per-section handler
  * [x] ~~Sort nodes by buckets, run single pass~~
  * [x] Incorporate alt compiler into main one
    * [x] register by names from common place
    * [x] resolve import stubs
    * [x] push returning arrays instead of modifying ctx (section.type)
    * [x] resolve refs / hoisting
    * [x] ~~collect by sections first, as array, to flat-map after~~
    * [x] Use keys for ops
    * [x] Get rid of precompile, do binary immediately, just re-add nodes as abbr
    * [x] Optimize import
    * [x] consumeType -> typeuse (better storage)
    * [x] vec
    * [x] common parts pre-parse
* [ ] Optimizations
  * [x] split generic precompile into section builders as was in v1
  * [x] ~~introduce more complete ref/deref use~~ -> we can't really solve full hoisting issue (types, code refs)
  * [x] make IR: types indexing, code deferring
  * [x] ~~make generic consuming ops for instructions instead of condition checks~~ -> it's too metaphysical & unclear how to handle generic cases
  * [x] ~~flatten (deabbr) ops (if makes sense)~~ nah, we don't have fixed immeds
  * [x] make func init code immediately instead of duplicating code
  * [x] Use instr instead of expr for wider support (extrapolate standard)?
  * [x] Do away with ALIGNS const, calc mem properly
  * [ ] streamline sections parsing/build (no intermediary array)
* [x] elem all use-cases
* [ ] Print: make it as nice as AI
* [ ] Feature: func-ref
* [ ] Feature: ref-types
* [ ] Feature: gc
* [ ] Official tests
  * [x] Include testsuite repo
  * [ ] All test instructions: assert_invalid
  * [ ] All tests
* [x] Compiler: Named/multiple memory;
* [x] Compiler: Named/multiple tables;
* [x] Relax no-inline limitation?
* [ ] validation / errors: should be safe to type in anything
* [ ] Feature: numeric values in data https://github.com/WebAssembly/wat-numeric-values/blob/main/proposals/wat-numeric-values/Overview.md
* [x] Feature: extended-const (polyfill?) https://github.com/WebAssembly/extended-const
* [ ] Wasm3

## REPL

* [ ] compiler selector
* [ ] examples
* [ ] perf stats
* [ ] prettifier

## Backlog

* [ ] wat-based wat-compiler


## Offering Qualifications

* minimal & clever validator - basic checks via generic funcs
* streamline, clear, lightweight algorithm - easy to remember
* meaningful base of tests covered - not verbosities
* clear, lightweight repl
