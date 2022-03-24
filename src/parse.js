import parse from 'subscript/parse.js'

[
 '(', (a,b,fn) => (
    a && err(),
    b=expr(0,CPAREN) || err('empty condition'),
    b
  ),

  'module', () => (),
  // 'table', () => (post('init','copy')),
  // 'func', () => (),
  // 'elem', () => (post('drop')),
  // 'type', () => (),
  // 'result', () => (),
  // 'call_indirect', () => (),
  // 'func', () => (),
  // 'param', () => (),
  // 'memory', () => (post('init', 'copy', 'fill')),
  // 'export', () => (),
  // 'data', () => (post('drop')),
]

// bulk-ops: .init, .copy, .drop, .fill
const post = () => {
}
