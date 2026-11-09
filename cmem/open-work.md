# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- ⬜ **Release 1.0.3** (owner, 2026-11-09: "commit, push then release"). A patch: everything
  since `v1.0.2` is `.github/` (the Bun-download retry, `bd80a0d`) and `cmem/`. Neither is in the
  package, so the crate's code equals 1.0.2's. Its run is the first on GitHub with the retrying
  download (`--retry-all-errors`, needs curl ≥ 7.71 on the runner). Read back: run green in all
  three jobs, crates.io `max_version` 1.0.3, GitHub Release `v1.0.3` created by the script.

- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
