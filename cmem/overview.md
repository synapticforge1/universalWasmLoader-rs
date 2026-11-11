# Overview — universalWasmLoader-rs

## What this is

The **Rust port** of the Universal WASM Loader reference (JavaScript) implementation. It loads a
`.wasm` module together with its companion `.wit` interface file and applies WIT-derived
**Canonical ABI translation** automatically, so a Rust host can call WASM exports with native Rust
types (numbers direct, strings/bools marshalled) without writing any `wasmtime` glue by hand.

- **Crate:** `universal-wasm-loader` (`Cargo.toml`), version `1.0.4` (SPEC 4.0.1; on crates.io
  and as GitHub Release `v1.0.4`, 2026-11-09, both read back; 1.0.0 = the SPEC 4.0.0 release;
  history under Tests & build/release),
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
    Since the 2026-11-10 `publish.yml` rewrite no `jrmarcum` string is left outside `cmem/`
    (`git grep`, measured).
  - **Publishing path (letter H20, 2026-10-26; changed 2026-11-10 by the owner's D2):** until
    1.0.4, crates.io publishing used a repo secret API token (`CARGO_REGISTRY_TOKEN`). From the
    next release it is **crates.io trusted publishing (OIDC)**: the trusted publisher is created
    on crates.io under the `synapticforge1` repository (an owner setting, [release.md](release.md)
    § How a release runs), and the secret is then deleted.
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
| `src/wit_parser.rs` | STRICT WIT parser (SPEC 4.0.0 §2, since 2026-11-08), a port of -js `wit-parser.js` 2.0.0 with the same grammar and fault messages; `parse_wit` returns `Result<ParsedWit>` (was infallible and loose: `u32` → `s32`, a comma-less param dropped). Each `WitFunc` carries three name forms — `name` (kebab), `camel_name` (the actual WASM export name), `snake_name` (the Rust API key) |
| `src/types.rs` | Type-conversion traits (`IntoWasmVal`/`FromWasmVal`/`WasmArgs`/`FromWasmArgs`) and `host_fn` helper |
| `src/wasi.rs` | **SPEC §10.2** minimal WASI-P1 shim: `link_wasi_shim(&mut Linker<()>)` registers the small `wasi_snapshot_preview1` subset via `linker.func_wrap` (`fd_write`→stdout/stderr, `proc_exit`, `random_get`, `clock_time_get`, environ/args, `fd_close`/`fd_seek`/`fd_fdstat_get`). Hand-rolled on the existing `Store<()>` — deliberately **avoids** `wasmtime-wasi`/`WasiP1Ctx` (which would force `Store<WasiP1Ctx>`); minimal-invasiveness choice |
| `tests/spec_tests.rs` | 26-assertion suite (incl. 2 §10 tests) |
| `tests/refusals.rs` | SPEC 4.0.0 §8 "Refusals", 28 tests; scratch `.wit` files in a temp dir (never `tests/`, the stamp); http rows on a hand-rolled tokio `TcpListener` server (127.0.0.1, request counter per target, a `Stall` route) — no new dev-dependency |
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
- **`wasm_import_with_options(source, callbacks?, LoadOptions)`** (2026-11-08, SPEC 4.0.0 §1/§11)
  — `wasm_import` = this with `LoadOptions::default()`. `LoadOptions` (opaque, builder):
  `DEFAULT_TIMEOUT` 30 s, `.timeout(d)` (zero → load error), `.no_timeout()`,
  `.cancel_token(CancelToken)`. `CancelToken` is the crate's own (`AtomicBool` + `tokio::Notify`;
  `tokio-util` was not in the lock and is not added): `new`, `cancel`, `is_cancelled`. One limit
  per fetch covers request → last byte (`tokio::time::timeout` around send + `bytes()`); a
  `reqwest::Client` with no limits of its own. `wasm_load` / `create_singleton` / `InstancePool`
  are file-only, so they take no options (n/a, as -c / -dotnet / -go).
- **`SPEC_VERSION: &str`** (added for 0.2.0, 2026-10-26) — the SPEC version implemented, `"4.0.1"`
  since 2026-11-09 (`"4.0.0"` from 2026-11-08, `"3.0.0"` before). 4.0.1 (-js `ac1de68`) is a
  clarification with no behaviour change here: §11.1 lets a port whose options cannot tell zero
  from "unset" (Go) read a zero limit as 30 s, and names Rust's `Option` among the ports that
  keep refusing zero. This crate refuses zero (`a_zero_time_limit_is_an_error`), as before.
  **Found by the gate:** `bump.ts patch` for 1.0.4 REFUSED with "SPEC_VERSION is 4.0.0 but the
  reference SPEC.md (-js origin/main) is 4.0.1", before writing anything.
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

### ✅ SPEC 4.0.0 — loud failures (2026-11-08, workspace letters H29 / C29; commit `3ade569`, released in 1.0.0)

The SPEC is -js's 4.0.0 (released with -js 2.0.0 on 2026-11-07). What 0.2.0 did, MEASURED with
the new `tests/refusals.rs` on v0.2.0's `src/` (scratch crate; the 4 options tests cannot compile
there): **20 red, 4 green** — the green 4 are behaviours 0.2.0 already had (absent `.wit` → raw,
HTTP 404/410 `.wit` → raw, a callback's `Err` reaches the caller, a typed http load). Item by item:

| Rule | 0.2.0 | now |
| --- | --- | --- |
| §2 absent vs failed | ANY `.wit` read failure → raw (`.ok()`); http `.wit` non-2xx / network error → raw; the `.wasm` fetched FIRST; `set_extension("wit")` made `math.bin` read `math.wit`; a `?query` kept on the `.wit` URL | `.wit` first; raw only on `NotFound`, HTTP 404 / 410, or a path not ending in `.wasm` (case-insensitive); else `cannot read .wit` / `HTTP <status> for <url>` / not UTF-8, before the `.wasm`; query + fragment dropped |
| §2 strict parsing | regex, never failed (garbage → empty world → typed module with no exports) | `parse_wit` → `Result`; `invalid .wit '<path or url>': <fault>`; a WIT export the module lacks fails the load (`check_exports`, after instantiation) |
| §4 callbacks | missing → `default_wasm_val` (0 / false / ""); result coerced (`I32` for bool, `F64` for anything, else `I32(0)`) | all missing named at load, before the `.wasm` (`check_imports`); `string`-result import refused at load; result kind EXACT (`F32` for `-> f64` refused), error names callback / import / type / value; void import ignores the value. Promise row: n/a by type — `HostCallback` returns `Result<WasmVal>` and no future implements `IntoWasmVal` |
| §4 typed calls | `zip` silently dropped extra args; bool param `unwrap_or(false)` | `check_args`: count + exact kind, naming export / parameter / WIT type; the result accessor (`call::<_, R>`) already refused a wrong kind, now names the export |
| §11 time limit | none: a stalled `.wit` server MEASURED still waiting after 5 s (scratch probe) | 30 s default per fetch, `LoadOptions`, `CancelToken`; one request per file |

Beyond the letter: `@N` now takes ASCII digits only (SPEC §3; `parse::<i32>` took `+5` / `-1`);
a `version` global that is not i32 is an error (was a panic in `unwrap_i32`); a string write past
linear memory is an error (was a slice panic). Inverted on the new code with mutants in a scratch
copy: "cancel ignored" → exactly the already-cancelled test red; "`.wit` non-2xx → raw" + "zero
limit allowed" → exactly those 2 tests red. Not inverted by mutant: the stall-timeout and
cancel-during-stall tests (a mutant would hang); the 0.2.0 stall measurement stands in.

### SPEC 3.0.0 conformance (2026-06-15, VERIFIED) — still holds under 4.0.0

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
day to -js `origin/main` `bcab4b4` (SPEC 3.0.0, 3.x `abi.js`, `wasi.js`), and on 2026-11-08 to
`8d5af30` (SPEC 4.0.0, -js 2.0.0 = tag `v2.0.0` `1169ab9` + memory commits), and on 2026-11-09
to `3a36d1e` (SPEC 4.0.1). Never hand-edit it —
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

- **Test command:** `cargo test`. Status 2026-11-08: **66 green** — 2 parser unit tests + 1
  fixture stamp + 28 refusals (`tests/refusals.rs`) + 26 spec (`tests/spec_tests.rs`) + 1
  SPEC-version + 8 doc-tests (2026-10-26: 35). Covers numeric passthrough, bool normalization, string params+returns, host-import
  callbacks, singleton identity, pool acquire/release, `bind`, `wasm_interface!`, and the 2 §10 tests.
  All tests are sync `#[test]` except the two `InstancePool` tests which are `#[tokio::test]`.
- **Build:** no build step beyond cargo — `src/*.rs` are the source of truth.
- **Releases: see [release.md](release.md)** (🔒 the ONE record, owner 2026-11-10, workspace H33
  D3): how a release runs — `bun scripts/bump.ts <level>` (commits `bump to vX.Y.Z`), then
  `bun scripts/release.ts` (pushes `main` only), then CI: checks → tag → Release page → crates.io
  trusted publishing — and § "Release History", newest first (1.0.4 … 0.1.0). The detailed records
  that stood here until 2026-11-10 (the bump / release scripts' measurements, the C30 / H30 / H32
  workflow steps, each release's read-backs) are summarised there; their full text is in git
  (`git show 3fa32fa:cmem/overview.md`).
- **Scripts are TypeScript on Bun** (workspace Tooling rule 1 / letter H15): `scripts/bump.ts`,
  `release.ts`, `compat.ts` (the release-mode gate, shared by bump, release and CI),
  `github-release.ts` (state / tag / page), `crates-io.ts` (has / token / revoke / readback), and
  their tests (`bun test scripts/`).
- **Measured facts kept from the old records:** cargo-semver-checks 0.51.0 sees breaks only (an
  addition floors at patch) and has no lint for a changed return type (`parse_wit` →
  `Result`, 2026-11-08 — the SPEC check set that major); the previous-tag-tests check caught a
  "bool decode `!= 0` → `== 0`" mutant semver-checks could not see (2026-10-26); the 0.1.1 run
  showed a repo secret does not survive an org transfer (2026-10-21) — moot since D2 retires it.

## Notable invariants / traps (carried from CLAUDE.md)

- **Look up exports by `camel_name`, never `snake_name`** — mixing them produces "export not found".
- **`wasmtime` v28 pinned:** `Val::unwrap_f32()/unwrap_f64()` return the native float directly — do
  not wrap with `from_bits()`. Don't upgrade wasmtime without re-checking.
- **`once_cell::sync::OnceCell`** is used for the singleton (`OnceLock::get_or_try_init` is nightly).
- **`reqwest::blocking` must not run inside `spawn_blocking`** — URL fetch is done async in
  `wasm_import` before the `spawn_blocking` compile step.
- Import callbacks: resolve memory via `caller.get_export("memory")` inside the closure — never
  pre-capture a memory handle (wasmtime ownership prevents safe pre-capture).
