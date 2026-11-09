# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- ⬜ **Release 1.0.1** (owner, 2026-11-08: "bump the version and push and release"): a patch
  carrying the `release.ts` fix (`afd09ca`; `scripts/` is not in the package, so the crate's
  code is unchanged, the packaged README gains the release note). Read back: run green in all
  three jobs, crates.io `max_version` 1.0.1, GitHub Release `v1.0.1`. The first release cut by the
  fixed `release.ts`.

- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
