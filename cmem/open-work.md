# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- 🗓️ **OWNER: finish 1.0.2's GitHub Release** (workspace H30). crates.io has 1.0.2, but run
  42567711837's `release` job failed at the Bun download (a GitHub 504; [overview.md](overview.md)
  § Release flow, the 1.0.2 entry). In the web UI: Actions → that run → **"Re-run failed jobs"**.
  That re-runs only `release`, which waits for crates.io (instant), installs Bun and runs
  `scripts/github-release.ts`. It measures the H30 step on GitHub for the first time. Read back
  afterwards: the release job green, a GitHub Release `v1.0.2`. (Creating the release by hand in
  the web UI instead would leave the script unmeasured until the next release.)


- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
