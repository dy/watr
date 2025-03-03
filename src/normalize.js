/**
 * @module watr/normalize
 * Deabbrs & makes explicit input WAT file
 */
import parse from './parse.js'
import { SECTION } from './const.js'

export default function normalize (nodes) {
  if (typeof nodes === 'string') nodes = parse(nodes)

  let from = 0

  // (module ...) abbr https://webassembly.github.io/spec/core/text/modules.html#id10
  if (nodes[0] === 'module') {
    from = nodes[1]?.[0] === '$' ? 2 : 1
  }
  // (op ...) single node
  else if (typeof nodes[0] === 'string') nodes = [nodes]

  if (nodes[from] === 'binary' || nodes[from] === 'quote') return nodes.slice(from) // FIXME: make more clever

  const sections = []
  for (let kind in SECTION) sections[SECTION[kind]] = []

  // TODO: dealias section names
  // TODO: deabbr exports

  // reorder nodes by sections, deabbr
  for (let i = from; i < nodes.length; i++) {
    let node = nodes[i], kind = node[0]

    // (rec (type $a (sub final? $sup* (func ...))...) (type $b ...)) -> save subtypes
    if (kind === 'rec') {
      sections[SECTION.type].push(node);
      continue
    }

    // import abbr
    // (import m n (table|memory|global|func id? type)) -> (table|memory|global|func id? (import m n) type)
    if (kind === 'import') {
      let [,m,n,dfn] = node, idx = (dfn[1]?.[0] === '$') + 1
      node = [...dfn.slice(0, idx), [kind,m,n], ...dfn.slice(idx)]
      kind = node[0]
    }

    let items = sections[SECTION[kind]];

    if (kind === 'export' || kind === 'start' || kind === 'elem' || kind === 'data') {
      items.push(node)
    }

    // (kind === 'type' || kind === 'table' || kind === 'memory' || kind === 'global' || kind === 'func')
    else {
      // index, alias
      let idx = 1 // within-node idx
      let name = (node[idx]?.[0] === '$') && node[idx++]

      // export abbr
      // (table|memory|global|func id? (export n)* ...) -> (table|memory|global|func id ...) (export n (table|memory|global|func id))
      while (node[idx]?.[0] === 'export') sections[SECTION.export].push([...node[idx++], [kind, items.length]])

      // import abbr
      // (table|memory|global|func id? (import m n) type) -> (import m n (table|memory|global|func id? type))
      if (node[idx]?.[0] === 'import') {
        let imp = node[idx++]
        sections[SECTION.import].push([...imp, [kind, name || `(;${items.length};)`, ...node.slice(idx)]])
        items.length++ // stub
        continue
      }

      // table abbr
      // (table id? reftype (elem ...n)) -> (table id? n n reftype) (elem (table id) (i32.const 0) reftype ...)
      if (kind === 'table' && node[idx+1]?.[0] === 'elem') {
        let reftype = node[idx], [, ...els] = node[idx+1]
        idx = 1
        node = [kind, els.length, els.length, reftype]
        sections[SECTION.elem].push(['elem', ['table', name || items.length], ['i32.const', '0'], reftype, ...els])
      }

      // // data abbr
      // // (memory id? (data str)) -> (memory id? n n) (data (memory id) (i32.const 0) str)
      // else if (kind === 'memory' && node[0]?.[0] === 'data') {
      //   let [, ...data] = node.shift(), m = '' + Math.ceil(data.map(s => s.slice(1, -1)).join('').length / 65536) // FIXME: figure out actual data size
      //   ctx.data.push([['memory', items.length], ['i32.const', 0], ...data])
      //   node = [m, m]
      // }

      // // keep start name
      // else if (kind === 'start') name && node.push(name)

      // // normalize type definition to (func|array|struct dfn) form
      // // (type (func param* result*))
      // // (type (array (mut i8)))
      // // (type (struct (field a)*)
      // // (type (sub final? $nm* (struct|array|func ...)))
      // else if (kind === 'type') {
      //   let [dfn] = node
      //   let issub = subc-- > 0
      //   let subkind = issub && 'subfinal', supertypes = []
      //   if (dfn[0] === 'sub') {
      //     subkind = dfn.shift(), dfn[0] === 'final' && (subkind += dfn.shift())
      //     dfn = (supertypes = dfn).pop() // last item is definition
      //   }

      //   let ckind = dfn.shift() // composite type kind
      //   if (ckind === 'func') dfn = paramres(dfn), ctx.type['$' + dfn.join('>')] ??= ctx.type.length
      //   else if (ckind === 'struct') dfn = fieldseq(dfn, 'field', true)
      //   else if (ckind === 'array') dfn = dfn.shift()

      //   node = [ckind, dfn, subkind, supertypes, rec ? [ctx.type.length, rec] : issub]
      // }

      // // dupe to code section, save implicit type
      // else if (kind === 'func') {
      //   let [idx, param, result] = typeuse(node, ctx);
      //   idx ?? (ctx._[idx = '$' + param + '>' + result] = [param, result]);
      //   // we save idx because type can be defined after
      //   !imported && nodes.push(['code', [idx, param, result], ...plain(node, ctx)]) // pass param since they may have names
      //   node.unshift(['type', idx])
      // }

      items.push([kind, name || `(;${items.length};)`, ...node.slice(idx)])
    }
  }

  // TODO: push implicit types
  return sections.flat()
}
