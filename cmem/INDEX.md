# cmem — Portable Project Memory for universalWasmLoader-rs

> **At session start, read `../../cmem/workspace-correspondence.md`, then `../../cmem/handoffs.md`,
> for items addressed to this repo.** The workspace session reviews across the sibling repos and
> reports there; nothing is ever written into this repo from outside. (owner, 2026-09-20 / 2026-10-26)

This folder is the **authoritative, portable project memory** for `universalWasmLoader-rs`. It lives
inside the project tree, so it travels with the repo and is committed to git. Keep files small and
single-topic. Layout per the workspace `../../cmem/memory-conventions.md` (a small repo: INDEX +
overview + the files below). Machine-only facts go in the gitignored `cmem/local/`.

## Policy

- **`cmem/` is the single home for ALL project memory.** When the owner says "**update the project
  memory**," update the matching `cmem/` topic file with the latest decisions, found bugs, design
  changes, and current state — then add/refresh its one-line pointer in the table below. Convert
  relative dates to absolute; update existing entries rather than duplicating.
- **`README` and `SPEC.md` are NOT project memory.** They are the public, user-facing docs. Keep
  internal decision logs / bug post-mortems out of them — those live here in `cmem/`.
- **`CLAUDE.md` is a gitignored pointer**, never authoritative (untracked 2026-10-26, drift L2).

### The "update the project memory" trigger (binding on every agent)
When the owner says **"update the project memory"** (or a synonym — "update memory", "record this"),
do BOTH: (1) revise all relevant `cmem/` files and refresh the Files-table pointers (absolute dates;
update, don't duplicate) — and AUDIT for stale live claims: grep the old values, measure when two
files disagree; and (2) sync the user-facing README / SPEC.md only where the change is
user-relevant — never copy internal decision logs into them.

### The "look for code issues" trigger (binding on every agent)
When the owner says **"look for code issues"** (or "code audit" / "audit the code"), perform a
comprehensive audit across tested AND untested paths for: (1) workarounds / temporary hacks;
(2) dead code; (3) bugs (wrong ABI marshalling, off-by-one pointer/length math, endianness, missing
`cabi_post` calls); and (4) silent fall-throughs (returning a default instead of erroring). Report
`file:line` + severity, fix the safe ones, and keep the gate green (see working-rules.md).

## Files

| File | What it holds |
| --- | --- |
| [overview.md](overview.md) | What this loader port is, repo location (`synapticforge1` since 2026-10-21), API surface, ABI/SPEC 3.0.0 conformance, fixtures, tests, release flow + compatibility gate, publishing path |
| [working-rules.md](working-rules.md) | The checklist: git + branching, the gate (= CI's), tooling hard rules (Bun scripts, no heredocs, LF), privacy (path test, maintainer address), boundaries |
| [best-practices.md](best-practices.md) | METHOD: § L this repo's rules + the workspace's 28 ★ rules, a stamped verbatim copy (2026-10-26) |
| [open-work.md](open-work.md) | The ONE list of what is outstanding |
