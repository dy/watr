;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; raycast                              ;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;Compiled by WAXC (Version Mar  3 2021);;

(module
(import "console" "log" (func $wax::js::console.log (param i32) (param i32)))
(import "Math" "log"    (func $log   (param f32) (result f32)))
(import "Math" "exp"    (func $exp   (param f32) (result f32)))
(import "Math" "cos"    (func $cos   (param f32) (result f32)))
(import "Math" "sin"    (func $sin   (param f32) (result f32)))
(import "Math" "tan"    (func $tan   (param f32) (result f32)))
(import "Math" "cosh"   (func $cosh  (param f32) (result f32)))
(import "Math" "sinh"   (func $sinh  (param f32) (result f32)))
(import "Math" "tanh"   (func $tanh  (param f32) (result f32)))
(import "Math" "acos"   (func $acos  (param f32) (result f32)))
(import "Math" "asin"   (func $asin  (param f32) (result f32)))
(import "Math" "atan2"  (func $atan2 (param f32) (param  f32) (result f32)))
(import "Math" "pow"    (func $pow   (param f32) (param  f32) (result f32)))
(import "Math" "random" (func $random            (result f32)))

(func $fmax (param $x f32) (param $y f32) (result f32) (f32.max (local.get $x) (local.get $y)))
(func $fmin (param $x f32) (param $y f32) (result f32) (f32.min (local.get $x) (local.get $y)))
(func $fabs (param $x f32) (result f32) (f32.abs (local.get $x)))
(func $floor (param $x f32) (result f32) (f32.floor (local.get $x)))
(func $ceil (param $x f32) (result f32) (f32.ceil (local.get $x)))
(func $sqrt (param $x f32) (result f32) (f32.sqrt (local.get $x)))
(func $round (param $x f32) (result f32) (f32.nearest (local.get $x)))

(func $abs (param $x i32) (result i32)
  (if (i32.lt_s (local.get $x) (i32.const 0))(then
      (i32.sub (i32.const 0) (local.get $x))
      return
  ))
  (local.get $x)
)

(global $INFINITY f32 (f32.const 340282346638528859811704183484516925440))

;;=== User Code            BEGIN ===;;
  (func $get__ray__o (param $ptr i32) (result i32) (i32.load (i32.add (local.get $ptr) (i32.const 0))))
  (func $set__ray__o (param $ptr i32) (param $v i32) (i32.store (i32.add (local.get $ptr) (i32.const 0)) (local.get $v)))
  (func $get__ray__d (param $ptr i32) (result i32) (i32.load (i32.add (local.get $ptr) (i32.const 4))))
  (func $set__ray__d (param $ptr i32) (param $v i32) (i32.store (i32.add (local.get $ptr) (i32.const 4)) (local.get $v)))
  (func $get__ray__tmin (param $ptr i32) (result f32) (f32.load (i32.add (local.get $ptr) (i32.const 8))))
  (func $set__ray__tmin (param $ptr i32) (param $v f32) (f32.store (i32.add (local.get $ptr) (i32.const 8)) (local.get $v)))
  (func $get__ray__tmax (param $ptr i32) (result f32) (f32.load (i32.add (local.get $ptr) (i32.const 12))))
  (func $set__ray__tmax (param $ptr i32) (param $v f32) (f32.store (i32.add (local.get $ptr) (i32.const 12)) (local.get $v)))
  (global $sizeof__ray i32 (i32.const 16))
  (func $get__mesh__vertices (param $ptr i32) (result i32) (i32.load (i32.add (local.get $ptr) (i32.const 0))))
  (func $set__mesh__vertices (param $ptr i32) (param $v i32) (i32.store (i32.add (local.get $ptr) (i32.const 0)) (local.get $v)))
  (func $get__mesh__faces (param $ptr i32) (result i32) (i32.load (i32.add (local.get $ptr) (i32.const 4))))
  (func $set__mesh__faces (param $ptr i32) (param $v i32) (i32.store (i32.add (local.get $ptr) (i32.const 4)) (local.get $v)))
  (func $get__mesh__facenorms (param $ptr i32) (result i32) (i32.load (i32.add (local.get $ptr) (i32.const 8))))
  (func $set__mesh__facenorms (param $ptr i32) (param $v i32) (i32.store (i32.add (local.get $ptr) (i32.const 8)) (local.get $v)))
  (global $sizeof__mesh i32 (i32.const 12))
  (func $v_sub (export "v_sub") (param $u i32) (param $v i32) (result i32)
    (local $tmp___3cf f32)
    (local $tmp___3cd f32)
    (local $tmp___3ce f32)
    (local $tmp___3cb f32)
    (local $tmp___3cc f32)
    (local $tmp___3ca f32)
    (local $tmp___3d1 f32)
    (local $tmp___3d0 f32)
    (local $tmp___3d2 f32)
    (local $tmp___3c9 i32)


    (call $wax::push_stack)



    (local.set $tmp___3cb (f32.load (i32.add (local.get $u) (i32.mul (i32.const 0) (i32.const 4)))))

    (local.set $tmp___3cc (f32.load (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))))
    (local.set $tmp___3ca (f32.sub (local.get $tmp___3cb) (local.get $tmp___3cc)))


    (local.set $tmp___3ce (f32.load (i32.add (local.get $u) (i32.mul (i32.const 1) (i32.const 4)))))

    (local.set $tmp___3cf (f32.load (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))))
    (local.set $tmp___3cd (f32.sub (local.get $tmp___3ce) (local.get $tmp___3cf)))


    (local.set $tmp___3d1 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 2) (i32.const 4)))))

    (local.set $tmp___3d2 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))))
    (local.set $tmp___3d0 (f32.sub (local.get $tmp___3d1) (local.get $tmp___3d2)))
    (local.set $tmp___3c9 (call $w__vec_lit3 (i32.reinterpret_f32 (local.get $tmp___3ca)) (i32.reinterpret_f32 (local.get $tmp___3cd)) (i32.reinterpret_f32 (local.get $tmp___3d0))))
    (call $wax::pop_stack)
    (local.get $tmp___3c9)
    return
    (call $wax::pop_stack)
  )
  (func $v_cross (export "v_cross") (param $u i32) (param $v i32) (result i32)
    (local $tmp___3da f32)
    (local $tmp___3dc f32)
    (local $tmp___3db f32)
    (local $tmp___3de f32)
    (local $tmp___3dd f32)
    (local $tmp___3df f32)
    (local $tmp___3e0 f32)
    (local $tmp___3e1 f32)
    (local $tmp___3d3 i32)
    (local $tmp___3e2 f32)
    (local $tmp___3e3 f32)
    (local $tmp___3d5 f32)
    (local $tmp___3e4 f32)
    (local $tmp___3d4 f32)
    (local $tmp___3e5 f32)
    (local $tmp___3d7 f32)
    (local $tmp___3e6 f32)
    (local $tmp___3d6 f32)
    (local $tmp___3e7 f32)
    (local $tmp___3d9 f32)
    (local $tmp___3e8 f32)
    (local $tmp___3d8 f32)


    (call $wax::push_stack)




    (local.set $tmp___3d6 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 1) (i32.const 4)))))

    (local.set $tmp___3d7 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))))
    (local.set $tmp___3d5 (f32.mul (local.get $tmp___3d6) (local.get $tmp___3d7)))


    (local.set $tmp___3d9 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 2) (i32.const 4)))))

    (local.set $tmp___3da (f32.load (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))))
    (local.set $tmp___3d8 (f32.mul (local.get $tmp___3d9) (local.get $tmp___3da)))
    (local.set $tmp___3d4 (f32.sub (local.get $tmp___3d5) (local.get $tmp___3d8)))



    (local.set $tmp___3dd (f32.load (i32.add (local.get $u) (i32.mul (i32.const 2) (i32.const 4)))))

    (local.set $tmp___3de (f32.load (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))))
    (local.set $tmp___3dc (f32.mul (local.get $tmp___3dd) (local.get $tmp___3de)))


    (local.set $tmp___3e0 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 0) (i32.const 4)))))

    (local.set $tmp___3e1 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))))
    (local.set $tmp___3df (f32.mul (local.get $tmp___3e0) (local.get $tmp___3e1)))
    (local.set $tmp___3db (f32.sub (local.get $tmp___3dc) (local.get $tmp___3df)))



    (local.set $tmp___3e4 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 0) (i32.const 4)))))

    (local.set $tmp___3e5 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))))
    (local.set $tmp___3e3 (f32.mul (local.get $tmp___3e4) (local.get $tmp___3e5)))


    (local.set $tmp___3e7 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 1) (i32.const 4)))))

    (local.set $tmp___3e8 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))))
    (local.set $tmp___3e6 (f32.mul (local.get $tmp___3e7) (local.get $tmp___3e8)))
    (local.set $tmp___3e2 (f32.sub (local.get $tmp___3e3) (local.get $tmp___3e6)))
    (local.set $tmp___3d3 (call $w__vec_lit3 (i32.reinterpret_f32 (local.get $tmp___3d4)) (i32.reinterpret_f32 (local.get $tmp___3db)) (i32.reinterpret_f32 (local.get $tmp___3e2))))
    (call $wax::pop_stack)
    (local.get $tmp___3d3)
    return
    (call $wax::pop_stack)
  )
  (func $v_dot (export "v_dot") (param $u i32) (param $v i32) (result f32)
    (local $tmp___3ea f32)
    (local $tmp___3eb f32)
    (local $tmp___3ec f32)
    (local $tmp___3ed f32)
    (local $tmp___3ee f32)
    (local $tmp___3ef f32)
    (local $tmp___3f3 f32)
    (local $tmp___3f2 f32)
    (local $tmp___3f1 f32)
    (local $tmp___3f0 f32)
    (local $tmp___3e9 f32)


    (call $wax::push_stack)




    (local.set $tmp___3ec (f32.load (i32.add (local.get $u) (i32.mul (i32.const 0) (i32.const 4)))))

    (local.set $tmp___3ed (f32.load (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))))
    (local.set $tmp___3eb (f32.mul (local.get $tmp___3ec) (local.get $tmp___3ed)))


    (local.set $tmp___3ef (f32.load (i32.add (local.get $u) (i32.mul (i32.const 1) (i32.const 4)))))

    (local.set $tmp___3f0 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))))
    (local.set $tmp___3ee (f32.mul (local.get $tmp___3ef) (local.get $tmp___3f0)))
    (local.set $tmp___3ea (f32.add (local.get $tmp___3eb) (local.get $tmp___3ee)))


    (local.set $tmp___3f2 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 2) (i32.const 4)))))

    (local.set $tmp___3f3 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))))
    (local.set $tmp___3f1 (f32.mul (local.get $tmp___3f2) (local.get $tmp___3f3)))
    (local.set $tmp___3e9 (f32.add (local.get $tmp___3ea) (local.get $tmp___3f1)))
    (call $wax::pop_stack)
    (local.get $tmp___3e9)
    return
    (call $wax::pop_stack)
  )
  (func $v_scale (export "v_scale") (param $u i32) (param $x f32) (result i32)
    (local $tmp___3fa f32)
    (local $tmp___3f7 f32)
    (local $tmp___3f6 f32)
    (local $tmp___3f5 f32)
    (local $tmp___3f4 i32)
    (local $tmp___3f9 f32)
    (local $tmp___3f8 f32)


    (call $wax::push_stack)



    (local.set $tmp___3f6 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 0) (i32.const 4)))))
    (local.set $tmp___3f5 (f32.mul (local.get $tmp___3f6) (local.get $x)))


    (local.set $tmp___3f8 (f32.load (i32.add (local.get $u) (i32.mul (i32.const 1) (i32.const 4)))))
    (local.set $tmp___3f7 (f32.mul (local.get $tmp___3f8) (local.get $x)))


    (local.set $tmp___3fa (f32.load (i32.add (local.get $u) (i32.mul (i32.const 2) (i32.const 4)))))
    (local.set $tmp___3f9 (f32.mul (local.get $tmp___3fa) (local.get $x)))
    (local.set $tmp___3f4 (call $w__vec_lit3 (i32.reinterpret_f32 (local.get $tmp___3f5)) (i32.reinterpret_f32 (local.get $tmp___3f7)) (i32.reinterpret_f32 (local.get $tmp___3f9))))
    (call $wax::pop_stack)
    (local.get $tmp___3f4)
    return
    (call $wax::pop_stack)
  )
  (func $v_mag (export "v_mag") (param $v i32) (result f32)
    (local $tmp___3fc f32)
    (local $tmp___402 f32)
    (local $tmp___3fb f32)
    (local $tmp___403 f32)
    (local $tmp___400 f32)
    (local $tmp___401 f32)
    (local $tmp___406 f32)
    (local $tmp___3ff f32)
    (local $tmp___3fe f32)
    (local $tmp___404 f32)
    (local $tmp___3fd f32)
    (local $tmp___405 f32)


    (call $wax::push_stack)





    (local.set $tmp___3ff (f32.load (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))))

    (local.set $tmp___400 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))))
    (local.set $tmp___3fe (f32.mul (local.get $tmp___3ff) (local.get $tmp___400)))


    (local.set $tmp___402 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))))

    (local.set $tmp___403 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))))
    (local.set $tmp___401 (f32.mul (local.get $tmp___402) (local.get $tmp___403)))
    (local.set $tmp___3fd (f32.add (local.get $tmp___3fe) (local.get $tmp___401)))


    (local.set $tmp___405 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))))

    (local.set $tmp___406 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))))
    (local.set $tmp___404 (f32.mul (local.get $tmp___405) (local.get $tmp___406)))
    (local.set $tmp___3fc (f32.add (local.get $tmp___3fd) (local.get $tmp___404)))
    (local.set $tmp___3fb (call $sqrt (local.get $tmp___3fc)))
    (call $wax::pop_stack)
    (local.get $tmp___3fb)
    return
    (call $wax::pop_stack)
  )
  (func $normalize (export "normalize") (param $v i32)
    (local $tmp___407 f32)
    (local $tmp___408 f32)
    (local $tmp___409 f32)
    (local $tmp___40b f32)
    (local $tmp___40c f32)
    (local $tmp___40a f32)
    (local $tmp___40d f32)
    (local $l f32)


    (call $wax::push_stack)


    (local.set $tmp___407 (call $v_mag (local.get $v)))
    (local.set $l (local.get $tmp___407))


    (local.set $tmp___409 (f32.load (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))))
    (local.set $tmp___408 (f32.div (local.get $tmp___409) (local.get $l)))
    (f32.store (i32.add (local.get $v) (i32.mul (i32.const 0) (i32.const 4)))(local.get $tmp___408))


    (local.set $tmp___40b (f32.load (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))))
    (local.set $tmp___40a (f32.div (local.get $tmp___40b) (local.get $l)))
    (f32.store (i32.add (local.get $v) (i32.mul (i32.const 1) (i32.const 4)))(local.get $tmp___40a))


    (local.set $tmp___40d (f32.load (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))))
    (local.set $tmp___40c (f32.div (local.get $tmp___40d) (local.get $l)))
    (f32.store (i32.add (local.get $v) (i32.mul (i32.const 2) (i32.const 4)))(local.get $tmp___40c))
    (call $wax::pop_stack)
  )
  (func $det (export "det") (param $a i32) (param $b i32) (param $c i32) (result f32)
    (local $tmp___40f f32)
    (local $tmp___40e i32)
    (local $d i32)
    (local $e f32)


    (call $wax::push_stack)


    (local.set $tmp___40e (call $v_cross (local.get $a) (local.get $b)))
    (local.set $d (local.get $tmp___40e))


    (local.set $tmp___40f (call $v_dot (local.get $d) (local.get $c)))
    (local.set $e (local.get $tmp___40f))
    (call $wax::free (local.get $d))
    (call $wax::pop_stack)
    (local.get $e)
    return
    (call $wax::pop_stack)
  )
  (func $new_ray (export "new_ray") (param $ox f32) (param $oy f32) (param $oz f32) (param $dx f32) (param $dy f32) (param $dz f32) (result i32)
    (local $tmp___412 i32)
    (local $tmp___411 i32)
    (local $tmp___410 i32)
    (local $d i32)
    (local $o i32)
    (local $r i32)


    (call $wax::push_stack)


    (local.set $tmp___410 (call $wax::calloc (global.get $sizeof__ray)))
    (local.set $r (local.get $tmp___410))


    (local.set $tmp___411 (call $w__vec_lit3 (i32.reinterpret_f32 (local.get $ox)) (i32.reinterpret_f32 (local.get $oy)) (i32.reinterpret_f32 (local.get $oz))))
    (local.set $o (local.get $tmp___411))


    (local.set $tmp___412 (call $w__vec_lit3 (i32.reinterpret_f32 (local.get $dx)) (i32.reinterpret_f32 (local.get $dy)) (i32.reinterpret_f32 (local.get $dz))))
    (local.set $d (local.get $tmp___412))
    (call $normalize (local.get $d))
    (call $set__ray__o (local.get $r) (local.get $o))
    (call $set__ray__d (local.get $r) (local.get $d))
    (call $set__ray__tmin (local.get $r) (f32.const 0.0))
    (call $set__ray__tmax (local.get $r) (global.get $INFINITY))
    (call $wax::pop_stack)
    (local.get $r)
    return
    (call $wax::pop_stack)
  )
  (func $destroy_ray (export "destroy_ray") (param $r i32)
    (local $tmp___413 i32)
    (local $tmp___414 i32)


    (call $wax::push_stack)

    (local.set $tmp___413 (call $get__ray__o (local.get $r)))
    (call $wax::free (local.get $tmp___413))

    (local.set $tmp___414 (call $get__ray__d (local.get $r)))
    (call $wax::free (local.get $tmp___414))
    (call $wax::free (local.get $r))
    (call $wax::pop_stack)
  )
  (func $ray_tri (export "ray_tri") (param $r i32) (param $p0 i32) (param $p1 i32) (param $p2 i32) (result f32)
    (local $tmp___420 f32)
    (local $tmp___421 f32)
    (local $tmp___42d__s4e7 f32)
    (local $tmp___422 f32)
    (local $tmp___423 f32)
    (local $tmp___417 i32)
    (local $tmp___424 f32)
    (local $tmp___416 i32)
    (local $tmp___425 i32)
    (local $tmp___434 i32)
    (local $tmp___415 i32)
    (local $tmp___426 i32)
    (local $tmp___437 i32)
    (local $tmp___42c__s4e7 i32)
    (local $tmp___427 i32)
    (local $tmp___428 i32)
    (local $tmp___429 i32)
    (local $tmp___419 i32)
    (local $tmp___438__s4ea i32)
    (local $tmp___418 i32)
    (local $tmp___439__s4ea f32)
    (local $tmp___42f__s4e8 i32)
    (local $tmp___41c f32)
    (local $tmp___41b f32)
    (local $tmp___42a f32)
    (local $tmp___41a i32)
    (local $tmp___42b i32)
    (local $e1 i32)
    (local $tmp___41f f32)
    (local $tmp___42e i32)
    (local $tmp___41e f32)
    (local $e2 i32)
    (local $tmp___41d i32)
    (local $tmp___433__s4e8 f32)
    (local $tmp___432__s4e8 f32)
    (local $tmp___431__s4e8 f32)
    (local $tmp___430__s4e8 f32)
    (local $tmp___436__s4e9 f32)
    (local $tmp___435__s4e9 i32)
    (local $denom f32)
    (local $s i32)
    (local $t f32)
    (local $u f32)
    (local $v f32)
    (local $_d i32)


    (call $wax::push_stack)


    (local.set $tmp___415 (call $v_sub (local.get $p1) (local.get $p0)))
    (local.set $e1 (local.get $tmp___415))


    (local.set $tmp___416 (call $v_sub (local.get $p2) (local.get $p0)))
    (local.set $e2 (local.get $tmp___416))



    (local.set $tmp___418 (call $get__ray__o (local.get $r)))
    (local.set $tmp___417 (call $v_sub (local.get $tmp___418) (local.get $p0)))
    (local.set $s (local.get $tmp___417))



    (local.set $tmp___41a (call $get__ray__d (local.get $r)))

    (local.set $tmp___41b (f32.convert_i32_s (i32.const -1)))
    (local.set $tmp___419 (call $v_scale (local.get $tmp___41a) (local.get $tmp___41b)))
    (local.set $_d (local.get $tmp___419))


    (local.set $tmp___41c (call $det (local.get $e1) (local.get $e2) (local.get $_d)))
    (local.set $denom (local.get $tmp___41c))


    (local.set $tmp___41e (f32.convert_i32_s (i32.const 0)))
    (local.set $tmp___41d (f32.eq (local.get $denom) (local.get $tmp___41e)))
    (if (local.get $tmp___41d) (then
      (call $wax::free (local.get $e1))
      (call $wax::free (local.get $e2))
      (call $wax::free (local.get $s))
      (call $wax::free (local.get $_d))
      (call $wax::pop_stack)
      (global.get $INFINITY)
      return
    ))



    (local.set $tmp___420 (call $det (local.get $s) (local.get $e2) (local.get $_d)))
    (local.set $tmp___41f (f32.div (local.get $tmp___420) (local.get $denom)))
    (local.set $u (local.get $tmp___41f))



    (local.set $tmp___422 (call $det (local.get $e1) (local.get $s) (local.get $_d)))
    (local.set $tmp___421 (f32.div (local.get $tmp___422) (local.get $denom)))
    (local.set $v (local.get $tmp___421))



    (local.set $tmp___424 (call $det (local.get $e1) (local.get $e2) (local.get $s)))
    (local.set $tmp___423 (f32.div (local.get $tmp___424) (local.get $denom)))
    (local.set $t (local.get $tmp___423))






    (local.set $tmp___42a (f32.convert_i32_s (i32.const 0)))
    (local.set $tmp___429 (f32.lt (local.get $u) (local.get $tmp___42a)))

    (local.set $tmp___42b (i32.eq (local.get $tmp___429) (i32.const 0)))
    (if (local.get $tmp___42b) (then


      (local.set $tmp___42d__s4e7 (f32.convert_i32_s (i32.const 0)))
      (local.set $tmp___42c__s4e7 (f32.lt (local.get $v) (local.get $tmp___42d__s4e7)))
      (local.set $tmp___429 (local.get $tmp___42c__s4e7))
    ))
    (local.set $tmp___428 (i32.ne (local.get $tmp___429) (i32.const 0)))

    (local.set $tmp___42e (i32.eq (local.get $tmp___428) (i32.const 0)))
    (if (local.get $tmp___42e) (then



      (local.set $tmp___431__s4e8 (f32.convert_i32_s (i32.const 1)))

      (local.set $tmp___432__s4e8 (f32.add (local.get $u) (local.get $v)))
      (local.set $tmp___430__s4e8 (f32.sub (local.get $tmp___431__s4e8) (local.get $tmp___432__s4e8)))

      (local.set $tmp___433__s4e8 (f32.convert_i32_s (i32.const 0)))
      (local.set $tmp___42f__s4e8 (f32.lt (local.get $tmp___430__s4e8) (local.get $tmp___433__s4e8)))
      (local.set $tmp___428 (local.get $tmp___42f__s4e8))
    ))
    (local.set $tmp___427 (i32.ne (local.get $tmp___428) (i32.const 0)))

    (local.set $tmp___434 (i32.eq (local.get $tmp___427) (i32.const 0)))
    (if (local.get $tmp___434) (then


      (local.set $tmp___436__s4e9 (call $get__ray__tmin (local.get $r)))
      (local.set $tmp___435__s4e9 (f32.lt (local.get $t) (local.get $tmp___436__s4e9)))
      (local.set $tmp___427 (local.get $tmp___435__s4e9))
    ))
    (local.set $tmp___426 (i32.ne (local.get $tmp___427) (i32.const 0)))

    (local.set $tmp___437 (i32.eq (local.get $tmp___426) (i32.const 0)))
    (if (local.get $tmp___437) (then


      (local.set $tmp___439__s4ea (call $get__ray__tmax (local.get $r)))
      (local.set $tmp___438__s4ea (f32.gt (local.get $t) (local.get $tmp___439__s4ea)))
      (local.set $tmp___426 (local.get $tmp___438__s4ea))
    ))
    (local.set $tmp___425 (i32.ne (local.get $tmp___426) (i32.const 0)))
    (if (local.get $tmp___425) (then
      (call $wax::free (local.get $e1))
      (call $wax::free (local.get $e2))
      (call $wax::free (local.get $s))
      (call $wax::free (local.get $_d))
      (call $wax::pop_stack)
      (global.get $INFINITY)
      return
    ))
    (call $set__ray__tmax (local.get $r) (local.get $t))
    (call $wax::free (local.get $e1))
    (call $wax::free (local.get $e2))
    (call $wax::free (local.get $s))
    (call $wax::free (local.get $_d))
    (call $wax::pop_stack)
    (local.get $t)
    return
    (call $wax::pop_stack)
  )
  (func $ray_mesh (export "ray_mesh") (param $r i32) (param $m i32) (param $l i32) (result f32)
    (local $tmp___457 f32)
    (local $tmp___447__s4ec i32)
    (local $tmp___456 f32)
    (local $tmp___446__s4ec i32)
    (local $tmp___455 i32)
    (local $tmp___445__s4ec i32)
    (local $tmp___453__s4ed i32)
    (local $tmp___454 i32)
    (local $tmp___444__s4ec i32)
    (local $tmp___443__s4ec i32)
    (local $tmp___452 i32)
    (local $tmp___442__s4ec i32)
    (local $tmp___451 i32)
    (local $tmp___441__s4ec i32)
    (local $tmp___450 i32)
    (local $tmp___440__s4ec i32)
    (local $dstmin f32)
    (local $tmp___459 f32)
    (local $tmp___449__s4ec i32)
    (local $tmp___458 f32)
    (local $tmp___448__s4ec i32)
    (local $tmp___43a__s4ec i32)
    (local $tmp___44f__s4ec i32)
    (local $tmp___43b__s4ec i32)
    (local $tmp___44e__s4ec i32)
    (local $tmp___43c__s4ec i32)
    (local $tmp___44d__s4ec f32)
    (local $tmp___43d__s4ec i32)
    (local $tmp___44c__s4ec i32)
    (local $tmp___43e__s4ec i32)
    (local $tmp___44b__s4ec i32)
    (local $tmp___43f__s4ec i32)
    (local $tmp___44a__s4ec i32)
    (local $argmin i32)
    (local $a__s4ec i32)
    (local $c__s4ec i32)
    (local $b__s4ec i32)
    (local $i__s4eb i32)
    (local $n i32)
    (local $t__s4ec f32)
    (local $ndotl f32)


    (call $wax::push_stack)

    (local.set $dstmin (global.get $INFINITY))

    (local.set $argmin (i32.const -1))
    (if (i32.const 1) (then

      (local.set $i__s4eb (i32.const 0))
      block $tmp__block_0x89e568
      loop $tmp__lp_502
        (if (i32.const 1) (then

          (call $wax::push_stack)




          (local.set $tmp___43d__s4ec (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___43c__s4ec (call $wax::arr_length (local.get $tmp___43d__s4ec)))
          (local.set $tmp___43b__s4ec (i32.lt_s (local.get $i__s4eb) (local.get $tmp___43c__s4ec)))
          (local.set $tmp___43a__s4ec (local.get $tmp___43b__s4ec))
          (if (local.get $tmp___43a__s4ec) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x89e568)
          ))



          (local.set $tmp___43f__s4ec (call $get__mesh__vertices (local.get $m)))



          (local.set $tmp___442__s4ec (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___441__s4ec (call $wax::arr_get (local.get $tmp___442__s4ec) (local.get $i__s4eb)))
          (local.set $tmp___440__s4ec (i32.load (i32.add (local.get $tmp___441__s4ec) (i32.mul (i32.const 0) (i32.const 4)))))
          (local.set $tmp___43e__s4ec (call $wax::arr_get (local.get $tmp___43f__s4ec) (local.get $tmp___440__s4ec)))
          (local.set $a__s4ec (local.get $tmp___43e__s4ec))



          (local.set $tmp___444__s4ec (call $get__mesh__vertices (local.get $m)))



          (local.set $tmp___447__s4ec (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___446__s4ec (call $wax::arr_get (local.get $tmp___447__s4ec) (local.get $i__s4eb)))
          (local.set $tmp___445__s4ec (i32.load (i32.add (local.get $tmp___446__s4ec) (i32.mul (i32.const 1) (i32.const 4)))))
          (local.set $tmp___443__s4ec (call $wax::arr_get (local.get $tmp___444__s4ec) (local.get $tmp___445__s4ec)))
          (local.set $b__s4ec (local.get $tmp___443__s4ec))



          (local.set $tmp___449__s4ec (call $get__mesh__vertices (local.get $m)))



          (local.set $tmp___44c__s4ec (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___44b__s4ec (call $wax::arr_get (local.get $tmp___44c__s4ec) (local.get $i__s4eb)))
          (local.set $tmp___44a__s4ec (i32.load (i32.add (local.get $tmp___44b__s4ec) (i32.mul (i32.const 2) (i32.const 4)))))
          (local.set $tmp___448__s4ec (call $wax::arr_get (local.get $tmp___449__s4ec) (local.get $tmp___44a__s4ec)))
          (local.set $c__s4ec (local.get $tmp___448__s4ec))


          (local.set $tmp___44d__s4ec (call $ray_tri (local.get $r) (local.get $a__s4ec) (local.get $b__s4ec) (local.get $c__s4ec)))
          (local.set $t__s4ec (local.get $tmp___44d__s4ec))

          (local.set $tmp___44e__s4ec (f32.lt (local.get $t__s4ec) (local.get $dstmin)))
          (if (local.get $tmp___44e__s4ec) (then
            (local.set $dstmin (local.get $t__s4ec))
            (local.set $argmin (local.get $i__s4eb))
          ))

          (local.set $tmp___44f__s4ec (i32.add (local.get $i__s4eb) (i32.const 1)))
          (local.set $i__s4eb (local.get $tmp___44f__s4ec))
          (call $wax::pop_stack)

          (br $tmp__lp_502)
        ))
      end
      end
    ))


    (local.set $tmp___451 (i32.lt_s (local.get $argmin) (i32.const -1)))

    (local.set $tmp___452 (i32.eq (local.get $tmp___451) (i32.const 0)))
    (if (local.get $tmp___452) (then

      (local.set $tmp___453__s4ed (f32.eq (local.get $dstmin) (global.get $INFINITY)))
      (local.set $tmp___451 (local.get $tmp___453__s4ed))
    ))
    (local.set $tmp___450 (i32.ne (local.get $tmp___451) (i32.const 0)))
    (if (local.get $tmp___450) (then
      (call $wax::pop_stack)
      (f32.const 0.0)
      return
    ))



    (local.set $tmp___455 (call $get__mesh__facenorms (local.get $m)))
    (local.set $tmp___454 (call $wax::arr_get (local.get $tmp___455) (local.get $argmin)))
    (local.set $n (local.get $tmp___454))


    (local.set $tmp___456 (call $v_dot (local.get $n) (local.get $l)))
    (local.set $ndotl (local.get $tmp___456))



    (local.set $tmp___459 (f32.convert_i32_s (i32.const 0)))
    (local.set $tmp___458 (call $fmax (local.get $ndotl) (local.get $tmp___459)))
    (local.set $tmp___457 (f32.add (local.get $tmp___458) (f32.const 0.1)))
    (call $wax::pop_stack)
    (local.get $tmp___457)
    return
    (call $wax::pop_stack)
  )
  (func $add_vert (export "add_vert") (param $m i32) (param $x f32) (param $y f32) (param $z f32)
    (local $tmp___45d i32)
    (local $tmp___45c i32)
    (local $tmp___45b i32)
    (local $tmp___45a i32)


    (call $wax::push_stack)

    (local.set $tmp___45a (call $get__mesh__vertices (local.get $m)))


    (local.set $tmp___45c (call $get__mesh__vertices (local.get $m)))
    (local.set $tmp___45b (call $wax::arr_length (local.get $tmp___45c)))

    (local.set $tmp___45d (call $w__vec_lit3 (i32.reinterpret_f32 (local.get $x)) (i32.reinterpret_f32 (local.get $y)) (i32.reinterpret_f32 (local.get $z))))
    (call $wax::arr_insert (local.get $tmp___45a) (local.get $tmp___45b) (local.get $tmp___45d))
    (call $wax::pop_stack)
  )
  (func $add_face (export "add_face") (param $m i32) (param $a i32) (param $b i32) (param $c i32)
    (local $tmp___464 i32)
    (local $tmp___460 i32)
    (local $tmp___461 i32)
    (local $tmp___462 i32)
    (local $tmp___463 i32)
    (local $tmp___45f i32)
    (local $tmp___45e i32)


    (call $wax::push_stack)

    (local.set $tmp___45e (call $get__mesh__faces (local.get $m)))


    (local.set $tmp___460 (call $get__mesh__faces (local.get $m)))
    (local.set $tmp___45f (call $wax::arr_length (local.get $tmp___460)))


    (local.set $tmp___462 (i32.sub (local.get $a) (i32.const 1)))

    (local.set $tmp___463 (i32.sub (local.get $c) (i32.const 1)))

    (local.set $tmp___464 (i32.sub (local.get $b) (i32.const 1)))
    (local.set $tmp___461 (call $w__vec_lit3 (local.get $tmp___462) (local.get $tmp___463) (local.get $tmp___464)))
    (call $wax::arr_insert (local.get $tmp___45e) (local.get $tmp___45f) (local.get $tmp___461))
    (call $wax::pop_stack)
  )
  (func $calc_facenorms (export "calc_facenorms") (param $m i32)
    (local $tmp___471__s4ef i32)
    (local $tmp___470__s4ef i32)
    (local $tmp___473__s4ef i32)
    (local $tmp___472__s4ef i32)
    (local $tmp___475__s4ef i32)
    (local $tmp___465__s4ef i32)
    (local $tmp___474__s4ef i32)
    (local $tmp___466__s4ef i32)
    (local $tmp___477__s4ef i32)
    (local $tmp___467__s4ef i32)
    (local $tmp___476__s4ef i32)
    (local $tmp___468__s4ef i32)
    (local $tmp___479__s4ef i32)
    (local $tmp___469__s4ef i32)
    (local $tmp___478__s4ef i32)
    (local $e1__s4ef i32)
    (local $tmp___47a__s4ef i32)
    (local $tmp___46a__s4ef i32)
    (local $tmp___46b__s4ef i32)
    (local $tmp___47c__s4ef i32)
    (local $e2__s4ef i32)
    (local $tmp___46c__s4ef i32)
    (local $tmp___47b__s4ef i32)
    (local $tmp___46d__s4ef i32)
    (local $tmp___47e__s4ef i32)
    (local $tmp___46e__s4ef i32)
    (local $tmp___47d__s4ef i32)
    (local $tmp___46f__s4ef i32)
    (local $a__s4ef i32)
    (local $b__s4ef i32)
    (local $c__s4ef i32)
    (local $n__s4ef i32)
    (local $i__s4ee i32)


    (call $wax::push_stack)
    (if (i32.const 1) (then

      (local.set $i__s4ee (i32.const 0))
      block $tmp__block_0x8aa9a0
      loop $tmp__lp_503
        (if (i32.const 1) (then

          (call $wax::push_stack)




          (local.set $tmp___468__s4ef (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___467__s4ef (call $wax::arr_length (local.get $tmp___468__s4ef)))
          (local.set $tmp___466__s4ef (i32.lt_s (local.get $i__s4ee) (local.get $tmp___467__s4ef)))
          (local.set $tmp___465__s4ef (local.get $tmp___466__s4ef))
          (if (local.get $tmp___465__s4ef) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x8aa9a0)
          ))



          (local.set $tmp___46a__s4ef (call $get__mesh__vertices (local.get $m)))



          (local.set $tmp___46d__s4ef (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___46c__s4ef (call $wax::arr_get (local.get $tmp___46d__s4ef) (local.get $i__s4ee)))
          (local.set $tmp___46b__s4ef (i32.load (i32.add (local.get $tmp___46c__s4ef) (i32.mul (i32.const 0) (i32.const 4)))))
          (local.set $tmp___469__s4ef (call $wax::arr_get (local.get $tmp___46a__s4ef) (local.get $tmp___46b__s4ef)))
          (local.set $a__s4ef (local.get $tmp___469__s4ef))



          (local.set $tmp___46f__s4ef (call $get__mesh__vertices (local.get $m)))



          (local.set $tmp___472__s4ef (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___471__s4ef (call $wax::arr_get (local.get $tmp___472__s4ef) (local.get $i__s4ee)))
          (local.set $tmp___470__s4ef (i32.load (i32.add (local.get $tmp___471__s4ef) (i32.mul (i32.const 1) (i32.const 4)))))
          (local.set $tmp___46e__s4ef (call $wax::arr_get (local.get $tmp___46f__s4ef) (local.get $tmp___470__s4ef)))
          (local.set $b__s4ef (local.get $tmp___46e__s4ef))



          (local.set $tmp___474__s4ef (call $get__mesh__vertices (local.get $m)))



          (local.set $tmp___477__s4ef (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___476__s4ef (call $wax::arr_get (local.get $tmp___477__s4ef) (local.get $i__s4ee)))
          (local.set $tmp___475__s4ef (i32.load (i32.add (local.get $tmp___476__s4ef) (i32.mul (i32.const 2) (i32.const 4)))))
          (local.set $tmp___473__s4ef (call $wax::arr_get (local.get $tmp___474__s4ef) (local.get $tmp___475__s4ef)))
          (local.set $c__s4ef (local.get $tmp___473__s4ef))


          (local.set $tmp___478__s4ef (call $v_sub (local.get $a__s4ef) (local.get $b__s4ef)))
          (local.set $e1__s4ef (local.get $tmp___478__s4ef))


          (local.set $tmp___479__s4ef (call $v_sub (local.get $b__s4ef) (local.get $c__s4ef)))
          (local.set $e2__s4ef (local.get $tmp___479__s4ef))


          (local.set $tmp___47a__s4ef (call $v_cross (local.get $e1__s4ef) (local.get $e2__s4ef)))
          (local.set $n__s4ef (local.get $tmp___47a__s4ef))
          (call $normalize (local.get $n__s4ef))

          (local.set $tmp___47b__s4ef (call $get__mesh__facenorms (local.get $m)))


          (local.set $tmp___47d__s4ef (call $get__mesh__facenorms (local.get $m)))
          (local.set $tmp___47c__s4ef (call $wax::arr_length (local.get $tmp___47d__s4ef)))
          (call $wax::arr_insert (local.get $tmp___47b__s4ef) (local.get $tmp___47c__s4ef) (local.get $n__s4ef))
          (call $wax::free (local.get $e1__s4ef))
          (call $wax::free (local.get $e2__s4ef))

          (local.set $tmp___47e__s4ef (i32.add (local.get $i__s4ee) (i32.const 1)))
          (local.set $i__s4ee (local.get $tmp___47e__s4ef))
          (call $wax::pop_stack)

          (br $tmp__lp_503)
        ))
      end
      end
    ))
    (call $wax::pop_stack)
  )
  (func $move_mesh (export "move_mesh") (param $m i32) (param $x f32) (param $y f32) (param $z f32)
    (local $tmp___47f__s4f1 i32)
    (local $tmp___48b__s4f1 f32)
    (local $tmp___48c__s4f1 f32)
    (local $tmp___48a__s4f1 i32)
    (local $tmp___48f__s4f1 i32)
    (local $tmp___48d__s4f1 i32)
    (local $tmp___48e__s4f1 i32)
    (local $tmp___488__s4f1 i32)
    (local $tmp___489__s4f1 i32)
    (local $tmp___482__s4f1 i32)
    (local $tmp___493__s4f1 i32)
    (local $tmp___483__s4f1 i32)
    (local $tmp___492__s4f1 f32)
    (local $tmp___480__s4f1 i32)
    (local $tmp___491__s4f1 f32)
    (local $tmp___481__s4f1 i32)
    (local $tmp___490__s4f1 i32)
    (local $tmp___486__s4f1 f32)
    (local $tmp___487__s4f1 i32)
    (local $tmp___484__s4f1 i32)
    (local $tmp___495__s4f1 i32)
    (local $tmp___485__s4f1 f32)
    (local $tmp___494__s4f1 i32)
    (local $i__s4f0 i32)


    (call $wax::push_stack)
    (if (i32.const 1) (then

      (local.set $i__s4f0 (i32.const 0))
      block $tmp__block_0x8b1888
      loop $tmp__lp_504
        (if (i32.const 1) (then

          (call $wax::push_stack)




          (local.set $tmp___482__s4f1 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___481__s4f1 (call $wax::arr_length (local.get $tmp___482__s4f1)))
          (local.set $tmp___480__s4f1 (i32.lt_s (local.get $i__s4f0) (local.get $tmp___481__s4f1)))
          (local.set $tmp___47f__s4f1 (local.get $tmp___480__s4f1))
          (if (local.get $tmp___47f__s4f1) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x8b1888)
          ))


          (local.set $tmp___484__s4f1 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___483__s4f1 (call $wax::arr_get (local.get $tmp___484__s4f1) (local.get $i__s4f0)))




          (local.set $tmp___488__s4f1 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___487__s4f1 (call $wax::arr_get (local.get $tmp___488__s4f1) (local.get $i__s4f0)))
          (local.set $tmp___486__s4f1 (f32.load (i32.add (local.get $tmp___487__s4f1) (i32.mul (i32.const 0) (i32.const 4)))))
          (local.set $tmp___485__s4f1 (f32.add (local.get $tmp___486__s4f1) (local.get $x)))
          (f32.store (i32.add (local.get $tmp___483__s4f1) (i32.mul (i32.const 0) (i32.const 4)))(local.get $tmp___485__s4f1))


          (local.set $tmp___48a__s4f1 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___489__s4f1 (call $wax::arr_get (local.get $tmp___48a__s4f1) (local.get $i__s4f0)))




          (local.set $tmp___48e__s4f1 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___48d__s4f1 (call $wax::arr_get (local.get $tmp___48e__s4f1) (local.get $i__s4f0)))
          (local.set $tmp___48c__s4f1 (f32.load (i32.add (local.get $tmp___48d__s4f1) (i32.mul (i32.const 1) (i32.const 4)))))
          (local.set $tmp___48b__s4f1 (f32.add (local.get $tmp___48c__s4f1) (local.get $y)))
          (f32.store (i32.add (local.get $tmp___489__s4f1) (i32.mul (i32.const 1) (i32.const 4)))(local.get $tmp___48b__s4f1))


          (local.set $tmp___490__s4f1 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___48f__s4f1 (call $wax::arr_get (local.get $tmp___490__s4f1) (local.get $i__s4f0)))




          (local.set $tmp___494__s4f1 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___493__s4f1 (call $wax::arr_get (local.get $tmp___494__s4f1) (local.get $i__s4f0)))
          (local.set $tmp___492__s4f1 (f32.load (i32.add (local.get $tmp___493__s4f1) (i32.mul (i32.const 2) (i32.const 4)))))
          (local.set $tmp___491__s4f1 (f32.add (local.get $tmp___492__s4f1) (local.get $z)))
          (f32.store (i32.add (local.get $tmp___48f__s4f1) (i32.mul (i32.const 2) (i32.const 4)))(local.get $tmp___491__s4f1))

          (local.set $tmp___495__s4f1 (i32.add (local.get $i__s4f0) (i32.const 1)))
          (local.set $i__s4f0 (local.get $tmp___495__s4f1))
          (call $wax::pop_stack)

          (br $tmp__lp_504)
        ))
      end
      end
    ))
    (call $wax::pop_stack)
  )
  (func $destroy_mesh (export "destroy_mesh") (param $m i32)
    (local $tmp___4a7__s4f7 i32)
    (local $tmp___4a4__s4f5 i32)
    (local $tmp___4a6__s4f7 i32)
    (local $tmp___4a3__s4f5 i32)
    (local $tmp___4a2__s4f5 i32)
    (local $tmp___4a1__s4f5 i32)
    (local $tmp___4ad i32)
    (local $tmp___4a0__s4f5 i32)
    (local $tmp___49a__s4f3 i32)
    (local $tmp___49f__s4f5 i32)
    (local $tmp___49c__s4f3 i32)
    (local $tmp___49e__s4f5 i32)
    (local $tmp___49b__s4f3 i32)
    (local $tmp___4a9__s4f7 i32)
    (local $tmp___4a8__s4f7 i32)
    (local $tmp___499__s4f3 i32)
    (local $tmp___498__s4f3 i32)
    (local $tmp___4aa__s4f7 i32)
    (local $tmp___4a5 i32)
    (local $tmp___4ac__s4f7 i32)
    (local $tmp___4ab__s4f7 i32)
    (local $tmp___497__s4f3 i32)
    (local $tmp___49d i32)
    (local $tmp___496__s4f3 i32)
    (local $i__s4f2 i32)
    (local $i__s4f4 i32)
    (local $i__s4f6 i32)


    (call $wax::push_stack)
    (if (i32.const 1) (then

      (local.set $i__s4f2 (i32.const 0))
      block $tmp__block_0x518f88
      loop $tmp__lp_505
        (if (i32.const 1) (then

          (call $wax::push_stack)




          (local.set $tmp___499__s4f3 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___498__s4f3 (call $wax::arr_length (local.get $tmp___499__s4f3)))
          (local.set $tmp___497__s4f3 (i32.lt_s (local.get $i__s4f2) (local.get $tmp___498__s4f3)))
          (local.set $tmp___496__s4f3 (local.get $tmp___497__s4f3))
          (if (local.get $tmp___496__s4f3) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x518f88)
          ))


          (local.set $tmp___49b__s4f3 (call $get__mesh__vertices (local.get $m)))
          (local.set $tmp___49a__s4f3 (call $wax::arr_get (local.get $tmp___49b__s4f3) (local.get $i__s4f2)))
          (call $wax::free (local.get $tmp___49a__s4f3))

          (local.set $tmp___49c__s4f3 (i32.add (local.get $i__s4f2) (i32.const 1)))
          (local.set $i__s4f2 (local.get $tmp___49c__s4f3))
          (call $wax::pop_stack)

          (br $tmp__lp_505)
        ))
      end
      end
    ))

    (local.set $tmp___49d (call $get__mesh__vertices (local.get $m)))
    (call $wax::arr_free (local.get $tmp___49d))
    (if (i32.const 1) (then

      (local.set $i__s4f4 (i32.const 0))
      block $tmp__block_0x51a7e8
      loop $tmp__lp_506
        (if (i32.const 1) (then

          (call $wax::push_stack)




          (local.set $tmp___4a1__s4f5 (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___4a0__s4f5 (call $wax::arr_length (local.get $tmp___4a1__s4f5)))
          (local.set $tmp___49f__s4f5 (i32.lt_s (local.get $i__s4f4) (local.get $tmp___4a0__s4f5)))
          (local.set $tmp___49e__s4f5 (local.get $tmp___49f__s4f5))
          (if (local.get $tmp___49e__s4f5) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x51a7e8)
          ))


          (local.set $tmp___4a3__s4f5 (call $get__mesh__faces (local.get $m)))
          (local.set $tmp___4a2__s4f5 (call $wax::arr_get (local.get $tmp___4a3__s4f5) (local.get $i__s4f4)))
          (call $wax::free (local.get $tmp___4a2__s4f5))

          (local.set $tmp___4a4__s4f5 (i32.add (local.get $i__s4f4) (i32.const 1)))
          (local.set $i__s4f4 (local.get $tmp___4a4__s4f5))
          (call $wax::pop_stack)

          (br $tmp__lp_506)
        ))
      end
      end
    ))

    (local.set $tmp___4a5 (call $get__mesh__faces (local.get $m)))
    (call $wax::arr_free (local.get $tmp___4a5))
    (if (i32.const 1) (then

      (local.set $i__s4f6 (i32.const 0))
      block $tmp__block_0x51c048
      loop $tmp__lp_507
        (if (i32.const 1) (then

          (call $wax::push_stack)




          (local.set $tmp___4a9__s4f7 (call $get__mesh__facenorms (local.get $m)))
          (local.set $tmp___4a8__s4f7 (call $wax::arr_length (local.get $tmp___4a9__s4f7)))
          (local.set $tmp___4a7__s4f7 (i32.lt_s (local.get $i__s4f6) (local.get $tmp___4a8__s4f7)))
          (local.set $tmp___4a6__s4f7 (local.get $tmp___4a7__s4f7))
          (if (local.get $tmp___4a6__s4f7) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x51c048)
          ))


          (local.set $tmp___4ab__s4f7 (call $get__mesh__facenorms (local.get $m)))
          (local.set $tmp___4aa__s4f7 (call $wax::arr_get (local.get $tmp___4ab__s4f7) (local.get $i__s4f6)))
          (call $wax::free (local.get $tmp___4aa__s4f7))

          (local.set $tmp___4ac__s4f7 (i32.add (local.get $i__s4f6) (i32.const 1)))
          (local.set $i__s4f6 (local.get $tmp___4ac__s4f7))
          (call $wax::pop_stack)

          (br $tmp__lp_507)
        ))
      end
      end
    ))

    (local.set $tmp___4ad (call $get__mesh__facenorms (local.get $m)))
    (call $wax::arr_free (local.get $tmp___4ad))
    (call $wax::free (local.get $m))
    (call $wax::pop_stack)
  )
  (func $render (export "render") (param $m i32) (param $light i32)
    (local $tmp___4bc__s4fb f32)
    (local $tmp___4da__s501 f32)
    (local $hi f32)
    (local $tmp___4bb__s4fb f32)
    (local $tmp___4cd__s4fe i32)
    (local $tmp___4cf__s500 i32)
    (local $tmp___4ba__s4fb f32)
    (local $tmp___4ce__s500 i32)
    (local $lo f32)
    (local $tmp___4cb i32)
    (local $tmp___4dc__s500 i32)
    (local $tmp___4db__s501 f32)
    (local $tmp___4af f32)
    (local $tmp___4bf__s4fb f32)
    (local $tmp___4ae i32)
    (local $tmp___4be__s4fb f32)
    (local $tmp___4cc__s4fe i32)
    (local $tmp___4dd__s4fe i32)
    (local $tmp___4bd__s4fb i32)
    (local $tmp___4b0__s4f9 i32)
    (local $tmp___4b1__s4f9 i32)
    (local $gray__s500 f32)
    (local $ch__s501 i32)
    (local $gray__s4fb f32)
    (local $tmp___4b3__s4fb i32)
    (local $tmp___4c2__s4fb f32)
    (local $tmp___4d0__s500 f32)
    (local $tmp___4b2__s4fb i32)
    (local $tmp___4c3__s4fb f32)
    (local $tmp___4d1__s500 i32)
    (local $tmp___4c0__s4fb f32)
    (local $tmp___4d2__s500 i32)
    (local $tmp___4c1__s4fb f32)
    (local $tmp___4d3__s500 i32)
    (local $tmp___4b7__s4fb f32)
    (local $tmp___4d4__s500 f32)
    (local $tmp___4d5__s501 f32)
    (local $tmp___4b6__s4fb f32)
    (local $tmp___4c7__s4fb i32)
    (local $tmp___4c6__s4fc f32)
    (local $tmp___4b5__s4fb f32)
    (local $tmp___4c4__s4fb i32)
    (local $tmp___4d7__s501 f32)
    (local $tmp___4b4__s4fb f32)
    (local $tmp___4c5__s4fb f32)
    (local $tmp___4d6__s501 f32)
    (local $tmp___4ca__s4f9 i32)
    (local $tmp___4d9__s501 i32)
    (local $tmp___4d8__s501 i32)
    (local $tmp___4b9__s4fb f32)
    (local $tmp___4c8__s4fb i32)
    (local $tmp___4b8__s4fb f32)
    (local $tmp___4c9__s4fb i32)
    (local $fy__s4fb f32)
    (local $fx__s4fb f32)
    (local $y__s4f8 i32)
    (local $pix i32)
    (local $r__s4fb i32)
    (local $s i32)
    (local $x__s4fa i32)
    (local $y__s4fd i32)
    (local $palette i32)
    (local $x__s4ff i32)


    (call $wax::push_stack)


    (local.set $tmp___4ae (call $wax::calloc (i32.mul (i32.const 4) (i32.const 15360))))
    (local.set $pix (local.get $tmp___4ae))
    (call $normalize (local.get $light))

    (local.set $palette (i32.const 4))

    (local.set $lo (global.get $INFINITY))


    (local.set $tmp___4af (f32.convert_i32_s (i32.const 0)))
    (local.set $hi (local.get $tmp___4af))
    (if (i32.const 1) (then

      (local.set $y__s4f8 (i32.const 0))
      block $tmp__block_0x51fd38
      loop $tmp__lp_508
        (if (i32.const 1) (then

          (call $wax::push_stack)


          (local.set $tmp___4b1__s4f9 (i32.lt_s (local.get $y__s4f8) (i32.const 40)))
          (local.set $tmp___4b0__s4f9 (local.get $tmp___4b1__s4f9))
          (if (local.get $tmp___4b0__s4f9) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x51fd38)
          ))
          (if (i32.const 1) (then

            (local.set $x__s4fa (i32.const 0))
            block $tmp__block_0x5206f8
            loop $tmp__lp_509
              (if (i32.const 1) (then

                (call $wax::push_stack)


                (local.set $tmp___4b3__s4fb (i32.lt_s (local.get $x__s4fa) (i32.const 80)))
                (local.set $tmp___4b2__s4fb (local.get $tmp___4b3__s4fb))
                (if (local.get $tmp___4b2__s4fb) (then

                )(else
                  (call $wax::pop_stack)
                  (br $tmp__block_0x5206f8)
                ))




                (local.set $tmp___4b6__s4fb (f32.convert_i32_s (local.get $x__s4fa)))


                (local.set $tmp___4b8__s4fb (f32.convert_i32_s (i32.const 80)))
                (local.set $tmp___4b7__s4fb (f32.div (local.get $tmp___4b8__s4fb) (f32.const 2.0)))
                (local.set $tmp___4b5__s4fb (f32.sub (local.get $tmp___4b6__s4fb) (local.get $tmp___4b7__s4fb)))
                (local.set $tmp___4b4__s4fb (f32.div (local.get $tmp___4b5__s4fb) (f32.const 2.0)))
                (local.set $fx__s4fb (local.get $tmp___4b4__s4fb))



                (local.set $tmp___4ba__s4fb (f32.convert_i32_s (local.get $y__s4f8)))


                (local.set $tmp___4bc__s4fb (f32.convert_i32_s (i32.const 40)))
                (local.set $tmp___4bb__s4fb (f32.div (local.get $tmp___4bc__s4fb) (f32.const 2.0)))
                (local.set $tmp___4b9__s4fb (f32.sub (local.get $tmp___4ba__s4fb) (local.get $tmp___4bb__s4fb)))
                (local.set $fy__s4fb (local.get $tmp___4b9__s4fb))



                (local.set $tmp___4be__s4fb (f32.convert_i32_s (i32.const 0)))

                (local.set $tmp___4bf__s4fb (f32.convert_i32_s (i32.const 0)))

                (local.set $tmp___4c0__s4fb (f32.convert_i32_s (i32.const 0)))

                (local.set $tmp___4c1__s4fb (f32.convert_i32_s (i32.const 100)))
                (local.set $tmp___4bd__s4fb (call $new_ray (local.get $tmp___4be__s4fb) (local.get $tmp___4bf__s4fb) (local.get $tmp___4c0__s4fb) (local.get $fx__s4fb) (local.get $fy__s4fb) (local.get $tmp___4c1__s4fb)))
                (local.set $r__s4fb (local.get $tmp___4bd__s4fb))


                (local.set $tmp___4c2__s4fb (call $ray_mesh (local.get $r__s4fb) (local.get $m) (local.get $light)))
                (local.set $gray__s4fb (local.get $tmp___4c2__s4fb))

                (local.set $tmp___4c3__s4fb (call $fmax (local.get $gray__s4fb) (local.get $hi)))
                (local.set $hi (local.get $tmp___4c3__s4fb))


                (local.set $tmp___4c5__s4fb (f32.convert_i32_s (i32.const 0)))
                (local.set $tmp___4c4__s4fb (f32.gt (local.get $gray__s4fb) (local.get $tmp___4c5__s4fb)))
                (if (local.get $tmp___4c4__s4fb) (then

                  (local.set $tmp___4c6__s4fc (call $fmin (local.get $gray__s4fb) (local.get $lo)))
                  (local.set $lo (local.get $tmp___4c6__s4fc))
                ))


                (local.set $tmp___4c8__s4fb (i32.mul (local.get $y__s4f8) (i32.const 80)))
                (local.set $tmp___4c7__s4fb (i32.add (local.get $tmp___4c8__s4fb) (local.get $x__s4fa)))
                (f32.store (i32.add (local.get $pix) (i32.mul (local.get $tmp___4c7__s4fb) (i32.const 4)))(local.get $gray__s4fb))
                (call $destroy_ray (local.get $r__s4fb))

                (local.set $tmp___4c9__s4fb (i32.add (local.get $x__s4fa) (i32.const 1)))
                (local.set $x__s4fa (local.get $tmp___4c9__s4fb))
                (call $wax::pop_stack)

                (br $tmp__lp_509)
              ))
            end
            end
          ))

          (local.set $tmp___4ca__s4f9 (i32.add (local.get $y__s4f8) (i32.const 1)))
          (local.set $y__s4f8 (local.get $tmp___4ca__s4f9))
          (call $wax::pop_stack)

          (br $tmp__lp_508)
        ))
      end
      end
    ))


    (local.set $tmp___4cb (call $wax::str_new (i32.const 0)))
    (local.set $s (local.get $tmp___4cb))
    (if (i32.const 1) (then

      (local.set $y__s4fd (i32.const 0))
      block $tmp__block_0x526608
      loop $tmp__lp_50a
        (if (i32.const 1) (then

          (call $wax::push_stack)


          (local.set $tmp___4cd__s4fe (i32.lt_s (local.get $y__s4fd) (i32.const 40)))
          (local.set $tmp___4cc__s4fe (local.get $tmp___4cd__s4fe))
          (if (local.get $tmp___4cc__s4fe) (then

          )(else
            (call $wax::pop_stack)
            (br $tmp__block_0x526608)
          ))
          (if (i32.const 1) (then

            (local.set $x__s4ff (i32.const 0))
            block $tmp__block_0x526fc8
            loop $tmp__lp_50b
              (if (i32.const 1) (then

                (call $wax::push_stack)


                (local.set $tmp___4cf__s500 (i32.lt_s (local.get $x__s4ff) (i32.const 80)))
                (local.set $tmp___4ce__s500 (local.get $tmp___4cf__s500))
                (if (local.get $tmp___4ce__s500) (then

                )(else
                  (call $wax::pop_stack)
                  (br $tmp__block_0x526fc8)
                ))




                (local.set $tmp___4d2__s500 (i32.mul (local.get $y__s4fd) (i32.const 80)))
                (local.set $tmp___4d1__s500 (i32.add (local.get $tmp___4d2__s500) (local.get $x__s4ff)))
                (local.set $tmp___4d0__s500 (f32.load (i32.add (local.get $pix) (i32.mul (local.get $tmp___4d1__s500) (i32.const 4)))))
                (local.set $gray__s500 (local.get $tmp___4d0__s500))


                (local.set $tmp___4d4__s500 (f32.convert_i32_s (i32.const 0)))
                (local.set $tmp___4d3__s500 (f32.ne (local.get $gray__s500) (local.get $tmp___4d4__s500)))
                (if (local.get $tmp___4d3__s500) (then


                  (local.set $tmp___4d6__s501 (f32.sub (local.get $gray__s500) (local.get $lo)))

                  (local.set $tmp___4d7__s501 (f32.sub (local.get $hi) (local.get $lo)))
                  (local.set $tmp___4d5__s501 (f32.div (local.get $tmp___4d6__s501) (local.get $tmp___4d7__s501)))
                  (local.set $gray__s500 (local.get $tmp___4d5__s501))





                  (local.set $tmp___4db__s501 (f32.convert_i32_s (i32.const 78)))
                  (local.set $tmp___4da__s501 (f32.mul (local.get $gray__s500) (local.get $tmp___4db__s501)))
                  (local.set $tmp___4d9__s501 (i32.trunc_f32_s (local.get $tmp___4da__s501)))
                  (local.set $tmp___4d8__s501 (call $wax::str_get (local.get $palette) (local.get $tmp___4d9__s501)))
                  (local.set $ch__s501 (local.get $tmp___4d8__s501))
                  (local.set $s (call $wax::str_add (local.get $s) (local.get $ch__s501)))
                )(else
                  (local.set $s (call $wax::str_add (local.get $s) (i32.const 32)))
                ))

                (local.set $tmp___4dc__s500 (i32.add (local.get $x__s4ff) (i32.const 1)))
                (local.set $x__s4ff (local.get $tmp___4dc__s500))
                (call $wax::pop_stack)

                (br $tmp__lp_50b)
              ))
            end
            end
          ))
          (local.set $s (call $wax::str_cat (local.get $s) (i32.const 84)))

          (local.set $tmp___4dd__s4fe (i32.add (local.get $y__s4fd) (i32.const 1)))
          (local.set $y__s4fd (local.get $tmp___4dd__s4fe))
          (call $wax::pop_stack)

          (br $tmp__lp_50a)
        ))
      end
      end
    ))
    (call $wax::print (local.get $s))
    (call $wax::free (local.get $pix))
    (call $wax::free (local.get $s))
    (call $wax::pop_stack)
  )
  (func $dodecahedron (export "dodecahedron") (result i32)
    (local $tmp___4df i32)
    (local $tmp___4de i32)
    (local $tmp___4e1 i32)
    (local $tmp___4e0 i32)
    (local $m i32)


    (call $wax::push_stack)


    (local.set $tmp___4de (call $wax::calloc (global.get $sizeof__mesh)))
    (local.set $m (local.get $tmp___4de))

    (local.set $tmp___4df (call $wax::arr_new (i32.const 0)))
    (call $set__mesh__vertices (local.get $m) (local.get $tmp___4df))

    (local.set $tmp___4e0 (call $wax::arr_new (i32.const 0)))
    (call $set__mesh__faces (local.get $m) (local.get $tmp___4e0))

    (local.set $tmp___4e1 (call $wax::arr_new (i32.const 0)))
    (call $set__mesh__facenorms (local.get $m) (local.get $tmp___4e1))
    (call $add_vert (local.get $m) (f32.const -0.436466) (f32.const -0.668835) (f32.const 0.601794))
    (call $add_vert (local.get $m) (f32.const 0.918378) (f32.const 0.351401) (f32.const -0.181931))
    (call $add_vert (local.get $m) (f32.const 0.886304) (f32.const -0.351401) (f32.const -0.301632))
    (call $add_vert (local.get $m) (f32.const -0.886304) (f32.const 0.351401) (f32.const 0.301632))
    (call $add_vert (local.get $m) (f32.const -0.918378) (f32.const -0.351401) (f32.const 0.181931))
    (call $add_vert (local.get $m) (f32.const 0.132934) (f32.const 0.858018) (f32.const 0.496117))
    (call $add_vert (local.get $m) (f32.const -0.048964) (f32.const 0.981941) (f32.const -0.182738))
    (call $add_vert (local.get $m) (f32.const 0.106555) (f32.const 0.162217) (f32.const -0.980985))
    (call $add_vert (local.get $m) (f32.const -0.582772) (f32.const 0.162217) (f32.const -0.796280))
    (call $add_vert (local.get $m) (f32.const -0.132934) (f32.const -0.858018) (f32.const -0.496117))
    (call $add_vert (local.get $m) (f32.const 0.048964) (f32.const -0.981941) (f32.const 0.182738))
    (call $add_vert (local.get $m) (f32.const 0.582772) (f32.const -0.162217) (f32.const 0.796280))
    (call $add_vert (local.get $m) (f32.const -0.106555) (f32.const -0.162217) (f32.const 0.980985))
    (call $add_vert (local.get $m) (f32.const 0.436466) (f32.const 0.668835) (f32.const -0.601794))
    (call $add_vert (local.get $m) (f32.const 0.730785) (f32.const 0.468323) (f32.const 0.496615))
    (call $add_vert (local.get $m) (f32.const -0.678888) (f32.const 0.668835) (f32.const -0.302936))
    (call $add_vert (local.get $m) (f32.const -0.384570) (f32.const 0.468323) (f32.const 0.795474))
    (call $add_vert (local.get $m) (f32.const 0.384570) (f32.const -0.468323) (f32.const -0.795474))
    (call $add_vert (local.get $m) (f32.const 0.678888) (f32.const -0.668835) (f32.const 0.302936))
    (call $add_vert (local.get $m) (f32.const -0.730785) (f32.const -0.468323) (f32.const -0.496615))
    (call $add_face (local.get $m) (i32.const 19) (i32.const 3) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 12) (i32.const 19) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 15) (i32.const 12) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 8) (i32.const 14) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 18) (i32.const 8) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 3) (i32.const 18) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 20) (i32.const 5) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 9) (i32.const 20) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 16) (i32.const 9) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 13) (i32.const 17) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 1) (i32.const 13) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 5) (i32.const 1) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 7) (i32.const 16) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 6) (i32.const 7) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 17) (i32.const 6) (i32.const 4))
    (call $add_face (local.get $m) (i32.const 6) (i32.const 15) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 7) (i32.const 6) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 14) (i32.const 7) (i32.const 2))
    (call $add_face (local.get $m) (i32.const 10) (i32.const 18) (i32.const 3))
    (call $add_face (local.get $m) (i32.const 11) (i32.const 10) (i32.const 3))
    (call $add_face (local.get $m) (i32.const 19) (i32.const 11) (i32.const 3))
    (call $add_face (local.get $m) (i32.const 11) (i32.const 1) (i32.const 5))
    (call $add_face (local.get $m) (i32.const 10) (i32.const 11) (i32.const 5))
    (call $add_face (local.get $m) (i32.const 20) (i32.const 10) (i32.const 5))
    (call $add_face (local.get $m) (i32.const 20) (i32.const 9) (i32.const 8))
    (call $add_face (local.get $m) (i32.const 10) (i32.const 20) (i32.const 8))
    (call $add_face (local.get $m) (i32.const 18) (i32.const 10) (i32.const 8))
    (call $add_face (local.get $m) (i32.const 9) (i32.const 16) (i32.const 7))
    (call $add_face (local.get $m) (i32.const 8) (i32.const 9) (i32.const 7))
    (call $add_face (local.get $m) (i32.const 14) (i32.const 8) (i32.const 7))
    (call $add_face (local.get $m) (i32.const 12) (i32.const 15) (i32.const 6))
    (call $add_face (local.get $m) (i32.const 13) (i32.const 12) (i32.const 6))
    (call $add_face (local.get $m) (i32.const 17) (i32.const 13) (i32.const 6))
    (call $add_face (local.get $m) (i32.const 13) (i32.const 1) (i32.const 11))
    (call $add_face (local.get $m) (i32.const 12) (i32.const 13) (i32.const 11))
    (call $add_face (local.get $m) (i32.const 19) (i32.const 12) (i32.const 11))
    (call $calc_facenorms (local.get $m))
    (call $wax::pop_stack)
    (local.get $m)
    return
    (call $wax::pop_stack)
  )
  (func $main (export "main") (result i32)
    (local $tmp___4e6 i32)
    (local $tmp___4e5 f32)
    (local $tmp___4e4 f32)
    (local $tmp___4e3 f32)
    (local $tmp___4e2 i32)
    (local $m i32)
    (local $light i32)


    (call $wax::push_stack)


    (local.set $tmp___4e2 (call $dodecahedron))
    (local.set $m (local.get $tmp___4e2))

    (local.set $tmp___4e3 (f32.convert_i32_s (i32.const 0)))

    (local.set $tmp___4e4 (f32.convert_i32_s (i32.const 0)))

    (local.set $tmp___4e5 (f32.convert_i32_s (i32.const 5)))
    (call $move_mesh (local.get $m) (local.get $tmp___4e3) (local.get $tmp___4e4) (local.get $tmp___4e5))


    (local.set $tmp___4e6 (call $w__vec_lit3 (i32.reinterpret_f32 (f32.const 0.1)) (i32.reinterpret_f32 (f32.const 0.2)) (i32.reinterpret_f32 (f32.const 0.4))))
    (local.set $light (local.get $tmp___4e6))
    (call $render (local.get $m) (local.get $light))
    (call $destroy_mesh (local.get $m))
    (call $wax::free (local.get $light))
    (call $wax::pop_stack)
    (i32.const 0)
    return
    (call $wax::pop_stack)
  )
(data (i32.const 4) "`.-,_:^!~;r+|()=>l?icv[]tzj7*f{}sYTJ1unyIFowe2h3Za4X%5P$mGAUbpK960#H&DRQ80WMB@N")
(data (i32.const 84) "\n")
(func $w__vec_lit3 (param $_0 i32) (param $_1 i32) (param $_2 i32)(result i32)
  (local $a i32) (local.set $a (call $wax::malloc (i32.const 12)))
  (i32.store (i32.add (local.get $a) (i32.const 0)) (local.get $_0))
  (i32.store (i32.add (local.get $a) (i32.const 4)) (local.get $_1))
  (i32.store (i32.add (local.get $a) (i32.const 8)) (local.get $_2))
  (return (local.get $a))
)
(global $wax::min_addr (mut i32) (i32.const 88))
;;=== User Code            END   ===;;

;;=== WAX Standard Library BEGIN ===;;
;;========================================================;;
;;     BASELINE MALLOC WITH HANDWRITTEN WEBASSEMBLY       ;;
;;========================================================;;
;; 32-bit implicit-free-list first-fit baseline malloc    ;;
;;--------------------------------------------------------;;

;; IMPLICIT FREE LIST:
;; Worse utilization and throughput than explicit/segregated, but easier
;; to implement :P
;;
;; HEAP LO                                                         HEAP HI
;; +---------------------+---------------------+...+---------------------+
;; | HDR | PAYLOAD | FTR | HDR | PAYLOAD | FTR |...+ HDR | PAYLOAD | FTR |
;; +----------^----------+---------------------+...+---------------------+
;;            |_ i.e. user data
;;
;; LAYOUT OF A BLOCK:
;; Since memory is aligned to multiple of 4 bytes, the last two bits of
;; payload_size is redundant. Therefore the last bit of header is used to
;; store the is_free flag.
;;
;; |---- HEADER (4b)----
;; |    ,--payload size (x4)--.     ,-is free?
;; | 0b . . . . . . . . . . . . 0  0
;; |------ PAYLOAD -----
;; |
;; |  user data (N x 4b)
;; |
;; |---- FOOTER (4b)---- (duplicate of header)
;; |    ,--payload size (x4)--.     ,-is free?
;; | 0b . . . . . . . . . . . . 0  0
;; |--------------------
;;
;; FORMULAS:
;; (these formulas are used throughout the code, so they're listed here
;; instead of explained each time encountered)
;;
;; payload_size = block_size - (header_size + footer_size) = block_size - 8
;;
;; payload_pointer = header_pointer + header_size = header_pointer + 4
;;
;; footer_pointer = header_pointer + header_size + payload_size
;;                = (header_pointer + payload_size) + 4
;;
;; next_header_pointer = footer_pointer + footer_size = footer_pointer + 4
;;
;; prev_footer_pointer = header_pointer - footer_size = header_pointer - 4

(memory $wax::mem 1)                                ;; start with 1 page (64K)
(export "mem" (memory $wax::mem))
;;// (global $wax::min_addr (mut i32) (i32.const 0))  ;; set by wax compiler depending on data section size
(global $wax::max_addr (mut i32) (i32.const 65536)) ;; initial heap size (64K)
(global $wax::heap_did_init (mut i32) (i32.const 0))     ;; init() called?

;; helpers to pack/unpack payload_size/is_free from header/footer
;; by masking out bits

;; read payload_size from header/footer given pointer to header/footer
(func $wax::hdr_get_size (param $ptr i32) (result i32)
  (i32.and (i32.load (local.get $ptr)) (i32.const 0xFFFFFFFC))
)
;; read is_free from header/footer
(func $wax::hdr_get_free (param $ptr i32) (result i32)
  (i32.and (i32.load (local.get $ptr)) (i32.const 0x00000001))
)
;; write payload_size to header/footer
(func $wax::hdr_set_size (param $ptr i32) (param $n i32)
  (i32.store (local.get $ptr) (i32.or
    (i32.and (i32.load (local.get $ptr)) (i32.const 0x00000003))
    (local.get $n)
  ))
)
;; write is_free to header/footer
(func $wax::hdr_set_free (param $ptr i32) (param $n i32)
  (i32.store (local.get $ptr) (i32.or
    (i32.and (i32.load (local.get $ptr)) (i32.const 0xFFFFFFFE))
    (local.get $n)
  ))
)
;; align memory by 4 bytes
(func $wax::align4 (param $x i32) (result i32)
  (i32.and
    (i32.add (local.get $x) (i32.const 3))
    (i32.const -4)
  )
)

;; initialize heap
;; make the whole heap a big free block
;; - automatically invoked by first malloc() call
;; - can be manually called to nuke the whole heap
(func $wax::init_heap
  (i32.store (i32.const 0) (global.get $wax::min_addr) )
  ;; write payload_size to header and footer
  (call $wax::hdr_set_size (global.get $wax::min_addr)
    (i32.sub (i32.sub (global.get $wax::max_addr) (global.get $wax::min_addr)) (i32.const 8))
  )
  (call $wax::hdr_set_size (i32.sub (global.get $wax::max_addr) (i32.const 4))
    (i32.sub (i32.sub (global.get $wax::max_addr) (global.get $wax::min_addr)) (i32.const 8))
  )
  ;; write is_free to header and footer
  (call $wax::hdr_set_free (global.get $wax::min_addr) (i32.const 1))
  (call $wax::hdr_set_free (i32.sub (global.get $wax::max_addr) (i32.const 4)) (i32.const 1))

  ;; set flag to tell malloc() that we've already called init()
  (global.set $wax::heap_did_init (i32.const 1))
)

;; extend (grow) the heap (to accomodate more blocks)
;; parameter: number of pages (64K) to grow
;; - automatically invoked by malloc() when current heap has insufficient free space
;; - can be manually called to get more space in advance
(func $wax::extend (param $n_pages i32)
  (local $n_bytes i32)
  (local $ftr i32)
  (local $prev_ftr i32)
  (local $prev_hdr i32)
  (local $prev_size i32)

  (local.set $prev_ftr (i32.sub (global.get $wax::max_addr) (i32.const 4)) )

  ;; compute number of bytes from page count (1page = 64K = 65536bytes)
  (local.set $n_bytes (i32.mul (local.get $n_pages) (i32.const 65536)))

  ;; system call to grow memory (`drop` discards the (useless) return value of memory.grow)
  (drop (memory.grow (local.get $n_pages) ))

  ;; make the newly acquired memory a big free block
  (call $wax::hdr_set_size (global.get $wax::max_addr) (i32.sub (local.get $n_bytes) (i32.const 8)))
  (call $wax::hdr_set_free (global.get $wax::max_addr) (i32.const 1))

  (global.set $wax::max_addr (i32.add (global.get $wax::max_addr) (local.get $n_bytes) ))
  (local.set $ftr (i32.sub (global.get $wax::max_addr) (i32.const 4)))

  (call $wax::hdr_set_size (local.get $ftr)
    (i32.sub (local.get $n_bytes) (i32.const 8))
  )
  (call $wax::hdr_set_free (local.get $ftr) (i32.const 1))

  ;; see if we can join the new block with the last block of the old heap
  (if (i32.eqz (call $wax::hdr_get_free (local.get $prev_ftr)))(then)(else

    ;; the last block is free, join it.
    (local.set $prev_size (call $wax::hdr_get_size (local.get $prev_ftr)))
    (local.set $prev_hdr
      (i32.sub (i32.sub (local.get $prev_ftr) (local.get $prev_size)) (i32.const 4))
    )
    (call $wax::hdr_set_size (local.get $prev_hdr)
      (i32.add (local.get $prev_size) (local.get $n_bytes) )
    )
    (call $wax::hdr_set_size (local.get $ftr)
      (i32.add (local.get $prev_size) (local.get $n_bytes) )
    )
  ))

)

;; find a free block that fit the request number of bytes
;; modifies the heap once a candidate is found
;; first-fit: not the best policy, but the simplest
(func $wax::find (param $n_bytes i32) (result i32)
  (local $ptr i32)
  (local $size i32)
  (local $is_free i32)
  (local $pay_ptr i32)
  (local $rest i32)

  ;; loop through all blocks
  (local.set $ptr (global.get $wax::min_addr))
  loop $search
    ;; we reached the end of heap and haven't found anything, return NULL
    (if (i32.lt_u (local.get $ptr) (global.get $wax::max_addr))(then)(else
      (i32.const 0)
      return
    ))

    ;; read info about current block
    (local.set $size    (call $wax::hdr_get_size (local.get $ptr)))
    (local.set $is_free (call $wax::hdr_get_free (local.get $ptr)))
    (local.set $pay_ptr (i32.add (local.get $ptr) (i32.const 4) ))

    ;; check if the current block is free
    (if (i32.eq (local.get $is_free) (i32.const 1))(then

      ;; it's free, but too small, move on
      (if (i32.gt_u (local.get $n_bytes) (local.get $size))(then
        (local.set $ptr (i32.add (local.get $ptr) (i32.add (local.get $size) (i32.const 8))))
        (br $search)

      ;; it's free, and large enough to be split into two blocks
      )(else(if (i32.lt_u (local.get $n_bytes) (i32.sub (local.get $size) (i32.const 8)))(then
        ;; OLD HEAP
        ;; ...+-------------------------------------------+...
        ;; ...| HDR |              FREE             | FTR |...
        ;; ...+-------------------------------------------+...
        ;; NEW HEAP
        ;; ...+---------------------+---------------------+...
        ;; ...| HDR | ALLOC   | FTR | HDR |  FREE   | FTR |...
        ;; ...+---------------------+---------------------+...

        ;; size of the remaining half
        (local.set $rest (i32.sub (i32.sub (local.get $size) (local.get $n_bytes) ) (i32.const 8)))

        ;; update headers and footers to reflect the change (see FORMULAS)

        (call $wax::hdr_set_size (local.get $ptr) (local.get $n_bytes))
        (call $wax::hdr_set_free (local.get $ptr) (i32.const 0))

        (call $wax::hdr_set_size (i32.add (i32.add (local.get $ptr) (local.get $n_bytes)) (i32.const 4))
          (local.get $n_bytes)
        )
        (call $wax::hdr_set_free (i32.add (i32.add (local.get $ptr) (local.get $n_bytes)) (i32.const 4))
          (i32.const 0)
        )
        (call $wax::hdr_set_size (i32.add (i32.add (local.get $ptr) (local.get $n_bytes)) (i32.const 8))
          (local.get $rest)
        )
        (call $wax::hdr_set_free (i32.add (i32.add (local.get $ptr) (local.get $n_bytes)) (i32.const 8))
          (i32.const 1)
        )
        (call $wax::hdr_set_size (i32.add (i32.add (local.get $ptr) (local.get $size)) (i32.const 4))
          (local.get $rest)
        )

        (local.get $pay_ptr)
        return

      )(else
        ;; the block is free, but not large enough to be split into two blocks
        ;; we return the whole block as one
        (call $wax::hdr_set_free (local.get $ptr) (i32.const 0))
        (call $wax::hdr_set_free (i32.add (i32.add (local.get $ptr) (local.get $size)) (i32.const 4))
          (i32.const 0)
        )
        (local.get $pay_ptr)
        return
      ))))
    )(else
      ;; the block is not free, we move on to the next block
      (local.set $ptr (i32.add (local.get $ptr) (i32.add (local.get $size) (i32.const 8))))
      (br $search)
    ))
  end

  ;; theoratically we will not reach here
  ;; return NULL
  (i32.const 0)
)


;; malloc - allocate the requested number of bytes on the heap
;; returns a pointer to the block of memory allocated
;; returns NULL (0) when OOM
;; if heap is not large enough, grows it via extend()
(func $wax::malloc (param $n_bytes i32) (result i32)
  (local $ptr i32)
  (local $n_pages i32)

  ;; call init() if we haven't done so yet
  (if (i32.eqz (global.get $wax::heap_did_init)) (then
    (call $wax::init_heap)
  ))

  ;; payload size is aligned to multiple of 4
  (local.set $n_bytes (call $wax::align4 (local.get $n_bytes)))

  ;; attempt allocation
  (local.set $ptr (call $wax::find (local.get $n_bytes)) )

  ;; NULL -> OOM -> extend heap
  (if (i32.eqz (local.get $ptr))(then
    ;; compute # of pages from # of bytes, rounding up
    (local.set $n_pages
      (i32.div_u
        (i32.add (local.get $n_bytes) (i32.const 65527) )
        (i32.const 65528)
      )
    )
    (call $wax::extend (local.get $n_pages))

    ;; try again
    (local.set $ptr (call $wax::find (local.get $n_bytes)) )
  ))
  (local.get $ptr)
)

;; free - free an allocated block given a pointer to it
(func $wax::free (param $ptr i32)
  (local $hdr i32)
  (local $ftr i32)
  (local $size i32)
  (local $prev_hdr i32)
  (local $prev_ftr i32)
  (local $prev_size i32)
  (local $prev_free i32)
  (local $next_hdr i32)
  (local $next_ftr i32)
  (local $next_size i32)
  (local $next_free i32)

  ;; step I: mark the block as free

  (local.set $hdr (i32.sub (local.get $ptr) (i32.const 4)))
  (local.set $size (call $wax::hdr_get_size (local.get $hdr)))
  (local.set $ftr (i32.add (i32.add (local.get $hdr) (local.get $size)) (i32.const 4)))

  (call $wax::hdr_set_free (local.get $hdr) (i32.const 1))
  (call $wax::hdr_set_free (local.get $ftr) (i32.const 1))

  ;; step II: try coalasce

  ;; coalasce with previous block

  ;; check that we're not already the first block
  (if (i32.eq (local.get $hdr) (global.get $wax::min_addr)) (then)(else

    ;; read info about previous block
    (local.set $prev_ftr (i32.sub (local.get $hdr) (i32.const 4)))
    (local.set $prev_size (call $wax::hdr_get_size (local.get $prev_ftr)))
    (local.set $prev_hdr
      (i32.sub (i32.sub (local.get $prev_ftr) (local.get $prev_size)) (i32.const 4))
    )

    ;; check if previous block is free -> merge them
    (if (i32.eqz (call $wax::hdr_get_free (local.get $prev_ftr))) (then) (else
      (local.set $size (i32.add (i32.add (local.get $size) (local.get $prev_size)) (i32.const 8)))
      (call $wax::hdr_set_size (local.get $prev_hdr) (local.get $size))
      (call $wax::hdr_set_size (local.get $ftr) (local.get $size))

      ;; set current header pointer to previous header
      (local.set $hdr (local.get $prev_hdr))
    ))
  ))

  ;; coalasce with next block

  (local.set $next_hdr (i32.add (local.get $ftr) (i32.const 4)))

  ;; check that we're not already the last block
  (if (i32.eq (local.get $next_hdr) (global.get $wax::max_addr)) (then)(else

    ;; read info about next block
    (local.set $next_size (call $wax::hdr_get_size (local.get $next_hdr)))
    (local.set $next_ftr
      (i32.add (i32.add (local.get $next_hdr) (local.get $next_size)) (i32.const 4))
    )

    ;; check if next block is free -> merge them
    (if (i32.eqz (call $wax::hdr_get_free (local.get $next_hdr))) (then) (else
      (local.set $size (i32.add (i32.add (local.get $size) (local.get $next_size)) (i32.const 8)))
      (call $wax::hdr_set_size (local.get $hdr) (local.get $size))
      (call $wax::hdr_set_size (local.get $next_ftr) (local.get $size))
    ))

  ))

)
;; copy a block of memory over, from src pointer to dst pointer
;; WebAssembly seems to be planning to support memory.copy
;; until then, this function uses a loop and i32.store8/load8
(func $wax::memcpy (param $dst i32) (param $src i32) (param $n_bytes i32)
  (local $ptr i32)
  (local $offset i32)
  (local $data i32)

  (if (i32.eqz (local.get $n_bytes))(then
    return
  ))

  (local.set $offset (i32.const 0))

  loop $cpy
    (local.set $data (i32.load8_u (i32.add (local.get $src) (local.get $offset))))
    (i32.store8 (i32.add (local.get $dst) (local.get $offset)) (local.get $data))

    (local.set $offset (i32.add (local.get $offset) (i32.const 1)))
    (br_if $cpy (i32.lt_u (local.get $offset) (local.get $n_bytes)))
  end
)

;; reallocate memory to new size
;; currently does not support contraction
;; nothing will happen if n_bytes is smaller than current payload size
(func $wax::realloc (param $ptr i32) (param $n_bytes i32) (result i32)
  (local $hdr i32)
  (local $next_hdr i32)
  (local $next_ftr i32)
  (local $next_size i32)
  (local $ftr i32)
  (local $size i32)
  (local $rest_hdr i32)
  (local $rest_size i32)
  (local $new_ptr i32)

  (local.set $hdr (i32.sub (local.get $ptr) (i32.const 4)))
  (local.set $size (call $wax::hdr_get_size (local.get $hdr)))

  (if (i32.gt_u (local.get $n_bytes) (local.get $size)) (then) (else
    (local.get $ptr)
    return
  ))

  ;; payload size is aligned to multiple of 4
  (local.set $n_bytes (call $wax::align4 (local.get $n_bytes)))

  (local.set $next_hdr (i32.add (i32.add (local.get $hdr) (local.get $size)) (i32.const 8)))

  ;; Method I: try to expand the current block

  ;; check that we're not already the last block
  (if (i32.lt_u (local.get $next_hdr) (global.get $wax::max_addr) )(then
    (if (call $wax::hdr_get_free (local.get $next_hdr)) (then

      (local.set $next_size (call $wax::hdr_get_size (local.get $next_hdr)))
      (local.set $rest_size (i32.sub
        (local.get $next_size)
        (i32.sub (local.get $n_bytes) (local.get $size))
      ))
      (local.set $next_ftr (i32.add (i32.add (local.get $next_hdr) (local.get $next_size)) (i32.const 4)))

      ;; next block is big enough to be split into two
      (if (i32.gt_s (local.get $rest_size) (i32.const 0) ) (then

        (call $wax::hdr_set_size (local.get $hdr) (local.get $n_bytes))

        (local.set $ftr (i32.add (i32.add (local.get $hdr) (local.get $n_bytes) ) (i32.const 4)))
        (call $wax::hdr_set_size (local.get $ftr) (local.get $n_bytes))
        (call $wax::hdr_set_free (local.get $ftr) (i32.const 0))

        (local.set $rest_hdr (i32.add (local.get $ftr) (i32.const 4) ))
        (call $wax::hdr_set_size (local.get $rest_hdr) (local.get $rest_size))
        (call $wax::hdr_set_free (local.get $rest_hdr) (i32.const 1))

        (call $wax::hdr_set_size (local.get $next_ftr) (local.get $rest_size))
        (call $wax::hdr_set_free (local.get $next_ftr) (i32.const 1))

        (local.get $ptr)
        return

      ;; next block is not big enough to be split, but is
      ;; big enough to merge with the current one into one
      )(else (if (i32.gt_s (local.get $rest_size) (i32.const -9) ) (then

        (local.set $size (i32.add (i32.add (local.get $size) (i32.const 8) ) (local.get $next_size)))
        (call $wax::hdr_set_size (local.get $hdr) (local.get $size))
        (call $wax::hdr_set_size (local.get $next_ftr) (local.get $size))
        (call $wax::hdr_set_free (local.get $next_ftr) (i32.const 0))

        (local.get $ptr)
        return
      ))))

    ))
  ))

  ;; Method II: allocate a new block and copy over

  (local.set $new_ptr (call $wax::malloc (local.get $n_bytes)))
  (call $wax::memcpy (local.get $new_ptr) (local.get $ptr) (local.get $size))
  (call $wax::free (local.get $ptr))
  (local.get $new_ptr)

)

(func $wax::calloc (param $n_bytes i32) (result i32)
  (local $ptr i32)
  (local $offset i32)
  (local.set $ptr (call $wax::malloc (local.get $n_bytes)))
  (local.set $offset (i32.const 0))
  loop $zero
    (if (i32.lt_u (local.get $offset) (local.get $n_bytes)) (then
      (i32.store8 (i32.add (local.get $offset) (local.get $ptr) ) (i32.const 0))
      (local.set $offset (i32.add (local.get $offset) (i32.const 1)))
      (br $zero)
    ))
  end
  (local.get $ptr)
  return
)

(func $wax::memmove (param $dst i32) (param $src i32) (param $n_bytes i32)
  (local $ptr i32)
  (local $offset i32)
  (local $data i32)

  (if (i32.eqz (local.get $n_bytes))(then
    return
  ))

  (if (i32.gt_u (local.get $dst) (local.get $src)) (then
    (local.set $offset (i32.sub (local.get $n_bytes) (i32.const 1)))
    loop $cpy_rev
      (local.set $data (i32.load8_u (i32.add (local.get $src) (local.get $offset))))
      (i32.store8 (i32.add (local.get $dst) (local.get $offset)) (local.get $data))

      (local.set $offset (i32.sub (local.get $offset) (i32.const 1)))
      (br_if $cpy_rev (i32.gt_s (local.get $offset) (i32.const -1)))
    end

  )(else
    (local.set $offset (i32.const 0))
    loop $cpy
      (local.set $data (i32.load8_u (i32.add (local.get $src) (local.get $offset))))
      (i32.store8 (i32.add (local.get $dst) (local.get $offset)) (local.get $data))

      (local.set $offset (i32.add (local.get $offset) (i32.const 1)))
      (br_if $cpy (i32.lt_u (local.get $offset) (local.get $n_bytes)))
    end
  ))
)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;                                  ;;
;;                                  ;;
;;               STACK              ;;
;;                                  ;;
;;                                  ;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; poor man's stack
;; malloc a block of memory and pretend it's the stack, because of the apparent lack(?) of stack address in webassembly

(global $wax::stack_indices_ptr (mut i32) (i32.const 0))
(global $wax::stack_content_ptr (mut i32) (i32.const 0))
(global $wax::stack_count   (mut i32) (i32.const 32))
(global $wax::stack_size    (mut i32) (i32.const 128))
(global $wax::stack_index   (mut i32) (i32.const 0))
(global $wax::stack_now     (mut i32) (i32.const 0))
(global $wax::stack_did_init(mut i32) (i32.const 0))

(func $wax::init_stack
  (global.set $wax::stack_indices_ptr (call $wax::calloc (i32.mul (global.get $wax::stack_count) (i32.const 4))))
  (global.set $wax::stack_content_ptr (call $wax::malloc (global.get $wax::stack_size)))
  (global.set $wax::stack_index (i32.const 0))
  (global.set $wax::stack_did_init (i32.const 1))
)
(func $wax::stack_index_offset (result i32)
  (i32.add (global.get $wax::stack_indices_ptr) (i32.mul (global.get $wax::stack_index) (i32.const 4)))
)
(func $wax::push_stack

  (if (i32.eqz (global.get $wax::stack_did_init)) (then (call $wax::init_stack) ))

  (global.set $wax::stack_index (i32.add (global.get $wax::stack_index) (i32.const 1) ))

  (if (i32.ge_u (global.get $wax::stack_index) (global.get $wax::stack_count)) (then
    (global.set $wax::stack_count (i32.add (global.get $wax::stack_count) (i32.const 128)))
    (global.set $wax::stack_indices_ptr (call $wax::realloc
      (global.get $wax::stack_indices_ptr)
      (i32.mul (global.get $wax::stack_count) (i32.const 4))
    ))
  ))

  (i32.store (call $wax::stack_index_offset) (global.get $wax::stack_now) )

)
(func $wax::pop_stack

  (global.set $wax::stack_now (i32.load (call $wax::stack_index_offset) ))
  (global.set $wax::stack_index (i32.sub (global.get $wax::stack_index) (i32.const 1) ))

)
(func $wax::alloca (param $n_bytes i32) (result i32)
  (local $inc i32)
  (if (i32.ge_u (i32.add (global.get $wax::stack_now) (local.get $n_bytes) ) (global.get $wax::stack_size)) (then
    (local.set $inc (i32.const 512))
    (if (i32.gt_u (local.get $n_bytes) (local.get $inc)) (then
      (local.set $inc (call $wax::align4 (local.get $n_bytes)))
    ))
    (global.set $wax::stack_size (i32.add (global.get $wax::stack_size) (local.get $inc) ))
    (global.set $wax::stack_content_ptr
      (call $wax::realloc (global.get $wax::stack_content_ptr) (global.get $wax::stack_size))
    )
  ))

  ;; repurpose $inc for ret val
  (local.set $inc (i32.add (global.get $wax::stack_content_ptr ) (global.get $wax::stack_now)))

  (global.set $wax::stack_now (i32.add (global.get $wax::stack_now) (local.get $n_bytes)))

  (local.get $inc)
  return
)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;                                  ;;
;;                                  ;;
;;              STRING              ;;
;;                                  ;;
;;                                  ;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(func $wax::fmod (param $x f32) (param $y f32) (result f32)
  (f32.sub (local.get $x) (f32.mul (local.get $y) (f32.trunc (f32.div (local.get $x) (local.get $y)) )))
)

(func $wax::str_new (param $ptr i32) (result i32)
  (if (i32.eqz (local.get $ptr))(then
    (call $wax::calloc (i32.const 1))
    return
  ))
  (call $wax::str_slice (local.get $ptr) (i32.const 0) (call $wax::str_len (local.get $ptr)) )
  return
)

(func $wax::str_get (param $ptr i32) (param $i i32) (result i32)
  (i32.load8_s (i32.add (local.get $ptr) (local.get $i)))
  return
)

(func $wax::str_add (param $ptr i32) (param $c i32) (result i32)
  (local $l i32)
  (local.set $l (call $wax::str_len (local.get $ptr)))
  (local.set $ptr (call $wax::realloc (local.get $ptr) (i32.add (local.get $l) (i32.const 2) ) ) )
  (i32.store8 (i32.add (local.get $ptr) (local.get $l)) (local.get $c)  )
  (i32.store8 (i32.add (i32.add (local.get $ptr) (local.get $l)) (i32.const 1)) (i32.const 0)  )

  (local.get $ptr)
  (return)
)

(func $wax::str_cat (param $s0 i32) (param $s1 i32) (result i32)
  (local $l0 i32)
  (local $l1 i32)
  (local.set $l0 (call $wax::str_len (local.get $s0)))
  (local.set $l1 (call $wax::str_len (local.get $s1)))

  (local.set $s0 (call $wax::realloc (local.get $s0) (i32.add (i32.add (local.get $l0) (local.get $l1) ) (i32.const 1)) ))

  (call $wax::memcpy (i32.add (local.get $s0) (local.get $l0)) (local.get $s1) (local.get $l1) )
  (i32.store8 (i32.add (i32.add (local.get $s0) (local.get $l0)) (local.get $l1)) (i32.const 0)  )
  (local.get $s0)
  return
)

(func $wax::str_cmp (param $s0 i32) (param $s1 i32) (result i32)
  (local $offset i32)
  (local $x i32)
  (local $y i32)
  (local.set $offset (i32.const 0))
  loop $cmp
    (local.set $x (i32.load8_u (i32.add (local.get $s0) (local.get $offset))) )
    (local.set $y (i32.load8_u (i32.add (local.get $s1) (local.get $offset))) )

    (if (i32.eq (local.get $x) (local.get $y)) (then
      (if (i32.eqz (local.get $x)) (then
        (i32.const 1)
        return
      ))
    )(else
      (i32.const 0)
      return
    ))

    (local.set $offset (i32.add (local.get $offset) (i32.const 1)))
    (br $cmp)
  end
  (i32.const 0) ;;impossible, just shut compiler up
  return
)

(func $wax::str_len (param $ptr i32) (result i32)
  (local $offset i32)
  (local.set $offset (i32.const 0))
  loop $zero
    (if (i32.load8_u (i32.add (local.get $ptr) (local.get $offset))) (then
      (local.set $offset (i32.add (local.get $offset) (i32.const 1)))
      (br $zero)
    ))
  end
  (local.get $offset)
  return
)

(func $wax::str_slice (param $ptr i32) (param $i i32) (param $n i32) (result i32)
  (local $nptr i32)
  (local.set $nptr (call $wax::malloc (i32.add (local.get $n) (i32.const 1))))
  (call $wax::memcpy
    (local.get $nptr)
    (i32.add (local.get $ptr) (local.get $i))
    (local.get $n)
  )
  (i32.store8 (i32.add (local.get $nptr) (local.get $n) ) (i32.const 0))
  (local.get $nptr)
  return
)

(func $wax::print (param $ptr i32)
  (local $len i32)
  (local.set $len (call $wax::str_len (local.get $ptr)))
  (call $wax::js::console.log (local.get $ptr) (local.get $len))
)

(func $wax::int2str (param $x i32) (result i32)
  (local $ptr i32)
  (local $rem i32)
  (local $isneg i32)
  (local $str i32)

  (local.set $str (call $wax::alloca (i32.const 16)))
  (local.set $ptr (i32.add (local.get $str) (i32.const 15)))
  (i32.store8 (local.get $ptr) (i32.const 0))

  (local.set $isneg (i32.const 0))
  (if (i32.lt_s (local.get $x) (i32.const 0)) (then
    (local.set $isneg (i32.const 1))
    (local.set $x (i32.sub (i32.const 0) (local.get $x) ))
  ))

  loop $digits
    (local.set $ptr (i32.sub (local.get $ptr) (i32.const 1)))

    (local.set $rem (i32.rem_u (local.get $x) (i32.const 10)))
    (i32.store8 (local.get $ptr) (i32.add (local.get $rem) (i32.const 48)))

    (local.set $x (i32.div_u (local.get $x) (i32.const 10)))

    (if (i32.eqz (i32.eqz (local.get $x))) (then
      (br $digits)
    ))
  end

  (if (local.get $isneg) (then
    (local.set $ptr (i32.sub (local.get $ptr) (i32.const 1)))
    (i32.store8 (local.get $ptr) (i32.const 45)) ;; '-'
  ))

  (local.get $ptr)
  return
)

(func $wax::fint2str (param $x f32) (result i32)
  (local $ptr i32)
  (local $rem i32)
  (local $isneg i32)
  (local $str i32)
  (local.set $x (f32.trunc (local.get $x)))

  (local.set $str (call $wax::alloca (i32.const 48)))
  (local.set $ptr (i32.add (local.get $str) (i32.const 47)))
  (i32.store8 (local.get $ptr) (i32.const 0))

  (if (f32.lt (local.get $x) (f32.const 0)) (then
    (local.set $isneg (i32.const 1))
    (local.set $x (f32.sub (f32.const 0) (local.get $x) ))
  ))

  loop $digits
    (local.set $ptr (i32.sub (local.get $ptr) (i32.const 1)))

    (local.set $rem (i32.trunc_f32_s (call $wax::fmod (local.get $x) (f32.const 10.0))))
    (i32.store8 (local.get $ptr) (i32.add (local.get $rem) (i32.const 48)))

    (local.set $x (f32.div (local.get $x) (f32.const 10.0)))

    (if (f32.gt (local.get $x) (f32.const 0.99999994) ) (then ;;nextafterf(1.00000001,0.0);
      (br $digits)
    ))
  end

  (if (local.get $isneg) (then
    (local.set $ptr (i32.sub (local.get $ptr) (i32.const 1)))
    (i32.store8 (local.get $ptr) (i32.const 45)) ;; '-'
  ))

  (local.get $ptr)
  return
)




(func $wax::flt2str (param $x f32) (result i32)
  (local $ptr0 i32)
  (local $ptr i32)
  (local $rem i32)
  (local $isneg i32)
  (local $str i32)

  (local.set $ptr0 (call $wax::fint2str (local.get $x)))

  (if (f32.lt (local.get $x) (f32.const 0)) (then
    (local.set $x (f32.sub (f32.const 0.0) (local.get $x)))
  ))
  (local.set $x (f32.sub (local.get $x) (f32.trunc (local.get $x))))

  (local.set $str (call $wax::alloca (i32.const 16)))
  (i32.store8 (i32.sub (local.get $str) (i32.const 1)) (i32.const 46)  )
  (local.set $ptr (local.get $str))

  loop $digits

    (local.set $rem (i32.trunc_f32_s (f32.mul (local.get $x) (f32.const 10.0)) ))
    (i32.store8 (local.get $ptr) (i32.add (local.get $rem) (i32.const 48)))

    (local.set $x (f32.sub (f32.mul (local.get $x) (f32.const 10.0)) (f32.convert_i32_s (local.get $rem))) )

    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))

    (if (i32.and
      (f32.gt (local.get $x) (f32.const 1.1920928955078126e-7) ) ;; floating-point epsilon
      (i32.lt_s (i32.sub (local.get $ptr) (local.get $str)) (i32.const 15))
    )(then
      (br $digits)
    ))
  end
  (i32.store8 (local.get $ptr) (i32.const 0))

  (local.get $ptr0)
  return

)

(func $wax::str2int (param $s i32) (result i32)
  (local $x i32)
  (local $ptr i32)
  (local $d i32)
  (local $sign i32)
  (local.set $x (i32.const 0))

  (local.set $ptr (local.get $s))

  (local.set $sign (i32.const 1))
  (if (i32.eq (i32.load8_s (local.get $ptr) ) (i32.const 45) ) (then ;;'-'
    (local.set $sign (i32.const -1))
    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
  )(else(if (i32.eq (i32.load8_s (local.get $ptr) ) (i32.const 43) ) (then ;;'+'
    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1))) ;;redundant
  ))))

  loop $digits
    (local.set $d (i32.load8_s (local.get $ptr) ))
    (if (i32.or
      (i32.lt_s (local.get $d) (i32.const 48))
      (i32.gt_s (local.get $d) (i32.const 57))
    )(then
      (i32.mul (local.get $sign) (local.get $x))
      return
    ))

    (local.set $x (i32.mul (local.get $x) (i32.const 10)))
    (local.set $x (i32.add (local.get $x) (i32.sub (local.get $d) (i32.const 48))))

    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
    (br $digits)
  end

  (i32.mul (local.get $sign) (local.get $x))
  return
)

(func $wax::str2flt (param $s i32) (result f32)
  (local $x f32)
  (local $ptr i32)
  (local $d i32)
  (local $sign f32)
  (local $mlt f32)

  (local.set $x (f32.const 0.0))

  (local.set $ptr (local.get $s))


  (local.set $sign (f32.const 1.0))
  (if (i32.eq (i32.load8_s (local.get $ptr) ) (i32.const 45) ) (then ;;'-'
    (local.set $sign (f32.const -1))
    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
  )(else(if (i32.eq (i32.load8_s (local.get $ptr) ) (i32.const 43) ) (then ;;'+'
    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1))) ;;redundant
  ))))

  block $out
  loop $digits
    (local.set $d (i32.load8_s (local.get $ptr) ))
    (if (i32.eq (local.get $d) (i32.const 46)) (then ;; '.'
      (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
      (br $out)
    ))
    (if (i32.or
      (i32.lt_s (local.get $d) (i32.const 48))
      (i32.gt_s (local.get $d) (i32.const 57))
    )(then
      (f32.mul (local.get $sign) (local.get $x))
      return
    ))

    (local.set $x (f32.mul (local.get $x) (f32.const 10.0)))
    (local.set $x (f32.add (local.get $x) (f32.convert_i32_s (i32.sub (local.get $d) (i32.const 48)))))

    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
    (br $digits)
  end
  end

  (local.set $mlt (f32.const 0.1))
  loop $fracs
    (local.set $d (i32.load8_s (local.get $ptr) ))

    (if (i32.or
      (i32.lt_s (local.get $d) (i32.const 48))
      (i32.gt_s (local.get $d) (i32.const 57))
    )(then
      (f32.mul (local.get $sign) (local.get $x))
      return
    ))
    (local.set $x (f32.add
      (local.get $x)
      (f32.mul (f32.convert_i32_s (i32.sub (local.get $d) (i32.const 48))) (local.get $mlt))
    ))
    (local.set $mlt (f32.mul (local.get $mlt) (f32.const 0.1)))

    (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))

    (br $fracs)
  end

  (f32.mul (local.get $sign) (local.get $x))
  return
)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;                                  ;;
;;                                  ;;
;;               ARRAY              ;;
;;                                  ;;
;;                                  ;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; addapted from https://github.com/LingDong-/wasm-fun

;;   Continous, resizable storage for a sequence of values,
;;   similar to C++ vector<T>
;;
;;   +--------------------+
;;   |data|length|capacity|
;;   +-|------------------+
;;     |        +---------------------------
;;     `------> |elem 0|elem 1|elem 2|......
;;              +---------------------------

;; struct arr {
;;   i32/f32/(void*) data
;;   int length
;;   int capacity
;; }

(global $wax::DEFAULT_CAPACITY (mut i32) (i32.const 8))

;; (internal) getter/setters for arr struct fields

(func $wax::_arr_set_data (param $ptr i32) (param $data i32)
  (i32.store (local.get $ptr) (local.get $data))
)
(func $wax::_arr_set_length (param $ptr i32) (param $length i32)
  (i32.store (i32.add (local.get $ptr) (i32.const 4)) (local.get $length))
)
(func $wax::_arr_set_capacity (param $ptr i32) (param $capacity i32)
  (i32.store (i32.add (local.get $ptr) (i32.const 8)) (local.get $capacity))
)
(func $wax::_arr_get_data (param $ptr i32) (result i32)
  (i32.load (local.get $ptr))
)
(func $wax::_arr_get_capacity (param $ptr i32) (result i32)
  (i32.load (i32.add (local.get $ptr) (i32.const 8)))
)

;; returns length of an array given an arr pointer
(func $wax::arr_length (param $ptr i32) (result i32)
  (i32.load (i32.add (local.get $ptr) (i32.const 4)) )
)

;; initialize a new arr, returns a pointer to it
;; elem_size: size of each element, in bytes
(func $wax::arr_new (param $len i32) (result i32)
  (local $ptr i32)
  (local $cap i32)
  (local $data i32)
  (if (i32.lt_u (local.get $len) (global.get $wax::DEFAULT_CAPACITY)) (then
    (local.set $cap (global.get $wax::DEFAULT_CAPACITY))
  )(else
    (local.set $cap (local.get $len))
  ))
  (local.set $ptr (call $wax::malloc (i32.const 12)))
  (local.set $data (call $wax::calloc (i32.mul (local.get $cap) (i32.const 4))))
  (call $wax::_arr_set_data (local.get $ptr) (local.get $data))
  (call $wax::_arr_set_length (local.get $ptr) (local.get $len))
  (call $wax::_arr_set_capacity (local.get $ptr) (local.get $cap))
  (local.get $ptr)
)

;; free allocated memory given an arr pointer
(func $wax::arr_free (param $a i32)
  (call $wax::free (call $wax::_arr_get_data (local.get $a)))
  (call $wax::free (local.get $a))
)



;; get ith element of an array
(func $wax::arr_get (param $a i32) (param $i i32) (result i32)
  (local $data i32)
  (local $elem_size i32)
  (local.set $data (call $wax::_arr_get_data (local.get $a)))
  (local.set $elem_size (i32.const 4))
  (i32.load (i32.add (i32.mul (local.get $i) (local.get $elem_size)) (local.get $data)))
)

;; set ith element of an array
(func $wax::arr_set (param $a i32) (param $i i32) (param $v i32)
  (local $data i32)
  (local $elem_size i32)
  (local.set $data (call $wax::_arr_get_data (local.get $a)))
  (local.set $elem_size (i32.const 4))
  (i32.store (i32.add (i32.mul (local.get $i) (local.get $elem_size)) (local.get $data)) (local.get $v))
)

;; remove n elements from an array starting at index i
(func $wax::arr_remove (param $a i32) (param $i i32) (param $n i32)
  (local $data i32)
  (local $elem_size i32)
  (local $length i32)
  (local $offset i32)

  (local.set $length (call $wax::arr_length (local.get $a)))
  (local.set $data (call $wax::_arr_get_data (local.get $a)))
  (local.set $elem_size (i32.const 4))

  (local.set $offset
    (i32.add (local.get $data) (i32.mul (local.get $i) (local.get $elem_size) ))
  )

  (call $wax::memmove
    (local.get $offset)
    (i32.add (local.get $offset) (i32.mul (local.get $n) (local.get $elem_size)))
    (i32.mul (i32.sub (local.get $length) (i32.add (local.get $i) (local.get $n)) ) (local.get $elem_size))
  )
  (call $wax::_arr_set_length  (local.get $a) (i32.sub (local.get $length) (local.get $n) ))
)


;; add an element to the end of the array
;; does not write the element, instead, returns a pointer
;; to the new last element for the user to write at
(func $wax::arr_push (param $a i32) (result i32)
  (local $length i32)
  (local $capacity i32)
  (local $data i32)
  (local $elem_size i32)

  (local.set $length (call $wax::arr_length (local.get $a)))
  (local.set $capacity (call $wax::_arr_get_capacity (local.get $a)))
  (local.set $data (call $wax::_arr_get_data (local.get $a)))
  (local.set $elem_size (i32.const 4))

  (if (i32.lt_u (local.get $length) (local.get $capacity) ) (then) (else
    (local.set $capacity (i32.add
      (i32.add (local.get $capacity) (i32.const 1))
      (local.get $capacity)
    ))
    (call $wax::_arr_set_capacity (local.get $a) (local.get $capacity))

    (local.set $data
      (call $wax::realloc (local.get $data) (i32.mul (local.get $elem_size) (local.get $capacity) ))
    )
    (call $wax::_arr_set_data (local.get $a) (local.get $data))
  ))
  (call $wax::_arr_set_length (local.get $a) (i32.add (local.get $length) (i32.const 1)))

  ;; (i32.store (i32.add (local.get $data) (i32.mul (local.get $length) (local.get $elem_size))) (i32.const 0))

  (i32.add (local.get $data) (i32.mul (local.get $length) (local.get $elem_size)))
)

;; insert into an array at given index
(func $wax::arr_insert (param $a i32) (param $i i32) (param $v i32)
  (local $data i32)
  (local $elem_size i32)
  (local $length i32)
  (local $offset i32)

  (local.set $length (call $wax::arr_length (local.get $a)))

  (drop (call $wax::arr_push (local.get $a)))

  (local.set $data (call $wax::_arr_get_data (local.get $a)))
  (local.set $elem_size (i32.const 4))

  (local.set $offset
    (i32.add (local.get $data) (i32.mul (local.get $i) (local.get $elem_size) ))
  )

  (call $wax::memmove
    (i32.add (local.get $offset) (local.get $elem_size))
    (local.get $offset)
    (i32.mul
      (i32.sub (local.get $length) (local.get $i) )
      (local.get $elem_size)
    )
  )

  (i32.store (local.get $offset) (local.get $v))

)

;; slice an array, producing a copy of a range of elements
;; i = starting index (inclusive), j = stopping index (exclusive)
;; returns pointer to new array
(func $wax::arr_slice (param $a i32) (param $i i32) (param $n i32) (result i32)
  (local $a_length i32)
  (local $length i32)
  (local $elem_size i32)
  (local $ptr i32)
  (local $data i32)
  (local $j i32)

  (local.set $j (i32.add (local.get $i) (local.get $n)))

  (local.set $a_length (call $wax::arr_length (local.get $a)))

  (if (i32.lt_s (local.get $i) (i32.const 0) )(then
    (local.set $i (i32.add (local.get $a_length) (local.get $i)))
  ))
  (if (i32.lt_s (local.get $j) (i32.const 0) )(then
    (local.set $j (i32.add (local.get $a_length) (local.get $j)))
  ))

  (local.set $length (i32.sub (local.get $j) (local.get $i)))
  (local.set $elem_size (i32.const 4))

  (local.set $ptr (call $wax::malloc (i32.const 12)))
  (local.set $data (call $wax::malloc (i32.mul (local.get $length) (local.get $elem_size))))
  (call $wax::_arr_set_data (local.get $ptr) (local.get $data))
  (call $wax::_arr_set_length (local.get $ptr) (local.get $length))
  (call $wax::_arr_set_capacity (local.get $ptr) (local.get $length))

  (call $wax::memcpy (local.get $data)
    (i32.add
      (call $wax::_arr_get_data (local.get $a))
      (i32.mul (local.get $i) (local.get $elem_size))
    )
    (i32.mul (local.get $length) (local.get $elem_size))
  )

  (local.get $ptr)
)


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;                                  ;;
;;                                  ;;
;;                MAP               ;;
;;                                  ;;
;;                                  ;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; adapted from https://github.com/LingDong-/wasm-fun

;;   Hash table (separate chaining with linked lists)
;;   similar to C++ map<T,T>.
;;
;;   Entire key is stored in map node; val is 32 bit int/float/pointer
;;
;;   Functions involving keys have two versions, *_i and *_h.
;;   _i takes an i32 as key directly (for simple small keys),
;;   while _h versions read the key from the heap given a
;;   pointer and a byte count (for larger keys)
;;
;;   +-----------+
;;   |num_buckets|          ,----------------------.
;;   |-----------|        +-|-------------------+  |  +---------------------+
;;   | bucket 0  |------->|next|key_size|key|val|  `->|next|key_size|key|val|
;;   |-----------|        +---------------------+     +---------------------+
;;   | bucket 1  |
;;   |-----------|        +---------------------+
;;   | bucket 2  |------->|next|key_size|key|val|
;;   |-----------|        +---------------------+
;;   | ......... |


;; struct map{
;;   int num_buckets;
;;   int length;
;;   mapnode* bucket0;
;;   mapnode* bucket1;
;;   mapnode* bucket2;
;;   ...
;; }
;; struct mapnode{
;;   mapnode* next;
;;   int key_size;
;;   key_t key;
;;   int val;
;; }

;; (internal) getters and setters for map struct

(func $wax::_map_get_num_buckets (param $m i32) (result i32)
  (i32.load (local.get $m))
)
(func $wax::_map_set_num_buckets (param $m i32) (param $num_buckets i32)
  (i32.store (local.get $m) (local.get $num_buckets))
)
(func $wax::map_length (param $m i32) (result i32)
  (i32.load (i32.add (local.get $m) (i32.const 4)))
)
(func $wax::_map_inc_length (param $m i32) (param $dx i32)
  (local $l i32)
  (local $o i32)
  (local.set $o (i32.add (local.get $m) (i32.const 4)))
  (local.set $l (i32.load (local.get $o)))
  (i32.store (local.get $o) (i32.add (local.get $l) (local.get $dx)))
)
(func $wax::_map_get_bucket (param $m i32) (param $i i32) (result i32)
  (i32.load (i32.add
    (i32.add (local.get $m) (i32.const 8))
    (i32.mul (local.get $i) (i32.const 4))
  ))
)
(func $wax::_map_set_bucket (param $m i32) (param $i i32) (param $ptr i32)
  (i32.store (i32.add
    (i32.add (local.get $m) (i32.const 8))
    (i32.mul (local.get $i) (i32.const 4))
  ) (local.get $ptr) )
)

;; (internal) getters and setters for map node struct

(func $wax::_mapnode_get_next (param $m i32) (result i32)
  (i32.load (local.get $m))
)
(func $wax::_mapnode_get_key_size (param $m i32) (result i32)
  (i32.load (i32.add (local.get $m) (i32.const 4)))
)
(func $wax::_mapnode_get_key_ptr (param $m i32) (result i32)
  (i32.add (local.get $m) (i32.const 8))
)
(func $wax::_mapnode_get_val_ptr (param $m i32) (result i32)
  (local $key_size i32)
  (local.set $key_size (call $wax::_mapnode_get_key_size (local.get $m)))
  (i32.add (i32.add (local.get $m) (i32.const 8)) (local.get $key_size))
)

(func $wax::_mapnode_set_next (param $m i32) (param $v i32)
  (i32.store (local.get $m) (local.get $v))
)
(func $wax::_mapnode_set_key_size (param $m i32) (param $v i32)
  (i32.store (i32.add (local.get $m) (i32.const 4)) (local.get $v))
)

(func $wax::_mapnode_set_key_h (param $m i32) (param $key_ptr i32) (param $key_size i32)
  (local $ptr i32)
  (local $i i32)
  (local.set $ptr (call $wax::_mapnode_get_key_ptr (local.get $m)))
  loop $loop_mapnode_set_key_h
    (i32.store8
      (i32.add (local.get $ptr) (local.get $i))
      (i32.load8_u (i32.add (local.get $key_ptr) (local.get $i)))
    )
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $loop_mapnode_set_key_h (i32.lt_u (local.get $i) (local.get $key_size) ))
  end
)
(func $wax::_mapnode_set_key_i (param $m i32) (param $key i32)
  (i32.store
    (call $wax::_mapnode_get_key_ptr (local.get $m))
    (local.get $key)
  )
)

;; Hash functions

;; hash an integer with SHR3
(func $wax::_map_hash_i (param $num_buckets i32) (param $key i32) (result i32)
  (local.set $key (i32.xor (local.get $key) (i32.shl   (local.get $key) (i32.const 17))))
  (local.set $key (i32.xor (local.get $key) (i32.shr_u (local.get $key) (i32.const 13))))
  (local.set $key (i32.xor (local.get $key) (i32.shl   (local.get $key) (i32.const 5 ))))
  (i32.rem_u (local.get $key) (local.get $num_buckets))
)

;; hash a sequence of bytes by xor'ing them into an integer and calling _map_hash_i
(func $wax::_map_hash_h (param $num_buckets i32) (param $key_ptr i32) (param $key_size i32) (result i32)
  (local $key i32)
  (local $i i32)
  (local $byte i32)

  (local.set $i (i32.const 0))
  loop $loop_map_hash_h
    (local.set $byte (i32.load8_u (i32.add (local.get $key_ptr) (local.get $i))))

    (local.set $key
      (i32.xor (local.get $key)
        (i32.shl (local.get $byte) (i32.mul (i32.const 8) (i32.rem_u (local.get $i) (i32.const 4))))
      )
    )
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $loop_map_hash_h (i32.lt_u (local.get $i) (local.get $key_size) ))
  end

  (call $wax::_map_hash_i (local.get $num_buckets) (local.get $key))
)

;; initialize a new map, given number of buckets
;; returns a pointer to the map
(func $wax::map_new (param $num_buckets i32) (result i32)
  (local $m i32)
  (local $i i32)
  (local.set $m (call $wax::malloc (i32.add (i32.mul (local.get $num_buckets) (i32.const 4)) (i32.const 8)) ))
  (call $wax::_map_set_num_buckets (local.get $m) (local.get $num_buckets))

  (local.set $i (i32.const 0))
  loop $loop_map_new_clear
    (call $wax::_map_set_bucket (local.get $m) (local.get $i) (i32.const 0))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $loop_map_new_clear (i32.lt_u (local.get $i) (local.get $num_buckets) ))
  end
  (local.get $m)
)

;; compare the key stored in a node agianst a key on the heap
(func $wax::_map_cmp_key_h (param $node i32) (param $key_ptr i32) (param $key_size i32) (result i32)
  (local $key_ptr0 i32)
  (local $key_size0 i32)
  (local $i i32)
  (local.set $key_ptr0 (call $wax::_mapnode_get_key_ptr (local.get $node)))
  (local.set $key_size0 (call $wax::_mapnode_get_key_size (local.get $node)))
  (if (i32.eq (local.get $key_size0) (local.get $key_size))(then
    (local.set $i (i32.const 0))
    loop $loop_map_cmp_key_h

      (if (i32.eq
        (i32.load8_u (i32.add (local.get $key_ptr0) (local.get $i)))
        (i32.load8_u (i32.add (local.get $key_ptr ) (local.get $i)))
      )(then)(else
        (i32.const 0)
        return
      ))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop_map_cmp_key_h (i32.lt_u (local.get $i) (local.get $key_size) ))
    end
    (i32.const 1)
    return
  ))
  (i32.const 0)
  return
)

;; compare the key stored in a node agianst a key passed directly as i32 argument
(func $wax::_map_cmp_key_i (param $node i32) (param $key i32) (result i32)
  (local $key_ptr0 i32)
  (local $key_size0 i32)
  (local.set $key_ptr0 (call $wax::_mapnode_get_key_ptr (local.get $node)))
  (local.set $key_size0 (call $wax::_mapnode_get_key_size (local.get $node)))

  (if (i32.eq (local.get $key_size0) (i32.const 4))(then
    (i32.eq (i32.load (local.get $key_ptr0))  (local.get $key) )
    return
  ))
  (i32.const 0)
  return
)

;; insert a new entry to the map, taking a key stored on the heap
;; m : the map
;; key_ptr: pointer to the key on the heap
;; key_size: size of the key in bytes
;; returns pointer to the value inserted in the map for the user to write at

(func $wax::map_set_h (param $m i32) (param $key_ptr i32) (param $val i32)
  (local $num_buckets i32)
  (local $hash i32)
  (local $it i32)
  (local $node_size i32)
  (local $prev i32)
  (local $key_size i32)
  (local.set $key_size (i32.add (call $wax::str_len (local.get $key_ptr)) (i32.const 1)))

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))
  (local.set $hash (call $wax::_map_hash_h (local.get $num_buckets) (local.get $key_ptr) (local.get $key_size)))

  (local.set $it (call $wax::_map_get_bucket (local.get $m) (local.get $hash)))
  (local.set $node_size (i32.add (local.get $key_size) (i32.const 12) ))


  (if (i32.eqz (local.get $it))(then
    (local.set $it (call $wax::malloc (local.get $node_size)))

    (call $wax::_mapnode_set_key_size (local.get $it) (local.get $key_size))
    (call $wax::_mapnode_set_next (local.get $it) (i32.const 0))
    (call $wax::_mapnode_set_key_h (local.get $it) (local.get $key_ptr) (local.get $key_size))

    (call $wax::_map_set_bucket (local.get $m) (local.get $hash) (local.get $it))

    (i32.store (call $wax::_mapnode_get_val_ptr (local.get $it)) (local.get $val))
    (call $wax::_map_inc_length (local.get $m) (i32.const 1))
    return
  )(else
    (local.set $prev (i32.const 0))
    loop $loop_map_set_h
      (if (i32.eqz (local.get $it))(then)(else
        (if (call $wax::_map_cmp_key_h (local.get $it) (local.get $key_ptr) (local.get $key_size) )(then
          (local.set $it (call $wax::realloc (local.get $it) (local.get $node_size)))

          (if (i32.eqz (local.get $prev)) (then
            (call $wax::_map_set_bucket (local.get $m) (local.get $hash) (local.get $it))
          )(else
            (call $wax::_mapnode_set_next (local.get $prev) (local.get $it))
          ))
          (i32.store (call $wax::_mapnode_get_val_ptr (local.get $it)) (local.get $val))
          return
        ))
        (local.set $prev (local.get $it))
        (local.set $it (call $wax::_mapnode_get_next (local.get $it)))
        (br $loop_map_set_h)
      ))
    end
    (local.set $it (call $wax::malloc (local.get $node_size)))
    (call $wax::_mapnode_set_key_size (local.get $it) (local.get $key_size))
    (call $wax::_mapnode_set_next (local.get $it) (i32.const 0))
    (call $wax::_mapnode_set_key_h (local.get $it) (local.get $key_ptr) (local.get $key_size))

    (call $wax::_mapnode_set_next (local.get $prev) (local.get $it))
    (i32.store (call $wax::_mapnode_get_val_ptr (local.get $it)) (local.get $val))
    (call $wax::_map_inc_length (local.get $m) (i32.const 1))
    return
  ))

)

;; insert a new entry to the map, taking a key passed directly as i32 argument
;; m : the map
;; key: the key
;; returns pointer to the value inserted in the map for the user to write at

(func $wax::map_set_i (param $m i32) (param $key i32)  (param $val i32)
  (local $num_buckets i32)
  (local $hash i32)
  (local $it i32)
  (local $node_size i32)
  (local $prev i32)

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))
  (local.set $hash (call $wax::_map_hash_i (local.get $num_buckets) (local.get $key)))

  (local.set $it (call $wax::_map_get_bucket (local.get $m) (local.get $hash)))
  (local.set $node_size (i32.const 16) )


  (if (i32.eqz (local.get $it))(then
    (local.set $it (call $wax::malloc (local.get $node_size)))

    (call $wax::_mapnode_set_key_size (local.get $it) (i32.const 4))
    (call $wax::_mapnode_set_next (local.get $it) (i32.const 0))
    (call $wax::_mapnode_set_key_i (local.get $it) (local.get $key))

    (call $wax::_map_set_bucket (local.get $m) (local.get $hash) (local.get $it))

    (i32.store (call $wax::_mapnode_get_val_ptr (local.get $it)) (local.get $val))
    (call $wax::_map_inc_length (local.get $m) (i32.const 1))
    return
  )(else
    (local.set $prev (i32.const 0))
    loop $loop_map_set_i
      (if (i32.eqz (local.get $it))(then)(else
        (if (call $wax::_map_cmp_key_i (local.get $it) (local.get $key) )(then
          (local.set $it (call $wax::realloc (local.get $it) (local.get $node_size)))

          (if (i32.eqz (local.get $prev)) (then
            (call $wax::_map_set_bucket (local.get $m) (local.get $hash) (local.get $it))
          )(else
            (call $wax::_mapnode_set_next (local.get $prev) (local.get $it))
          ))
          (i32.store (call $wax::_mapnode_get_val_ptr (local.get $it)) (local.get $val))
          return
        ))
        (local.set $prev (local.get $it))
        (local.set $it (call $wax::_mapnode_get_next (local.get $it)))
        (br $loop_map_set_i)
      ))
    end
    (local.set $it (call $wax::malloc (local.get $node_size)))
    (call $wax::_mapnode_set_key_size (local.get $it) (i32.const 4))
    (call $wax::_mapnode_set_next (local.get $it) (i32.const 0))
    (call $wax::_mapnode_set_key_i (local.get $it) (local.get $key))

    (call $wax::_mapnode_set_next (local.get $prev) (local.get $it))
    (i32.store (call $wax::_mapnode_get_val_ptr (local.get $it)) (local.get $val))
    (call $wax::_map_inc_length (local.get $m) (i32.const 1))
    return
  ))

)

;; lookup a key for its value in the map, taking a key stored on the heap
;; m : the map
;; key_ptr: pointer to the key on the heap
;; key_size: size of the key in bytes
;; returns pointer to the value in the map, NULL (0) if not found.

(func $wax::map_get_h (param $m i32) (param $key_ptr i32) (result i32)
  (local $num_buckets i32)
  (local $hash i32)
  (local $it i32)
  (local $key_size i32)
  (local.set $key_size (i32.add (call $wax::str_len (local.get $key_ptr)) (i32.const 1)))

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))
  (local.set $hash (call $wax::_map_hash_h (local.get $num_buckets) (local.get $key_ptr) (local.get $key_size)))
  (local.set $it (call $wax::_map_get_bucket (local.get $m) (local.get $hash)))

  loop $loop_map_get_h
    (if (i32.eqz (local.get $it))(then)(else
      (if (call $wax::_map_cmp_key_h (local.get $it) (local.get $key_ptr) (local.get $key_size) )(then
        (i32.load (call $wax::_mapnode_get_val_ptr (local.get $it)))
        return
      ))
      (local.set $it (call $wax::_mapnode_get_next (local.get $it)))
      (br $loop_map_get_h)
    ))
  end

  (i32.const 0)
)

;; lookup a key for its value in the map, taking a key passed directly as i32 argument
;; m : the map
;; key : the key
;; returns pointer to the value in the map, NULL (0) if not found.

(func $wax::map_get_i (param $m i32) (param $key i32) (result i32)
  (local $num_buckets i32)
  (local $hash i32)
  (local $it i32)

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))
  (local.set $hash (call $wax::_map_hash_i (local.get $num_buckets) (local.get $key)))
  (local.set $it (call $wax::_map_get_bucket (local.get $m) (local.get $hash)))

  loop $loop_map_get_i
    (if (i32.eqz (local.get $it))(then)(else
      (if (call $wax::_map_cmp_key_i (local.get $it) (local.get $key) )(then
        (i32.load (call $wax::_mapnode_get_val_ptr (local.get $it)))
        return
      ))
      (local.set $it (call $wax::_mapnode_get_next (local.get $it)))
      (br $loop_map_get_i)
    ))
  end

  (i32.const 0)
)

;; remove a key-value pair from the map, given a key stored on the heap
;; m : the map
;; key_ptr: pointer to the key on the heap
;; key_size: size of the key in bytes

(func $wax::map_remove_h (param $m i32) (param $key_ptr i32) (param $key_size i32)
  (local $num_buckets i32)
  (local $hash i32)
  (local $it i32)
  (local $prev i32)
  (local $next i32)

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))
  (local.set $hash (call $wax::_map_hash_h (local.get $num_buckets) (local.get $key_ptr) (local.get $key_size)))
  (local.set $it (call $wax::_map_get_bucket (local.get $m) (local.get $hash)))

  (local.set $prev (i32.const 0))

  loop $loop_map_remove_h
    (if (i32.eqz (local.get $it))(then)(else
      (if (call $wax::_map_cmp_key_h (local.get $it) (local.get $key_ptr) (local.get $key_size) )(then
        (local.set $next (call $wax::_mapnode_get_next (local.get $it)))

        (if (i32.eqz (local.get $prev)) (then
          (call $wax::_map_set_bucket (local.get $m) (local.get $hash) (local.get $next))
        )(else
          (call $wax::_mapnode_set_next (local.get $prev) (local.get $next))
        ))
        (call $wax::free (local.get $it))
        (call $wax::_map_inc_length (local.get $m) (i32.const -1))
        return
      ))
      (local.set $prev (local.get $it))
      (local.set $it (local.get $next))
      (br $loop_map_remove_h)
    ))
  end
)

;; remove a key-value pair from the map, given a key passed directly as i32 argument
;; m : the map
;; key : the key
(func $wax::map_remove_i (param $m i32) (param $key i32)
  (local $num_buckets i32)
  (local $hash i32)
  (local $it i32)
  (local $prev i32)
  (local $next i32)

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))
  (local.set $hash (call $wax::_map_hash_i (local.get $num_buckets) (local.get $key)))
  (local.set $it (call $wax::_map_get_bucket (local.get $m) (local.get $hash)))

  (local.set $prev (i32.const 0))

  loop $loop_map_remove_i
    (if (i32.eqz (local.get $it))(then)(else
      (if (call $wax::_map_cmp_key_i (local.get $it) (local.get $key) )(then
        (local.set $next (call $wax::_mapnode_get_next (local.get $it)))

        (if (i32.eqz (local.get $prev)) (then
          (call $wax::_map_set_bucket (local.get $m) (local.get $hash) (local.get $next))
        )(else
          (call $wax::_mapnode_set_next (local.get $prev) (local.get $next))
        ))
        (call $wax::free (local.get $it))
        (call $wax::_map_inc_length (local.get $m) (i32.const 1))
        return
      ))
      (local.set $prev (local.get $it))
      (local.set $it (local.get $next))
      (br $loop_map_remove_i)
    ))
  end
)


;; generate a new iterator for traversing map pairs
;; in effect, this returns a pointer to the first node
(func $wax::map_iter_new  (param $m i32) (result i32)
  (local $num_buckets i32)
  (local $i i32)
  (local $node i32)

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))

  (local.set $i (i32.const 0))
  loop $loop_map_iter_new
    (local.set $node (call $wax::_map_get_bucket (local.get $m) (local.get $i)))
    (if (i32.eqz (local.get $node))(then)(else
      (local.get $node)
      return
    ))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $loop_map_iter_new (i32.lt_u (local.get $i) (local.get $num_buckets) ))
  end
  (i32.const 0)
  return
)

;; increment an interator for traversing map pairs
;; in effect, this finds the next node of a given node, by first looking
;; at the linked list, then re-hashing the key to look through the rest of the hash table
(func $wax::map_iter_next (param $m i32) (param $iter i32) (result i32)
  (local $next i32)
  (local $num_buckets i32)
  (local $node i32)
  (local $i i32)

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))

  (local.set $next (call $wax::_mapnode_get_next (local.get $iter)))

  (if (i32.eqz (local.get $next))(then

    (local.set $i (i32.add (call $wax::_map_hash_h
      (local.get $num_buckets)
      (call $wax::_mapnode_get_key_ptr  (local.get $iter))
      (call $wax::_mapnode_get_key_size (local.get $iter))
    ) (i32.const 1)))


    (if (i32.eq (local.get $i) (local.get $num_buckets)) (then
      (i32.const 0)
      return
    ))

    loop $loop_map_iter_next
      (local.set $node (call $wax::_map_get_bucket (local.get $m) (local.get $i)))
      (if (i32.eqz (local.get $node))(then)(else
        (local.get $node)
        return
      ))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $loop_map_iter_next (i32.lt_u (local.get $i) (local.get $num_buckets) ))
    end

    (i32.const 0)
    return

  )(else
    (local.get $next)
    return
  ))
  (i32.const 0)
  return
)

;; given a map iterator, get a pointer to the key stored
(func $wax::map_iter_key_h (param $iter i32) (result i32)
  (call $wax::_mapnode_get_key_ptr (local.get $iter))
)
;; given a map iterator, read the key stored as an int
;; only works if your key is an i32
(func $wax::map_iter_key_i (param $iter i32) (result i32)
  (i32.load (call $wax::_mapnode_get_key_ptr (local.get $iter)))
)
;; given a map iterator, get a pointer to the value stored
(func $wax::map_iter_val (param $iter i32) (result i32)
  (i32.load (call $wax::_mapnode_get_val_ptr (local.get $iter)))
)

;; remove all key-values in the map
(func $wax::map_clear (param $m i32)
  (local $num_buckets i32)
  (local $hash i32)
  (local $it i32)

  (local $next i32)

  (local.set $num_buckets (call $wax::_map_get_num_buckets (local.get $m)))

  (local.set $hash (i32.const 0))

  loop $loop_map_clear_buckets

    (local.set $it (call $wax::_map_get_bucket (local.get $m) (local.get $hash)))

    loop $loop_map_clear_nodes
      (if (i32.eqz (local.get $it))(then)(else
        (local.set $next (call $wax::_mapnode_get_next (local.get $it)))

        (call $wax::free (local.get $it))

        (local.set $it (local.get $next))
        (br $loop_map_clear_nodes)
      ))
    end

    (call $wax::_map_set_bucket (local.get $m) (local.get $hash) (i32.const 0))

    (local.set $hash (i32.add (local.get $hash) (i32.const 1)))
    (br_if $loop_map_clear_buckets (i32.lt_u (local.get $hash) (local.get $num_buckets)))

  end
)

;; free all allocated memory for a map
(func $wax::map_free (param $m i32)
  (call $wax::map_clear (local.get $m))
  (call $wax::free (local.get $m))
)
;;=== WAX Standard Library END   ===;;

)
