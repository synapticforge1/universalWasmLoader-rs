# Overview — universalWasmLoader-rs

## What this is

The **Rust port** of the Universal WASM Loader reference (JavaScript) implementation. It loads a
`.wasm` module together with its companion `.wit` interface file and applies WIT-derived
**Canonical ABI translation** automatically, so a Rust host can call WASM exports with native Rust
types (numbers direct, strings/bools marshalled) without writing any `wasmtime` glue by hand.

- **Crate:** `universal-wasm-loader` (`Cargo.toml`), version `1.0.1` (SPEC 4.0.0; published
  2026-11-09T02:58Z UTC, read back; 1.0.0 = the SPEC 4.0.0 release; history under Tests & build/release),
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
- **`SPEC_VERSION: &str`** (added for 0.2.0, 2026-10-26) — the SPEC version implemented, `"4.0.0"`
  since 2026-11-08 (was `"3.0.0"`).
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
`8d5af30` (SPEC 4.0.0, -js 2.0.0 = tag `v2.0.0` `1169ab9` + memory commits). Never hand-edit it —
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
    by its level — **MEASURED 2026-11-08 at the first SPEC change (3.0.0 → 4.0.0, branch
    `spec-4.0.0`):** `bump.ts minor --dry-run` → floor major "set by: SPEC 3.0.0 -> 4.0.0", minor
    refused, exit 1; `major --dry-run` → allowed, v0.2.0's tests 30 passed / 0 failed, exit 0.
    The branch fired ALONE: cargo-semver-checks 0.51.0 floored that diff at patch although
    `wit_parser::parse_wit` changed its return type `ParsedWit` → `Result<ParsedWit>` — it has no
    lint for a changed return type, a second blind spot beside additions. (c) After writing `Cargo.toml` it runs
    `cargo update --workspace --offline` so `Cargo.lock` carries the new version (CI is `--locked`).
  - **`bun scripts/release.ts`** — reads the `Cargo.toml` version; **refuses, before committing
    anything, when `vX.Y.Z` exists locally (`rev-parse --verify`) or on `origin`
    (`ls-remote --exit-code`: 0 exists, 2 absent, anything else → refuse: origin could not be
    asked)**; then commits any pending bump of `Cargo.toml`/`Cargo.lock`, `git tag vX.Y.Z` +
    `git push` + `git push origin vX.Y.Z` — no `-f` anywhere (★ 7.11: a tag publishes, a published
    version is immutable). Never runs `cargo publish` locally — the tag push triggers CI.
    Fixed 2026-11-08 (it force-moved the tag, inherited from `release.sh`). Proof against a
    throwaway bare remote: fresh tag → exit 0, remote tag = HEAD; re-run → refused (local);
    local tag deleted + a new commit → refused (origin), remote tag unchanged, no local tag left;
    unreachable origin → refused (ls-remote 128); the OLD script on that same state → exit 0 and
    the remote tag MOVED to the new commit (the defect).
  - **`.github/workflows/publish.yml`** — triggered on `push: tags: ["v*"]`. **`run:`-only**
    (the Actions policy under the previous `jrmarcum` owner permitted only `jrmarcum`-owned
    actions; any third-party `uses:` step → `startup_failure`, nothing runs, nothing reaches
    crates.io). **Since the 2026-10-21 move the governing policy is the `synapticforge1` org's
    — UNMEASURED here; keep `run:`-only until it is checked** (loader-dotnet's run 42441589123
    shows the org accepts hash-pinned `uses:`, but this repo needs none). Do NOT reintroduce `uses:`.
    **Since 2026-11-08 (workspace C30, owner: "C30 is required in this project") three jobs**,
    top-level `permissions: {}`:
    - `checks` {contents: read} — clone WITHOUT credentials (was `x-access-token:` in the URL, so
      the write token sat in `.git/config` beside third-party build scripts); HEAD must equal
      `github.sha`; the tag must equal `v` + the Cargo.toml version; Rust **1.99.1** pinned through
      the runner's rustup (verifies the signed manifest; was `curl | sh` of an unpinned installer
      and "stable"); build → test → `cargo install cargo-semver-checks --version 0.51.0 --locked`
      + `check-release`. All third-party code runs here.
    - `publish` {contents: read} — `git ls-remote` the tag (peeled) = `github.sha` or refuse; a
      fresh tokenless clone; probe `crates.io/api/v1/crates/universal-wasm-loader/<v>` (200 →
      skip the upload, 404 → publish, anything else → fail); `cargo publish --locked --no-verify`
      with `CARGO_REGISTRY_TOKEN` in that ONE step. `--no-verify` is the point: publish's verify
      step rebuilt the crate, running dependencies' build scripts with the registry token in env.
    - `release` {contents: write} — no build; runs when `checks` passed and `publish` was not
      cancelled, EVEN IF `publish` failed (workspace C34: a failure after the upload must not
      strand the GitHub Release); waits up to 5 min for crates.io to answer 200 for the version.
      **Since 2026-11-09 (workspace H30: no GitHub CLI, in CI too)** it then clones without
      credentials (HEAD = `github.sha`), installs Bun **1.4.4** pinned by sha256 (`bf8ccbfb…`,
      matched in Bun's SHASUMS256.txt AND loader-go's `release.yml`), and runs
      `bun scripts/github-release.ts` with `GITHUB_TOKEN`: the tag must exist on GitHub and peel
      to `github.sha` (annotated tags followed) — `POST /releases` would otherwise CREATE a missing
      tag from the default branch, which the CLI's `--verify-tag` used to refuse; an existing
      release → exit 0; else `POST /releases` {generate_release_notes} → 201, then read back.
      Until 1.0.1 this step was the CLI (`release view` / `release create --verify-tag`).
      Proof 2026-11-09 (scratch, deleted): against real GitHub read-only with `--dry-run` —
      `v1.0.1` + its commit → "already exists" 0, `v1.0.1` + 1.0.0's commit → refused 1, `v9.9.9`
      → refused 1; against a mock API (`GITHUB_API_URL`) — annotated tag peeled, dry-run and
      no-token send no POST, a 422 POST → 1, create → 201 with `Bearer` + the body then read
      back, re-run → no POST. UNMEASURED on GitHub until the next tag run.
    Checked locally 2026-11-08 (scratch scripts, deleted): Bun.YAML parses it to that graph, 0
    `uses:`, the secret in one step; the tag step against GitHub: right commit 0, wrong commit 1,
    absent tag 1; the probe: 0.2.0 → 200, 1.0.0 → 404; `cargo +1.99.1 test --locked` 66/66.
    Measured on GitHub by 1.0.0's run 42549004225 (all jobs green; release record below).
  - **`1.0.0` (2026-11-08) = SPEC 4.0.0 + the C30 workflow.** Owner: "yes release 1.0.0. yes
    merge and push". `bump.ts major` through the full gate: floor major (set by `SPEC 3.0.0 ->
    4.0.0`), v0.2.0's tests 30/30 on the new src, `Cargo.lock` = 1.0.0 (one line). README
    dependency lines `"0.2"` → `"1.0"`, Breaking Changes row stamped `1.0.0`. Release commit
    `9240b11` = tag `v1.0.0` = `origin/main` (`ls-remote`). **Run 42549004225: green in all
    three jobs and every step** — the first run of the C30 split, so it is MEASURED now (the
    pinned rustup install, the tokenless clones, the tag check, the crates.io probe, `--no-verify`
    publish, the wait-then-CLI release, replaced by the REST script since). Read back: crates.io `max_version` **1.0.0** (created
    2026-11-09T02:16:03Z UTC); GitHub Release `v1.0.0` published 02:16:12Z. As a user: a fresh
    scratch crate depending on `universal-wasm-loader = "1.0"` (resolved from the crates.io
    index) prints `SPEC_VERSION 4.0.0`, `add(3, 4) = 7`, and refuses `add("x", 1)` and
    `imports_50` without callbacks, each with its message.
  - **`1.0.1` (2026-11-08, owner: "bump the version and push and release")** — a patch carrying
    the `release.ts` fix (`afd09ca`; `scripts/` is excluded from the package, so the crate's code
    equals 1.0.0's; the packaged README gains the release note). `bump.ts patch`: floor patch,
    v1.0.0's tests 58/58 on the new src. `bump version to v1.0.1` `c74df9e` = tag `v1.0.1` =
    `origin/main`, cut by the FIXED `release.ts` (checked the tag absent, no `-f`). Run
    **42552859531** green in all three jobs (`checks` 10.5 min — wasmtime and cargo-semver-checks
    compile from source; `publish` 15 s; `release` 4 s). Read back: crates.io `max_version`
    **1.0.1** (created 2026-11-09T02:58:14Z UTC), GitHub Release `v1.0.1`.
  - **`1.0.2` (2026-11-09, owner: "bump and release")** — a patch carrying the H30 release step
    (`a8459ee`; `scripts/` and `.github/` are excluded from the package, so the crate's code
    equals 1.0.1's). `bump.ts patch`: floor patch, v1.0.1's tests 58/58. `bump version to v1.0.2`
    `027df43` = tag `v1.0.2` = `origin/main`. Run **42567711837**: `checks` and `publish` green,
    crates.io `max_version` **1.0.2** (read back). **`release` FAILED at "Install Bun"**: curl exit
    22, because GitHub's release-download service answered **504 Gateway Time-out**. Measured from
    here the same hour: the same URL gave 504, then 200 three times, while another asset of that
    release still gave 504. A GitHub-side flake, not this repo's code. So the GitHub Release
    `v1.0.2` was NOT created, and `scripts/github-release.ts` has still not run on GitHub.
    Hardening in `publish.yml`: the download retries (`--retry 6 --retry-delay 10
    --retry-all-errors`, 30 s connect, 300 s total); the sha256 check still decides what runs.
    Measured locally: four 504s, then success, `bun.zip: OK`. A re-run of the failed job uses
    the tagged commit's workflow (no retry), so it succeeds only while the download serves —
    UNMEASURED until the owner re-runs it (open-work).
  - **On crates.io: `0.1.0` (2026-06-24), `0.1.1` (2026-10-22), `0.2.0` (2026-10-26T22:53Z),
    `1.0.0` (2026-11-09T02:16Z), `1.0.1` (2026-11-09T02:58Z), `1.0.2` (2026-11-09).**
    0.2.0 = the minor that adds `SPEC_VERSION`; bumped through the full gate (floor patch,
    `v0.1.1` tests 26/26 on the new src, SPEC 3.0.0 = reference), bump commit `c8f2e11`, tag
    `v0.2.0`; run `40414680446` green on every step incl. the new compatibility gate; read back
    from the crates.io API (`max_version` 0.2.0) and the GitHub release `v0.2.0`. The first
    release from the `synapticforge1` org after the 0.1.1 secret fix; the org's Actions policy
    still unprobed for `uses:` (the workflow stays `run:`-only). Every release must bump
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
