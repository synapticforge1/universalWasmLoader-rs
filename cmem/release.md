# release.md — how a release runs here, and every release (newest first)

🔒 The ONE place releases are recorded (owner, 2026-11-10; workspace letter H33 D3). Other files
point here. The workspace's uniform shape is `../../cmem/release-process.md` § 5 (slots U1–U12);
this file says how this repo fills it.

## How a release runs (since 2026-11-10, the owner's order)

The owner says **"release"** (workspace H34): memory → commit → merge into `main` → push → then
this process. The level (patch / minor / major) is the owner's; ask if it was not given.

1. **`bun scripts/bump.ts <level>`** (U1–U3) — the level is REQUIRED (no default). Refuses a dirty
   tree (untracked files count). Gate: the API floor (`cargo semver-checks` vs tag `v<current>`,
   patch → minor → major, the first accepted is the floor), the SPEC check (`SPEC_VERSION` =
   loader-js `main`'s `SPEC.md`; a SPEC change since the tag raises the floor by its level), and
   the previous tag's tests against the new `src/` (red refuses a patch / minor). Then it writes
   `Cargo.toml` + `Cargo.lock` and makes the commit **`bump to vX.Y.Z`** itself (only those two
   files, read back). `--dry-run` writes and commits nothing.
2. **`bun scripts/release.ts`** (U4) — guards: clean tree; on `main`; HEAD = `origin/main` (just
   fetched) + exactly that bump commit; the tag absent here and on `origin`; crates.io's version
   LIST without X.Y.Z (never the version's own URL before it exists — a caching registry may cache
   the miss, best-practices L3). Cold gate: `cargo build --release --locked`, `cargo test
   --locked`, `bun test scripts/`, `bun scripts/compat.ts --release`. Then ONE `git push origin
   main` (never forced), read back with `ls-remote`. **It makes no tag, ever.** `--dry-run`.
3. **CI, `.github/workflows/publish.yml`, on that push of `main`** — 🔒 "CI to check first, then
   push the tag, and then create the release page from the tag, then publish the package to the
   registry", in ONE run (a `GITHUB_TOKEN` tag starts no run, so the jobs chain by `needs:`):
   - **`checks`** {contents: read; credential-less full clone at `github.sha`} (U5): `state` —
     the version's tag absent → **new**, on this commit → **rerun**, elsewhere → **none** (an
     ordinary push; the rest is skipped); build, `cargo test`, `bun test scripts/`; for a release
     `compat.ts --release` (API floor over the previous tag, SPEC, the previous tag's tests,
     `cargo package --locked`).
   - **`tag`** {contents: write; no checkout} (U6): `github-release.ts tag` — the annotated tag
     `vX.Y.Z` on `github.sha` via `git/tags` + `git/refs`, read back; already here = done,
     elsewhere = refused.
   - **`release`** {contents: write; no checkout} (U7): `github-release.ts page` — the Release
     page FROM the tag, H32's order, the crates.io link on top, BEFORE the publish.
   - **`publish`** {id-token: write, contents: read} (U8): the tag still peels here; skip when
     crates.io already lists the version; **crates.io trusted publishing** (owner's D2) — GitHub
     OIDC (audience `crates.io`) → `POST /api/v1/trusted_publishing/tokens` → a short-lived token;
     `cargo publish --locked --no-verify`; the token revoked (`DELETE`); then the read-back,
     FATAL: crates.io serves X.Y.Z, not yanked (crates.io has no provenance attestation; serving
     the version is § 6's nearest equivalent).
   - U9: no `uses:`; Rust 1.99.1 via the runner's rustup (signed manifests), cargo-semver-checks
     0.51.0 `--locked`, Bun 1.4.4 by version + sha256; top-level `permissions: {}`;
     `concurrency` per commit, never cancelled (a per-tag group cannot exist before the tag).
4. **U10, as a user (by hand):** a scratch crate depending on `universal-wasm-loader = "X.Y"`,
   resolved from crates.io: `SPEC_VERSION`, `add(3, 4) = 7`, and the refusals (`add("x", 1)`,
   `imports_50` without callbacks).
5. **U11:** an entry below, newest first, with what changed, the run id and the read-backs.
6. **U12, on a failure:** "Re-run failed jobs" in the web UI (owner): each job skips what is done
   (`tag` = done, page = done, crates.io lists it = no upload). Never a new tag for the same code,
   never a moved tag.

**Owner items for trusted publishing (D2):** on crates.io, `universal-wasm-loader` → Settings →
Trusted Publishing → add GitHub: repository `synapticforge1/universalWasmLoader-rs`, workflow
`publish.yml` (no environment) — **done by the owner 2026-11-10** (reported; not readable from
here, so the first release measures it). After the first
release publishes through it, delete the GitHub secret `CARGO_REGISTRY_TOKEN` and revoke that
crates.io API token — nothing references it any more. ⚠️ UNMEASURED until that release: the
exchange on GitHub, and whether crates.io accepts a run started by a push of `main` (the action's
source restricts no ref; crates.io's docs page did not render, 2026-11-10). If `publish` fails
there, the fix is the setting, then U12's re-run.

### How the release path got here (dated)

- **2026-10-26** — `bump.sh` / `release.sh` ported to Bun under the proof rule (14 cases); the
  `cargo semver-checks` floor, the previous-tag tests and the SPEC check added to `bump` (H6).
- **2026-11-08** — `release.ts` refuses to move a tag (it force-moved it; `afd09ca`). C30: one
  job → `checks` / `publish` / `release`, credential-less clones, `cargo publish --no-verify`
  with the token in one step, Rust pinned.
- **2026-11-09** — H30: the page through the REST API, not the CLI. H32: the page job checks out
  nothing and keeps H32's order; per-request time limits (C40); committed tests.
- **2026-11-10** — H33 / D1 / D2: this file's process. `bump` requires the level and commits;
  `release` pushes `main` only; CI tags, pages, then publishes through trusted publishing.
  **Proof before landing (best-practices 7.22):** `bun test scripts/` 35 cases on mock APIs
  (GitHub REST, GitHub's OIDC endpoint, crates.io), 11 one-line mutants each caught by its own
  case (tag moved elsewhere, no tag read-back, rerun misreported, no page sha check, no
  existing-page stop, no time limit ×2, a listed version missed, the token printed unmasked,
  yanked accepted, no read-back polling). Read-only against the REAL GitHub and crates.io: `state`
  rerun / none / new; `tag` done / refused / would create; `page` exists / refused; `has` 1.0.4
  true, 9.9.9 false; `readback` 1.0.4 served. **A rehearsal** in a scratch clone with a scratch
  bare `origin`, 18 of 18: `bump` refused no level and an untracked file, then committed `bump to
  v1.0.5` (exactly Cargo.toml + Cargo.lock, tree clean); `release.ts` refused another branch, an
  untracked file, a commit on top, a local tag and a tag on origin, each with `origin/main`
  untouched; `--dry-run` passed the whole cold gate (`compat --release`: floor patch over v1.0.4,
  SPEC 4.0.1 = reference, v1.0.4's tests 58/58, `cargo package`); the real run pushed `main` =
  the bump, read back, NO tag; a second run refused. `compat --release` inverted: `wasm_load`
  made private → "refuses a patch bump over v1.0.4: function_missing". ⚠️ The rehearsal FOUND a
  defect, fixed in `57d21c8`: `bump.ts` sliced file names out of trimmed `status --porcelain`
  lines and refused its own change ("argo.lock"). ⚠️ Method: a rehearsal stopped mid-run left its
  clone locked ("Device or resource busy") and the next run silently reused that stale clone —
  the harness now uses a fresh directory and refuses unless the clone's HEAD is the commit under
  test. UNMEASURED on GitHub until the first release in this order.

## Release History

### 1.0.4 — 2026-11-09 (patch)

**What changed:** the Release page in H32's order (no checkout in the page job, a draft check and
a second peel after the POST, the crates.io link on top, 30 s per request) with committed tests;
`SPEC_VERSION` 4.0.0 → **4.0.1** (a § 11.1 clarification for Go; Rust keeps refusing a zero time
limit — no behaviour change). The crate's code is otherwise 1.0.3's.
**How:** the first `bump.ts patch` REFUSED on the SPEC check (reference 4.0.1, ours 4.0.0); after
the claim moved, floor patch "set by: SPEC 4.0.0 -> 4.0.1" (the SPEC branch's first patch-level
firing), v1.0.3's tests 58/58. `bump version to v1.0.4` `314a959` = tag `v1.0.4`. Run
**42680215036**, every job and step green, first attempt. **Read back:** crates.io 1.0.4
(2026-11-09T19:14:47Z); page `v1.0.4` by `github-actions[bot]`, crates.io link on top,
`releases/latest`; tag unmoved.

### 1.0.3 — 2026-11-09 (patch)

**What changed:** nothing in the crate's code; the release workflow's Bun download retries
transient failures (`bd80a0d`, after 1.0.2's 504).
**How:** floor patch, v1.0.2's tests 58/58; `45d9f59` = tag `v1.0.3`. Run **42642487686**, every
job and step green, first attempt — the first GitHub run of the retrying download and the first
all-green run of the REST page script. **Read back:** crates.io 1.0.3 (2026-11-09T15:23:58Z);
page `v1.0.3` by `github-actions[bot]`.

### 1.0.2 — 2026-11-09 (patch)

**What changed:** nothing in the crate's code; the GitHub Release page made through the REST API
instead of the GitHub CLI (H30, `a8459ee`).
**How:** floor patch, v1.0.1's tests 58/58; `027df43` = tag `v1.0.2`. Run **42567711837**:
`checks` and `publish` green (crates.io 1.0.2, read back); `release` FAILED at "Install Bun" —
GitHub's release-download service answered 504 (measured the same hour: 504, then 200 ×3). The
owner's "Re-run failed jobs" (attempt 2) was green: page `v1.0.2` by `github-actions[bot]`,
05:45:51Z, the first page made by the REST script; tag unmoved.

### 1.0.1 — 2026-11-09 (patch)

**What changed:** nothing in the crate's code; `release.ts` no longer moves a tag (refuses when
it exists locally or on origin; `afd09ca`) — the packaged README gained that note.
**How:** floor patch, v1.0.0's tests 58/58; `c74df9e` = tag `v1.0.1`, cut by the fixed script.
Run **42552859531**, every job green (`checks` 10.5 min, `publish` 15 s, `release` 4 s).
**Read back:** crates.io 1.0.1 (2026-11-09T02:58:14Z); GitHub Release `v1.0.1`.

### 1.0.0 — 2026-11-09 (major)

**What changed:** **SPEC 4.0.0, loud failures** (H29 / C29): only an ABSENT `.wit` gives raw
exports (any other `.wit` failure is an error, before the `.wasm` is fetched); a strict WIT parser
(`parse_wit` → `Result`); every WIT import needs a callback, refused at load naming all; callback
results checked exactly; typed-call arguments checked (count + exact kind, no coercion); a 30 s
limit per http(s) fetch, `LoadOptions` + `CancelToken` (`wasm_import_with_options`). Plus the C30
release workflow (credentials split across three jobs). Migration: README § Breaking Changes.
**How:** `bump.ts major`, floor major "set by: SPEC 3.0.0 -> 4.0.0" (semver-checks alone said
patch — it has no lint for a changed return type), v0.2.0's tests 30/30; `9240b11` = tag
`v1.0.0`. Run **42549004225**, every job green. **Read back:** crates.io 1.0.0
(2026-11-09T02:16:03Z UTC); GitHub Release `v1.0.0`; as a user, a fresh crate on `"1.0"` loaded
`math_50` and refused `add("x", 1)` and callback-less `imports_50`.

### 0.2.0 — 2026-10-26 (minor)

**What changed:** `pub const SPEC_VERSION` (then "3.0.0") and a test that every SPEC claim agrees
with it; the release gate (semver-checks floor, previous-tag tests, SPEC check) in `bump`.
**How:** floor patch, v0.1.1's tests 26/26, SPEC 3.0.0 = reference; bump commit `c8f2e11` = tag
`v0.2.0`. Run `40414680446`, every step green incl. the new compatibility gate. **Read back:**
crates.io `max_version` 0.2.0 (2026-10-26T22:53Z); GitHub Release `v0.2.0`.

### 0.1.1 — 2026-10-22

**What changed:** the repository moved to the `synapticforge1` org (links, `repository =`).
**How:** run `39696811741` (commit `85a2f74`): attempt 1 failed at the publish — the
`CARGO_REGISTRY_TOKEN` secret did not survive the transfer; the owner re-added it and re-ran
(attempt 2): every step green. **Read back:** crates.io 0.1.1 (2026-10-22T00:11Z, with the new
repository URL); GitHub Release `v0.1.1`.

### 0.1.0 — 2026-06-24

The first release on crates.io: the SPEC 3.0.0 port (callee-allocated string returns, the §10
`_initialize` call and WASI-P1 shim). No GitHub Release page (no tag `v0.1.0` exists on GitHub;
2026-11-09: only new tags get pages, owner).
