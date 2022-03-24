// convert wat tree to wasm binary
// ref: https://ontouchstart.pages.dev/chapter_wasm_binary
// ref: https://github.com/WebAssembly/design/blob/main/BinaryEncoding.md#function-section
export default (tree) => {
  return new Uint8Array(module(tree))
}

export const module = ([_, ...nodes]) => {
  const magic = [0x00, 0x61, 0x73, 0x6d];
  const version = [0x01, 0x00, 0x00, 0x00];

  const types = [
      // 0x01, // type section
      // 0x04, // 4 bytes
      // 0x01, // 1 type
      // 0x60, // func type
      // 0x00, // no input
      // 0x00  // no output
  ];
  const fns = [
      // 0x03, // func section
      // 0x02, // 2 bytes
      // 0x01, // number of fns
      // 0x00  // type of the function
  ];
  const codes = [
      // 0x0a, // code section
      // 0x04, // 4 bytes
      // 0x01, // number of function bodies.
      // 0x02, // 2 bytes
      // 0x00, // number of local variables
      // 0x0b  // opcode for end
  ];

  const imports = []
  const tables = []
  const memorys = []
  const globals = []
  const exports = []
  const starts = []
  const elements = []
  const datas = []

  for (let [section, ...parts] of nodes) {
    if (section === 'func') {
      let ins = 0, outs = 0
      // FIXME: count params
      // FIXME: count output
      let idx = types.push([TYPE.func, ins, outs])-1
      fns.push(idx)
      // FIXME: collect actual statements
      // FIXME: map statements to codes
      let vars=0, ops = []//parts.flat()
      codes.push([ops.length+2, vars, ...ops, 0x0b])
    }
  }
  console.log(types, fns, codes)

  return [
    ...magic,
    ...version,
    ...section(SECTION.type, types),
    // ...section(imports),
    ...section(SECTION.function, fns),
    // ...section(tables),
    // ...section(memorys),
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

const SECTION = {
  type: 1,
  import: 2,
  function: 3,
  table: 4,
  memory: 5,
  global: 6,
  export: 7,
  start: 8,
  element: 9,
  code: 10,
  data: 11
}

const TYPE = {
  i32: 0x7f,
  i64: 0x7e,
  f32: 0x7d,
  f64: 0x7c,
  void: 0x40,
  func: 0x60,
  funcref: 0x70,
}
