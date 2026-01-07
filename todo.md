
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
  * [x] streamline sections parsing/build (no intermediary array)
* [x] Streamline building:
  * [x] Split func into code/func to build sections separately
  * [x] Turn import into shallow node of a kind: name alias, typeuse, replace with null
    ? how will it help making typeuse at the end, like func->code dodes?
  * [x] Try detecting typeuse in sorting stage -> append all extra type nodes at the end
    - We should have all used types ready by momemt of binary build
      ~+ code section with import
    - traverse difficulty: we plainify nested nodes first, and detecting nested types first is wrong order
      ~+ unless we adjust traverse order
    - we should not register type if that's simple result or none: that would duplicate logic
      ~+ unless we normalize marker to `(result i32)`|`(type $id)`|`empty`
  * [x] remove typeuses
  * [x] Return binary directly from build
  * [x] catch mistakes like having a string in place of node, eg `(memory.copy 0 ...)`
* [x] Separate slicing concert, remove unnecessary slices
* [x] elem all use-cases
* [x] Official tests
  * [x] Include testsuite repo
  * [x] All test instructions: assert_invalid
  * [x] All tests
* [x] Compiler: Named/multiple memory;
* [x] Compiler: Named/multiple tables;
* [x] Relax no-inline limitation?
* [x] validation / errors: should be safe to type in anything
* [x] Abbr dict instead of thick plain
  * [x] ~~Make abbr main source of transforms, don't check for `if node==section|block`~~ -> too different call signature: 1 node 1 result vs nodes list nodes result. It's section vs node
* [x] ~~Indicate immediates via list~~ -> too many expeptions, doesn't make much sense
* [x] ~~Replace missing index with `(;idx;)`~~ -> not so much benefit
* [x] GC
  * [x] Recursive types
    * [x] normalize subtypes to list, skip single recusion abbr
* [x] annotations
  * [ ] named sections
  * [ ] branch hints
* [ ] multiple memories
* [ ] Try removing all quotes
* [ ] Exceptions, memory64, code_metadata, js_strings
* [ ] Features
  * [x] Feature: extended-const (polyfill?) https://github.com/WebAssembly/extended-const
  * [x] All main ones (readme)
  * [x] Feature: numeric values in data https://github.com/WebAssembly/wat-numeric-values/blob/main/proposals/wat-numeric-values/Overview.md
  * [ ] Wasm3
* [x] Print: make it as nice as AI
* [ ] Bench binaryen
* [ ] replace wabt with spec/wasm for tests
* [ ] All tests

## REPL

* [x] compiler selector
* [ ] examples (when no code - prompt for suggest?)
* [x] perf stats: time took to compile
* [x] prettify / minify
* [ ] PWA
* [ ] drop wasm binary?
* [x] ~~normalize code button (when normalizer step is ready)~~
* [ ] compile button? better for SEO and UI - can have a shortcut
* [ ] button shortcuts: ctrl + enter, ctrl + /
* [ ] history
* [x] ~~binary copy~~ -> just copy text as is
* [x] download wasm binary
* [x] binary analysis with highlight
* [x] github link
* [x] make Brahman at absolute level
* [x] navigation to comparison?, github
* [x] highlight fails: (elem (i32.const 0) (;;)(ref func) (ref.func 0))
* [ ] shareable permalinks #code=(module(func (result i32) i32.const 42))
* [ ] tree view for binary
* [ ] dark theme
* [ ] inline docs about all commands / instructions
  * [ ] at least tooltips for syntax
* [x] ~~resizable divider between panels~~
* [ ] offline use
* [ ] random code generator? (AI)?
* [ ] copy as binary
* [ ] make a component? going to need it for jz, piezo

## Backlog

* [ ] wat-based wat-compiler
* [ ] Make template string for precise float values watr`(f32.const ${1.2345})`
  * [ ] It can also compile module right away 'let {a,b} = watr`(export a)`'

## Offering Qualifications

* minimal & clever validator - basic checks via generic funcs
* streamline, clear, light, sensible algorithm - easy to remember & understand
* meaningful base of tests covered - not verbosities
* clear, lightweight repl
