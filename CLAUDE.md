> **⚠️ PORTABLE PROJECT MEMORY NOW LIVES IN `cmem/`** — start at [`cmem/INDEX.md`](cmem/INDEX.md).
> When saving new project memory, write it into the matching `cmem/` topic file (and refresh its
> pointer in `cmem/INDEX.md`). The **"update the project memory"** and **"look for code issues"**
> triggers are defined in `cmem/INDEX.md` and are binding. This `CLAUDE.md` remains as the auto-loaded
> historical archive; `cmem/` is the source of truth.

# CLAUDE.md — universalWasmLoader-rs

This file is the single source of project context for AI-assisted development. Keep it up to date as the project evolves. It is gitignored — never committed.

## Project Overview

**Crate:** `universal-wasm-loader`  
**Version:** See `Cargo.toml`  
**License:** MIT  
**Spec:** `upstream/universalWasmLoader-js/SPEC.md` — cross-language contract, currently **SPEC v2.0.0**  
**Reference impl:** `upstream/universalWasmLoader-js/` — read `abi.js`, `wit-parser.js`, `universal-wasm-loader.js` before changing ABI behavior

Rust port of the universalWasmLoader reference JavaScript implementation. Backed by the `wasmtime` crate. Passes the full test suite (24 assertions) defined in `tests/spec_tests.rs`.

### Polyglot Ecosystem Context

This crate is **Stage 2** of a polyglot WASM ecosystem. Stage 2 ports the JS reference implementation to Rust (this repo) and Python to validate that SPEC.md is implementable across languages before committing to further ports. **Stage 4** (planned): Go, JVM, .NET, C.

The JS repo (`upstream/universalWasmLoader-js/`) is the reference implementation and the source of truth for any cross-language behavioral question.

### SPEC v2.0.0 Key Changes

These were implemented in this crate and represent the current interface contract:

- `WasmImportOptions` removed; replaced by `Callbacks` builder (keys are **camelCase** WIT import names, e.g. `"envMul"`)
- `AbiProfile` removed from public API; ABI (wasic vs component) auto-detected from module exports (`cabi_realloc` present → Canonical ABI)
- **WIT file not found → raw WASM fallback** — no error is raised; the module loads without WIT-derived type info
- **`@N` version pinning** — `wasm_import("path.wasm@2", ...)` asserts that the WASM `version` global equals 2 at load time
- `call_raw_export` added for no-WIT mode

## File Structure

```text
universalWasmLoader-rs/
├── Cargo.toml                  # deps: wasmtime=28, anyhow, tokio, regex-lite, once_cell, reqwest
├── src/
│   ├── lib.rs                  # Public API: wasm_load, wasm_import, create_singleton, InstancePool,
│   │                           #             ModuleExports, Callbacks, wasm_interface!
│   ├── wit_parser.rs           # Regex-based WIT parser (no deps)
│   ├── abi.rs                  # ABI translation: wasic + component export callers; import linker
│   └── wasi.rs                 # Minimal WASI-P1 shim (SPEC §10.2) — func_wrap on Linker<()>, no wasmtime-wasi dep
├── tests/
│   ├── spec_tests.rs           # 26-assertion test suite (sync except pool tests) — incl. 2 SPEC §10 tests
│   ├── math_50.wasm + .wit     # Numeric round-trip fixture
│   ├── booleans_50.wasm + .wit # Bool normalization fixture
│   ├── strings_50.wasm + .wit  # String param + return fixture
│   └── imports_50.wasm + .wit  # Host import callback fixture
├── upstream/
│   └── universalWasmLoader-js/ # Cloned reference impl (gitignored)
├── README.md
├── CLAUDE.md                   # This file (gitignored)
└── LICENSE
```

## Architecture

### Public API (`src/lib.rs`)

**Primary sync entry point (file paths only):**

- **`wasm_load(path, callbacks?) → Result<ModuleExports>`** — synchronous load + compile. No `await` in user space. Wraps `instantiate_sync` directly.

**Async entry point (file paths + URLs):**

- **`wasm_import(source, callbacks?) → impl Future<Output = Result<ModuleExports>>`** — async; does IO first (`tokio::fs` or `reqwest`), then `spawn_blocking` for CPU-bound compilation. Required for URL sources; optional for file paths.

**Typed handle macro:**

- **`wasm_interface! { pub struct Name { fn method(args) -> R; } }`** — generates a named struct wrapping `ModuleExports`. The `load` associated function is synchronous (calls `wasm_load` internally). Each method calls `self.0.call(stringify!(method_name), (args,))`.

**Singleton (sync, file-only):**

- **`create_singleton(path, callbacks?) → impl Fn() → Result<ModuleExports>`** — returns a closure that loads once via `once_cell::sync::OnceCell` and returns a clone of the same `Arc` on every call. `ModuleExports::ptr_eq` verifies same-instance identity.

**Pool (async, file-only internally):**

- **`InstancePool::new(path, callbacks?, size) → impl Future<Output = Result<InstancePool>>`** — pre-instantiates N modules via `instantiate_sync` inside `spawn_blocking`. `run(fn)` acquires via `tokio::sync::Semaphore`, calls `fn`, releases — even if `fn` returns `Err`.

**On a loaded instance:**

- **`ModuleExports::call(name, args) → Result<R>`** — dispatches to the ABI layer. Takes snake_case name (e.g. `"is_positive"`); resolves camelCase WASM export name via `WitFunc::camel_name`.
- **`ModuleExports::bind<Args, R>(name) → impl Fn(Args) -> Result<R>`** — returns a standalone callable that owns a clone of the handle and captures the export name. Useful for the destructuring pattern.
- **`ModuleExports::call_dyn(name, &[WasmVal]) → Result<WasmVal>`** — raw dynamic dispatch.
- **`ModuleExports::ptr_eq(other) → bool`** — Arc identity check for singleton tests.

**Callbacks builder:**

- **`Callbacks::on(name, closure)`** — generic; closure receives a destructured tuple and returns a native value. Types are inferred. Key is camelCase WIT import name.
- **`Callbacks::on_raw(name, HostCallback)`** — accepts a pre-built `Arc<dyn Fn(&[WasmVal]) -> Result<WasmVal>>`. Use with `host_fn(...)` when you need a stored value.

**Value types:**

- **`WasmVal`** — decoded value enum: `I32`, `I64`, `F32`, `F64`, `Bool`, `Str`, `Void`.

### WIT Parser (`src/wit_parser.rs`)

Regex-based, no dependencies. Parses the format emitted by `wasmtk` (see `upstream/universalWasmLoader-js/wit-parser.js` for the reference):

- `package local:name;` → `package_name`
- `world name { import ...; export ...; }` → `imports[]`, `exports[]`
- Each `WitFunc` carries **three** name forms — this is the most important invariant in this codebase:

  | Field | Form | Example | Used for |
  | --- | --- | --- | --- |
  | `name` | kebab-case | `"is-positive"` | WIT source identity |
  | `camel_name` | camelCase | `"isPositive"` | **Actual WASM binary export name** |
  | `snake_name` | snake_case | `"is_positive"` | **Rust public API key** |

- Import WASM namespace keys use underscore (`"env-mul"` → `"env_mul"`), which matches `snake_name` for imports.

### ABI Utilities (`src/abi.rs`)

Reference: `upstream/universalWasmLoader-js/abi.js`

**Import side — `link_import_env`:**

Registers host callbacks in a `wasmtime::Linker<()>` under the `"env"` namespace before instantiation. Memory is read from `caller.get_export("memory")` inside each callback at call time — this is the correct wasmtime pattern for the chicken-and-egg problem (memory only exists after instantiation, but imports must be registered before it). Attempting to pre-capture a memory handle requires unsafe cross-store access and does not compile cleanly under wasmtime's ownership model.

**Export side — ABI auto-detection:**

`detect_abi` iterates `module.exports()` looking for `"cabi_realloc"`. If found → `AbiKind::Component`, else → `AbiKind::Wasic`. The kind is stored in `ExportsInner` and used at call time. Never exposed in the public API.

| Function | Profile | String params | String returns |
| --- | --- | --- | --- |
| `call_wasic_export` | `"wasic"` | `__malloc(len)` → write bytes → pass `(ptr, len)` | call fn (void), read `__str_ret_ptr`/`__str_ret_len` globals |
| `call_component_export` | `"component"` | `cabi_realloc(0,0,1,len)` → write bytes → pass `(ptr, len)` | allocate 8-byte area `cabi_realloc(0,0,4,8)`, pass as trailing arg, read little-endian i32 pair |
| `call_raw_export` | (no WIT) | not supported | not supported |

Import-side encoding is identical for both profiles: WASM passes `(ptr: i32, len: i32)` for string args.

Bool encoding: `true → 1`, `false → 0` on input; `!= 0 → true` on return. Numeric types pass through as-is.

## WIT Name Conventions

| WIT source | WASM binary | Rust API |
| --- | --- | --- |
| `is-positive` (export, kebab) | `isPositive` (camelCase) | `"is_positive"` (snake_case) |
| `env-mul` (import, kebab) | `env_mul` (underscore) | `"env_mul"` (snake_case) |

**Do not use `snake_name` to look up exports in `wasmtime::Instance`.** Always use `camel_name`. Mixing these up produces "export not found" errors with no obvious cause. This is the most common trap in this codebase.

`wasmtk`'s Phase 50 bindgen converts kebab exports to camelCase in the generated WASM binary. The JS reference always used camelCase (`fn.tsName`) for both proxy keys and raw export lookups — the Rust port must match exactly.

## Test Suite

Run with: `cargo test`

Fixture `.wasm` + `.wit` pairs in `tests/` are compiled outputs of `wasmtk modc` (Phase 50 bindgen). **Do not hand-edit any fixture file** (`.wasm` or `.wit`). If regeneration is needed, copy from `upstream/universalWasmLoader-js/tests/`.

All tests are plain `#[test]` (synchronous) except the two `InstancePool` tests which are `#[tokio::test]` because `InstancePool::new` is inherently async.

| Group | Tests | WASM exports (camelCase) | What is covered |
| --- | --- | --- | --- |
| `math_50` | `math_add`, `math_multiply`, `math_square` | `add(s32,s32)->s32`, `multiply(f64,f64)->f64`, `square(s32)->s32` | numeric passthrough |
| `booleans_50` | `bool_is_positive_*`, `bool_in_range_*`, `bool_is_even_*` | `isPositive(f64)->bool`, `inRange(f64,f64,f64)->bool`, `isEven(s32)->bool` | bool normalization |
| `strings_50` | `str_greet`, `str_shout`, `str_len` | `greet(string)->string`, `shout(string)->string`, `strLen(string)->s32` | string params + returns |
| `imports_50` | `imports_scale`, `imports_combine` | `scale(f64,f64)->f64`, `combine(s32,s32)->s32` | host import callbacks (`env_mul`, `env_add`) |
| lifecycle | `singleton_same_instance`, `singleton_correct_result` | — | singleton identity |
| lifecycle | `pool_run_returns_correct_result`, `pool_concurrent_run` | — | pool acquire/release |
| `bind` | `bind_add`, `bind_multiple_exports`, `bind_bool_export` | — | standalone callable |
| `wasm_interface!` | `interface_math`, `interface_booleans`, `interface_strings` | — | typed struct handle |

All 24 pass.

## Development Notes

- **No build step** — `src/*.rs` are the source of truth; edit directly.
- **`wasmtime` v28 pinned** — `Val::unwrap_f32()` and `unwrap_f64()` return the native float type directly. Do not wrap with `f32::from_bits()` / `f64::from_bits()`. Do not upgrade without re-checking this API.
- **`once_cell` for singleton** — `std::sync::OnceLock::get_or_try_init` requires nightly (hits `E0658: use of unstable library feature once_cell_try` on stable). Use `once_cell::sync::OnceCell` from the `once_cell` crate for any fallible one-time initialization.
- **`reqwest::blocking` must not be used inside `spawn_blocking`** — it panics. URL fetching is done async in `wasm_import` before the `spawn_blocking` call. `wasm_load` and `instantiate_sync` are file-only; they use `std::fs`.
- **`wasm_interface!` uses `stringify!`** — method names must match WIT snake_case export names exactly. The macro is `#[macro_export]` so it is available at crate root.
- **Before changing ABI behavior** — read `upstream/universalWasmLoader-js/abi.js` first. The Rust port must match the JS reference exactly per the spec.
- **Import callbacks: use `caller.get_export("memory")` inside the closure** — never try to capture a pre-instantiation memory handle. The wasmtime ownership model prevents safe pre-capture; `Caller<'_, ()>` gives access to the live instance at call time.
