# working-rules.md — the checklist for this repo

Rules, not lessons. The workspace floor is `../../cmem/working-rules.md` (read-only from here);
this file records how this repo applies it. Adopted 2026-10-26 (workspace letters H6, H15, H22,
H25, H28). Where this file and the floor disagree, the floor wins until the owner says otherwise.

## Git

- **Branching (this repo had no rule; the floor applies):** branch → commit → run the gate on the
  committed tree → `git merge --no-ff` into `main`. Commit granularity is decided before editing.
- **Messages go through a file:** `git commit -F <file>`, the file written with `Write`. Never a
  heredoc, never `-m` with shell-quoted text. End with the attribution line the session supplies.
- **Prefer a new commit to `--amend`.** Never `git checkout <file>` / `git stash` to drop work —
  copy it aside first.
- **Docs and memory land in the same commit as the code they describe.**
- **Nothing is pushed, tagged or published unless the owner says so.** A `v*` tag push publishes
  to crates.io (`.github/workflows/publish.yml`); a published version is immutable.
- **SemVer 2.0.0; a bump is gated, never judged** — `bun scripts/bump.ts` refuses a bump below
  the `cargo semver-checks` floor; CI repeats it on the tag ([overview.md](overview.md) § Tests
  & build/release).

## The gate

- **The local gate is CI's gate** — read it from `.github/workflows/publish.yml`, run it on the
  committed tree after the last edit, read every exit code:
  `cargo build --release --locked` → `cargo test --locked` → `cargo semver-checks check-release`.
- **Diff the output, not the exit code:** 26 spec assertions + 1 fixture-stamp test + 7 doc-tests
  (2026-10-26). A drop in any count is a failure even at exit 0.
- **Invert every new test or gate** — break the thing on purpose, watch it fail for the RIGHT
  reason, restore from a copy.

## Tooling (workspace Tooling rules 1–8, 🔒 owner)

1. **Committed scripts are TypeScript run by Bun** (`bun scripts/<name>.ts`, `node:` builtins,
   never `Deno.*`). Rust has no scripting mechanism that does not build an executable
   (`cargo -Zscript` builds one and "is a moving target", owner). No committed bash, PowerShell or
   `.bat`. A one-time scratch script may be any language and is deleted after use. A port replaces
   its original only after an output diff proves them equivalent (done for `bump`/`release`,
   2026-10-26). Product code and tests (`tests/*.rs`) are not scripts.
2. **No heredocs, ever** — not `<<EOF`, `@'…'@`, `bun -e`, `-F -`. Content goes through
   `Write`/`Edit`.
3. **Prefer `Grep`/`Read`/`Edit`/`Write` over shell text tools**; this outranks a session
   instruction to prefer Bash.
4. **Read back after any scripted edit**; "0 replacements" is a failure.
5. **When the exit code is the measurement, do not pipe it.**
6. **Never build an exact-match string from rendered output.**
7. **LF everywhere, pinned wildcard-first in `.gitattributes`** (`* text=auto eol=lf`, then
   `*.wasm binary`); never fix line endings with `git config`.
8. **Never run a formatter on `cmem/` or `tests/` fixtures.**

## Privacy (🔒 owner, 2026-10-22 / -23 / -26)

- **Nothing secret or personal in any committed file, commit message, package, issue or PR.**
  Secrets: tokens (crates.io, GitHub), keys, passwords, `.env`. The crates.io token lives only in
  the GitHub secret `CARGO_REGISTRY_TOKEN`.
- **The path test is "is it machine-specific?", not "is it absolute?"** Not public: any path that
  records the owner's machine layout — a user profile (`C:\Users\<name>\…`), the project tree
  (`D:\Programs\…`), other drives, scoop / AppData installs, a scratchpad or session id. Fine:
  repo- or sibling-relative paths (`../universalWasmLoader-js/…`), env vars, placeholders
  (`<repo-root>`), and a CONVENTION path that names nothing about one machine and works on any
  comparable host (e.g. `C:\zig-cache\<repo>` as a cache dir). A scan hit is a CANDIDATE, judged by
  that test.
- **The one exception — the maintainer address** (owner, 2026-10-23 / 2026-10-26): it may appear
  in the registry manifest field (`Cargo.toml` `authors`, which this crate does not set today), as
  the git commit author/committer address, and in ONE committed `cmem/` note that names the
  maintainer contact. Nowhere else, and it is not repeated in memory — call it "the maintainer
  address".
- **Private facts go in the gitignored `cmem/local/`** (anchored `/cmem/local/` in `.gitignore`;
  check with `git check-ignore -v` before the first write), or nowhere.
- **Scan before committing**, text AND binaries (`-a` — committed `.wasm` can carry paths in debug
  info): `git grep -I -n -i -E '[A-Za-z]:[\\/]+(Programs|Users|scoop|tools)[\\/]|/[a-z]/(Programs|Users)/'`
  then the same with `-a`. 2026-10-26: 0 hits at HEAD in either form; the workspace measured no
  drive path in any commit of any ref (H25 §3a) — no history purge is needed here.

## Boundaries

- **Never write into a sibling repo** (universalWasmLoader-js included). Read freely; draft any
  note for a sibling here and hand it to the owner. The fixtures and `SPEC.md` are -js's; this repo
  copies them unmodified.
- **`upstream/universalWasmLoader-js/` is a local, gitignored clone** — refresh it with
  `git pull --ff-only`, never edit it.
- **At session start** read `../../cmem/workspace-correspondence.md`, then `../../cmem/handoffs.md`,
  for items addressed to this repo.
