# Overview — universalWasmLoader-rs

## What this is

The **Rust port** of the Universal WASM Loader reference (JavaScript) implementation. It loads a
`.wasm` module together with its companion `.wit` interface file and applies WIT-derived
**Canonical ABI translation** automatically, so a Rust host can call WASM exports with native Rust
types (numbers direct, strings/bools marshalled) without writing any `wasmtime` glue by hand.

- **Crate:** `universal-wasm-loader` (`Cargo.toml`), version `0.1.0`, license MIT.
- **Language / runtime:** Rust (edition 2021), backed by the **`wasmtime` crate, pinned at v28**.
- **Registry:** published to **crates.io**.
- **Repository (moved 2026-10-21):** **<https://github.com/synapticforge1/universalWasmLoader-rs>**
  — transferred from the personal account `jrmarcum` to the owner-controlled org
  **`synapticforge1`** (confirmed via the GitHub API redirect on 2026-10-21). The sibling
  `universalWasmLoader-js` moved too — <https://github.com/synapticforge1/universalWasmLoader-js>
  (its own memory updated by its session). `wasmtk` did **NOT** move — `jrmarcum/wasmtk` is still
  correct (checked 2026-10-21); do not "fix" those README links.
  - **References updated in-repo 2026-10-21:** `Cargo.toml` `repository =`; `README.md` SPEC link
    and Ecosystem link to `-js`; the Actions-policy wording in `README.md` and
    `.github/workflows/publish.yml` (no longer claims the policy is `jrmarcum`'s); local `origin`
    of this repo and of the gitignored `upstream/universalWasmLoader-js` clone repointed to
    `synapticforge1` (`git ls-remote` verified). The only `jrmarcum` strings left outside `cmem/`
    are the `wasmtk` links and the history note in the `publish.yml` comment — both intended.
  - Re-verified after the edits, 2026-10-21: `cargo test --locked` → 26/26 + 7 doc-tests.
  - crates.io shows the new `repository` URL only **after the next publish**.
  - The publish workflow is location-agnostic (`${{ github.repository }}`).
  - **Before the next tag push (owner, on GitHub — not checkable from an unauthenticated
    session):** (1) confirm the `CARGO_REGISTRY_TOKEN` repo secret exists in the transferred
    repo; (2) check the `synapticforge1` org's Actions policy (see Release flow); (3) push the
    unpushed local commits (`cc8a5f7`, `7e39a7f`, plus this move commit) — `origin/main` was at
    `7b91b9e` on 2026-10-21.
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
| `src/wasi.rs` | **SPEC §10.2** minimal WASI-P1 shim: `link_wasi_shim(&mut Linker<()>)` registers the small `wasi_snapshot_preview1` subset via `linker.func_wrap` (`fd_write`→stdout/stderr, `proc_exit`, `random_get`, `clock_time_get`, environ/args, `fd_close`/`fd_seek`/`fd_fdstat_get`). Hand-rolled on the existing `Store<()>` — deliberately **avoids** `wasmtime-wasi`/`WasiP1Ctx` (which would force `Store<WasiP1Ctx>`); minimal-invasiveness choice |
| `tests/spec_tests.rs` | 26-assertion suite (incl. 2 §10 tests) |

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

**Verification:** `cargo test` (wasmtime v28 crate present) → **26/26 spec assertions pass** (+7
doc-tests), including the three string conformance tests (`str_greet` → `Hello, World!`, `str_shout`
→ `hihi`, `str_len` → `5`) and `interface_strings`, against the new fixture under the new ABI, plus
the two **SPEC §10** tests below.

## SPEC §10 — producer model (loader capabilities), added 2026-07-05 (`cc8a5f7`)

- **§10.1** — after `linker.instantiate(...)`, `lib.rs` calls a reactor module's `_initialize` once
  before any other export via `instance.get_typed_func::<(), ()>(&mut store, "_initialize")` (no-op
  if absent).
- **§10.2** — `wasi::link_wasi_shim(&mut linker)` (see `src/wasi.rs`) registers the minimal
  `wasi_snapshot_preview1` subset on the existing `Store<()>` before the env link, so an I/O-using
  library module (e.g. a `modc` lib that calls `console.log` → `fd_write`) loads without a native
  WASI. Chosen over `wasmtime-wasi` to keep `Store<()>` (no store-type change, no new dep).
- **Tests:** `spec10_initialize_called` (`getValue()==99` after `_initialize`) and
  `spec10_wasi_io_library_loads` (`log_and_double(21)==42`), with fixtures `init_check.wasm` +
  `wasi_io_50.{wasm,wit}` copied into `tests/`.

## Tests & build/release

- **Test command:** `cargo test`. Current status: **26/26 assertions pass** (`tests/spec_tests.rs`)
  + 7 doc-tests. Covers numeric passthrough, bool normalization, string params+returns, host-import
  callbacks, singleton identity, pool acquire/release, `bind`, `wasm_interface!`, and the 2 §10 tests.
  All tests are sync `#[test]` except the two `InstancePool` tests which are `#[tokio::test]`.
- **Build:** no build step beyond cargo — `src/*.rs` are the source of truth.
- **Release flow (crates.io):** version lives in **`Cargo.toml`** (`[package].version`, single
  source of truth). Bump → tag → push → CI publishes.
  - **`scripts/bump.sh [patch|minor|major] [--dry-run]`** — raises the first `version = "X.Y.Z"`
    in `Cargo.toml` (patch is default). Pure bash + awk (no `cargo-edit` dependency); `--dry-run`
    prints the next version without writing. `cargo set-version --bump <kind>` (cargo-edit) is an
    equivalent if preferred. NOTE: avoid `next` as an awk variable name — it is a gawk reserved
    word (the script uses `nextver`).
  - **`scripts/release.sh`** — reads the `Cargo.toml` version, commits any pending bump, then
    `git tag -f vX.Y.Z` + `git push` + `git push -f origin vX.Y.Z`. Never runs `cargo publish`
    locally — the tag push triggers CI. Mirrors the JS reference's `deno task publish`.
  - **`.github/workflows/publish.yml`** — triggered on `push: tags: ["v*"]`. **`run:`-only**
    (the Actions policy under the previous `jrmarcum` owner permitted only `jrmarcum`-owned
    actions; any third-party `uses:` step → `startup_failure`, nothing runs, nothing reaches
    crates.io). **Since the 2026-10-21 move the governing policy is the `synapticforge1` org's
    — UNMEASURED; keep `run:`-only until it is checked.** Steps, all plain `run:`:
    `git clone` checkout (token-auth, `--branch ${{ github.ref_name }}`) → rustup curl installer
    (`~/.cargo/bin` appended to `$GITHUB_PATH`) → `cargo build --release --locked` →
    `cargo test --locked` (gate) → `cargo publish --locked` with `CARGO_REGISTRY_TOKEN` env from
    `${{ secrets.CARGO_REGISTRY_TOKEN }}` (workflow errors out if the secret is empty) → optional
    `gh release create` (pre-installed `gh`, `run:`). Do NOT reintroduce `uses:`.
  - **Validation done (not published):** `scripts/bump.sh --dry-run` for patch/minor/major all
    compute correctly; a real `bump.sh patch` wrote `0.1.1` and was reverted via
    `git checkout -- Cargo.toml` (restored `0.1.0`); `cargo publish --dry-run --locked
    --allow-dirty` packaged 26 files and compiled clean, aborting upload as expected.
  - **`0.1.0` is already on crates.io** (`cargo publish --dry-run` reports "already exists on
    crates.io index", 2026-10-21) — the next release must bump `Cargo.toml` first
    (`scripts/bump.sh`). The dry run packaged 25 files with the new `synapticforge1` repository URL.
  - **One-time owner setup (done for the first publish; re-check the secret after the repo move):**
    1. **`CARGO_REGISTRY_TOKEN` GitHub repo secret** — from a crates.io API token
       (<https://crates.io/settings/tokens>, publish scope); add under repo Settings → Secrets
       and variables → Actions, named exactly `CARGO_REGISTRY_TOKEN`.
    2. **Crate name `universal-wasm-loader`** must be available (first publish) or already owned
       by the publishing crates.io account.

## Notable invariants / traps (carried from CLAUDE.md)

- **Look up exports by `camel_name`, never `snake_name`** — mixing them produces "export not found".
- **`wasmtime` v28 pinned:** `Val::unwrap_f32()/unwrap_f64()` return the native float directly — do
  not wrap with `from_bits()`. Don't upgrade wasmtime without re-checking.
- **`once_cell::sync::OnceCell`** is used for the singleton (`OnceLock::get_or_try_init` is nightly).
- **`reqwest::blocking` must not run inside `spawn_blocking`** — URL fetch is done async in
  `wasm_import` before the `spawn_blocking` compile step.
- Import callbacks: resolve memory via `caller.get_export("memory")` inside the closure — never
  pre-capture a memory handle (wasmtime ownership prevents safe pre-capture).
