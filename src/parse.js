const OPAREN=40, CPAREN=41, OBRACK=91, CBRACK=93, SPACE=32, DQUOTE=34, PERIOD=46,
_0=48, _9=57, SEMIC=59, NEWLINE=32, PLUS=43, MINUS=45, COLON=58

export default (str) => {
  let i = 0, level = [], buf=''

  const commit = (k,v) => buf && (
    [k, v] = buf.split('='),
    level.push(v ? [k,v] : k),
    buf = ''
  )

  const parseLevel = () => {
    for (let c, root; i < str.length; ) {
      c = str.charCodeAt(i)
      if (c === OPAREN) {
        if (str.charCodeAt(i+1) === SEMIC) i=str.indexOf(';)', i)+2
        else i++, (root=level).push(level=[]), parseLevel(), level=root
      }
      else if (c <= SPACE) commit(), i++
      else if (c === CPAREN) return commit(), i++
      else if (c === SEMIC) i=str.indexOf('\n', i)+1
      else buf+=str[i++]
    }

    commit()
  }

  parseLevel()

  return level[0]
}
