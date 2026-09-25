import t, { is, ok, same, throws } from 'tst'
import { parse, isWasm } from './runner.js'

t('parser: s-expr', () => {
  const tree = parse('(module)')
  is(tree, ['module'])
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

t('parser: data single byte', () => {
  const tree = parse(`(data (i32.const 0) "\\2a")`)
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
  const tokens = parse('$"$i" $$hi')
  is(tokens, ['$"$i"', '$$hi'])
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
  is(tokens, ['an', '(; inline ;)', 'comment', ';; line comment\n', '1'])

  tokens = parse('(an (;inline;) comment\n;; line comment\n1)')
  is(tokens, ['an', '(;inline;)', 'comment', ';; line comment\n', '1'])
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
  is(tokens, [['hello', '$hi', '"world"'], ';; (should) be a comment\n', 'and', '(; another ;)', 'line', '0x312', '43.23'])
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
  is(tokens, [['i32.const', '0'], ';;'])
})

t('parse: export name', () => {
  let tokens = parse(`(func (export "~!@#$%^&*()_+\`-={}|[]\\\\:\\\";'<>?,./ \\\\") (result i32) (i32.const 6))`)
  is(tokens, ['func', ['export', `"~!@#$%^&*()_+\`-={}|[]\\\\:\\\";'<>?,./ \\\\"`], ['result', 'i32'], ['i32.const', '6']])
})

t('parse: quotes', () => {
  let tokens = parse(`(import "" "abc" (global $foo i32))(global $foo i32 (i32.const 0))`)
  is(tokens, [['import', '""', '"abc"', ['global', '$foo', 'i32']], ['global', '$foo', 'i32', ['i32.const', '0']]])
})

t('parse: unclosed quote', () => {
  throws(() => parse(`(import "" ")`))
})

t('parse: source spans preserve token boundaries and parser reuse', () => {
  const cases = [
    ['', []], ['()', []], [' \t\r\n', []],
    ['x', 'x'], ['(x)', ['x']], ['(x )', ['x']],
    ['""', '""'], ['$"a b"', '$"a b"'],
    ['x"y"', ['x', '"y"']], ['$$"y"', ['$$', '"y"']],
    ['"a\\"b"', '"a\\"b"'], ['"a\\\\"', '"a\\\\"'],
    ['(@a)', ['@a']], ['(@a "b")', ['@a', '"b"']],
    ['(x(;a(;b;)c;)y)', ['x', '(;a(;b;)c;)', 'y']],
    [';;', ';;'], [';;x', ';;x'], [';;x\n', ';;x\n'], [';;x\r', ';;x\r'],
    ['(x;;y)', ['x', ';;y']], ['(x;;y\n)', ['x', ';;y\n']],
    ['(x;;y\r)', ['x', ';;y\r']], ['(x;;y\r\nz)', ['x', ';;y\r', 'z']],
    ['"😀\ud800"', '"😀\ud800"'],
  ]
  for (const [source, expected] of [...cases, ...cases, ...cases.slice().reverse()])
    is(parse(source), expected, JSON.stringify(source))
  // The Wasm boundary returns array elements, not their named properties.
  // JZ's WAT-parser invariant checks these locations inside compiled code.
  if (!isWasm) {
    const tree = parse(' (x (y))')
    is(tree.loc, 1)
    is(tree[1].loc, 4)
  }
  for (const source of ['(', '(x', '"', '"x', '"x\\', '(;', '(;x;', '(;x(;y;)']) {
    throws(() => parse(source), source)
    is(parse('(ok)'), ['ok'], 'an error leaves the next parse independent')
  }
})

t('parse: long tokens retain exact source spelling', () => {
  const text = 'a😀'.repeat(4000)
  for (const token of [text, `"${text}"`, `$"${text}"`, `(;${text};)`, `;;${text}\n`])
    is(parse(`(x ${token})`), ['x', token])
})


t('parse: optional source locations preserve tokens, errors and reuse', () => {
  const sources = ['', '()', '(x)', ' (x (y))', '(x "😀\ud800" (; c ;) (z))', '(a)(b)']
  for (const source of [...sources, ...sources, ...sources.slice().reverse()]) {
    const plain = parse(source, { loc: false }), located = parse(source)
    is(JSON.stringify(plain), JSON.stringify(located))
    if (!isWasm) {
      const check = node => {
        if (!Array.isArray(node)) return
        ok(!Object.hasOwn(node, 'loc'))
        node.forEach(check)
      }
      check(plain)
    }
  }
  for (const source of ['(', '(x', '"', '(;', '(x)) trailing']) {
    let expected, actual
    try { parse(source) } catch (e) { expected = e.message }
    try { parse(source, { loc: false }) } catch (e) { actual = e.message }
    ok(expected)
    is(actual, expected, 'parse errors retain offsets without node locations')
  }
  if (!isWasm) {
    is(parse(' (x)', { loc: true }).loc, 1)
    is(parse(' (x)', {}).loc, 1)
    is([' (x)', '  (y)'].map(parse).map(n => n.loc), [1, 2])
  }
})
