#!/usr/bin/env node
/**
 * watr CLI - WebAssembly Text Format compiler
 *
 * Usage:
 *   watr input.wat                    # compile to input.wasm
 *   watr input.wat -o output.wasm     # compile to output.wasm
 *   watr input.wat --print            # pretty-print WAT
 *   watr input.wat --minify           # minify WAT
 *   watr input.wat --polyfill         # polyfill newer features to MVP
 *   watr --help                       # show help
 *
 * @module watr/bin
 */

import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import compile from '../src/compile.js'
import print from '../src/print.js'
import polyfill from '../src/polyfill.js'
import parse from '../src/parse.js'

const args = process.argv.slice(2)

// Parse polyfill option first (to exclude feature arg from files)
let polyfillOpts = null
const polyfillIdx = args.findIndex(a => a === '--polyfill')
let polyfillFeatureArg = null
if (polyfillIdx !== -1) {
  // Check if next arg is feature list (not a flag or file)
  const next = args[polyfillIdx + 1]
  if (next && !next.startsWith('-') && !next.includes('.') && next !== '-') {
    polyfillOpts = next
    polyfillFeatureArg = next
  } else {
    polyfillOpts = true
  }
}

// Parse -o output arg
const outIdx = args.findIndex(a => a === '-o' || a === '--output')
const outArg = outIdx !== -1 ? args[outIdx + 1] : null

const flags = new Set(args.filter(a => a.startsWith('-') && a !== '-'))
const files = args.filter(a => (!a.startsWith('-') || a === '-') && a !== polyfillFeatureArg && a !== outArg)

// Help
if (flags.has('-h') || flags.has('--help') || !files.length) {
  console.log(`
watr - Light & fast WAT compiler

Usage:
  watr <input.wat> [options]

Options:
  -o, --output <file>   Output file (default: input.wasm)
  -p, --print           Pretty-print WAT to stdout
  -m, --minify          Minify WAT to stdout
  --polyfill [features] Polyfill newer features to MVP (default: all)
                        Features: funcref sign_ext nontrapping bulk_memory
                                  return_call i31ref extended_const multi_value
  -h, --help            Show this help

Examples:
  watr add.wat                    # → add.wasm
  watr add.wat -o lib/add.wasm    # → lib/add.wasm
  watr add.wat --print            # pretty-print
  watr add.wat --polyfill         # polyfill all features
  watr add.wat --polyfill funcref # polyfill specific features
  cat add.wat | watr -            # stdin → stdout (binary)

ॐ https://github.com/dy/watr
`)
  process.exit(flags.has('-h') || flags.has('--help') ? 0 : 1)
}

// Input
const input = files[0]
const src = input === '-'
  ? readFileSync(0, 'utf8')
  : readFileSync(input, 'utf8')

// Print mode
if (flags.has('-p') || flags.has('--print')) {
  console.log(print(src, { indent: '  ', newline: '\n' }))
  process.exit(0)
}

// Minify mode
if (flags.has('-m') || flags.has('--minify')) {
  console.log(print(src, { indent: '', newline: '' }))
  process.exit(0)
}

// Compile mode
let ast = parse(src)
if (polyfillOpts) ast = polyfill(ast, polyfillOpts)
const binary = compile(ast)

// Output
const output = outIdx !== -1 && args[outIdx + 1]
  ? args[outIdx + 1]
  : input === '-'
    ? null
    : input.replace(/\.wat$/, '') + '.wasm'

if (output) {
  writeFileSync(output, binary)
  console.error(`✓ ${basename(output)} (${binary.length} bytes)`)
} else {
  process.stdout.write(binary)
}
