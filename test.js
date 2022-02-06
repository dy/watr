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

t.only('global', () => {
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


