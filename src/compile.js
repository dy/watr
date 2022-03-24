// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section


const SEC_TYPE=1, SEC_IMPORT=2, SEC_FUNC=3, SEC_TABLE=4, SEC_MEM=5, SEC_GLOBAL=6, SEC_EXPORT=7, SEC_START=8, SEC_EL=9, SEC_CODE=10, SEC_DATA=11,

TYPE_I32=0x7f, TYPE_I64=0x7e, TYPE_F32=0x7d, TYPE_F64=0x7c, TYPE_VOID=0x40, TYPE_FUNC=0x60, TYPE_FUNCREF=0x70,

EXT_FUNC=0, EXT_TABLE=1, EXT_MEM=2, EXT_GLOBAL=3,

RANGE_MIN=0, RANGE_MIN_MAX=1

export default (tree) => {
  return new Uint8Array(module(tree))
}

export const module = ([_, ...nodes]) => {
  const magic = [0x00, 0x61, 0x73, 0x6d];
  const version = [0x01, 0x00, 0x00, 0x00];

  const types = [], fns = [], codes = [], imports = [],
        tables = [], mems = [], globals = [], exports = [],
        starts = [], elements = [], datas = []

  const node = {
    func: (parts) => {
      let param_count = 0, return_count = 0, param_types=[], return_types=[]
      // FIXME: count params/types
      // FIXME: count returns/types
      let idx = types.push([TYPE_FUNC, param_count, ...param_types, return_count, ...return_types])-1
      fns.push(idx)

      // FIXME: collect actual statements
      // FIXME: map statements to codes
      let vars=0, ops = []//parts.flat()
      codes.push([ops.length+2, vars, ...ops, 0x0b])
    },
    memory: ([min, max, shared]) => mems.push(max ? [RANGE_MIN_MAX, min, max] : [RANGE_MIN, min]),
    global: ([type, mutable]) => globals.push([]),
    table: ([type, limits]) => tables.push([]),
    // import: () => ,
  }

  for (let [key, ...parts] of nodes) node[key](parts)

  return [ ...magic, ...version,
    ...section(SEC_TYPE, types),
    // ...section(imports),
    ...section(SEC_FUNC, fns),
    // ...section(tables),
    ...section(SEC_MEM, mems),
    // ...section(globals),
    // ...section(exports),
    // ...section(starts),
    // ...section(elements),
    ...section(SEC_CODE, codes),
    // ...section(datas)
  ]
}

// generate section prefixed with length, #items
const section = (code, items) => {
  if (!items.length) return []
  let data = [items.length, ...items.flat()]
  return [code, data.length, ...data]
}
