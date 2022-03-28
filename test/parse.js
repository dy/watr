import t, { is, ok, same } from 'tst'
import parse from '../src/parse.js'

t('parser: s-expr', () => {
  const tree = parse('(module)')
  is(tree, ['module'])
})

t('parser: s-expr no instruction (throws)', () => {
  try {
    parse(tokenize('()'))
  } catch (error) {
    expect(error.message).to.include('expected: instr')
  }
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
