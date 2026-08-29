// Syntax highlighting for code blocks — CSS Custom Highlight API, no spans:
// markup stays plain text, colors come from ::highlight() rules in site.css.
// Same conventions as microlighter (language-* class on <code>, category names
// comment/keyword/string/numeric), tuned for what the docs use: wat, js, sh.
const G = {
  wat: [
    [/;;.*|\(;[^]*?;\)/g, 'comment'],
    [/"(?:\\.|[^"\\])*"/g, 'string'],
    [/@[\w.]+|(?<![\w.$])(?:module|func|param|result|local|global|memory|table|type|import|export|start|elem|data|offset|item|rec|sub|final|struct|array|field|mut|tag|block|loop|if|then|else|end|try_table|catch|catch_all|catch_ref|catch_all_ref|throw|throw_ref|rethrow|br|br_if|br_table|br_on_null|br_on_non_null|br_on_cast|br_on_cast_fail|call|call_indirect|call_ref|return|return_call|return_call_indirect|return_call_ref|nop|unreachable|drop|select)\b(?!\.)/g, 'keyword'],
    [/(?<![\w$.])[+-]?(?:0x[\da-f_]+(?:\.[\da-f_]*)?(?:p[+-]?\d+)?|0b[01_]+|\d[\d_]*(?:\.[\d_]*)?(?:e[+-]?\d+)?|inf|nan(?::0x[\da-f_]+)?)\b/gi, 'numeric'],
  ],
  js: [
    [/\/\/.*|\/\*[^]*?\*\//g, 'comment'],
    [/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, 'string'],
    [/(?<![\w.$])(?:import|export|from|default|const|let|var|function|return|new|await|async|if|else|for|of|in|while|do|class|extends|this|throw|try|catch|finally|typeof|instanceof|yield|delete|void|switch|case|break|continue|true|false|null|undefined)\b/g, 'keyword'],
    [/(?<![\w$.])(?:0x[\da-f]+|\d[\d_]*(?:\.\d*)?(?:e[+-]?\d+)?)n?\b/gi, 'numeric'],
  ],
  sh: [
    [/#.*/g, 'comment'],
    [/'[^']*'|"[^"]*"/g, 'string'],
    [/(?<!\S)--?[\w-]+/g, 'keyword'],
  ],
}
G.bash = G.sh

if (CSS.highlights) {
  const H = {}
  for (const code of document.querySelectorAll('pre > code[class*="language-"]')) {
    const rules = G[code.className.match(/language-(\w+)/)[1]]
    code.normalize()
    if (!rules || code.childNodes.length !== 1) continue // unknown language / pre-tokenized markup
    const text = code.firstChild, src = text.data
    // earliest match wins, ties go to the earlier rule; each rule keeps its next match cached
    const next = rules.map(([re]) => (re.lastIndex = 0, re.exec(src)))
    for (let i = 0;;) {
      let k = -1
      next.forEach((m, j) => m && (k < 0 || m.index < next[k].index) && (k = j))
      if (k < 0) break
      const m = next[k], end = m.index + m[0].length
      const r = new Range()
      r.setStart(text, m.index), r.setEnd(text, end)
      ;(H[rules[k][1]] ??= new Highlight()).add(r)
      i = end > m.index ? end : m.index + 1
      next.forEach((m, j) => { if (m && m.index < i) rules[j][0].lastIndex = i, next[j] = rules[j][0].exec(src) })
    }
  }
  for (const c in H) CSS.highlights.set(c, H[c])
}
