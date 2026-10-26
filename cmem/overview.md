# Overview — universalWasmLoader-rs

## What this is

The **Rust port** of the Universal WASM Loader reference (JavaScript) implementation. It loads a
`.wasm` module together with its companion `.wit` interface file and applies WIT-derived
**Canonical ABI translation** automatically, so a Rust host can call WASM exports with native Rust
types (numbers direct, strings/bools marshalled) without writing any `wasmtime` glue by hand.

- **Crate:** `universal-wasm-loader` (`Cargo.toml`), version `0.1.1` (published 2026-10-22),
  license MIT.
- **Language / runtime:** Rust (edition 2021), backed by the **`wasmtime` crate, pinned at v28**.
- **Registry:** published to **crates.io**.
- **Repository (moved 2026-10-21):** **<https://github.com/synapticforge1/universalWasmLoader-rs>**
  — transferred from the personal account `jrmarcum` to the owner-controlled org
  **`synapticforge1`** (confirmed via the GitHub API redirect on 2026-10-21). The sibling
  `universalWasmLoader-js` moved too — <https://github.com/synapticforge1/universalWasmLoader-js>
  (its own memory updated by its session). `wasmtk` moved later, on 2026-10-23
  (<https://github.com/synapticforge1/wasmtk>); the 2026-10-21 line here that said it had not was
  true then and is superseded (workspace letters H17 §3 / H25 §1).
  - **References updated in-repo 2026-10-21:** `Cargo.toml` `repository =`; `README.md` SPEC link
    and Ecosystem link to `-js`; the Actions-policy wording in `README.md` and
    `.github/workflows/publish.yml`; local `origin` of this repo and of the gitignored
    `upstream/universalWasmLoader-js` clone repointed to `synapticforge1` (`git ls-remote`
    verified). **2026-10-26:** the three `README.md` links to `jrmarcum/wasmtk` → `synapticforge1/wasmtk`.
    The only `jrmarcum` string left outside `cmem/` is the history note in the `publish.yml` comment.
  - **Publishing path after the move (letter H20, recorded 2026-10-26):** crates.io publishing uses
    a **repo secret API token** (`CARGO_REGISTRY_TOKEN`), NOT crates.io trusted publishing (OIDC).
    So no policy pins the GitHub owner/repository IDs and H20's failure mode (a locked trust policy
    rejecting the new org) does not apply; the move's only effect was the secret not surviving the
    transfer (below), already re-added. If trusted publishing is adopted later, create the policy
    under `synapticforge1` (owner's registry account).
  - Re-verified after the edits, 2026-10-21: `cargo test --locked` → 26/26 + 7 doc-tests.
  - crates.io shows the new `repository` URL only **after the next publish**.
  - The publish workflow is location-agnostic (`${{ github.repository }}`).
  - **First release after the move — `v0.1.1`, 2026-10-21 (run `39696811741`, commit
    `85a2f74`):** the `run:`-only workflow STARTED under the `synapticforge1` org (so its Actions
    policy accepts it); checkout, toolchain, release build and the test gate all passed;
    **`Publish to crates.io` failed: `CARGO_REGISTRY_TOKEN secret is not set`** — the repo secret
    did NOT survive the transfer. Owner re-added the secret and re-ran the job (attempt 2):
    **all steps green — `0.1.1` PUBLISHED to crates.io 2026-10-22T00:11Z** (crates.io now shows
    the `synapticforge1` repository URL) and GitHub release `v0.1.1` created. The job-failure
    reason is readable without auth via the public check-run annotations API
    (`/repos/<owner>/<repo>/check-runs/<job id>/annotations`).
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
| `tests/fixtures_stamp.rs` | the fixture bytes ARE the stamped reference set (sha256 vs `tests/fixtures.json`) |

**Fixtures (2026-10-26):** `tests/` holds universalWasmLoader-js's stamped reference set, copied
byte for byte from its git blobs at -js `bcab4b4` — `tests/fixtures.json` names the generator,
wasmtk `4a5c3cf668d` (`v2.0.3-64-g4a5c3cf`, on wasmtk's `origin/main`, tag `v3.0.0` — fetchable,
★ 8.10). `math_50`, `booleans_50`, `strings_50`, `imports_50`, `wasi_io_50` (`.wasm` + `.wit`) are
`wasmtk modc` output; `init_check.{wat,wasm}` is hand-written. Five `.wasm` changed from the
pre-2026-10-26 set (the `.wit` were already identical); 26/26 still pass. `fixtures_stamp.rs`
fails on a changed byte, a missing file, or an unstamped `.wasm`/`.wit`/`.wat` (each inverted
2026-10-26). Never hand-edit a fixture; re-copy the set and `fixtures.json` together when -js
re-stamps (workspace letter H7, drift L3/X8).

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
- **`SPEC_VERSION: &str`** (added for 0.2.0, 2026-10-26) — the SPEC version implemented, `"3.0.0"`.
  The ONE source for the claim: `tests/spec_version.rs` fails if `README.md` or the crate doc
  (`src/lib.rs`) claims a different "Spec vX.Y.Z" (both said v2.0.0 until 2026-10-26 while the code
  was 3.0.0); `scripts/bump.ts` refuses a bump when it differs from the reference `SPEC.md`.

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

**Fixture:** `tests/strings_50.{wasm,wit}` — `greet`/`shout` are `(result i32)` with companion
`cabi_post_greet` / `cabi_post_shout` exports (now the stamped reference set, see Source layout).

**The local reference clone `upstream/universalWasmLoader-js/`** (gitignored, not shipped) was a
2.x snapshot with a hand-edited `SPEC.md` until 2026-10-26 (drift L5); it was fast-forwarded that
day to -js `origin/main` `bcab4b4` (SPEC 3.0.0, 3.x `abi.js`, `wasi.js`). Never hand-edit it —
`git -C upstream/universalWasmLoader-js pull --ff-only` refreshes it; the sibling checkout
`../universalWasmLoader-js` is the same repository.

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

- **Test command:** `cargo test`. Status 2026-10-26: **26/26 assertions pass** (`tests/spec_tests.rs`)
  + 1 fixture-stamp test + 1 SPEC-version test + 7 doc-tests. Covers numeric passthrough, bool normalization, string params+returns, host-import
  callbacks, singleton identity, pool acquire/release, `bind`, `wasm_interface!`, and the 2 §10 tests.
  All tests are sync `#[test]` except the two `InstancePool` tests which are `#[tokio::test]`.
- **Build:** no build step beyond cargo — `src/*.rs` are the source of truth.
- **Release flow (crates.io):** version lives in **`Cargo.toml`** (`[package].version`, single
  source of truth). Bump → tag → push → CI publishes.
  - **Scripts are TypeScript on Bun** (workspace Tooling rule 1 / letter H15: Rust's
    `cargo -Zscript` builds an executable, so it does not count). `scripts/bump.sh` and
    `release.sh` were ported to `bump.ts` / `release.ts` on 2026-10-26 under the proof rule:
    14 cases run against both (11 bump incl. 3 that must fail; 3 release against a throwaway bare
    remote, comparing stdout, exit code, `Cargo.toml`, remote tags, tag tree and message) — 13
    identical after normalizing path spelling, commit ids and the new script name in the hint. The
    14th was a DEFECT in the original: with no version line `bump.sh` exited 1 SILENTLY (its error
    message was unreachable under `set -eo pipefail`); the port prints it. Details in the commit.
  - **`bun scripts/bump.ts [patch|minor|major] [--dry-run|-n]`** — raises the first
    `version = "X.Y.Z"` in `Cargo.toml` (patch is default; last kind argument wins); `--dry-run`
    prints the next version without writing. Writes temp + rename.
    **🔒 Gated (workspace letter H6, SemVer 2.0.0 + the compatibility gate, 2026-10-26):** it
    runs `cargo semver-checks check-release` against tag `v<current>` (crates.io if no tag) for
    patch, then minor, then major; the first accepted is the FLOOR, printed with the lints that
    set it; a lower bump is refused. CI repeats it on the tag (`publish.yml` step "Compatibility
    gate", registry baseline). Measured 2026-10-26: clean tree → floor patch (229 checks); mutant
    "`pub fn create_singleton` → private" → floor **major** (`function_missing`), patch and minor
    refused, and the CI form exits 100 — a break needs MAJOR even at 0.x with an explicit release
    type. Blind spot: it sees breaks only; an addition floors at patch, so minor-for-new-API is
    the releaser's call. Needs `cargo install cargo-semver-checks --locked` (0.51.0 here).
    **Also gated (2026-10-26, the loaders' part of H6):** (a) BEHAVIOUR — the tag's `tests/`
    (unmodified, its own fixtures) run against the new `src/` in a throwaway `.compat/` crate
    (gitignored, removed after); red refuses a patch or minor, a major may proceed. Measured: vs
    `v0.1.1` 26 passed; mutant "bool decode `!= 0` → `== 0`" (no API change, so semver-checks is
    blind) → 17 passed / 9 failed, minor refused, major allowed. (b) SPEC — `SPEC_VERSION` must
    equal `Version:` in -js `origin/main:SPEC.md`, read from the fetched `upstream/` clone (absent
    clone = error); mutant `3.1.0` refused. A `SPEC_VERSION` change since the tag raises the floor
    by its level — ⬜ UNMEASURED: no tag carries the const before 0.2.0, so that branch cannot fire
    yet; invert it at the first SPEC change. (c) After writing `Cargo.toml` it runs
    `cargo update --workspace --offline` so `Cargo.lock` carries the new version (CI is `--locked`).
  - **`bun scripts/release.ts`** — reads the `Cargo.toml` version, commits any pending bump of
    `Cargo.toml`/`Cargo.lock`, then `git tag -f vX.Y.Z` + `git push` + `git push -f origin vX.Y.Z`.
    Never runs `cargo publish` locally — the tag push triggers CI. 🟡 It force-moves the tag
    (inherited from `release.sh`); a tag that already published must never move (★ 7.11) —
    see [open-work.md](open-work.md).
  - **`.github/workflows/publish.yml`** — triggered on `push: tags: ["v*"]`. **`run:`-only**
    (the Actions policy under the previous `jrmarcum` owner permitted only `jrmarcum`-owned
    actions; any third-party `uses:` step → `startup_failure`, nothing runs, nothing reaches
    crates.io). **Since the 2026-10-21 move the governing policy is the `synapticforge1` org's
    — UNMEASURED; keep `run:`-only until it is checked.** Steps, all plain `run:`:
    `git clone` checkout (token-auth, `--branch ${{ github.ref_name }}`) → rustup curl installer
    (`~/.cargo/bin` appended to `$GITHUB_PATH`) → `cargo build --release --locked` →
    `cargo test --locked` (gate) → `cargo install cargo-semver-checks --locked` +
    `cargo semver-checks check-release` (compatibility gate) → `cargo publish --locked` with `CARGO_REGISTRY_TOKEN` env from
    `${{ secrets.CARGO_REGISTRY_TOKEN }}` (workflow errors out if the secret is empty) → optional
    `gh release create` (pre-installed `gh`, `run:`). Do NOT reintroduce `uses:`.
  - **On crates.io: `0.1.0` (2026-06-24) and `0.1.1` (2026-10-22).** Every release must bump
    `Cargo.toml` first (`bun scripts/bump.ts`); `Cargo.lock` must carry the same version (CI uses
    `--locked`).
  - **One-time owner setup (done; the secret was re-added after the 2026-10-21 repo move):**
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
