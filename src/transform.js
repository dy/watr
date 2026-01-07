// AST transformations: flatten, nest, resolve names
// Used by compile.js (flat + resolve) and print.js (nested)

import { INSTR } from './const.js'

/**
 * Check if string is a valid instruction name (not just array index)
 */
function isInstruction(s) {
  return typeof s === 'string' && Array.isArray(INSTR[s])
}

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
      if (typeof op !== 'string' || !isInstruction(op)) {
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
 * ['i32.const', '1', 'i32.const', '2', 'i32.add'] → [['i32.add', ['i32.const', '1'], ['i32.const', '2']]]
 * Uses instruction arity to determine nesting
 */
function nest(nodes, ctx) {
  const stack = []
  const out = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    // Non-instruction arrays pass through
    if (Array.isArray(node)) {
      // Already nested or non-instruction (result, param, etc.)
      out.push(node)
      continue
    }

    // String - instruction or immediate
    if (typeof node === 'string') {
      const op = node

      // Check if it's an instruction
      if (isInstruction(op)) {
        const arity = getArity(op)

        // Collect immediates (next non-instruction strings)
        const immediates = []
        while (i + 1 < nodes.length && typeof nodes[i + 1] === 'string' && !isInstruction(nodes[i + 1])) {
          immediates.push(nodes[++i])
        }

        // Pop args from stack
        const args = []
        for (let j = 0; j < arity; j++) {
          if (stack.length) args.unshift(stack.pop())
        }

        // Control flow: block, loop, if, end
        if (op === 'block' || op === 'loop' || op === 'if') {
          // Start collecting block body
          stack.push({ type: 'block', op, immediates, body: [] })
        }
        else if (op === 'else') {
          // Mark else in current block
          const block = stack[stack.length - 1]
          if (block?.type === 'block') {
            block.thenBody = block.body
            block.body = []
          }
        }
        else if (op === 'end') {
          // Close block
          const block = stack.pop()
          if (block?.type === 'block') {
            const result = [block.op, ...block.immediates, ...block.body]
            if (block.thenBody) {
              // if with then/else
              result.push(['then', ...block.thenBody])
              if (block.body.length) result.push(['else', ...block.body])
            }
            stack.push(result)
          }
        }
        else {
          // Build nested form: [op, ...immediates, ...args]
          stack.push([op, ...immediates, ...args])
        }
      }
      else {
        // Not an instruction - might be a label or other token
        // Push as-is
        stack.push(node)
      }
    }
    else {
      // Other types - pass through
      out.push(node)
    }
  }

  // Remaining stack items go to output
  out.push(...stack)

  return out
}

/**
 * Get input arity (number of stack operands) for instruction
 */
function getArity(op) {
  // Control flow - special handling
  if (op === 'block' || op === 'loop' || op === 'if' || op === 'else' || op === 'end') return 0
  if (op === 'br' || op === 'br_if' || op === 'return') return 0 // Actually variable, simplified
  if (op === 'call' || op === 'call_indirect') return 0 // Variable based on type

  // Pattern matching on instruction name suffix
  const suffix = op.split('.').pop()?.split('_')[0]

  // 0 inputs
  if (suffix === 'const' || suffix === 'get' || suffix === 'size' || suffix === 'null' || op === 'ref.func' || op === 'nop' || op === 'unreachable') return 0

  // 3 inputs
  if (op === 'select' || suffix === 'copy' || suffix === 'fill') return 3

  // 2 inputs - binary ops, stores, comparisons
  if (suffix === 'store' || suffix === 'add' || suffix === 'sub' || suffix === 'mul' || suffix === 'div' || suffix === 'rem' ||
      suffix === 'and' || suffix === 'or' || suffix === 'xor' || suffix === 'shl' || suffix === 'shr' || suffix === 'rotl' || suffix === 'rotr' ||
      suffix === 'eq' || suffix === 'ne' || suffix === 'lt' || suffix === 'gt' || suffix === 'le' || suffix === 'ge' ||
      suffix === 'min' || suffix === 'max' || suffix === 'copysign') return 2

  // 1 input - most other ops
  return 1
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
