;; A JS-compiler-shaped GC module (strings as i16 arrays, cons strings, vectors,
;; objects with a props array, tagged values, closures) whose only import is
;; WASI fd_write: the gc polyfill lowers it to linear memory, so it runs where
;; GC doesn't, wasm2c included. `run` prints a report and returns its length.
(module
  (type $__vec_base (sub (struct (field $length (mut i32)))))
  (type $__arr_f64 (array (mut f64)))
  (type $__vec_f64 (sub $__vec_base (struct (field $length (mut i32)) (field $data (mut (ref null $__arr_f64))))))
  (type $__arr_externref (array (mut externref)))
  (type $__vec_externref (sub $__vec_base (struct (field $length (mut i32)) (field $data (mut (ref null $__arr_externref))))))
  (type $__str_data (array (mut i16)))
  (type $AnyString (sub (struct (field $len i32))))
  (type $NativeString (sub $AnyString (struct (field $len i32) (field $off i32) (field $data (ref null $__str_data)))))
  (type $ConsString (sub $AnyString (struct (field $len i32) (field $left (ref null $AnyString)) (field $right (ref null $AnyString)))))
  (type $$wasi_fd_write (func (param i32 i32 i32 i32) (result i32)))
  (type $PropEntry (struct (field $key (ref null $AnyString)) (field $value (mut anyref)) (field $flags (mut i32))))
  (type $PropMap (array (mut (ref null $PropEntry))))
  (type $Object (struct (field $proto (mut (ref null $Object))) (field $props (mut (ref null $PropMap))) (field $count (mut i32))))
  (type $__box_number (struct (field $value f64)))
  (type $AnyValue (struct (field $tag i32) (field $i32val i32) (field $f64val f64) (field $refval eqref) (field $externval externref)))
  (type $__fn_wrap_0_struct (sub (struct (field $func funcref))))
  (type $__fn_wrap_0_type (func (param (ref null $__fn_wrap_0_struct) externref) (result externref)))
  (type $__fn_wrap_1_struct (sub $__fn_wrap_0_struct (struct (field $func funcref) (field $env (ref null $Object)))))

  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (type $$wasi_fd_write)))
  (memory (export "memory") 1)

  ;; UTF-16 text, by unit: "Hello" 0, ", " 5, "world" 7, "!" 12, "n" 13, "sum" 14, "missing" 17,
  ;; " len=" 24, " sum=" 29, " n+x=" 34, " undefined=" 39, " kinds=" 50, "\n" 57
  (data $text "H\00e\00l\00l\00o\00,\00 \00w\00o\00r\00l\00d\00!\00n\00s\00u\00m\00m\00i\00s\00s\00i\00n\00g\00 \00l\00e\00n\00=\00 \00s\00u\00m\00=\00 \00n\00+\00x\00=\00 \00u\00n\00d\00e\00f\00i\00n\00e\00d\00=\00 \00k\00i\00n\00d\00s\00=\00\n\00")
  (elem declare func $adder)

  (global $__undefined (ref null $AnyValue) (struct.new $AnyValue (i32.const 1) (i32.const 0) (f64.const nan) (ref.null eq) (ref.null extern)))
  (global $out (mut i32) (i32.const 64))

  ;; text[off, off + n) as a native string, n UTF-16 units
  (func $str (param $off i32) (param $n i32) (result (ref $NativeString))
    (struct.new $NativeString (local.get $n) (i32.const 0) (array.new_data $__str_data $text (i32.shl (local.get $off) (i32.const 1)) (local.get $n))))

  (func $concat (param $a (ref null $AnyString)) (param $b (ref null $AnyString)) (result (ref $ConsString))
    (struct.new $ConsString
      (i32.add (struct.get $AnyString $len (local.get $a)) (struct.get $AnyString $len (local.get $b)))
      (local.get $a) (local.get $b)))

  ;; copy s's units into dst at at, walking cons strings
  (func $copy (param $s (ref null $AnyString)) (param $dst (ref $__str_data)) (param $at i32)
    (local $n (ref $NativeString)) (local $c (ref $ConsString))
    (block $cons (result (ref null $AnyString))
      (local.set $n (br_on_cast_fail $cons (ref null $AnyString) (ref $NativeString) (local.get $s)))
      (array.copy $__str_data $__str_data (local.get $dst) (local.get $at)
        (struct.get $NativeString $data (local.get $n)) (struct.get $NativeString $off (local.get $n)) (struct.get $NativeString $len (local.get $n)))
      (return))
    (local.set $c (ref.cast (ref $ConsString)))
    (call $copy (struct.get $ConsString $left (local.get $c)) (local.get $dst) (local.get $at))
    (call $copy (struct.get $ConsString $right (local.get $c)) (local.get $dst)
      (i32.add (local.get $at) (struct.get $AnyString $len (struct.get $ConsString $left (local.get $c))))))

  (func $flatten (param $s (ref null $AnyString)) (result (ref $NativeString)) (local $d (ref $__str_data))
    (if (ref.test (ref $NativeString) (local.get $s)) (then (return (ref.cast (ref $NativeString) (local.get $s)))))
    (local.set $d (array.new_default $__str_data (struct.get $AnyString $len (local.get $s))))
    (call $copy (local.get $s) (local.get $d) (i32.const 0))
    (struct.new $NativeString (array.len (local.get $d)) (i32.const 0) (local.get $d)))

  (func $equals (param $a (ref null $AnyString)) (param $b (ref null $AnyString)) (result i32)
    (local $x (ref $NativeString)) (local $y (ref $NativeString)) (local $i i32)
    (if (ref.eq (local.get $a) (local.get $b)) (then (return (i32.const 1))))
    (if (i32.ne (struct.get $AnyString $len (local.get $a)) (struct.get $AnyString $len (local.get $b))) (then (return (i32.const 0))))
    (local.set $x (call $flatten (local.get $a)))
    (local.set $y (call $flatten (local.get $b)))
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $i) (struct.get $NativeString $len (local.get $x))))
      (if (i32.ne
            (array.get_u $__str_data (struct.get $NativeString $data (local.get $x)) (i32.add (struct.get $NativeString $off (local.get $x)) (local.get $i)))
            (array.get_u $__str_data (struct.get $NativeString $data (local.get $y)) (i32.add (struct.get $NativeString $off (local.get $y)) (local.get $i))))
        (then (return (i32.const 0))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next)))
    (i32.const 1))

  ;; output: units as bytes into linear memory at $out
  (func $emit (param $s (ref null $AnyString)) (local $n (ref $NativeString)) (local $i i32)
    (local.set $n (call $flatten (local.get $s)))
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $i) (struct.get $NativeString $len (local.get $n))))
      (i32.store8 (global.get $out)
        (array.get_u $__str_data (struct.get $NativeString $data (local.get $n)) (i32.add (struct.get $NativeString $off (local.get $n)) (local.get $i))))
      (global.set $out (i32.add (global.get $out) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next))))

  (func $emit_int (param $v i32) (local $digits (ref $__str_data)) (local $i i32) (local $neg i32)
    (local.set $digits (array.new_default $__str_data (i32.const 11)))
    (local.set $i (i32.const 11))
    (if (i32.lt_s (local.get $v) (i32.const 0)) (then (local.set $neg (i32.const 1)) (local.set $v (i32.sub (i32.const 0) (local.get $v)))))
    (loop $next
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (array.set $__str_data (local.get $digits) (local.get $i) (i32.add (i32.const 48) (i32.rem_u (local.get $v) (i32.const 10))))
      (br_if $next (local.tee $v (i32.div_u (local.get $v) (i32.const 10)))))
    (if (local.get $neg) (then
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (array.set $__str_data (local.get $digits) (local.get $i) (i32.const 45))))
    (call $emit (struct.new $NativeString (i32.sub (i32.const 11) (local.get $i)) (local.get $i) (local.get $digits))))

  ;; vectors: length plus a data array that doubles
  (func $vec_push (param $v (ref $__vec_f64)) (param $x f64) (local $d (ref null $__arr_f64)) (local $n i32)
    (local.set $d (struct.get $__vec_f64 $data (local.get $v)))
    (local.set $n (struct.get $__vec_base $length (local.get $v)))
    (if (i32.ge_u (local.get $n) (array.len (local.get $d))) (then
      (local.set $d (array.new $__arr_f64 (f64.const 0) (i32.shl (local.get $n) (i32.const 1))))
      (array.copy $__arr_f64 $__arr_f64 (local.get $d) (i32.const 0) (struct.get $__vec_f64 $data (local.get $v)) (i32.const 0) (local.get $n))
      (struct.set $__vec_f64 $data (local.get $v) (local.get $d))))
    (array.set $__arr_f64 (local.get $d) (local.get $n) (local.get $x))
    (struct.set $__vec_base $length (local.get $v) (i32.add (local.get $n) (i32.const 1))))

  (func $vec_sum (param $v (ref $__vec_f64)) (result f64) (local $i i32) (local $s f64)
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $i) (struct.get $__vec_base $length (local.get $v))))
      (local.set $s (f64.add (local.get $s) (array.get $__arr_f64 (struct.get $__vec_f64 $data (local.get $v)) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next)))
    (local.get $s))

  ;; objects: props found by key, the map grows by copy
  (func $obj_new (result (ref $Object))
    (struct.new $Object (ref.null $Object) (array.new_default $PropMap (i32.const 1)) (i32.const 0)))

  (func $obj_find (param $o (ref $Object)) (param $key (ref null $AnyString)) (result (ref null $PropEntry))
    (local $i i32) (local $e (ref null $PropEntry))
    (loop $next
      (if (i32.lt_u (local.get $i) (struct.get $Object $count (local.get $o))) (then
        (local.set $e (array.get $PropMap (struct.get $Object $props (local.get $o)) (local.get $i)))
        (if (call $equals (struct.get $PropEntry $key (local.get $e)) (local.get $key)) (then (return (local.get $e))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next))))
    (if (ref.is_null (struct.get $Object $proto (local.get $o))) (then (return (ref.null $PropEntry))))
    (call $obj_find (ref.as_non_null (struct.get $Object $proto (local.get $o))) (local.get $key)))

  (func $obj_get (param $o (ref $Object)) (param $key (ref null $AnyString)) (result anyref)
    (block $missing
      (return (struct.get $PropEntry $value (br_on_null $missing (call $obj_find (local.get $o) (local.get $key))))))
    (global.get $__undefined))

  (func $obj_set (param $o (ref $Object)) (param $key (ref null $AnyString)) (param $v anyref)
    (local $e (ref null $PropEntry)) (local $map (ref null $PropMap)) (local $n i32)
    (local.set $e (call $obj_find (local.get $o) (local.get $key)))
    (if (i32.eqz (ref.is_null (local.get $e))) (then (struct.set $PropEntry $value (local.get $e) (local.get $v)) (return)))
    (local.set $map (struct.get $Object $props (local.get $o)))
    (local.set $n (struct.get $Object $count (local.get $o)))
    (if (i32.eq (local.get $n) (array.len (local.get $map))) (then
      (local.set $map (array.new_default $PropMap (i32.shl (local.get $n) (i32.const 1))))
      (array.copy $PropMap $PropMap (local.get $map) (i32.const 0) (struct.get $Object $props (local.get $o)) (i32.const 0) (local.get $n))
      (struct.set $Object $props (local.get $o) (local.get $map))))
    (array.set $PropMap (local.get $map) (local.get $n) (struct.new $PropEntry (local.get $key) (local.get $v) (i32.const 0)))
    (struct.set $Object $count (local.get $o) (i32.add (local.get $n) (i32.const 1))))

  ;; any value as an int: i31, boxed number, tagged value, string length; null is 0
  (func $to_int (param $v anyref) (result i32) (local $av (ref $AnyValue))
    (if (ref.is_null (local.get $v)) (then (return (i32.const 0))))
    (if (ref.test (ref i31) (local.get $v)) (then (return (i31.get_s (ref.cast (ref i31) (local.get $v))))))
    (block $notnum
      (return (i32.trunc_f64_s (struct.get $__box_number $value
        (block $num (result (ref $__box_number))
          (br_on_cast $num anyref (ref $__box_number) (local.get $v))
          (drop) (br $notnum))))))
    (block $notval (result anyref)
      (local.set $av (br_on_cast_fail $notval anyref (ref $AnyValue) (local.get $v)))
      (return (if (result i32) (i32.eq (struct.get $AnyValue $tag (local.get $av)) (i32.const 1)) (then (i32.const -1)) (else (i32.const -2)))))
    (drop)
    (struct.get $AnyString $len (ref.cast (ref $AnyString) (local.get $v))))

  ;; a closure: adds env.n to its argument
  (func $adder (type $__fn_wrap_0_type) (local $env (ref null $Object))
    (local.set $env (struct.get $__fn_wrap_1_struct $env (ref.cast (ref $__fn_wrap_1_struct) (local.get 0))))
    (extern.convert_any (ref.i31 (i32.add
      (call $to_int (any.convert_extern (local.get 1)))
      (call $to_int (call $obj_get (ref.as_non_null (local.get $env)) (call $str (i32.const 13) (i32.const 1))))))))

  (func $call (param $f (ref null $__fn_wrap_0_struct)) (param $x externref) (result externref)
    (call_ref $__fn_wrap_0_type (local.get $f) (local.get $x)
      (ref.cast (ref $__fn_wrap_0_type) (struct.get $__fn_wrap_0_struct $func (local.get $f)))))

  ;; "Hello, world! len=13 sum=24 n+x=47 undefined=-1 kinds=33\n"
  (func $report (result i32)
    (local $s (ref null $AnyString)) (local $v (ref $__vec_f64)) (local $o (ref $Object)) (local $child (ref $Object))
    (local $f (ref $__fn_wrap_1_struct)) (local $boxes (ref $__vec_externref)) (local $i i32) (local $k i32)
    (global.set $out (i32.const 64))
    ;; "Hello" ", " "world" "!" as cons strings
    (local.set $s (call $concat (call $concat (call $str (i32.const 0) (i32.const 5)) (call $str (i32.const 5) (i32.const 2)))
                                (call $concat (call $str (i32.const 7) (i32.const 5)) (call $str (i32.const 12) (i32.const 1)))))
    (call $emit (local.get $s))
    (call $emit (call $str (i32.const 24) (i32.const 5)))
    (call $emit_int (struct.get $AnyString $len (local.get $s)))
    ;; vector: 1.5 + 2.5 + ... grows twice
    (local.set $v (struct.new $__vec_f64 (i32.const 0) (array.new_fixed $__arr_f64 1 (f64.const 0))))
    (loop $push
      (call $vec_push (local.get $v) (f64.add (f64.convert_i32_s (local.get $i)) (f64.const 1.5)))
      (br_if $push (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (i32.const 6))))
    (call $emit (call $str (i32.const 29) (i32.const 5)))
    (call $emit_int (i32.trunc_f64_s (call $vec_sum (local.get $v))))
    ;; object chain: child -> proto; n lives on the proto, sum on the child
    (local.set $o (call $obj_new))
    (call $obj_set (local.get $o) (call $str (i32.const 13) (i32.const 1)) (struct.new $__box_number (f64.const 42.9)))
    (local.set $child (call $obj_new))
    (struct.set $Object $proto (local.get $child) (local.get $o))
    (call $obj_set (local.get $child) (call $str (i32.const 14) (i32.const 3)) (ref.i31 (i32.const 21)))
    ;; "su" + "m" finds the same key
    (call $obj_set (local.get $child) (call $concat (call $str (i32.const 14) (i32.const 2)) (call $str (i32.const 16) (i32.const 1))) (ref.i31 (i32.const 22)))
    ;; closure over the child: n + x through the proto
    (local.set $f (struct.new $__fn_wrap_1_struct (ref.func $adder) (local.get $child)))
    (call $emit (call $str (i32.const 34) (i32.const 5)))
    (call $emit_int (call $to_int (any.convert_extern (call $call (local.get $f) (extern.convert_any (ref.i31 (i32.const 5)))))))
    (call $emit (call $str (i32.const 39) (i32.const 11)))
    (call $emit_int (call $to_int (call $obj_get (local.get $child) (call $str (i32.const 17) (i32.const 7)))))
    ;; a vector of externrefs holding every kind of value, plus the updated sum
    (local.set $k (call $to_int (call $obj_get (local.get $child) (call $str (i32.const 14) (i32.const 3)))))
    (local.set $boxes (struct.new $__vec_externref (i32.const 5) (array.new_fixed $__arr_externref 5
      (extern.convert_any (ref.i31 (i32.const 3)))
      (extern.convert_any (struct.new $__box_number (f64.const 4.5)))
      (extern.convert_any (call $str (i32.const 0) (i32.const 5)))
      (extern.convert_any (global.get $__undefined))
      (ref.null extern))))
    (local.set $i (i32.const 0))
    (loop $sum
      (local.set $k (i32.add (local.get $k) (call $to_int (any.convert_extern
        (array.get $__arr_externref (struct.get $__vec_externref $data (local.get $boxes)) (local.get $i))))))
      (br_if $sum (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (struct.get $__vec_base $length (local.get $boxes)))))
    (call $emit (call $str (i32.const 50) (i32.const 7)))
    (call $emit_int (local.get $k))
    (call $emit (call $str (i32.const 57) (i32.const 1)))
    (i32.sub (global.get $out) (i32.const 64)))

  ;; write the report to stdout: iovec at 0, bytes written at 8
  (func $run (export "run") (result i32) (local $n i32)
    (local.set $n (call $report))
    (i32.store (i32.const 0) (i32.const 64))
    (i32.store (i32.const 4) (local.get $n))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
    (local.get $n))

  (func (export "_start") (drop (call $run)))
)
