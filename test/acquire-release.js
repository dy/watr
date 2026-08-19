// Acquire-release atomics proposal: https://github.com/WebAssembly/acquire-release-atomics
// Scope follows the reference interpreter: ordering keyword on atomic loads only.
// Reference bytes quoted from the official generated test
// test/core/acquire-release-atomics/basic.wast (module binary section):
//   fe 10 02 00     i32.atomic.load               (align 2, no ordering)
//   fe 10 12 01 00  i32.atomic.load acqrel        (align 2 | 0x10, ordering 0x01)
//   fe 10 12 00 00  i32.atomic.load seqcst        (align 2 | 0x10, ordering 0x00)
import t, { is, ok } from 'tst'
import { compile } from './runner.js'

const hex = a => [...a].map(x => x.toString(16).padStart(2, '0')).join(' ')
const body = src => hex(compile(`(module (memory 1 1) (func ${src}))`))

t('acqrel: ordering flag and byte match official basic.wast', () => {
  ok(body(`(drop (i32.atomic.load (i32.const 0)))`).includes('fe 10 02 00'))
  ok(body(`(drop (i32.atomic.load acqrel (i32.const 0)))`).includes('fe 10 12 01 00'))
  ok(body(`(drop (i32.atomic.load seqcst (i32.const 0)))`).includes('fe 10 12 00 00'))
})

t('acqrel: all load variants, natural alignment | 0x10', () => {
  // opcodes 0xfe10-0xfe16, natural align log2: 2, 3, 0, 1, 0, 1, 2
  ok(body(`(drop (i32.atomic.load acqrel (i32.const 0)))`).includes('fe 10 12 01 00'))
  ok(body(`(drop (i64.atomic.load acqrel (i32.const 0)))`).includes('fe 11 13 01 00'))
  ok(body(`(drop (i32.atomic.load8_u acqrel (i32.const 0)))`).includes('fe 12 10 01 00'))
  ok(body(`(drop (i32.atomic.load16_u acqrel (i32.const 0)))`).includes('fe 13 11 01 00'))
  ok(body(`(drop (i64.atomic.load8_u acqrel (i32.const 0)))`).includes('fe 14 10 01 00'))
  ok(body(`(drop (i64.atomic.load16_u acqrel (i32.const 0)))`).includes('fe 15 11 01 00'))
  ok(body(`(drop (i64.atomic.load32_u acqrel (i32.const 0)))`).includes('fe 16 12 01 00'))
})

t('acqrel: explicit offset and align precede the ordering keyword', () => {
  ok(body(`(drop (i32.atomic.load offset=8 align=4 acqrel (i32.const 0)))`).includes('fe 10 12 01 08'))
  ok(body(`(drop (i32.atomic.load offset=8 align=4 seqcst (i32.const 0)))`).includes('fe 10 12 00 08'))
})

t('acqrel: rejected outside atomic loads', () => {
  const throws = src => { try { compile(`(module (memory 1 1) (func ${src}))`) } catch { return true } return false }
  // assert_malformed in official basic.wast: "(i32.load acqrel ...)" -> "unexpected token"
  ok(throws(`(drop (i32.load acqrel (i32.const 0)))`))
  ok(throws(`(i32.atomic.store acqrel (i32.const 0) (i32.const 1))`))
  ok(throws(`(drop (i32.atomic.rmw.add acqrel (i32.const 0) (i32.const 1)))`))
})

t('acqrel: default encoding unchanged without keyword', () => {
  is(body(`(drop (i64.atomic.load (i32.const 0)))`).includes('fe 11 03 00'), true)
})
