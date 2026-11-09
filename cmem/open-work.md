# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- ⬜ **The next tag measures H32's release job on GitHub** (2026-11-09): `checks` running
  `bun test scripts/`, and `release` fetching the script alone at `github.sha` (no checkout), with
  the crates.io link, the draft check and the second peel ([overview.md](overview.md) § Release
  flow). Read back: every step green; the page's `author.login` = `github-actions[bot]`, the
  crates.io link on top, the tag unmoved. Then write that into workspace row H32.

- 🟡 **Previous-tag tests and the SPEC check run in `bump.ts` only, not in CI** (CI clones
  `--depth=1` without tags or the reference clone). CI repeats `cargo semver-checks` and runs
  `tests/spec_version.rs`; the bump is the gate for the other two.
