import compile from './compile.js'
import parse from './parse.js'

export default src => (
  src = typeof src === 'string' ? parse(src) : src,
  compile(src)
)
export {compile, parse}
