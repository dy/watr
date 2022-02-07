import fs from 'fs'
import t from 'tst'

t.skip('table', () => {
  var buffer = fs.readFileSync('./table.wasm');
  const mod = new WebAssembly.Module(buffer)
  const instance = new WebAssembly.Instance(mod)

  console.log(instance.exports.callByIndex(0)) // => 42
  console.log(instance.exports.callByIndex(1)) // => 13
  console.log(instance.exports.callByIndex(2)) // => error
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
  const importObj = {
    js: {
      log: arg=>console.log(arg),
      mem: new WebAssembly.Memory({ initial:1 })
    }
  }
  const instance = new WebAssembly.Instance(mod, importObj)
  const {get, set, populate} = instance.exports

  populate()
  console.log(get(0))
  set(1,2)
  console.log(get(1))

  // grow by one page
  console.log(importObj.js.mem.grow(1))
})



t('loop', () => {
  var buf = fs.readFileSync('./loops.wasm')
  const mod = new WebAssembly.Module(buf)
  // const mem = new WebAssembly.Memory({ initial:1 })
  // const f32mem = new Float32Array(mem.buffer)
  const importObj = {console: {log:(arg)=>console.log(arg)}}
  const instance = new WebAssembly.Instance(mod, importObj)

})


t.only('array', () => {
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


