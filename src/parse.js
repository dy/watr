import parse, {set, expr, err, lookup, isId, skip, cur, idx} from 'subscript/parse.js'
import { OP } from './const.js'

const OPAREN=40, CPAREN=41, OBRACK=91, CBRACK=93, SPACE=32, DQUOTE=34, PERIOD=46, _0=48, _9=57,
PREC_SEQ=1, PREC_SOME=4, PREC_EVERY=5, PREC_OR=6, PREC_XOR=7, PREC_AND=8,
PREC_EQ=9, PREC_COMP=10, PREC_SHIFT=11, PREC_SUM=12, PREC_MULT=13, PREC_UNARY=15, PREC_POSTFIX=16, PREC_CALL=18

set('(', 10, (a,b) => {
  if (a) return
  a = []
  // || err('Unknown keyword')]
  while(b=expr(0)) a.push(b)
  skip(c=>c==CPAREN)
  return a
})
// offset=1, align=1 must be (offset 1) (align 1) like (param x)
set('=', 1, (a,b) =>[a, expr(1)])

// Take . or " as part of id. Don't waste parsing resource
lookup[0] = c => skip(c => isId(c) || c === PERIOD || c === DQUOTE)
// set('.', 1, (a,b) =>a + '.' + expr(1))
// set('"', 10, (a) => console.log(a)||skip(c => c-DQUOTE?1:0) + skip(1))

export default parse
