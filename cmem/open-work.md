# open-work.md — the ONE list of what is outstanding

Only open items; each points at its record. Closed items leave (git keeps them).

- 🟡 **`scripts/release.ts` force-moves the tag** (`git tag -f`, `git push -f origin <tag>`,
  inherited from `release.sh`, ported unchanged 2026-10-26 under the proof rule). A tag publishes
  and a published crate version is immutable (★ 7.11), so re-running a release after a publish
  would move a tag away from what crates.io shipped. Fix: refuse when the tag already exists
  locally or on `origin`. A behaviour change — its own commit, inverted.
