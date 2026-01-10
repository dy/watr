# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
