// Repro harness: watr-HEAD optimize corrupts the jz self-host kernel (one-byte
// string corruption: `s += i` reaches the kernel parser as `s 0=` — "Unclosed (").
// jz kernel green at b85f595-era watr; corrupt under b6983f3 (tail-merged
// epilogues + same-constant parameter specialization) / 67792d9 (convergence
// driver). Suspected: two near-identical helpers merged with one wrong
// specialized constant. Run:
//   node test/jz-kernel-repro.mjs            # builds jz kernel with THIS watr, probes it
// Reduce: diff `optimize(mod)` vs `optimize(mod, without tail-merge/param-spec)`
// over the jz module (JZ=../jz), find the merged pair, extract to a unit test here.
import { execSync } from 'node:child_process'
const JZ = new URL('../../jz/', import.meta.url).pathname
try {
  execSync(`node ${JZ}scripts/selfhost-build.mjs`, { stdio: 'pipe', timeout: 600000 })
} catch (e) { console.error('kernel build failed:', String(e.stderr).slice(0, 300)); process.exit(1) }
const { instantiate } = await import(JZ + 'interop.js')
const { readFileSync } = await import('node:fs')
const inst = instantiate(readFileSync(JZ + 'dist/jz.wasm'), { memory: 8192 })
const src = 'export let main = (s) => { let h = 0; for (let i = 0; i < 10; i++) h += i; return h }'
try {
  const out = inst.memory.read(inst.exports.default(inst.memory.String(src), 0, inst.memory.String('0')))
  console.log('kernel compile OK,', out.length, 'bytes — no corruption with this watr')
} catch (e) { console.error('CORRUPTION REPRODUCED:', e.message.split('\n').slice(0, 2).join(' | ')) }
