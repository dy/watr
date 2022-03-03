;; test passing array to and back
(module
  (import "js" "mem" (memory 1))
  (import "console" "log" (func $log (param i32 f32)))

  ;; gain processing function
  (func $arr (export "arr")
    (local.array i32[] (i32.const 0))
    ;; doesn't work, although that's what walt generates
    ;; (local.set arr
    ;;   (subscript
    ;;     (local.set arr)
    ;;     (i32.const 0)
    ;;   )
    ;;   (i32.const 20)
    ;; )
    ;; (local.set arr
    ;;   (subscript
    ;;     (local.set arr)
    ;;     (i32.const 1)
    ;;   )
    ;;   (i32.const 15)
    ;; )
    ;; (return arr)
  )
)
