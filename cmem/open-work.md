# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- ⬜ **Release 1.0.2 measures the REST release step** (owner, 2026-11-09: "bump and release";
  workspace H30): the `release` job's clone, the sha256-pinned Bun 1.4.4 and
  `scripts/github-release.ts` have run only locally (real GitHub read-only + a mock API;
  [overview.md](overview.md) § Release flow). 1.0.2 is a patch: `scripts/` and `.github/` are
  not in the package, so the crate's code equals 1.0.1's. Read back: run green in all three jobs,
  crates.io `max_version` 1.0.2, the GitHub Release `v1.0.2` created by the script.


- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
