# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- 🗓️ **OWNER: release SPEC 4.0.0** (workspace C29). Branch `spec-4.0.0`, local only, NOT merged,
  pushed or bumped. **Version decision: MAJOR → 1.0.0.** This repo's gate refuses a lower bump for
  a break even at 0.x (`bump.ts` header; `parse_wit`'s signature changed, SPEC 3.0.0 → 4.0.0), so a
  pre-1.0 minor (0.3.0, the choice of -dart / -dotnet / -go / -jvm) would need the owner to change
  that rule. At the bump: README's two `universal-wasm-loader = "0.2"` lines move to the new
  version, and the README `_next release_` row is stamped. Record: [overview.md](overview.md)
  § SPEC 4.0.0.
- 🗓️ **OWNER: C30 — the publish job holds both credentials while running third-party code**
  (read 2026-11-08, reasoned, not measured). `publish.yml` is ONE job with `contents: write`; the
  token is embedded in the `git clone` URL, so it sits in `.git/config`. The same job runs
  `cargo build` / `cargo test` (dependencies' `build.rs` and proc macros execute), compiles
  `cargo-semver-checks` from crates.io, and installs rustup by `curl | sh` with no pinned version.
  Then `cargo publish` runs with `CARGO_REGISTRY_TOKEN` in its env, and publish VERIFIES by
  building the packaged crate again: third-party build scripts run with the registry token in their
  environment. Proposed (loader-dart `cb7bc26` / -go `2ff71ef` / -jvm as models): a `checks` job
  (`contents: read`, tokenless clone, build + test + semver gate) and a `publish` job that refuses
  unless the tag is still `github.sha`, runs `cargo publish --no-verify` (the build was verified in
  `checks`) with the token only in that step, and a `release` job (`contents: write`, no build)
  for `gh release create`; pin the toolchain version. Not changed without the owner.
- 🟡 **C34's analogue (crates.io):** `cargo publish` uploads, then waits for the index. A failure
  after the upload leaves the version on crates.io with the job red, so the GitHub Release step is
  skipped, and crates.io never accepts the number again, so a re-run fails "already exists".
  Fix with the C30 split: the `release` job runs when crates.io answers 200 for the version
  (`https://crates.io/api/v1/crates/universal-wasm-loader/<v>`), not on the publish step's success.
- 🟡 **`scripts/release.ts` force-moves the tag** (`git tag -f`, `git push -f origin <tag>`,
  inherited from `release.sh`, ported unchanged 2026-10-26 under the proof rule). A tag publishes
  and a published crate version is immutable (★ 7.11), so re-running a release after a publish
  would move a tag away from what crates.io shipped. Fix: refuse when the tag already exists
  locally or on `origin`. A behaviour change — its own commit, inverted.
- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
