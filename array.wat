;; test passing array to and back
(module
  (import "js" "mem" (memory 1))
  (import "console" "log" (func $log (param i32 f32)))

  (global $blockSize (import "js" "blockSize") (mut i32))
  (global $len (mut i32) (i32.const 0))
  ;; len = blockSize * 4
  (func (global.set $len (i32.mul (global.get $blockSize) (i32.const 4))))
  (start 1)

  ;; gain processing function
  (func $amp (export "amp") (param $amp f32)
    (local $i i32)
    (local $x f32)

    (loop $gain
      ;; x = input[i]
      (local.set $x (f32.load (local.get $i)))

      ;; console.log(i, x)
      ;; (call $log (local.get $i) (local.get $x))

      ;; x = x * amp
      (local.set $x (f32.mul (local.get $x) (local.get $amp)))

      ;; input[i] = x * amp
      (f32.store (local.get $i) (local.get $x))

      ;; i++
      (local.set $i (i32.add (local.get $i) (i32.const 4)))

      ;; if (i < len) repeat
      (br_if $gain (i32.lt_s (local.get $i) (global.get $len)))
    )
  )
)
