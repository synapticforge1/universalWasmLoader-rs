# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- ⬜ **Read back the 1.0.0 release** (owner, 2026-11-08: "yes release 1.0.0"; SPEC 4.0.0,
  workspace C29): the first run of the three-job `publish.yml` (C30 / C34, [overview.md](overview.md)
  § Release flow) green in every job; crates.io `max_version` 1.0.0; GitHub Release `v1.0.0`.
  Until then the split is unmeasured on GitHub.
- 🟡 **`scripts/release.ts` force-moves the tag** (`git tag -f`, `git push -f origin <tag>`,
  inherited from `release.sh`, ported unchanged 2026-10-26 under the proof rule). A tag publishes
  and a published crate version is immutable (★ 7.11), so re-running a release after a publish
  would move a tag away from what crates.io shipped. Fix: refuse when the tag already exists
  locally or on `origin`. A behaviour change — its own commit, inverted.
- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
