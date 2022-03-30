import t, { is, ok, same } from 'tst'
import parse from '../src/parse.js'

t('parser: s-expr', () => {
  const tree = parse('(module)')
  is(tree, ['module'])
})

t.skip('parser: s-expr no instruction (throws)', () => {
  try {
    parse('()')
  } catch (error) {
    ok(/Empty/.test(error.message))
    return
  }
  throw 'Failed'
})

t('parser: s-expr named', () => {
  const tree = parse('(module $hello)')
  is(tree, ['module', '$hello'])
})

t('parser: ref labels as children', () => {
  const tree = parse('(elem (i32.const 0) $f1 $f2)')
  is(tree, ['elem', ['i32.const', '0'], '$f1', '$f2'])
})

t('parser: s-expr number params', () => {
  const tree = parse('(memory 1 2)')
  is(tree, ['memory', '1', '2'])
})

t('parser: s-expr number params + named params', () => {
  const tree = parse('(memory 1 2 shared)')
  is(tree, ['memory', '1', '2', 'shared'])
})

t('parser: s-expr named params with = value', () => {
  const tree = parse('(i32.load offset=0 align=4)')
  is(tree, ['i32.load', ['offset','0'], ['align','4']])
})

t('parser: stack instruction', () => {
  const code = '(func i32.const 42)'
  const tree = parse(code)
  is(tree, ['func', 'i32.const', '42'])
})

t('parser: many stack instructions', () => {
  const code = '(func i32.const 22 i32.const 20 i32.add)'
  const tree = parse(code)
  is(tree, ['func', 'i32.const', '22', 'i32.const', '20', 'i32.add'])
})

t('parser: children', () => {
  const code = '(func $answer (result i32) (i32.add (i32.const 20) (i32.const 22)))'
  const tree = parse(code)
  is(tree, ['func', '$answer', ['result', 'i32'], ['i32.add', ['i32.const', '20'], ['i32.const', '22']]])
})

t('parser: minimal export function', () => {
  const code = '(func (export "answer") (result i32) (i32.const 42))'
  const tree = parse(code)
  is(tree, ['func', ['export', '"answer"'], ['result', 'i32'], ['i32.const', '42']])
})

t.skip('parser: children', () => {
  const code = String.raw`(data (i32.const 0) "\2a")`
  const tree = parse(code)
  console.log(code)
  is(tree, ['data', ['i32.const', '0'], '"\\2a"'])
})

t('parse: instr', () => {
  const tokens = parse('hello')
  is(tokens, 'hello')
})

t('parse: param', () => {
  const tokens = parse('align=4')
  is(tokens, ['align', '4'])
})

t('parse: label', () => {
  const tokens = parse('$$hi')
  is(tokens, '$$hi')
})

t.skip('parse: string', () => {
  const r = String.raw
  const tokens = parse(r`"hello""ano\"t\n\ther""more"`)
  expect(tokens).to.deep.equal([
    { value: 'hello', kind: 'string', index: 0 },
    { value: r`ano\"t\n\ther`, kind: 'string', index: 7 },
    { value: 'more', kind: 'string', index: 22 }
  ])
})

t('parse: number', () => {
  const tokens = parse('123')
  is(tokens, '123')
})

t('parse: hex', () => {
  const tokens = parse('0xf2')
  is(tokens, '0xf2')
})

t('parse: comments', () => {
  const tokens = parse('(an (; inline ;) comment\n;; line comment\n1)')
  is(tokens, ['an', 'comment', '1'])
})

t('parse: nul', () => {
  const tokens = parse(' \n\t')
  is(tokens, undefined)
})

t.skip('parse: error', () => {
  try {
    let tree = parse('§what')
  } catch (e) {
    ok(/syntax/.test(e.message))
  }
})

t('parse: number', t => {
  ;[
    '12',
    '12.3',
    '-12.3',
    '+12.3',
    '1e5',
    '1.23e5',
    '1.23e-5',
    '1.23e+5',
    'nan',
    'inf',
    '+inf',
    '-inf',
  ].forEach(n => {
    const tokens = parse(n)
    is(tokens, n)
  })

  ;[
    '-0xf2',
    '+0xf2',
    '0xf2.ef',
    '0xf2.ePf',
    '0xf2.P-f',
    'nan:0xff',
  ].forEach(n => {
    const tokens = parse(n)
    is(tokens, n)
  })
})


t('parse: complex case 1', () => {
  const tokens = parse(`(
(hello $hi
"world")
;; (should) be a comment
and (; another ;) line 0x312 43.23
)`)
  is(tokens, [['hello', '$hi', '"world"'], 'and', 'line', '0x312', '43.23'])
})

t('parse: minimal function', () => {
  let tokens = parse('(func (export "answer") (result i32) (i32.const 42))')
  is(tokens, ['func', ['export', '"answer"'], ['result', 'i32'], ['i32.const', '42']])
})
