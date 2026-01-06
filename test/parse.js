import t, { is, ok, same, throws } from 'tst'
import parse from '../src/parse.js'

t('parser: s-expr', () => {
  const tree = parse('(module)')
  is(tree, ['module'])
})

t('parser: annotation simple', () => {
  const tree = parse('(@a)')
  is(tree, ['@a'])
})

t('parser: annotations full case', () => {
  const tree = parse(`(@a , ; ] [ }} }x{ ({) ,{{};}] ;)`)
  is(tree, ['@a', ',', ';', ']', '[', '}}', '}x{', ['{'], ',{{};}]', ';'])
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
  is(tree, ['i32.load', 'offset=0', 'align=4'])
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
  is(tokens, 'align=4')
})

t('parse: label', () => {
  const tokens = parse('$$hi')
  is(tokens, '$$hi')
})

t('parse: quoted identifiers', () => {
  let tokens = parse('(func $"hello world")')
  is(tokens, ['func', '$hello world'])

  tokens = parse('(br_if $"loop one")')
  is(tokens, ['br_if', '$loop one'])

  tokens = parse('(func $"weird\\"name\\"")')
  is(tokens, ['func', '$weird"name"'])

  // strings should preserve escapes for compiler
  tokens = parse('(data "hello\\nworld")')
  is(tokens, ['data', '"hello\\nworld"'])

  tokens = parse('(data "test\\\\path")')
  is(tokens, ['data', '"test\\\\path"'])

  // unicode escapes are decoded in parser
  tokens = parse('(data "\\u{41}\\u{42}")')
  // is(tokens, ['data', '"AB"'])
  is(tokens, ['data', '"\\u{41}\\u{42}"'])
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
  let tokens = parse('(an (; inline ;) comment\n;; line comment\n1)')
  is(tokens, ['an', 'comment', '1'])

  tokens = parse('(an (; inline ;) comment\n;; line comment\n1)', {comments: true})
  is(tokens, ['an', '(; inline ;)', 'comment', ';; line comment\n', '1'])
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

t('parse: multiple functions', () => {
  let tokens = parse('(func $a) (func $b)')
  is(tokens, [['func', '$a'], ['func', '$b']])
})

t('parse: elseif', () => {
  let tokens = parse('(if a(then)(else(if(b))))')
  is(tokens, ['if', 'a', ['then'], ['else', ['if', ['b']]]])
})

t('parse: data', () => {
  let tokens = parse('(data (i32.const 4) "`.-,_:^!~;r+|()=>l?icv[]tzj7*f{}sYTJ1unyIFowe2h3Za4X%5P$mGAUbpK960#H&DRQ80WMB@N")')
  is(tokens, [
    'data', ['i32.const', '4'],
    '"`.-,_:^!~;r+|()=>l?icv[]tzj7*f{}sYTJ1unyIFowe2h3Za4X%5P$mGAUbpK960#H&DRQ80WMB@N"'
  ])
})

t('parse: immediate comment end', () => {
  let tokens = parse(`(i32.const 0);;`)
  is(tokens, ['i32.const', '0'])
})

t('parse: export name', () => {
  let tokens = parse(`(func (export "~!@#$%^&*()_+\`-={}|[]\\\\:\\\";'<>?,./ \\\\") (result i32) (i32.const 6))`)
  is(tokens, ['func', ['export', '"~!@#$%^&*()_+`-={}|[]\\\\:\\\";\'<>?,./ \\\\"'], ['result', 'i32'], ['i32.const', '6']])
})

t('parse: quote', () => {
  let tokens = parse(`(import "" "" (global $foo i32))(global $foo i32 (i32.const 0))`)
  is(tokens, [
    ['import', '""', '""', ['global', '$foo', 'i32']],
    ['global', '$foo', 'i32', ['i32.const', '0']]
  ])
})
