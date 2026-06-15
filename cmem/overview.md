# Overview — universalWasmLoader-rs

## What this is

The **Rust port** of the Universal WASM Loader reference (JavaScript) implementation. It loads a
`.wasm` module together with its companion `.wit` interface file and applies WIT-derived
**Canonical ABI translation** automatically, so a Rust host can call WASM exports with native Rust
types (numbers direct, strings/bools marshalled) without writing any `wasmtime` glue by hand.

- **Crate:** `universal-wasm-loader` (`Cargo.toml`), version `0.1.0`, license MIT.
- **Language / runtime:** Rust (edition 2021), backed by the **`wasmtime` crate, pinned at v28**.
- **Registry:** published to **crates.io**.
- **Ecosystem role:** **Stage 2** of the polyglot WASM ecosystem — ports the JS reference to Rust
  (alongside the Python port) to prove the cross-language `SPEC.md` is implementable before further
  language ports. The JS repo is the source of truth for any cross-language behavioral question.

## Source layout (the `src/*.rs` that are the real implementation)

| File | Role |
| --- | --- |
| `src/lib.rs` | Public API: `wasm_load`, `wasm_import`, `create_singleton`, `InstancePool`, `ModuleExports`, `Callbacks`, the `wasm_interface!` macro, and the internal `AbiKind` (Component / Wasic) |
| `src/abi.rs` | ABI translation: import linker (`link_import_env`) + export callers (`call_wasic_export`, `call_component_export`, `call_raw_export`); `WasmVal` value enum; `HostCallback` type |
| `src/wit_parser.rs` | Regex-based WIT parser (no parser deps); each `WitFunc` carries three name forms — `name` (kebab), `camel_name` (the actual WASM export name), `snake_name` (the Rust API key) |
| `src/types.rs` | Type-conversion traits (`IntoWasmVal`/`FromWasmVal`/`WasmArgs`/`FromWasmArgs`) and `host_fn` helper |
| `tests/spec_tests.rs` | 24-assertion suite |

Fixtures in `tests/` are `wasmtk modc` (Phase 50 bindgen) outputs: `math_50`, `booleans_50`,
`strings_50`, `imports_50` (each `.wasm` + `.wit`). Do not hand-edit fixtures.

## Public API surface (Rust equivalent of the reference loader)

- **`wasm_load(path, callbacks?) -> Result<ModuleExports>`** — synchronous load+compile (file paths
  only); no async in user space. This is the primary entry point.
- **`wasm_import(source, callbacks?) -> Future<Result<ModuleExports>>`** — async; the equivalent of
  the reference `wasmImport`. Required for `http://`/`https://` URL sources (does IO first, then
  `spawn_blocking` for compilation); also works for file paths in an async context. Supports `@N`
  version pinning (asserts the module's `version` i32 global equals N).
- **`create_singleton(path, callbacks?) -> impl Fn() -> Result<ModuleExports>`** — the
  `createSingleton` equivalent; loads once via `once_cell::sync::OnceCell`, returns a clone of the
  same `Arc`-backed instance on each call. `ModuleExports::ptr_eq` verifies identity.
- **`InstancePool::new(path, callbacks?, size) -> Future<Result<InstancePool>>`** — the
  `InstancePool` equivalent; pre-instantiates N independent instances (each its own linear memory).
  `run(fn)` acquires via a `tokio::sync::Semaphore`, calls, and releases (even on `Err`).
- **`wasm_interface! { pub struct Name { fn method(args) -> R; } }`** — generates a typed struct
  handle; `Name::load(path, callbacks?)` is synchronous.
- **On `ModuleExports`:** `call(name, args)`, `bind::<Args,R>(name)`, `call_dyn(name, &[WasmVal])`,
  `ptr_eq(other)`. Public API keys are **snake_case** (e.g. `"is_positive"`); the loader resolves
  the camelCase WASM export name via `WitFunc::camel_name`.
- **`Callbacks`** builder: `on(name, closure)` (typed) / `on_raw(name, HostCallback)`. Keys are
  **camelCase** WIT import names (e.g. `"envMul"`).
- **`WasmVal`** — decoded value enum (`I32`/`I64`/`F32`/`F64`/`Bool`/`Str`/`Void`).

## ABI / Canonical ABI implementation

ABI kind is **auto-detected** from the module's exports: `cabi_realloc` present → `Component`
(Canonical ABI); otherwise → `Wasic`. Not exposed in the public API.

- **String params (both profiles):** encode `(ptr, len)` — wasic allocates via `__malloc(len)`;
  component allocates via `cabi_realloc(0,0,1,len)`. Bytes written into linear memory, `(ptr,len)`
  passed as two i32 args.
- **Bool:** `true → 1` / `false → 0` on input; `!= 0 → true` on return. Numerics pass through.
- **Imports:** host callbacks registered into a `Linker<()>` under the `"env"` namespace before
  instantiation; memory resolved from `caller.get_export("memory")` at call time.

### ✅ SPEC conformance status — ALIGNED TO SPEC 3.0.0 (2026-06-15, VERIFIED)

The cross-language `SPEC.md` is at **v3.0.0 (2026-06-15)** — a **BREAKING** change. String /
aggregate **RETURNS** moved from the old **caller-allocated out-parameter** convention to the
**canonical callee-allocated** convention: the export returns an i32 pointer to a
callee-allocated `[ptr, len]` pair, and the host reads that pair then calls a paired
**`cabi_post_<name>(retArea)`** export to release the returned memory.

**This port now implements the SPEC 3.0.0 convention** (Component / Canonical profile):

- **`src/abi.rs`, `call_component_export` (string-return branch).** Calls the export with ONLY the
  encoded params (no trailing return area), captures the returned `i32` (`ret_area`), reads the
  little-endian `[ptr, len]` pair from that pointer, decodes the UTF-8 bytes into an owned `String`
  (the copy keeps it valid past the release), then calls `cabi_post_<camel_name>(ret_area)` —
  looked up via `instance.get_typed_func::<i32, ()>` and **skipped if absent**.
- **`src/abi.rs`, `wit_to_wasm_results`.** A `string` return now derives a single `i32` wasm
  result type (was an empty result / void-with-out-param).
- **String PARAMS unchanged** — UTF-8 → `cabi_realloc(0,0,1,len)` → write → pass `(ptr, len)`.
- **Wasic profile unchanged** — `call_wasic_export` still reads `__str_ret_ptr` / `__str_ret_len`
  globals; that is a separate code path and the SPEC return-ABI change does not touch it.

**Fixture:** `tests/strings_50.{wasm,wit}` re-sourced from the new-ABI wasmtk bindgen fixture
(`greet`/`shout` now `(result i32)` with companion `cabi_post_greet` / `cabi_post_shout` exports).
`math_50` / `booleans_50` / `imports_50` unchanged.

**The bundled reference `upstream/universalWasmLoader-js/SPEC.md` has been refreshed to v3.0.0**
(header + §4 return-marshalling table + §5 callee-allocated string-return steps). NOTE: the bundled
`upstream/.../abi.js` JS source itself is still the v2.0.0 snapshot (old out-param) and was not
rewritten — it is a vendored reference, not built/run here.

**Verification:** `cargo test` (wasmtime v28 crate present) → **24/24 spec assertions pass**,
including the three string conformance tests (`str_greet` → `Hello, World!`, `str_shout` → `hihi`,
`str_len` → `5`) and `interface_strings`, against the new fixture under the new ABI.

## Tests & build/release

- **Test command:** `cargo test`. Current status: **24/24 assertions pass** (`tests/spec_tests.rs`).
  Covers numeric passthrough, bool normalization, string params+returns, host-import callbacks,
  singleton identity, pool acquire/release, `bind`, and `wasm_interface!`. All tests are sync
  `#[test]` except the two `InstancePool` tests which are `#[tokio::test]`.
- **Build:** no build step beyond cargo — `src/*.rs` are the source of truth.
- **Release flow:** standard cargo publish to crates.io (version in `Cargo.toml`).

## Notable invariants / traps (carried from CLAUDE.md)

- **Look up exports by `camel_name`, never `snake_name`** — mixing them produces "export not found".
- **`wasmtime` v28 pinned:** `Val::unwrap_f32()/unwrap_f64()` return the native float directly — do
  not wrap with `from_bits()`. Don't upgrade wasmtime without re-checking.
- **`once_cell::sync::OnceCell`** is used for the singleton (`OnceLock::get_or_try_init` is nightly).
- **`reqwest::blocking` must not run inside `spawn_blocking`** — URL fetch is done async in
  `wasm_import` before the `spawn_blocking` compile step.
- Import callbacks: resolve memory via `caller.get_export("memory")` inside the closure — never
  pre-capture a memory handle (wasmtime ownership prevents safe pre-capture).
