import t, { is, ok, same, throws } from 'tst'
import compile, { size } from '../src/compile.js'
import parse from '../src/parse.js'

// Independent framing oracle for one void function, including ULEB boundaries.
const leb = n => { const a = []; do { const b = n % 128; n = Math.floor(n / 128); a.push(b + (n ? 128 : 0)) } while (n); return a }
t('compile: packed function and section growth preserve exact framing', () => {
  for (const n of [0, 125, 126, 127, 4094, 4095, 65533, 65534, 65535]) {
    const ast = ['module', ['func', ...Array(n).fill('nop')]]
    const body = [0, ...Array(n).fill(1), 11]
    const payload = [1, ...leb(body.length), ...body]
    const expected = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, ...leb(payload.length), ...payload])
    const bytes = compile(ast)
    same(bytes, expected, `body with ${n} nops`)
    is(size(ast), bytes.length)
    ok(WebAssembly.validate(bytes))
  }
})

t('compile: locals are streamed without a host argument-count limit', () => {
  // Valid WAT; deliberately beyond V8's executable-local limit. An assembler
  // must still encode it. Alternating types prevent local-group compression.
  const ast = ['func', ['local', ...Array.from({ length: 70000 }, (_, i) => i % 2 ? 'f64' : 'i32')]]
  is(compile(ast).length, size(ast))
})

t('compile: frozen input, retained output and locations survive growth and recovery', () => {
  const freeze = n => { if (Array.isArray(n)) { n.forEach(freeze); Object.freeze(n) } return n }
  const ast = freeze(parse(`(module
    (type $s (sub (struct (field i32))))
    (func (export "f") (result i32)
      ;;@ large.wat:1:0
      ${'nop '.repeat(70000)} (i32.const 42))
    (func (result i32) ;;@ small.wat:2:0
      (i32.const 7)))`))
  const a = compile(ast), saved = a.slice(), map = JSON.stringify(a.sourceMap)
  throws(() => compile('(func (call $missing))'))
  const b = compile(ast)
  same(a, saved)
  same(b, saved)
  is(JSON.stringify(b.sourceMap), map)
  same(b.sourceMap.sources, ['large.wat', 'small.wat'])
  is(new WebAssembly.Instance(new WebAssembly.Module(b)).exports.f(), 42)
  is(size(ast), b.length)
})
