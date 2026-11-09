# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- ⬜ **The next tag run measures the REST release step** (workspace H30, 2026-11-09): the
  `release` job's clone, the sha256-pinned Bun 1.4.4 and `scripts/github-release.ts` have run only
  locally (real GitHub read-only + a mock API; [overview.md](overview.md) § Release flow). Read
  back: run green in all three jobs, the GitHub Release created by the script.


- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
