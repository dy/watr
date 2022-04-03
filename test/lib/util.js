import Wabt from './wabt.js'

let wabt = await Wabt()

export const hex = (str, ...fields) =>
  new Uint8Array(
    String.raw.call(null, str, fields)
    .trim()
    .replace(/;[^\n]*/g,'')
    .split(/[\s\n]+/)
    .filter(n => n !== '')
    .map(n => parseInt(n, 16))
  )

export function wat (code) {
  const parsed = wabt.parseWat('inline', code, {})
  console.time('wabt build')
  const binary = parsed.toBinary({
    log: true,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: false,
  })
  parsed.destroy()
  console.timeEnd('wabt build')

  return binary
}
