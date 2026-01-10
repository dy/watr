;; ॐ - The eternal sound
;; A meditation on numbers through WebAssembly
;;
;; "That which pervades the entire body you should know to be indestructible.
;;  No one is able to destroy that imperishable soul." - Bhagavad Gita 2.17

(module
  ;; 108 - sacred number in Vedic tradition
  ;; 1 truth, 0 illusion, 8 infinity
  (global (export "om") i32 (i32.const 108))

  ;; The three gunas (qualities of nature)
  (func (export "sattva") (result i32) (i32.const 1))  ;; purity, truth
  (func (export "rajas") (result i32) (i32.const 2))   ;; passion, activity
  (func (export "tamas") (result i32) (i32.const 3))   ;; inertia, darkness

  ;; Sum of gunas = 6 = creation
  (func (export "prakriti") (result i32)
    (i32.add (i32.add (call $sattva) (call $rajas)) (call $tamas)))

  ;; Reference to internal names
  (func $sattva (result i32) (i32.const 1))
  (func $rajas (result i32) (i32.const 2))
  (func $tamas (result i32) (i32.const 3))

  ;; Fibonacci - nature's algorithm, the golden spiral
  ;; Found in shells, flowers, galaxies
  (func (export "fibonacci") (param $n i32) (result i32)
    (if (result i32) (i32.lt_s (local.get $n) (i32.const 2))
      (then (local.get $n))
      (else
        (i32.add
          (call 4 (i32.sub (local.get $n) (i32.const 1)))
          (call 4 (i32.sub (local.get $n) (i32.const 2)))))))

  ;; Is prime? - indivisible, like the Atman
  (func (export "isPrime") (param $n i32) (result i32)
    (local $i i32)
    (if (i32.lt_s (local.get $n) (i32.const 2))
      (then (return (i32.const 0))))
    (local.set $i (i32.const 2))
    (block $done
      (loop $check
        (br_if $done (i32.gt_s (i32.mul (local.get $i) (local.get $i)) (local.get $n)))
        (if (i32.eqz (i32.rem_s (local.get $n) (local.get $i)))
          (then (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $check)))
    (i32.const 1))
)
