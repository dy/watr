// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section


// FIXME: make these regular constants?
const RANGE_MIN=0, RANGE_MIN_MAX=1,
SECTION = {type:1, import:2, function:3, table:4, memory:5, global:6, export:7, start:8, element:9, code:10, data:11},
TYPE = {i32:0x7f, i64:0x7e, f32:0x7d, f64:0x7c, void:0x40, func:0x60, funcref:0x70},
ETYPE = {func: 0, table: 1, mem: 2, global: 3}

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
    func: (parts, section) => {
      let param_count = 0, return_count = 0, param_types=[], return_types=[]
      // FIXME: count params/types
      // FIXME: count returns/types
      let idx = types.push([TYPE.func, param_count, ...param_types, return_count, ...return_types])-1
      fns.push(idx)

      // FIXME: collect actual statements
      // FIXME: map statements to codes
      let vars=0, ops = []//parts.flat()
      codes.push([ops.length+2, vars, ...ops, 0x0b])
    },
    memory: (parts) => {
      let imp = false
      // (memory (import "js" "mem") 1) → (import "js" "mem" (memory 1))
      if (parts[0][0] === 'import') {
        imp = parts.shift()
        // node.import([...parts[0].slice(1), ['memory', ...parts.slice(1)]])
      }

      let [min, max, shared] = parts,
          dfn = max ? [RANGE_MIN_MAX, min, max] : [RANGE_MIN, min]

      if (!imp) mems.push(dfn)
      else {
        let [_, mod, name] = imp
        imports.push([mod.length, ...encoder.encode(mod), name.length, ...encoder.encode(name), ETYPE.mem, ...dfn])
      }
    },
    global: ([type, mutable]) => globals.push([]),
    table: ([type, limits]) => tables.push([]),

    // (import mod name ref)
    import: ([mod, name, ref]) => {
      node[ref[0]]([['import', mod, name], ...ref.slice(1)])
    },
  }

  for (let [key, ...parts] of nodes) node[key](parts)

  return [ ...magic, ...version,
    ...section(SECTION.type, types),
    ...section(SECTION.import, imports),
    ...section(SECTION.function, fns),
    // ...section(tables),
    ...section(SECTION.memory, mems),
    // ...section(globals),
    // ...section(exports),
    // ...section(starts),
    // ...section(elements),
    ...section(SECTION.code, codes),
    // ...section(datas)
  ]
}

// generate section prefixed with length, #items
const section = (code, items) => {
  if (!items.length) return []
  let data = [items.length, ...items.flat()]
  return [code, data.length, ...data]
}

const encoder = new TextEncoder()
