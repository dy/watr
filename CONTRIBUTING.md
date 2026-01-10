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
