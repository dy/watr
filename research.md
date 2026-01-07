## [x] IR -> we collect nodes into context with scopes, but it's still valid nodes

* collect section names / indexes
* dedupe start
* collect-squash types
* handle imports/exports
* take code out of func
* flatten tree
* collect locals/deref
* normalize align/offset
* hoist fn names

1. Build structure/model/ir
  + precompile step from piezo
  - extra run, esp. fn body scan which is unnecessary
  - extra representation
  + we anyways have to scan funcs in advance or make func modify codes section
  + more spec'y, allows sticking to standard easier
  + likely we need parser: there's textual rules in spec different from binary
    ~ still instructions more or less map to binary

2. Map tree nodes directly to binary
  + flat map of instructions
  + allows keeping track of types live
  - requires manual name deref
    ~ not hard since we have structure
  + that allows registering new node kinds easily (assert etc)
  + compile.module(), compile.type() - for unit-testing
  - mapping func immediately doesn't make much sense: it creates code section anyways
    ~ module can handle it
      - then instructions are not direct node mappers, they act within module model


## [x] Global state vs passing state as argument -> global state is shorter

1. Global
  - model doesn't belong to root scope: there can be multiple modules or locals
  - unit-testing is therefore harder
  + way simpler to organize
  + doesn't crew up args
  + sorts like "runtime"

2. Argument
  - screws up instruction count so that we can't figure out immeds
    ~+ can be passed as `(a, b, ...[state]) => ()`
      ~- looks weird and heavy


## [x] Mapper: args, immeds, consume? -> consume

* How to flatten or group sequence?

0. Args for immed
  + Allows grouping flat sequence
  + Args anyways can be written to stack any amount
  ? Do we ever need args count for instruction? seems to be high-level purpose
  ? How do we convert group-node then?
    * `i32.load: (offset, param, ...args) => [...]`
      - how do we handle optional tokens?
        ~ we can still pass them as if they're present and normalize inside
      - spreading args into fn call is slowish and limited to 1K
        ~ we don't have to spread, we can do `args[0]` as full tree
    ~ we don't really have to deal with groups since we flatten tree
  - doesn't map tree, requires IR
  - enforces spreading args to pass node
  ? How do we handle optionals?

1. Consume nodes from total seq
  + handles immediates/args any way required
  + handles optional nodes like type, import, export, offset, param etc.
  - redundant code modifying input seq
    - increases code base size, duplication
  - mutable - breaks input tree
  - individual handlers for name, import, export

## [x] Consume state -> consume as argument, within

1. Nodes as argument, token consumes
  * `id(nodes); id = (nodes) => nodes[0][0] === '$' && nodes.shift()`
  - overflood of `.shift()` calls
  - each method cares about shift - not centralized cursor
  + works well on plain sequences of instructions `nodes => [code, ...immed(nodes)]`
  + same as old implementation

1.1 Nodes as argument, external consume
  * `id(nodes) && nodes.shift()`

2. Global cursor, like subscript/piezo
  * `opt(id); mult(modulefield);`
    - too much of fancy constructs/wrappers


## [x] Wrap to module? -> ~~likely yes - no much sense for instructions without context~~ just follow standard abbr: (module $id ...) === ...

1. Convert single/multiple/module always to module
  + ease of use
  + natural expectation, most prominent use-case
  + without module state is not initialized
  + makes code simpler (no wrapping layer)
  - unnatural transformer
  - extensions require external handle
    ~ rather a border-case, not usual

2. Compiler maps exactly the command to binary, not wrapping to module
  + allows extending commands (assert, register etc)
  - unexpected when simple code doesn't return full-fledged wasm
  - puts `module` on the same level as sections
    + can be flattened with sections and instructions
      - complicates grouping `table` vs `table.fill` etc
        + we can flat out section-prefixed instructions
          - module, block have list of instructions within: have to keep compiling
  * we still have to have a separate compiler for module for args preparing

## [x] What's faster: obj[op] or instr.indexOf(op) -> object lookup

* object lookup is 3-5x times faster

## [x] typeuse: parse or compile-level? -> indexing nodes first, typeuse on bin build second

1. Parse-level: must define all types
  * needs to scan tree, which is unnecessary

2. Compile-level: defines types during binary serialization
  * needs to collapse on section build
  + shortens parse code
  + likely we need to use it here: we can use late-binding for name/ref and so for typerefs

## [x] Hoisting -> ~~`ctx.kind[name] ??= ctx.kind.length++` and then after-init~~ must be on-par with wabt/standard to keep proper indices

1. Init nodes in order of sections
  - not necessarily helpful: global can depend on global declared later
  - adds O(n*log(n))
    ~ that's minimal overhead
2. Push current node to the end
  - can screw up exports order compared to wabt
  - it's a bit unsafe condition `if (nodes.length && !noref) nodes.push(currentNode)`
3. Save names to output, resolve at final step (binary conversion)
  - we cannot resolve type so easily from binary
    ~ we can store type along
    ? what is there can be referenced in advance besides function?
      * func, table, memory, global, type
  - extra iteration
    ~ we anyways iterate bytes by pushing in global bytes
  - looks like illicit extra transform step
  + can save code parts
  + generic solution for any forward-refs
  - has problems with calculating vec when internal refs can resolve to variable-length
  - cannot be used everywhere since code still reads from locals, blocks etc
  - causes at least type check for every single output byte
  - layers/concerns mixup: we mix binary representation with parsed parts, less clear code
4. Collect ref ids via single initial pre-run
  + Adds only O(n) (checking section nodes is way cheaper than every single byte)
  + Separates concern, not mixing up
  - It's unnecessary step same as what we do now
  - We anyways have to refer by name later so we deal with sections already
5. We create refs on-the-go like typeuse, but when we meet actual nodes they create real definition
  + avoids double pass
  + avoids binary-stage deref
  - doesn't make build[type] direct return

## [x] Generic prepare-loop vs section builders -> let's try section builders back - most simple & flexible

1. Generic prepare loop
  + generic name handling
  + generic import, export lists
  + less args for section builders
  + handles name refs in unified way
  - unnecessary checks for abbrs
  - we anyways pass context

2. Per-section handlers right away modify contexts
  + more flexibility
  + no troubles with start, func duplicate
  - duplicate of name, abbrs
    ~ can be reused via funcs?
  + allows not returning anything
  + easier to search particular parts: less meta stuff

## [x] Sync with wabt binary -> ~~let's not sync, keep meaningful small compiled version~~ likely we have to sync since it's low-hanging fruit

1. Yes
- debugging time wasted on meaningless compat
+ guaranteed work

2. No
+ compact types
  - we can't do much here
+ wabt fails some test cases
+ no time wasted
+ better codebase org

## [ ] Normalize or not? -> too little value. Try instead immutable, streamlined types

+ Allows unraveling mutable code
  ? can we make it immutable in-place?
+ Simplifies compiler
  - very little
+ Gives (false?) hope of declarative parser
- Takes unscoped time to make (bogging down with simple things)
- The precompiler code is tightly coupled, eg. struct fields names - need to be stored somewhere
- Current code seems to be more compact
+ Better order separation
  ? can we separate separately?

## [x] No wabt for testing? -> let's get rid of

- it is not reliable baseline
  - some tests not fail as expected
  - some things it cannot compile
  - it hangs with binaries
  - it has unnecessary full spec tests
- wasm/spec is what we're aiming for
- we needed it until we had repl, now we can compare against spec right away


## [ ] Str encoding, special characters ->

* $"\41B" == $"AB" == $"A\42" == $"\41\42" == $"\u{41}\u{42}"
* $"\t" == $"\09" == $"\u{09}"
* $"" == $"\ef\98\9a\ef\92\a9" == $"\u{f61a}\u{f4a9}"
* Strings generally have to handle unicodes properly, but same way maintain binary data https://webassembly.github.io/annotations/core/text/values.html#strings
* Names must be strings of valid unicode characters

* Standard suggests converting $xxx -> $"xxx"
  + that saves print function + produces valid token
  + that suggests names must be valid unicode byte sequences
  + we can safely use text encoder
  * only datastring may have raw bytes sequence

* Difference of parser vs compiler is that parser applies generic syntax structure normalization, whereas compiler (normalizer part of it) normalizes depending on node kind
  * It's not actually normalizer, normally it's called parser, and what now is called parser normally is called lexer.

1. Normalize strings in parse.js
  - brings aspect of semantics rather than plain tokens parsing into parser
  - it screws up errors look, since user sees normalized tokens instead of raw
    ~ html also sort-of does that
  - parser doesn't have to know about meaning of tokens, like `data` vs `import` vs `$`
  + string token normalization in general sense is still parsing
  + there's way too many places where id is used, take expr within data, elem, table; (inline) type idx, params, instr
    - an exception: it will know about data token to handle string a bit differently (Latin-1 maybe)
  - it's not very nice parser normalizes $abc to $"abc" - it is deabbr stage

2. Split strings by normal unicode and binary chunks, eg. "abc\defgh" becomes "abc" "\de" "fgh"

  - we don't need it: if there's raw non-unicode byte, whole string is raw.
  - messy, code is repetitive and heavy

3. If string contains raw non-unicode bytes (non-encodable to unicode) - keep it ~~raw~~ bytes array.

  + happens on moment of string insertion only, no repetitiveness
  ? How do we detect non-unicode string?
