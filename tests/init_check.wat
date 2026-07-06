;; SPEC §10 fixture: a reactor-style module whose `_initialize` sets a global.
;; Proves the loader calls `_initialize` once after instantiation — `getValue`
;; returns 0 if it was NOT called, 99 if it was. No companion .wit → raw-exports path.
(module
  (memory (export "memory") 1)
  (global $g (mut i32) (i32.const 0))
  (func (export "_initialize")
    (global.set $g (i32.const 99)))
  (func (export "getValue") (result i32)
    (global.get $g))
)
