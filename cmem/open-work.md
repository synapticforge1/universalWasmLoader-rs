# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- 🟡 **`scripts/release.ts` force-moves the tag** (`git tag -f`, `git push -f origin <tag>`,
  inherited from `release.sh`, ported unchanged 2026-10-26 under the proof rule). A tag publishes
  and a published crate version is immutable (★ 7.11), so re-running a release after a publish
  would move a tag away from what crates.io shipped. Fix: refuse when the tag already exists
  locally or on `origin`. A behaviour change — its own commit, inverted.
- 🟡 **Compatibility gate, the two loader parts not yet built** (workspace letter H6,
  `../../cmem/open-work.md` § "the compatibility gate, per repo"): run the PREVIOUS tag's
  `tests/` against the new `src/` before a patch or minor, and assert the `SPEC.md` version the
  port claims (3.0.0). `cargo semver-checks` (the -rs part) is in `bump.ts` and CI since 2026-10-26.
