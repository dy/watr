import t, { is, ok, same, throws } from 'tst'
import { inline } from './index.js'

// JS String Builtins Tests
// https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md
//
// These builtins are imported from the reserved "wasm:js-string" namespace
// and provide efficient access to JavaScript string operations without the overhead
// of importing JavaScript glue code.

t('js-string: cast - validates and returns a string', () => {
  let src = `
    (import "wasm:js-string" "cast" (func $cast (param externref) (result (ref extern))))
    (func (export "test") (param externref) (result externref)
      (call $cast (local.get 0))
    )
  `

  // Note: In a real implementation, this would require runtime support
  // For now, we can verify the module compiles correctly
  let wasm = inline(src, {
    'wasm:js-string': {
      cast: (s) => {
        if (s === null || typeof s !== 'string') throw new Error('Not a string');
        return s;
      }
    }
  })

  is(wasm.exports.test('hello'), 'hello')
  throws(() => wasm.exports.test(null))
  throws(() => wasm.exports.test(123))
})

t('js-string: test - checks if value is a string', () => {
  let src = `
    (import "wasm:js-string" "test" (func $test (param externref) (result i32)))
    (func (export "isString") (param externref) (result i32)
      (call $test (local.get 0))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      test: (s) => typeof s === 'string' && s !== null ? 1 : 0
    }
  })

  is(wasm.exports.isString('hello'), 1)
  is(wasm.exports.isString(null), 0)
  is(wasm.exports.isString(123), 0)
})

t('js-string: fromCharCode - creates string from single char code', () => {
  let src = `
    (import "wasm:js-string" "fromCharCode" (func $fromCharCode (param i32) (result (ref extern))))
    (func (export "charToString") (param i32) (result externref)
      (call $fromCharCode (local.get 0))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      fromCharCode: (code) => String.fromCharCode(code)
    }
  })

  is(wasm.exports.charToString(65), 'A')
  is(wasm.exports.charToString(97), 'a')
  is(wasm.exports.charToString(48), '0')
})

t('js-string: fromCodePoint - creates string from code point', () => {
  let src = `
    (import "wasm:js-string" "fromCodePoint" (func $fromCodePoint (param i32) (result (ref extern))))
    (func (export "cpToString") (param i32) (result externref)
      (call $fromCodePoint (local.get 0))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      fromCodePoint: (cp) => {
        if (cp < 0 || cp > 0x10FFFF) throw new Error('Invalid code point');
        return String.fromCodePoint(cp);
      }
    }
  })

  is(wasm.exports.cpToString(0x1F600), '😀') // grinning face emoji
  is(wasm.exports.cpToString(65), 'A')
  throws(() => wasm.exports.cpToString(-1))
  throws(() => wasm.exports.cpToString(0x110000))
})

t('js-string: charCodeAt - gets char code at index', () => {
  let src = `
    (import "wasm:js-string" "charCodeAt" (func $charCodeAt (param externref i32) (result i32)))
    (func (export "getCharCode") (param externref i32) (result i32)
      (call $charCodeAt (local.get 0) (local.get 1))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      charCodeAt: (s, i) => {
        if (typeof s !== 'string' || i < 0 || i >= s.length) throw new Error('Invalid');
        return s.charCodeAt(i);
      }
    }
  })

  is(wasm.exports.getCharCode('ABC', 0), 65)
  is(wasm.exports.getCharCode('ABC', 1), 66)
  is(wasm.exports.getCharCode('ABC', 2), 67)
})

t('js-string: codePointAt - gets code point at index', () => {
  let src = `
    (import "wasm:js-string" "codePointAt" (func $codePointAt (param externref i32) (result i32)))
    (func (export "getCodePoint") (param externref i32) (result i32)
      (call $codePointAt (local.get 0) (local.get 1))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      codePointAt: (s, i) => {
        if (typeof s !== 'string' || i < 0 || i >= s.length) throw new Error('Invalid');
        return s.codePointAt(i);
      }
    }
  })

  is(wasm.exports.getCodePoint('😀A', 0), 0x1F600)
  is(wasm.exports.getCodePoint('A😀', 1), 0x1F600)
})

t('js-string: length - returns string length', () => {
  let src = `
    (import "wasm:js-string" "length" (func $length (param externref) (result i32)))
    (func (export "getLength") (param externref) (result i32)
      (call $length (local.get 0))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      length: (s) => {
        if (typeof s !== 'string') throw new Error('Not a string');
        return s.length;
      }
    }
  })

  is(wasm.exports.getLength('hello'), 5)
  is(wasm.exports.getLength(''), 0)
  is(wasm.exports.getLength('😀'), 2) // emoji is 2 UTF-16 code units
})

t('js-string: concat - combines two strings', () => {
  let src = `
    (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern))))
    (func (export "joinStrings") (param externref externref) (result externref)
      (call $concat (local.get 0) (local.get 1))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      concat: (a, b) => {
        if (typeof a !== 'string' || typeof b !== 'string') throw new Error('Not strings');
        return a + b;
      }
    }
  })

  is(wasm.exports.joinStrings('hello', ' world'), 'hello world')
  is(wasm.exports.joinStrings('foo', 'bar'), 'foobar')
  is(wasm.exports.joinStrings('', 'test'), 'test')
})

t('js-string: substring - extracts substring', () => {
  let src = `
    (import "wasm:js-string" "substring" (func $substring (param externref i32 i32) (result (ref extern))))
    (func (export "substr") (param externref i32 i32) (result externref)
      (call $substring (local.get 0) (local.get 1) (local.get 2))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      substring: (s, start, end) => {
        if (typeof s !== 'string') throw new Error('Not a string');
        return s.substring(start, end);
      }
    }
  })

  is(wasm.exports.substr('hello world', 0, 5), 'hello')
  is(wasm.exports.substr('hello world', 6, 11), 'world')
  is(wasm.exports.substr('test', 1, 3), 'es')
})

t('js-string: equals - compares two strings', () => {
  let src = `
    (import "wasm:js-string" "equals" (func $equals (param externref externref) (result i32)))
    (func (export "isEqual") (param externref externref) (result i32)
      (call $equals (local.get 0) (local.get 1))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      equals: (a, b) => a === b ? 1 : 0
    }
  })

  is(wasm.exports.isEqual('hello', 'hello'), 1)
  is(wasm.exports.isEqual('hello', 'world'), 0)
  is(wasm.exports.isEqual('', ''), 1)
  is(wasm.exports.isEqual(null, null), 1) // equals allows null
})

t('js-string: compare - lexicographic comparison', () => {
  let src = `
    (import "wasm:js-string" "compare" (func $compare (param externref externref) (result i32)))
    (func (export "cmp") (param externref externref) (result i32)
      (call $compare (local.get 0) (local.get 1))
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      compare: (a, b) => {
        if (typeof a !== 'string' || typeof b !== 'string') throw new Error('Not strings');
        return a < b ? -1 : a > b ? 1 : 0;
      }
    }
  })

  is(wasm.exports.cmp('apple', 'banana'), -1)
  is(wasm.exports.cmp('zebra', 'apple'), 1)
  is(wasm.exports.cmp('test', 'test'), 0)
})

t('js-string: fromCharCodeArray - creates string from i16 array', () => {
  let src = `
    (memory (export "mem") 1)
    (import "wasm:js-string" "fromCharCodeArray"
      (func $fromCharCodeArray (param i32 i32 i32) (result (ref extern))))
    (func (export "arrayToString") (param i32 i32 i32) (result externref)
      ;; array: i32, start: i32, end: i32
      (call $fromCharCodeArray (local.get 0) (local.get 1) (local.get 2))
    )
    (func (export "writeChars") (param i32 i32 i32)
      ;; Write three i16 values at offset 0
      (i32.store16 (i32.const 0) (local.get 0))
      (i32.store16 (i32.const 2) (local.get 1))
      (i32.store16 (i32.const 4) (local.get 2))
    )
  `

  let memRef = null;

  let wasm = inline(src, {
    'wasm:js-string': {
      fromCharCodeArray: function(array, start, end) {
        // In real implementation, array would be offset into linear memory
        // For testing, we read from the instance's memory
        const mem = new Uint16Array(memRef.buffer);
        let result = '';
        for (let i = start; i < end; i++) {
          result += String.fromCharCode(mem[array / 2 + i]);
        }
        return result;
      }
    }
  })

  // Save memory reference
  memRef = wasm.exports.mem;

  // Write char codes to memory: 'A', 'B', 'C'
  wasm.exports.writeChars(65, 66, 67)

  // Read from memory offset 0, positions 0-3
  is(wasm.exports.arrayToString(0, 0, 3), 'ABC')
})

t('js-string: intoCharCodeArray - copies string to i16 array', () => {
  let src = `
    (memory (export "mem") 1)
    (import "wasm:js-string" "intoCharCodeArray"
      (func $intoCharCodeArray (param externref i32 i32) (result i32)))
    (func (export "stringToArray") (param externref i32) (result i32)
      ;; string: externref, array: i32, start: i32
      ;; start is hardcoded to 0 for simplicity
      (call $intoCharCodeArray (local.get 0) (local.get 1) (i32.const 0))
    )
    (func (export "readChar") (param i32) (result i32)
      ;; Read i16 at byte offset
      (i32.load16_u (local.get 0))
    )
  `

  let memRef = null;

  let wasm = inline(src, {
    'wasm:js-string': {
      intoCharCodeArray: function(str, array, start) {
        if (typeof str !== 'string') throw new Error('Not a string');
        const mem = new Uint16Array(memRef.buffer);
        for (let i = 0; i < str.length; i++) {
          mem[array / 2 + start + i] = str.charCodeAt(i);
        }
        return str.length;
      }
    }
  })

  // Save memory reference
  memRef = wasm.exports.mem;

  // Copy "Hi" to memory at offset 0
  let written = wasm.exports.stringToArray('Hi', 0)
  is(written, 2)

  // Read back the char codes
  is(wasm.exports.readChar(0), 72)  // 'H'
  is(wasm.exports.readChar(2), 105) // 'i'
})

t('js-string: complex example - string reversal', () => {
  let src = `
    (import "wasm:js-string" "length" (func $length (param externref) (result i32)))
    (import "wasm:js-string" "charCodeAt" (func $charCodeAt (param externref i32) (result i32)))
    (import "wasm:js-string" "fromCharCode" (func $fromCharCode (param i32) (result (ref extern))))
    (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern))))
    (import "wasm:js-string" "substring" (func $substring (param externref i32 i32) (result (ref extern))))

    (func (export "reverse") (param $str externref) (result externref)
      (local $len i32)
      (local $i i32)
      (local $result externref)
      (local $char externref)

      ;; Get string length
      (local.set $len (call $length (local.get $str)))

      ;; Initialize empty result string using substring(str, 0, 0)
      (local.set $result (call $substring (local.get $str) (i32.const 0) (i32.const 0)))

      ;; Loop backwards through string
      (local.set $i (local.get $len))
      (block $break
        (loop $continue
          ;; Break if i == 0
          (br_if $break (i32.eqz (local.get $i)))

          ;; Decrement i
          (local.set $i (i32.sub (local.get $i) (i32.const 1)))

          ;; Get char at position i and append to result
          (local.set $char
            (call $fromCharCode
              (call $charCodeAt (local.get $str) (local.get $i))))
          (local.set $result (call $concat (local.get $result) (local.get $char)))

          (br $continue)
        )
      )

      (local.get $result)
    )
  `

  let wasm = inline(src, {
    'wasm:js-string': {
      length: (s) => typeof s === 'string' ? s.length : 0,
      charCodeAt: (s, i) => s.charCodeAt(i),
      fromCharCode: (c) => String.fromCharCode(c),
      substring: (s, start, end) => s.substring(start, end),
      concat: (a, b) => a + b
    }
  })

  is(wasm.exports.reverse('hello'), 'olleh')
  is(wasm.exports.reverse('WASM'), 'MSAW')
  is(wasm.exports.reverse('a'), 'a')
})
