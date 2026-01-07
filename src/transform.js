// AST transformations: flatten, nest, resolve names
// Used by compile.js (flat + resolve) and print.js (nested)

import { INSTR } from './const.js'

/**
 * Transform AST to canonical form
 * @param {Array} nodes - AST nodes (instruction sequence)
 * @param {Object} ctx - compilation context (for resolve)
 * @param {Object} opts - transform options
 * @param {string} opts.form - 'flat' | 'nested' | 'preserve' (default: 'preserve')
 * @param {boolean} opts.resolve - resolve $names to indices (default: false)
 * @returns {Array} transformed AST
 */
export function transform(nodes, ctx, {
  form = 'preserve',
  resolve = false,
} = {}) {
  let result = [...nodes] // don't mutate input

  if (form === 'flat') result = flatten(result, ctx)
  else if (form === 'nested') result = nest(result, ctx)

  if (resolve) result = resolveNames(result, ctx)

  return result
}

/**
 * Flatten nested instructions to stack order
 * (i32.add (i32.const 1) (i32.const 2)) → ['i32.const', '1', 'i32.const', '2', 'i32.add']
 */
function flatten(nodes, ctx) {
  const out = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (typeof node === 'string') {
      // Already flat - pass through
      out.push(node)
    }
    else if (Array.isArray(node)) {
      const op = node[0]

      // Skip non-instruction arrays (result, param, type, ref, etc.)
      if (typeof op !== 'string' || INSTR[op] == null) {
        out.push(node)
        continue
      }

      // block/loop: flatten body, add 'end'
      if (op === 'block' || op === 'loop') {
        out.push(...flatten(node, ctx), 'end')
      }
      // if: handle then/else branches
      else if (op === 'if') {
        const parts = [...node]
        parts.shift() // remove 'if'

        let then = [], els = [], cond = []

        // Extract else branch
        if (parts[parts.length - 1]?.[0] === 'else') {
          els = flatten(parts.pop().slice(1), ctx)
          if (els.length) els.unshift('else')
        }
        // Extract then branch
        if (parts[parts.length - 1]?.[0] === 'then') {
          then = flatten(parts.pop().slice(1), ctx)
        }

        // Remaining parts: label?, blocktype?, condition*
        const immed = ['if']

        // label?
        if (parts[0]?.[0] === '$') immed.push(parts.shift())

        // blocktype? (result ...)
        while (parts.length && parts[0]?.[0] === 'result') {
          immed.push(parts.shift())
        }

        // condition args
        cond = flatten(parts, ctx)

        out.push(...cond, ...immed, ...then, ...els, 'end')
      }
      // Regular instruction: flatten args first (stack order), then op with immediates
      else {
        const parts = [...node]
        parts.shift() // remove op

        // Collect immediates (non-array items)
        const immediates = []
        while (parts.length && !Array.isArray(parts[0])) {
          immediates.push(parts.shift())
        }

        // Flatten remaining args (nested instructions)
        out.push(...flatten(parts, ctx))

        // Then instruction with immediates
        out.push(op, ...immediates)
      }
    }
    else {
      // Pass through anything else
      out.push(node)
    }
  }

  return out
}

/**
 * Nest flat instructions to tree form
 * ['i32.const', '1', 'i32.const', '2', 'i32.add'] → ['i32.add', ['i32.const', '1'], ['i32.const', '2']]
 * Requires stack arity knowledge
 */
function nest(nodes, ctx) {
  // TODO: implement nesting
  // This needs instruction arity (stack inputs) to build tree
  // For now, return as-is
  return nodes
}

/**
 * Resolve $names to numeric indices
 * (call $foo) → (call 0)
 */
function resolveNames(nodes, ctx) {
  // TODO: implement name resolution
  // Move id() logic here from compile.js
  return nodes
}

export default transform
