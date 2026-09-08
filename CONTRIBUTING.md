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
