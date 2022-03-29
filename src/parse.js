export default (str) => {
  let i = 0

  const parseLevel = (level, buf='') => {
    const commit = (k,v) => buf && (
      [k, v] = buf.split('='),
      level.push(v ? [k,v] : k),
      buf = ''
    )

    for (let c; i < str.length; ) {
      c = str.charCodeAt(i)
      if (c === OPAREN) {
        if (str[i+1]===';') i=str.indexOf(';)', i)+2
        else i++, level.push(parseLevel([]))
      }
      else if (c === CPAREN) return commit(), i++, level
      else if (c <= SPACE) commit(), i++
      else if (c === SEMIC) i=str.indexOf('\n', i)+1
      else buf+=str[i++]
    }

    commit()

    return level
  }

  let tree = parseLevel([])

  return tree[0]
}
