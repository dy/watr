// Differential PERF probe (sibling of jz-kernel-repro.mjs, which checks correctness —
// this checks speed): builds the jz self-host kernel with THIS watr working tree as
// the WAT optimizer, compiles bench/mat4+benchlib through it AND through native jz.js,
// prints the ratio + (opt-in) the __hc_ helper-elimination counters.
//
// Charter: /Users/div/projects/jz/.work/selfhost-perf-groundtruth.md, VERDICT section —
// a single-variable watr swap (5.0.0→5.1.1, fixed jz source) takes jz's self-host fresh
// ratio 1.08x→1.373x. Mechanism: jz's own compile() (index.js) calls watr's optimize()
// exactly ONCE, natively, over the ~139-module self-host graph's assembled WAT, at BUILD
// time (optimize:2, jz's scripts/selfhost-build.mjs). That one call is the ONLY place
// watr's optimizer touches the kernel for a runtime-level-0 bench (level 0 skips
// watr-optimize for the user program itself, both native and self-hosted) — so the
// built kernel binary's shape (how many dyn-prop/typed-array-fastpath helper calls
// SURVIVE vs get inlined/eliminated) is entirely a function of watr optimize()'s
// quality on this one build-time call. The native-jz.js comparator never touches watr
// at runtime level 0 either, so it is the fixed reference the ratio moves against.
//
// jz (/Users/div/projects/jz) is READ-ONLY: nothing is ever written under jz/, and
// jz's own dist/jz.wasm is never touched. We rebuild the kernel in-process instead of
// shelling out to jz's scripts/selfhost-build.mjs (which writes dist/jz.wasm) by calling
// jz's own compile()/resolveModuleGraph directly and keeping the output bytes in memory.
// To make that build use THIS watr checkout (not jz's node_modules/watr, a published
// copy) we register an ESM loader hook that redirects the 'watr' specifier family to
// WATR_ROOT (default: this working tree, derived from watr's own package.json exports
// map) — no npm link, no writes, no mutation of jz's node_modules.
//
// Run:
//   node test/jz-kernel-perf.mjs                      # this working tree, ratio only
//   JZ_HELPER_COUNTERS=1 node test/jz-kernel-perf.mjs  # + __hc_ helper counters
//   WATR_ROOT=/path/to/other/watr node test/jz-kernel-perf.mjs   # A/B vs another checkout
//   JZ_BENCH_RUNS=6 node test/jz-kernel-perf.mjs       # fewer timed runs (faster iteration)
//   JZ_BENCH_CASE=json node test/jz-kernel-perf.mjs    # any bench-selfhost.mjs corpus name
//   JZ_BENCH_CASE=mat4,json,tokenizer node test/jz-kernel-perf.mjs  # one kernel BUILD (the
//     expensive, watr-version-dependent step), many bench CASES timed/counted against it —
//     amortizes the ~2-3min build over an arbitrary case list

import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const JZ = new URL('../../jz/', import.meta.url).pathname
const WATR_ROOT = resolve(process.env.WATR_ROOT || new URL('../', import.meta.url).pathname)
const WANT_COUNTERS = /^(1|true|yes)$/i.test(process.env.JZ_HELPER_COUNTERS || '')
const LEVEL = process.env.JZ_LEVEL ?? '0'
const CASES = (process.env.JZ_BENCH_CASE || 'mat4').split(',').map(s => s.trim()).filter(Boolean)
const WARM = 8
const RUNS = Math.max(4, Number(process.env.JZ_BENCH_RUNS) || 18)

if (!existsSync(JZ + 'scripts/self.js')) { console.error('jz checkout not found at', JZ); process.exit(1) }

// --- redirect every 'watr'/'watr/*' specifier to WATR_ROOT, mirroring its own exports
// map (so a subpath watr adds/removes later still gets picked up automatically). This
// is a process-local resolution override — it never touches jz's node_modules/watr. ---
const watrPkg = JSON.parse(readFileSync(join(WATR_ROOT, 'package.json'), 'utf8'))
const specifierMap = {}
for (const [sub, target] of Object.entries(watrPkg.exports || {})) {
  const rel = typeof target === 'string' ? target : (target.default || target.import)
  if (typeof rel !== 'string' || !rel.endsWith('.js')) continue
  const specifier = sub === '.' ? 'watr' : `watr/${sub.replace(/^\.\//, '')}`
  specifierMap[specifier] = pathToFileURL(join(WATR_ROOT, rel)).href
}
const loaderSrc = `
const MAP = ${JSON.stringify(specifierMap)}
export async function resolve(specifier, context, nextResolve) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSrc)}`, import.meta.url)

// --- build the kernel: jz's own build pipeline (mirrors scripts/selfhost-build.mjs),
// output kept in memory only — no writes under jz/. ---
const { compile } = await import(JZ + 'index.js')
const { resolveModuleGraph } = await import(JZ + 'src/resolve.js')
const g = resolveModuleGraph(resolve(JZ, 'scripts/self.js'), { resolveNode: true })
const t0 = performance.now()
const wasm = compile(g.code, { modules: g.modules, memory: 8192, optimize: 2, helperCounters: WANT_COUNTERS })
const buildMs = performance.now() - t0
new WebAssembly.Module(wasm) // validate, same gate selfhost-build.mjs applies

// --- corpus source: bench/<case> + benchlib inlined, mirrors bench-selfhost.mjs's sourceFor ---
const BENCH = join(JZ, 'bench')
const benchlib = readFileSync(join(BENCH, '_lib', 'benchlib.js'), 'utf8').replace(/\bexport let\b/g, 'const')
const sourceFor = (name) => {
  let src = readFileSync(join(BENCH, name, `${name}.js`), 'utf8')
  if (src.includes('../_lib/benchlib.js'))
    src = benchlib + '\n' + src.replace(/import\s+\{[^}]+\}\s+from\s+['"]\.\.\/_lib\/benchlib\.js['"]\s*\n?/g, '')
  return src
}

const { default: compileSelf } = await import(JZ + 'scripts/self.js')
const { instantiate } = await import(JZ + 'interop.js')
const { HELPER_COUNTERS } = WANT_COUNTERS ? await import(JZ + 'src/helper-counters.js') : { HELPER_COUNTERS: [] }

const fnv = (bytes) => { let h = 0x811c9dc5 | 0; for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193); return h >>> 0 }
const timeMin = (fn) => {
  for (let i = 0; i < WARM; i++) fn()
  let best = Infinity
  for (let r = 0; r < RUNS; r++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t) }
  return best
}
// Fresh wasm instance per iteration — the kernel bump-allocates per compile and never
// resets its arena, so N compiles on one instance can exhaust memory (matches
// bench-selfhost.mjs's timeMinWasm methodology exactly; instantiation stays out of
// the timed region).
const timeMinWasm = (src) => {
  const setup = () => { const inst = instantiate(wasm, { memory: 8192 }); const sp = inst.memory.String(src); const lp = inst.memory.String(LEVEL); return () => inst.memory.read(inst.exports.default(sp, 0, lp)) }
  for (let i = 0; i < WARM; i++) setup()()
  let best = Infinity
  for (let r = 0; r < RUNS; r++) { const fn = setup(); const t = performance.now(); fn(); best = Math.min(best, performance.now() - t) }
  return best
}

console.log(`watr root: ${WATR_ROOT}`)
console.log(`kernel build: ${wasm.byteLength.toLocaleString()} bytes in ${buildMs.toFixed(0)} ms`)

let sumJs = 0, sumWasm = 0, ratios = []
for (const CASE of CASES) {
  const src = sourceFor(CASE)
  let jsBytes
  try { jsBytes = compileSelf(src, false, LEVEL) } catch (e) { console.error(`${CASE}: native jz compile failed:`, e.message); continue }

  // Dedicated instance for parity + helper counters (kept separate from the timed runs,
  // same split bench-selfhost.mjs uses — one compile, read counters, then time fresh
  // instances separately).
  const probe = instantiate(wasm, { memory: 8192 })
  if (WANT_COUNTERS) probe.instance.exports.__helper_counts_reset?.()
  let wasmBytesOut
  try { wasmBytesOut = probe.memory.read(probe.exports.default(probe.memory.String(src), 0, probe.memory.String(LEVEL))) }
  catch (e) { console.error(`${CASE}: kernel compile failed:`, e.message); continue }
  const parity = fnv(jsBytes) === fnv(wasmBytesOut instanceof Uint8Array ? wasmBytesOut : new Uint8Array(wasmBytesOut)) ? 'ok' : 'DIFF'

  const js = timeMin(() => compileSelf(src, false, LEVEL))
  const wasmMs = timeMinWasm(src)
  const ratio = wasmMs / js
  sumJs += js; sumWasm += wasmMs; ratios.push(ratio)

  console.log(`${CASE.padEnd(12)}  js ${js.toFixed(3)}ms  wasm ${wasmMs.toFixed(3)}ms  ratio ${ratio.toFixed(3)}x${ratio <= 1 ? ' (wasm FASTER)' : ''}  parity ${parity}`)

  if (WANT_COUNTERS) {
    const rows = []
    for (const [, label] of HELPER_COUNTERS) {
      const g = probe.instance.exports[`__hc_${label}`]
      if (g && g.value) rows.push([label, g.value])
    }
    rows.sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    for (const [label, n] of rows) console.log(`    ${label.padEnd(18)} ${n.toString().padStart(10)}`)
  }
}
if (CASES.length > 1) {
  const geo = ratios.length ? Math.exp(ratios.reduce((a, b) => a + Math.log(b), 0) / ratios.length) : NaN
  console.log(`\nTOTAL (${ratios.length}/${CASES.length})  js ${sumJs.toFixed(1)}ms  wasm ${sumWasm.toFixed(1)}ms  geomean ${geo.toFixed(3)}x`)
}
