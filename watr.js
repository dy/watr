/**
 * WebAssembly Text Format (WAT) compiler, parser, printer.
 *
 * @module watr
 */

import compile from './src/compile.js'
import parse from './src/parse.js'
import print from './src/print.js'

export default compile
export { compile, parse, print }
