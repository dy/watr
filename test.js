import fs from 'fs'
import t from 'tst'

t.only('table', () => {
  var buffer = fs.readFileSync('./table.wasm');
  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)

  const {callByIndex, getByIndex} = instance.exports

  console.log(callByIndex(0)) // => 42
  console.log(callByIndex(1)) // => 13
  // console.log(callByIndex(2)) // => error

  let fn = getByIndex(0)
  console.log(fn, fn?.())
})

t('global', () => {
  var buf = fs.readFileSync('./global.wasm')
  const mod = new WebAssembly.Module(buf)
  const importObj = {
    "js": {
      "log": arg=>console.log(arg),
      "g1": new WebAssembly.Global({value: 'i32', mutable: true}, 123)
    }
  }

  console.log(importObj.js.g1)
  const instance = new WebAssembly.Instance(mod, importObj)
  const {getG1, setG1, getG0} = instance.exports

  // console.log(getG0())
  console.log(getG1())
  setG1(100)
  console.log(getG1())
})


t('stack', () => {
  var buf = fs.readFileSync('./stack.wasm')
  const mod = new WebAssembly.Module(buf)
  const importObj = {"js": {}}
  const instance = new WebAssembly.Instance(mod, importObj)
  const {get, swap, mul} = instance.exports
  console.log(mul(12,13))
  // console.log(swap(1,2,3,4))
  // console.log(get())
})

t('memory', () => {
  var buf = fs.readFileSync('./memory.wasm')
  const mod = new WebAssembly.Module(buf)
  const mem = new WebAssembly.Memory({ initial: 1 })

  const importObj = {
    js: { log: arg=>console.log(arg) }
  }
  const instance = new WebAssembly.Instance(mod, importObj)
  const api = instance.exports

  console.log(mem.buffer)
// console.log(api.mem, api.g)

  // api.populate()
  // let view = new DataView(mem.buffer)
  // view.setInt16(1, 123)
  let i32 = new Int32Array(mem.buffer)
  i32[1] = 123
  console.log(api.get(4))
  api.set(4,2)
  console.log(api.get(4))

  // grow by one page
  // console.log(mem.grow(4))
})



t('loop', () => {
  var buf = fs.readFileSync('./loops.wasm')
  const mod = new WebAssembly.Module(buf)
  // const mem = new WebAssembly.Memory({ initial:1 })
  // const f32mem = new Float32Array(mem.buffer)
  const importObj = {console: {log:(arg)=>console.log(arg)}}
  const instance = new WebAssembly.Instance(mod, importObj)

})


t('amp bench', () => {
  const BLOCK = 1024
  var buf = fs.readFileSync('./array.wasm')
  const mod = new WebAssembly.Module(buf)
  const mem = new WebAssembly.Memory({ initial:1 })
  const blockSize = new WebAssembly.Global({value: 'i32', mutable: true}, BLOCK)
  // blockSize.value
  const f32mem = new Float32Array(mem.buffer)
  const importObj = {js: {mem, blockSize}, console:{log(a,b){console.log(a,b)}}}
  const instance = new WebAssembly.Instance(mod, importObj)
  const {amp, ampMulti, ampShort} = instance.exports


  let src = Array.from({length:BLOCK}, (a,i)=>i)


  f32mem.set(src)
  amp('2')
  console.log(f32mem)

  const MAX = 1e5
  f32mem.set(src)
  console.time('warmup')
  for (let i = 0; i < MAX; i++) amp(.5)
  console.timeEnd('warmup')

  f32mem.set(src)
  console.time('wasm amp')
  for (let i = 0; i < MAX; i++) amp(.5)
  console.timeEnd('wasm amp')

  f32mem.set(src)
  console.time('wasm amp multivariable')
  for (let i = 0; i < MAX; i++) ampMulti(.5)
  console.timeEnd('wasm amp multivariable')

  f32mem.set(src)
  console.time('wasm short')
  for (let i = 0; i < MAX; i++) ampShort(.5)
  console.timeEnd('wasm short')


  console.time('js amp')
  for (let i = 0; i < MAX; i++) for (let j = 0; j < src.length; j++) src[j]*=.5
  console.timeEnd('js amp')
})



t('types', () => {
  var buf = fs.readFileSync('./types.wasm')
  const mod = new WebAssembly.Module(buf)
  // const mem = new WebAssembly.Memory({ initial:1 })
  // const f32mem = new Float32Array(mem.buffer)
  const importObj = {console: {log:(...abc)=>console.log(...abc)}}
  const instance = new WebAssembly.Instance(mod, importObj)
  const {run} = instance.exports

  console.log(run(123, 13.3, 'abc'))
})
