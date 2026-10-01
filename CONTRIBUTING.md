# Contributing

Contributions welcome. Keep it simple.

## Setup

```bash
git clone https://github.com/dy/watr.git
cd watr
npm install
npm test
```

## Guidelines

1. **One concern per PR** — Don't mix features with refactors
2. **Tests required** — Add/update tests in `test/`
3. **No new dependencies** — Zero deps is a feature
4. **Match existing style** — ES modules, functional, early returns

## Testing

```bash
npm test                    # Full test suite
npm run test:repl           # REPL integration tests
```

Tests must pass on Node 24+ with `--experimental-wasm-exnref`.

The lockfile pins the working JZ source revision for both compilation and
interop; `npm ci`, `npm run build:wasm`, and `npm run test:wasm` need no override.
Replace the source pin with an npm release once it includes these fixes.
To test a different JZ checkout, use it for both steps:

```bash
JZ_ROOT=../jz npm run build:wasm
JZ_ROOT=../jz npm run test:wasm
```

`JZ_ROOT` is explicit; without it the build and runner both use installed JZ.
Do not test an older `dist/watr.wasm` after a failed build. A section-length
error even for `(func)` can indicate an obsolete build compiler; JZ 0.8.1
truncates the code section with the current packed encoder.

## Code Style

- Abbreviated but clear naming
- Minimal, functional
- Early returns over nested ifs
- No semicolons in watr.js (match source)
- Keep optimizer passes and their private helpers in `src/optimize.js`; separate source files should represent a package entry or shared infrastructure
- Structural equality and keys must distinguish numeric `0` from `-0`, just as parsed `"0"` and `"-0"` differ. Use `literalKey` for optimizer hash leaves; signed-zero regressions in `test/optimize.js` exercise both float widths and numeric AST inputs.
- Constant propagation may evaluate a local's pure defining expression through other known locals without expanding those constants into every read. Keep the existing write invalidation and constant folders authoritative, bound transitive work, and replace only expressions whose folded encoding does not grow.
- Local slot reuse propagates exits through assignment values. A write skipped by its value cannot donate its destination's implicit zero; unrelated local lifetimes remain eligible for sharing.
- Local propagation keeps branch-capable values before later operand writes: a bailout can observe caller locals without reading them in the value. The same rule applies to calls under a caller-local exception handler.
- Block removal must retain depth-relative branch frames, including unnamed blocks and frames crossed on the way to an outer target. A missing named-label reference alone does not prove a frame removable.
- Data packing uses the encoder's string decoder, so UTF-8 bytes and Unicode escapes determine both offsets and contents. String codecs collect pieces and join once; repeated concatenation retains quadratic storage in a bump allocator. Large byte runs use indexed pushes, not argument spreads.

## What We're Looking For

- Bug fixes with reproduction
- Test coverage improvements
- Documentation clarifications
- Performance without complexity

## What We're Not Looking For

- Style changes without functional improvement
- Dependencies
- Features without use cases
- "Improvements" that add complexity

## Questions?

Open an issue. Keep it focused.
