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

### ⚠️ SPEC conformance status — NEEDS ALIGNMENT TO SPEC 3.0.0

The cross-language `SPEC.md` is now at **v3.0.0 (2026-06-15)** — a **BREAKING** change. String /
aggregate **RETURNS** moved from the old **caller-allocated out-parameter** convention to the
**canonical callee-allocated** convention: the export returns an i32 pointer to a
callee-allocated `[ptr, len]` pair, and the host must read that pair and then call a paired
**`cabi_post_<name>(retPtr)`** export to release the returned memory.

**This port predates SPEC 3.0.0 and still implements the OLD conventions:**

- **Component / Canonical profile — OLD caller-allocated out-param.** In
  **`src/abi.rs`, `call_component_export` (string-return branch, lines ~248–256)**: the host
  allocates an 8-byte return area via `cabi_realloc(0,0,4,8)`, **passes it as a trailing i32 arg**,
  calls the export (void), then reads the little-endian `[ptr, len]` pair out of that area. There is
  **no `cabi_post_<name>` call** — `cabi_post` appears nowhere in `src/`.
- **Wasic profile — globals side-channel.** In **`src/abi.rs`, `call_wasic_export` (lines ~191–201)**:
  calls the export (void) then reads `__str_ret_ptr` / `__str_ret_len` globals. (Unchanged by the
  SPEC return-ABI change, but noted for completeness.)

The bundled reference under `upstream/universalWasmLoader-js/SPEC.md` in this repo is still the
**v2.0.0** copy (header says `Version: 2.0.0`), i.e. the upstream snapshot has not been refreshed to
3.0.0 here either.

**Action for a future session:** update `call_component_export` to the SPEC 3.0.0 callee-allocated
return convention (read the returned `[ptr,len]` pointer, then invoke `cabi_post_<camel_name>`),
refresh the bundled upstream SPEC/reference, regenerate or re-source the string fixtures if their ABI
changed, and re-run `cargo test`.

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
