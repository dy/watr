# JS String Builtins

The watr compiler supports the [WebAssembly JS String Builtins proposal](https://github.com/WebAssembly/js-string-builtins), which provides efficient access to JavaScript string operations without requiring JavaScript glue code.

## Overview

JS String Builtins are imported from the reserved `wasm:js-string` namespace. They allow WebAssembly modules to work efficiently with JavaScript strings using `externref` types.

## Available Builtins

### Type Testing and Casting

- **`cast`** - Validates and returns a string, traps if not a string
  ```wat
  (import "wasm:js-string" "cast" (func $cast (param externref) (result (ref extern))))
  ```

- **`test`** - Returns 1 if value is a string, 0 otherwise
  ```wat
  (import "wasm:js-string" "test" (func $test (param externref) (result i32)))
  ```

### String Creation

- **`fromCharCode`** - Creates a string from a single character code
  ```wat
  (import "wasm:js-string" "fromCharCode" (func $fromCharCode (param i32) (result (ref extern))))
  ```

- **`fromCodePoint`** - Creates a string from a Unicode code point
  ```wat
  (import "wasm:js-string" "fromCodePoint" (func $fromCodePoint (param i32) (result (ref extern))))
  ```

- **`fromCharCodeArray`** - Creates a string from an i16 array range in linear memory
  ```wat
  (import "wasm:js-string" "fromCharCodeArray"
    (func $fromCharCodeArray (param i32 i32 i32) (result (ref extern))))
  ```

### String Inspection

- **`charCodeAt`** - Gets the character code at a specified index
  ```wat
  (import "wasm:js-string" "charCodeAt" (func $charCodeAt (param externref i32) (result i32)))
  ```

- **`codePointAt`** - Gets the Unicode code point at a specified index
  ```wat
  (import "wasm:js-string" "codePointAt" (func $codePointAt (param externref i32) (result i32)))
  ```

- **`length`** - Returns the length of a string
  ```wat
  (import "wasm:js-string" "length" (func $length (param externref) (result i32)))
  ```

### String Manipulation

- **`concat`** - Concatenates two strings
  ```wat
  (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern))))
  ```

- **`substring`** - Extracts a substring using start and end indices
  ```wat
  (import "wasm:js-string" "substring" (func $substring (param externref i32 i32) (result (ref extern))))
  ```

- **`intoCharCodeArray`** - Copies a string into an i16 array in linear memory
  ```wat
  (import "wasm:js-string" "intoCharCodeArray"
    (func $intoCharCodeArray (param externref i32 i32) (result i32)))
  ```

### String Comparison

- **`equals`** - Compares two strings for equality (allows null)
  ```wat
  (import "wasm:js-string" "equals" (func $equals (param externref externref) (result i32)))
  ```

- **`compare`** - Lexicographic comparison, returns -1, 0, or 1
  ```wat
  (import "wasm:js-string" "compare" (func $compare (param externref externref) (result i32)))
  ```

## Usage Example

Here's a complete example that reverses a string:

```wat
(module
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

    ;; Initialize empty result string
    (local.set $result (call $substring (local.get $str) (i32.const 0) (i32.const 0)))

    ;; Loop backwards through string
    (local.set $i (local.get $len))
    (block $break
      (loop $continue
        (br_if $break (i32.eqz (local.get $i)))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))

        ;; Get char at position i and append to result
        (local.set $char
          (call $fromCharCode (call $charCodeAt (local.get $str) (local.get $i))))
        (local.set $result (call $concat (local.get $result) (local.get $char)))

        (br $continue)
      )
    )

    (local.get $result)
  )
)
```

## Implementation Details

JS String Builtins work through WebAssembly's import mechanism. The compiler already supports them - no new opcodes or special handling is needed. Simply import functions from the `wasm:js-string` namespace and provide implementations when instantiating the module:

```js
import { compile } from 'watr'

const src = `
  (import "wasm:js-string" "concat" (func $concat (param externref externref) (result (ref extern))))
  (func (export "joinStrings") (param externref externref) (result externref)
    (call $concat (local.get 0) (local.get 1))
  )
`

const buffer = compile(src)
const module = new WebAssembly.Module(buffer)
const instance = new WebAssembly.Instance(module, {
  'wasm:js-string': {
    concat: (a, b) => a + b
  }
})

instance.exports.joinStrings('Hello', ' World') // 'Hello World'
```

## Notes

- In production, these builtins would be provided by the WebAssembly runtime for optimal performance
- The test suite in [test/js-string-builtins.js](../test/js-string-builtins.js) provides comprehensive examples
- Most operations trap on invalid inputs (e.g., null strings, out-of-bounds indices)
- The `equals` function is the only one that explicitly allows null for both arguments

## References

- [Official Proposal](https://github.com/WebAssembly/js-string-builtins)
- [Proposal Overview](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md)
- [MDN: WebAssembly JavaScript builtins](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/JavaScript_builtins)
