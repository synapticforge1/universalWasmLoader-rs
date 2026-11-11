/**
 * Raise the [package] version in Cargo.toml and commit it as `bump to vX.Y.Z` (workspace letter
 * H33, slots U1–U3). Cargo.toml is the single source of version truth.
 *
 *   bun scripts/bump.ts patch|minor|major            # the level is REQUIRED — no default (U1)
 *   bun scripts/bump.ts patch|minor|major --dry-run  # every check, nothing written or committed
 *
 * Refuses a dirty tree, untracked files included (U3). GATED (workspace letter H6), never judged:
 *   - API floor: `cargo semver-checks` compares the source with the release tag `v<current>`
 *     (crates.io's copy when the tag is absent) for patch, then minor, then major; the first
 *     accepted is the FLOOR, printed with the lints that set it, and a lower level is refused.
 *     With an explicit --release-type a break needs MAJOR even at 0.x. It sees breaks only: an
 *     addition floors at patch (minor for new API is the owner's call), and it has no lint for a
 *     changed return type — the SPEC check below caught one (2026-11-08).
 *   - SPEC: `SPEC_VERSION` must equal the reference SPEC.md (universalWasmLoader-js `main`); a
 *     SPEC change since the tag raises the floor by its own level.
 *   - Behaviour: the tag's `tests/` against the new `src/` (scripts/compat.ts); red refuses a
 *     patch or minor.
 * Then it writes Cargo.toml (temp + rename), syncs Cargo.lock (CI is --locked) and makes the bump
 * commit itself (U2): exactly Cargo.toml and Cargo.lock, read back. `scripts/release.ts` pushes it.
 *
 * Committed scripts are TypeScript on Bun (workspace letter H15). `node:` builtins only.
 */
import { renameSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { KINDS, type Kind, ROOT, prevTagTests, referenceSpec, run, specVersionAt } from "./compat.ts";

function fail(msg: string, code = 1): never {
  console.error(`bump: ${msg}`);
  process.exit(code);
}

let kind: Kind | null = null;
let dryRun = false;
for (const arg of process.argv.slice(2)) {
  if ((KINDS as readonly string[]).includes(arg)) {
    if (kind !== null) fail(`two levels given ("${kind}", "${arg}") — give exactly one`, 2);
    kind = arg as Kind;
  } else if (arg === "--dry-run" || arg === "-n") dryRun = true;
  else fail(`unknown argument "${arg}" — use: patch | minor | major [--dry-run]`, 2);
}
if (kind === null) fail("the level is required: bun scripts/bump.ts patch|minor|major [--dry-run] (no default)", 2);

// ── a clean tree, untracked files counted (U3) ──
const dirty = run("git", ["status", "--porcelain", "--untracked-files=all"]).stdout.trim();
if (dirty) fail(`the tree is not clean (untracked files count):\n${dirty}`);

const cargoToml = join(ROOT, "Cargo.toml");
const VERSION_LINE = /^version[ \t]*=[ \t]*"(\d+)\.(\d+)\.(\d+)"/m;
const text = readFileSync(cargoToml, "utf8");
const m = text.match(VERSION_LINE);
if (!m) fail(`could not find a 'version = "X.Y.Z"' line in Cargo.toml`);
let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
const current = `${major}.${minor}.${patch}`;
if (kind === "major") [major, minor, patch] = [major + 1, 0, 0];
else if (kind === "minor") [minor, patch] = [minor + 1, 0];
else patch += 1;
const next = `${major}.${minor}.${patch}`;

// ── API floor ──
const tag = `v${current}`;
const haveTag = run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).status === 0;
const baseline = haveTag ? ["--baseline-rev", tag] : ["--baseline-version", current];
let floor: Kind | null = null;
let lints: string[] = [];
for (const k of KINDS) {
  const r = run("cargo", ["semver-checks", "check-release", ...baseline, "--release-type", k]);
  if (r.error || (r.status !== 0 && /no such command|not installed/i.test(r.stderr))) {
    fail("cargo-semver-checks is required — cargo install cargo-semver-checks --locked");
  }
  if (r.status === 0) {
    floor = k;
    break;
  }
  const found = [...`${r.stdout}${r.stderr}`.matchAll(/--- failure ([\w-]+):/g)].map((x) => x[1]);
  if (found.length === 0) fail(`cargo semver-checks failed without naming a lint (exit ${r.status}):\n${r.stderr.trim()}`);
  lints = found;
}
if (floor === null) fail(`cargo semver-checks rejects even a major bump: ${lints.join(", ")}`);

// ── SPEC: ours against the reference, and against the tag ──
const spec = specVersionAt(null);
if (spec === null) fail("no `pub const SPEC_VERSION` in src/lib.rs");
let refSpec: string;
try {
  refSpec = await referenceSpec();
} catch (e) {
  fail((e as Error).message);
}
if (refSpec !== spec) fail(`SPEC_VERSION is ${spec} but the reference SPEC.md (-js main) is ${refSpec}`);
const atTag = haveTag ? specVersionAt(tag) : null;
if (atTag !== null && atTag !== spec) {
  const [a, b] = [atTag.split("."), spec.split(".")];
  const moved = [0, 1, 2].findIndex((i) => a[i] !== b[i]);
  const specKind = KINDS[2 - moved];
  if (KINDS.indexOf(specKind) > KINDS.indexOf(floor)) floor = specKind;
  lints.push(`SPEC ${atTag} -> ${spec}`);
}
console.log(`SPEC_VERSION ${spec} = reference SPEC.md ${refSpec}${haveTag && atTag === null ? ` (no SPEC_VERSION at ${tag})` : ""}`);

const against = haveTag ? `tag ${tag}` : `crates.io ${current}`;
console.log(`compatibility floor vs ${against}: ${floor}${lints.length ? `  (set by: ${lints.join(", ")})` : ""}`);
if (KINDS.indexOf(kind) < KINDS.indexOf(floor)) fail(`${kind} refused — the surface diff requires at least ${floor}`);

// ── behaviour: the tag's tests/ against the new src/ ──
if (haveTag) {
  let t: ReturnType<typeof prevTagTests>;
  try {
    t = prevTagTests(tag);
  } catch (e) {
    fail((e as Error).message);
  }
  if (!t.green) console.error(t.failures);
  console.log(`${tag} tests/ against the new src/: ${t.green ? "green" : "RED"} — ${t.summary}`);
  if (!t.green && kind !== "major") fail(`${kind} refused — the previous release's tests are red; classify each failure`);
} else {
  console.log(`previous-release tests: skipped — no tag ${tag} to take them from`);
}

if (dryRun) {
  console.log(`bump (dry-run): ${current} -> ${next} (${kind}) — nothing written or committed`);
  process.exit(0);
}

// ── write Cargo.toml (first version line only; temp + rename), sync Cargo.lock ──
const updated = text.replace(VERSION_LINE, (line) => line.replace(/"\d+\.\d+\.\d+"/, `"${next}"`));
if (updated === text) fail("the version line was found but not replaced");
writeFileSync(`${cargoToml}.tmp`, updated);
renameSync(`${cargoToml}.tmp`, cargoToml);
if (run("cargo", ["update", "--workspace", "--offline"]).status !== 0) {
  fail("Cargo.toml was raised but `cargo update --workspace` failed — Cargo.lock is stale");
}

// ── the bump commit, made here (U2): exactly Cargo.toml + Cargo.lock ──
// Names straight from git — never sliced out of `status --porcelain` lines (a trimmed first line
// loses its leading space, and "argo.lock" was the result; found by the 2026-11-10 rehearsal).
const names = (out: string) => out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const changed = [
  ...names(run("git", ["diff", "--name-only"]).stdout),
  ...names(run("git", ["ls-files", "--others", "--exclude-standard"]).stdout),
].sort();
if (changed.join(",") !== "Cargo.lock,Cargo.toml") fail(`expected only Cargo.toml and Cargo.lock to change, found: ${changed.join(", ")}`);
if (run("git", ["add", "Cargo.toml", "Cargo.lock"]).status !== 0) fail("git add failed");
const message = `bump to v${next}`;
const c = run("git", ["commit", "-q", "-m", message]); // argv, not a shell: the message is never re-parsed
if (c.status !== 0) fail(`git commit failed:\n${c.stderr.trim()}`);
const files = run("git", ["show", "--name-only", "--format=%s", "HEAD"]).stdout.trim().split(/\r?\n/);
if (files[0] !== message || files.slice(1).filter(Boolean).sort().join(",") !== "Cargo.lock,Cargo.toml") {
  fail(`the bump commit does not read back as "${message}" with Cargo.toml + Cargo.lock: ${files.join(" | ")}`);
}
console.log(`committed "${message}" (Cargo.toml + Cargo.lock), ${kind} bump from ${current}`);
console.log(`Next: bun scripts/release.ts — it checks, then pushes main; CI tags, makes the page, publishes.`);
