import t, { is, ok } from 'tst'
import { compile } from '../watr.js'

// Position tracking tests
t('error: position tracking - unknown instruction', () => {
  try {
    compile(`(func
  (i32.unknown 42))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown instruction'), e.message)
    ok(e.message.includes('at 2:'), `should have line 2, got: ${e.message}`)
  }
})

t('error: position tracking - unknown local', () => {
  try {
    compile(`(module
  (func (param i32)
    (local.get $missing)))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown local'), e.message)
    ok(e.message.includes('at 3:'), `should have line 3, got: ${e.message}`)
  }
})

t('error: position tracking - duplicate func name', () => {
  try {
    compile(`(func $a)
(func $a)`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Duplicate'), e.message)
    ok(e.message.includes('at 2:'), `should have line 2, got: ${e.message}`)
  }
})

t('error: position tracking - bad label', () => {
  try {
    compile(`(func
  (block $outer
    (br $inner)))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('label'), e.message)
    ok(e.message.includes('at 3:'), `should have line 3, got: ${e.message}`)
  }
})

t('error: position tracking - parse error unclosed', () => {
  try {
    compile(`(func
  (i32.const 42`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('parenthesis') || e.message.includes('Unclosed'), e.message)
  }
})

// Unexpected token (non-array in module)
t('error: unexpected token', () => {
  try {
    compile(`(module Factorial using recursion)`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unexpected token Factorial'), e.message)
    ok(e.message.includes('at 1:9'), e.message) // points to "Factorial"
  }
})

// Duplicate errors
t('error: duplicate type', () => {
  try {
    compile(`(type $t (func))
(type $t (func))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Duplicate type $t'), e.message)
  }
})

t('error: duplicate local', () => {
  try {
    compile(`(func (local $x i32) (local $x i32))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Duplicate local $x'), e.message)
  }
})

// Unknown references
t('error: unknown func', () => {
  try {
    compile(`(func (call $missing))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown func $missing'), e.message)
  }
})

t('error: unknown type', () => {
  try {
    compile(`(func (result unknown))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown type'), e.message)
  }
})

t('error: unknown global', () => {
  try {
    compile(`(func (global.get $missing))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown global $missing'), e.message)
  }
})

t('error: unknown table', () => {
  try {
    compile(`(func (table.get $missing (i32.const 0)))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown table $missing'), e.message)
  }
})

t('error: unknown memory', () => {
  try {
    compile(`(func (i32.load $missing (i32.const 0)))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown memory $missing'), e.message)
  }
})

// Parse errors
t('error: unclosed quote', () => {
  try {
    compile(`(func (i32.const "unclosed))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unclosed quote'), e.message)
  }
})

t('error: unclosed block comment', () => {
  try {
    compile(`(func (; unclosed comment)`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unclosed block comment'), e.message)
  }
})

t('error: unexpected closing paren', () => {
  try {
    compile(`) (func)`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unexpected closing parenthesis'), e.message)
  }
})

// Memarg errors
t('error: bad align', () => {
  try {
    compile(`(func (i32.load align=3 (i32.const 0)))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Bad align'), e.message)
  }
})

// Integer encoding errors
t('error: i32 out of range', () => {
  try {
    compile(`(func (i32.const 0x1ffffffff))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('out of range'), e.message)
  }
})

t('error: i64 out of range', () => {
  try {
    compile(`(func (i64.const 0x1ffffffffffffffff))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('out of range'), e.message)
  }
})

// Unknown section/kind
t('error: unknown section', () => {
  try {
    compile(`(moduled (func))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown section moduled'), e.message)
    ok(e.message.includes('at 1:'), `should have line, got: ${e.message}`)
  }
})

t('error: unknown import kind', () => {
  try {
    compile(`(import "m" "n" (unknown))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown'), e.message)
  }
})

// Duplicate identifiers
t('error: duplicate memory', () => {
  try {
    compile(`(memory $m 1) (memory $m 1)`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Duplicate memory $m'), e.message)
  }
})

t('error: duplicate table', () => {
  try {
    compile(`(table $t 1 funcref) (table $t 1 funcref)`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Duplicate table $t'), e.message)
  }
})

t('error: duplicate global', () => {
  try {
    compile(`(global $g i32 (i32.const 0)) (global $g i32 (i32.const 0))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Duplicate global $g'), e.message)
  }
})

// Unknown references
t('error: unknown data', () => {
  try {
    compile(`(func (data.drop $missing))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown data $missing'), e.message)
  }
})

t('error: unknown elem', () => {
  try {
    compile(`(table 1 funcref) (func (table.init $missing (i32.const 0) (i32.const 0) (i32.const 0)))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown elem $missing'), e.message)
  }
})

t('error: unknown tag', () => {
  try {
    compile(`(func (throw $missing))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown tag $missing'), e.message)
  }
})

// Type errors
t('error: unknown type reference', () => {
  try {
    compile(`(func (type $missing))`)
    ok(false, 'should throw')
  } catch (e) {
    ok(e.message.includes('Unknown type $missing'), e.message)
  }
})

// Demo tests (visual inspection)
t.demo('Unknown instruction', () => {
  compile(`(module
  (func (result i32)
    (i32.unknown 42)
  )
)`)
})

t.demo('Duplicate function name', () => {
  compile(`(module
  (func $test (result i32) (i32.const 1))
  (func $test (result i32) (i32.const 2))
)`)

})

t.demo('Unknown function reference', () => {
  compile(`(module
  (func $add (param i32 i32) (result i32)
    (i32.add (local.get 0) (local.get 1)))
  (func (export "test")
    (call $missing (i32.const 42)))
)`)

})

t.demo('Bad type reference', () => {
  compile(`(module
  (func (param unknown) (result i32)
    (i32.const 42))
)`)

})

t.demo('Unknown local variable', () => {
  compile(`(module
  (func (param i32) (result i32)
    (local.get $nonexistent))
)`)

})

t.demo('Duplicate local name', () => {
  compile(`(module
  (func (param i32)
    (local $x i32)
    (local $x i32)
    (i32.const 0))
)`)

})

t.demo('Invalid memory reference', () => {
  compile(`(module
  (memory 1)
  (func
    (i32.load (i32.const 0))
    (i32.store $invalid (i32.const 0) (i32.const 42)))
)`)

})

t.demo('Unknown table', () => {
  compile(`(module
  (func
    (call_indirect $nonexistent (type 0) (i32.const 0)))
)`)

})

t.demo('Bad label reference', () => {
  compile(`(module
  (func
    (block $outer
      (br $inner)))
)`)

})

t.demo('Unknown global', () => {
  compile(`(module
  (func (result i32)
    (global.get $undefined))
)`)

})

t.demo('Unbalanced parenthesis', () => {
  compile(`(module
  (func (result i32)
    (i32.const 42)
  (;; missing closing paren
)`)

})

t.demo('Complex nested error', () => {
  compile(`(module
  (type $sig (func (param i32) (result i32)))
  (table 10 funcref)
  (func $double (param i32) (result i32)
    (i32.mul (local.get 0) (i32.const 2)))
  (func (export "test") (param i32) (result i32)
    (call_indirect (type $sig)
      (local.get 0)
      (i32.const 5))
    (call $triple (i32.const 10)))
  (func $main
    (drop (call $double (i32.const 21))))
)`)

})
