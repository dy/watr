import parse, { expr } from 'subscript/core'

[
 '(', (a,b,fn) => (
    a && err('a(b) is not wat'),
    b=expr(0,CPAREN) || err('empty condition'),
    b
  ), 

  'module', () => (),
  'table', () => (post('init','copy')),
  'func', () => (),
  'elem', () => (post('drop')),
  'type', () => (),
  'result', () => (),
  'call_indirect', () => (),
  'func', () => (),
  'param', () => (),
  'memory', () => (post('init', 'copy', 'fill')),
  'export', () => (),
  'data', () => (post('drop')),
]

// bulk-ops: .init, .copy, .drop, .fill
const post = () => {
}
