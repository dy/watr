const OPAREN=40, CPAREN=41, OBRACK=91, CBRACK=93, SPACE=32, DQUOTE=34, PERIOD=46,
_0=48, _9=57, SEMIC=59, NEWLINE=32, PLUS=43, MINUS=45, COLON=58

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
