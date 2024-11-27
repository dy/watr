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


## [x] Wrap to module? -> likely yes - no much sense for instructions without context

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

## [ ] typeuse: parse or compile-level? -> likely late binding

1. Parse-level: must define all types
  * needs to scan tree, which is unnecessary

2. Compile-level: defines types during binary serialization
  * needs to collapse on section build
  + shortens parse code
  + likely we need to use it here: we can use late-binding for name/ref and so for typerefs

## [ ] Hoisting

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
