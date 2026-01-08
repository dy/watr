import t, { is, ok, same, throws } from 'tst'
import parse from '../src/parse.js'

t('parser: s-expr', () => {
  const tree = parse('(module)')
  is(tree, ['module'])
})

t('parser: s-expr named', () => {
  const tree = parse('(module $hello)')
  is(tree, ['module', '$"hello"'])
})

t('parser: ref labels as children', () => {
  const tree = parse('(elem (i32.const 0) $f1 $f2)')
  is(tree, ['elem', ['i32.const', '0'], '$"f1"', '$"f2"'])
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
  is(tree, ['func', '$"answer"', ['result', 'i32'], ['i32.add', ['i32.const', '20'], ['i32.const', '22']]])
})

t('parser: minimal export function', () => {
  const code = '(func (export "answer") (result i32) (i32.const 42))'
  const tree = parse(code)
  is(tree, ['func', ['export', [97, 110, 115, 119, 101, 114]], ['result', 'i32'], ['i32.const', '42']])
})

t('parser: data single byte', () => {
  const tree = parse(`(data (i32.const 0) "\\2a")`)
  is(tree, ['data', ['i32.const', '0'], [42]])
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
  const tokens = parse('$"$hi" $$hi')
  is(tokens, ['$"$hi"', '$"$hi"'])
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

  tokens = parse('(an (;inline;) comment\n;; line comment\n1)')
  is(tokens, ['an', 'comment', '1'])

  tokens = parse('(an (; inline ;) comment\n;; line comment\n1)', { comments: true })
  is(tokens, ['an', '(; inline ;)', 'comment', ';; line comment\n', '1'])
})

t('parser: annotation simple', () => {
  const tree = parse('(@a)')
  is(tree, ['@a'])
})

t('parser: annotations full case', () => {
  const tree = parse(`(@a , ; ] [ }} }x{ ({) ,{{};}] ;)`)
  is(tree, ['@a', ',', ';', ']', '[', '}}', '}x{', ['{'], ',{{};}]', ';'])
})


t('parse: nul', () => {
  const tokens = parse(' \n\t')
  is(tokens, [])
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
  is(tokens, [['hello', '$"hi"', [119, 111, 114, 108, 100]], 'and', 'line', '0x312', '43.23'])
})

t('parse: minimal function', () => {
  let tokens = parse('(func (export "answer") (result i32) (i32.const 42))')
  is(tokens, ['func', ['export', [97, 110, 115, 119, 101, 114]], ['result', 'i32'], ['i32.const', '42']])
})

t('parse: multiple functions', () => {
  let tokens = parse('(func $a) (func $b)')
  is(tokens, [['func', '$"a"'], ['func', '$"b"']])
})

t('parse: elseif', () => {
  let tokens = parse('(if a(then)(else(if(b))))')
  is(tokens, ['if', 'a', ['then'], ['else', ['if', ['b']]]])
})

t('parse: data', () => {
  let tokens = parse('(data (i32.const 4) "`.-,_:^!~;r+|()=>l?icv[]tzj7*f{}sYTJ1unyIFowe2h3Za4X%5P$mGAUbpK960#H&DRQ80WMB@N")')
  is(tokens, [
    'data', ['i32.const', '4'],
    [96, 46, 45, 44, 95, 58, 94, 33, 126, 59, 114, 43, 124, 40, 41, 61, 62, 108, 63, 105, 99, 118, 91, 93, 116, 122, 106, 55, 42, 102, 123, 125, 115, 89, 84, 74, 49, 117, 110, 121, 73, 70, 111, 119, 101, 50, 104, 51, 90, 97, 52, 88, 37, 53, 80, 36, 109, 71, 65, 85, 98, 112, 75, 57, 54, 48, 35, 72, 38, 68, 82, 81, 56, 48, 87, 77, 66, 64, 78]
  ])
})

t('parse: immediate comment end', () => {
  let tokens = parse(`(i32.const 0);;`)
  is(tokens, ['i32.const', '0'])
})

t('parse: export name', () => {
  let tokens = parse(`(func (export "~!@#$%^&*()_+\`-={}|[]\\\\:\\\";'<>?,./ \\\\") (result i32) (i32.const 6))`)
  is(tokens, ['func', ['export', [126, 33, 64, 35, 36, 37, 94, 38, 42, 40, 41, 95, 43, 96, 45, 61, 123, 125, 124, 91, 93, 92, 58, 34, 59, 39, 60, 62, 63, 44, 46, 47, 32, 92]], ['result', 'i32'], ['i32.const', '6']])
})

t('parse: quotes', () => {
  let tokens = parse(`(import "" "abc" (global $foo i32))(global $foo i32 (i32.const 0))`)
  is(tokens, [['import', [], [97, 98, 99], ['global', '$"foo"', 'i32']], ['global', '$"foo"', 'i32', ['i32.const', '0']]])
})

t('parse: unclosed quote', () => {
  throws(() => parse(`(import "" ")`))
})
