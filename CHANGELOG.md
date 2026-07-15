# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v5.7.7

- fix: tolerate process shims without an `env` object in the count-oracle gate

[Compare](https://github.com/dy/watr/compare/v5.7.6...v5.7.7)

## v5.7.6

- fix: gate the local-use count oracle through `process.env` so self-hosted builds do not import `globalThis`

[Compare](https://github.com/dy/watr/compare/v5.7.5...v5.7.6)

## v5.7.5

- fix: inlining no longer resets a scratch local whose write dominates its reads within the same conditional arm
- preserve per-call zero initialization across joins, zero-trip loops, and branch-bypassed assignments

[Compare](https://github.com/dy/watr/compare/v5.7.4...v5.7.5)

## v5.4.1

- fix: `fold` reads hex-float constants (`0x1p-1022`) through `f64.parse` — `Number()` yielded NaN, poisoning constant products (broke subnormal `Math.pow` scaling in jz-compiled modules)

[Compare](https://github.com/dy/watr/compare/v5.4.0...v5.4.1)

## v5.4.0

- `walkN` / `walkPostN` public walkers — arrays-only traversal (leaves skipped), for callbacks that never act on string/number leaves
- `optimize`: `seltree` — dense `br_table` of speculable arms compiles to a branchless select tree (speed profile)
- `optimize`: `ifset` — one-armed conditional update lowers to a branchless `select` (speed profile)
- `optimize`: `deadset` — const `local.set` overwritten on every path before any read is dropped
- `optimize`: `zeroinit` — `local.set` of the spec-default zero is dropped
- `optimize`: `narrowLocals` + `intguard` — ToInt32 machinery retires over provably-int locals, gated on net convert profit
- `optimize`: `inlineWrappers` — adapter frames dissolve into their target at the wrapper site
- `optimize`: `identity` folds exact `trunc∘convert` f64 round-trips and impossible `convert_i32` vs const compares
- fix: `br_if` pair merge no longer speculates a load past its guard (the first `br_if` of a scan is the second's bounds check)
- fix: `guardRefine` else-arm facts no longer leak past the join
- self-host compile ~12% faster overall (hot-walk specialization + arrays-only walkers, byte-identical output)

[Compare](https://github.com/dy/watr/compare/v5.3.0...v5.4.0)

## v4.7.0

### Fixed

- **`optimize`: `branch` preserves the block type when folding a constant
  `if`.** Collapsing `(if (result T) <const-cond> (then …) (else …))` to the
  taken branch dropped the `(result T)` (and any `(param …)`), so a branch that
  leaves a value on the stack became a void `(block …)` — the value then dangled
  past the block, producing invalid wasm (`expected 0 elements on the stack for
  fallthru, found 1`). The folded branch now keeps the `if`'s block type. Surfaces
  on a typed `if` whose taken arm yields a value, e.g. a `Math.min`-style
  `(block (result f64) … (select …))` under an always-true condition.

### Added

- **`optimize`: `loopify` pass** (on by default) — collapses the canonical
  `while`-loop encoding
  ```
  (block $A (loop $B (br_if $A (i32.eqz cond)) …body… (br $B)))
  ```
  into `(loop $B (if cond (then …body… (br $B))))`. Drops the outer block
  framing, the `br_if`, and a leading `i32.eqz`; trades them for an `if`/`end`.
  Saves ~3 B per while-loop. Only fires when the outer block / loop are both
  void and $A is never targeted from within the body. Skip for typed
  block/loop pairs (preserves a real stack signature).
- **`optimize`: `fold` covers reinterprets and numeric conversions.**
  `(i64.reinterpret_f64 (f64.const …))`, `(f64.convert_i32_s (i32.const …))`
  and friends now fold at compile time — bit-exact (including NaN payloads)
  via `ArrayBuffer`-backed views, so `Math.fround` semantics for f32 are
  preserved. Common in numeric kernels that serialize f64 values through an
  i64 channel (e.g. tagged-pointer schemes).

## v4.6.0

### Added

- **`optimize`: `inlineOnce` pass** (on by default) — inlines functions called
  from exactly one place into their lone caller, then deletes them. Never
  duplicates code and never inflates (drops a func entry, a `call`, and often a type
  entry, paying back only a `block`/`local.set` wrapper); collapses helper chains to
  a fixpoint. Renames the callee's params/locals/labels to avoid shadowing.
- **`optimize`: `mergeBlocks` pass** (on by default) — unwraps untyped
  `(block $L …)` whose label is never branched to, splicing the body into its
  enclosing scope. Tracks label shadowing so an inner `block $L` doesn't mask the
  outer one's use, and skips blocks with `(param …)`/`(result …)`/`(type …)` since
  those imply a real stack signature.
- **`optimize`: `coalesceLocals` pass** (on by default) — shares local slots
  between same-type locals whose live ranges don't overlap. Live ranges are
  computed by a single execution-order walk (children of `local.set`/`local.tee`
  are visited before the set, so a read-then-write inside a set-rhs is correctly
  flagged) and extended to cover any enclosing `loop`. Locals whose first
  reference is a `local.get`, or whose first reference is inside an `if`/`else`
  branch, are never coalesced *into* an existing slot — they would otherwise
  observe the previous occupant's residue instead of the implicit zero / their
  own set on the alternate path.

### Changed

- **`optimize`: `propagate` is now on by default and can no longer inflate.** It
  used to be opt-in because copying a constant to many use sites could *grow* the
  module; now it only ever substitutes (a) a pure single-use local (always shrinks —
  drops the `set`, the lone `get` and the `local` decl) or (b) a constant narrow
  enough that inlining it is byte-neutral at worst. It also descends into nested
  `block`/`loop`/`then`/`else` scopes (so the `(block (result …) (local.set $p arg) …
  (local.get $p))` wrappers `inlineOnce` leaves behind get collapsed), runs a second
  sweep right after the inliners within each round, and correctly drops a tracked
  value once a local it reads is rewritten.
- **`optimize`: round size guard now measures encoded bytes, not AST node count.**
  Passes like `globals` / `inlineOnce` are node-count-neutral yet move real bytes,
  so the old `count()` guard couldn't see them. Each round is now kept only if
  `compile(ast).length` didn't grow (past a small tolerance in non-strict mode); a
  round that produces invalid wat (compile throws) also reverts instead of escaping.
- **`optimize`: `globals` pass is now size-aware.** It used to inline *every*
  immutable global constant unconditionally — turning many cheap `global.get`s
  (~2 B) into fat immediates (`i32.const` up to 4 B, `f64.const` 9 B) and *growing*
  large modules. Now a global is only propagated when `reads·constSize ≤ reads·2 +
  declSize`, and a global whose every read was replaced has its now-dead decl
  removed here too.

### Fixed

- `optimize`: `unbranch` no longer drops the value operand of a trailing
  `(br $L v…)` it removes when the block carries a `(result …)`.

## v4.0.0

### Breaking Changes

- **Default export changed**: `watr` (instant compile+instantiate) replaces `compile`
  ```js
  // v3.x
  import compile from 'watr'
  const binary = compile('(module ...)')

  // v4.x
  import watr from 'watr'
  const { add } = watr`(func (export "add") ...)`  // returns exports!

  // v4.x: to get binary, use named import
  import { compile } from 'watr'
  const binary = compile('(module ...)')
  ```

### Added

- **Template literal API**: `watr\`...\`` for instant WASM functions
- **Auto-import JS functions**: `watr\`(call ${console.log} (i32.const 42))\``
- **Value interpolation**: numbers, BigInts, identifiers, Uint8Arrays, code strings
- **CLI**: `npx watr input.wat` compiles to `.wasm`, `--print`/`--minify` for formatting
- **REPL**: Interactive playground at https://dy.github.io/watr/repl/
- **Error positions**: Line:column in error messages
- **JSDoc**: Comprehensive documentation for all exports
- Parser: Better comment handling with nesting support
- Parser: Depth tracking for unclosed parens/quotes
- Printer: Comment preservation option
- Printer: Proper `try_table` formatting

### Changed

- Internal: Restructured `const.js` with mnemonic encoding
- Internal: Cleaner immediate type handling

### Fixed

- Trailing line comments parsing
- Hex float precision
- Range checks for i32/i64 constants

## [3.3.0] - 2024

### Added

- Multiple memories support
- Tag section
- Custom sections (`@custom`)
- Annotations parsing
- String IDs in parser

### Fixed

- Memory alignment handling
- Official test suite compliance

## [3.2.1] - 2024

### Fixed

- Minor bug fixes

## [3.2.0] - 2024

### Added

- TypeScript declarations
- Submodule exports (`watr/parse`, `watr/print`, `watr/compile`)

## [3.1.0] - 2024

### Added

- Typed function references
- Tail calls
- Relaxed SIMD
- Reference types (`table.get/set/grow/fill`)
- Better error messages with validation

### Changed

- Reorganized internal instruction handling
- Optimized compiler passes

## [3.0.0] - 2024

### Breaking Changes

- Complete rewrite of compiler internals
- Dropped support for legacy abbreviation forms

### Added

- GC proposal support (structs, arrays, recursive types)
- Official WebAssembly test suite compliance
- Named memories and tables
- Full elem/data section syntax

### Changed

- Switched to official tests as primary test suite
- Reorganized internal node processing

## [2.x] - Legacy

Early versions with MVP + basic proposal support.
See git history for details.

---

[Unreleased]: https://github.com/dy/watr/compare/v3.3.0...HEAD
[3.3.0]: https://github.com/dy/watr/compare/v3.2.1...v3.3.0
[3.2.1]: https://github.com/dy/watr/compare/v3.2.0...v3.2.1
[3.2.0]: https://github.com/dy/watr/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/dy/watr/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/dy/watr/compare/v2.4.1...v3.0.0
