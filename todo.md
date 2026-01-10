
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
* [x] Optimizations
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
  * [x] named sections
  * [x] branch hints
* [x] multiple memories
* [x] code_metadata
* [x] import immutable approach (from branch)
  * [x] replace wabt with direct compile instead
  * [x] Remove unnecessary checks: end label, param names
  * [x] Type declarations with map file
* [x] ~~Full immutability via idx~~ no benefit: theoretical purity over self-documented simplicity; no perf gain
* [x] Split strings into unicode / binary parts
* [x] mnemonic algo
  * [x] plain() should also do flat ~~or nested~~, to simplify tree for instr
* [x] Prettify printer: keep comments
* [x] Ignore particular test cases instead of excluding full test (like const)
* [x] Better `str`, `id` tests, `name`: streamlined with `isId()` helper to replace repetitive checks
* [x] `id` test skips important malformed cases
* [x] All WebAssembly proposals
  * [x] MVP https://github.com/WebAssembly/design/blob/main/MVP.md
  * [x] Mutable globals https://github.com/WebAssembly/mutable-global
  * [x] Non-trapping float-to-int https://github.com/WebAssembly/nontrapping-float-to-int-conversions
  * [x] Sign extension https://github.com/WebAssembly/sign-extension-ops
  * [x] Multi-value https://github.com/WebAssembly/multi-value
  * [x] BigInt/i64 integration https://github.com/WebAssembly/JS-BigInt-integration
  * [x] Reference types https://github.com/WebAssembly/reference-types
  * [x] Bulk memory https://github.com/WebAssembly/bulk-memory-operations
  * [x] Fixed-width SIMD https://github.com/webassembly/simd
  * [x] Tail call https://github.com/WebAssembly/tail-call
  * [x] Extended const https://github.com/WebAssembly/extended-const
  * [x] Typed function references https://github.com/WebAssembly/function-references
  * [x] GC https://github.com/WebAssembly/gc
  * [x] Multiple memories https://github.com/WebAssembly/multi-memory
  * [x] Relaxed SIMD https://github.com/WebAssembly/relaxed-simd
  * [x] Annotations https://github.com/WebAssembly/annotations
  * [x] Branch hinting https://github.com/WebAssembly/branch-hinting
  * [x] Exception handling https://github.com/WebAssembly/exception-handling
  * [x] JS string builtins https://github.com/WebAssembly/js-string-builtins
  * [x] Memory64 https://github.com/WebAssembly/memory64
  * [x] Wide arithmetic https://github.com/WebAssembly/wide-arithmetic
  * [x] Threads https://github.com/webassembly/threads
  * [x] ~~JS Promise Integration https://github.com/WebAssembly/js-promise-integration~~
  * [x] ~~Web Content Security Policy https://github.com/WebAssembly/content-security-policy~~
* [x] Print: make it as nice as AI
* [x] Bench binaryen
* [x] ~~replace wabt with spec/wasm for tests~~ -> no meaningful way to normalize ulebs
* [x] Types
* [x] Cleanup tests harness
* [x] ~~Source position to error messages~~ -> until we need it badly: it's a hassle for JS
* [x] ~~Sourcemaps~~
* [x] Maintain ids better: no need to convert everything to `""` - you can unquote generally, keep quotes only for strings with escapes in printer, that's it
* [x] All FIXME/TODO
* [x] Make template string for precise float values watr`(f32.const ${1.2345})`
  * [x] It can also instantiate module immediately 'let {a,b} = watr`(export a)`'

## REPL

* [x] compiler selector
* [x] examples (when no code - prompt for suggest?)
* [x] perf stats: time took to compile
* [x] prettify / minify
* [x] ~~PWA~~
* [x] drop wasm binary?
* [x] ~~normalize code button (when normalizer step is ready)~~
* [x] ~~compile button? better for SEO and UI - can have a shortcut~~
* [x] button shortcuts: Cmd+/ (comment), Cmd+]/[ (indent/outdent), Cmd+Enter (compile)
* [x] line numbers display
* [x] ~~history~~
* [x] ~~binary copy~~ -> just copy text as is
* [x] download wasm binary
* [x] binary analysis with highlight
* [x] github link
* [x] make Brahman at absolute level
* [x] navigation to comparison?, github
* [x] highlight fails: (elem (i32.const 0) (;;)(ref func) (ref.func 0))
* [x] shareable permalinks #code=(module(func (result i32) i32.const 42))
* [x] ~~tree view for binary~~ no need
* [x] ~~dark theme~~
* [x] ~~inline docs about all commands / instructions~~ -> low value, already docs
* [x] ~~resizable divider between panels~~
* [x] ~~offline use~~ no gain
* [x] ~~random code generator? (AI)?~~ -> novely, not utility. no one needs random wat.
* [x] ~~copy as binary~~ why?
* [x] ~~make a component? going to need it for jz, piezo~~ -> build from scratch

## Future

* [ ] VSCode formatter plugin
* [ ] twgl with collection of wasm-rendered webgl tweets
* [ ] jz-based watr
* [ ] wat-based wat-compiler
