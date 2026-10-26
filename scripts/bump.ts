/**
 * Raise the [package] version in Cargo.toml — patch (default), minor, or major.
 * Cargo.toml is the single source of version truth.
 *
 *   bun scripts/bump.ts            # patch:  0.1.0 -> 0.1.1
 *   bun scripts/bump.ts minor      # minor:  0.1.0 -> 0.2.0
 *   bun scripts/bump.ts major      # major:  0.1.0 -> 1.0.0
 *   bun scripts/bump.ts --dry-run  # print the next patch version, do not write
 *   bun scripts/bump.ts minor --dry-run
 *
 * GATED (compatibility gate, workspace letter H6): before writing, `cargo semver-checks` compares
 * the source with the release tag `v<current>` (crates.io's copy when the tag is absent), finds
 * the FLOOR — the lowest of patch / minor / major it accepts — prints it with the lints that set
 * it, and REFUSES a lower bump. --dry-run reports the floor too. Requires cargo-semver-checks
 * (`cargo install cargo-semver-checks --locked`). With an explicit --release-type a break needs
 * MAJOR even at 0.x (measured 2026-10-26: a removed pub fn refused minor) — the workspace's
 * SemVer 2.0.0 rule. It sees breaks only: an ADDITION still floors at patch, so choosing minor
 * for new API stays the releaser's call.
 *
 * Two more checks (the loaders' part of H6): (1) BEHAVIOUR — the release tag's `tests/`
 * (unmodified, with its own fixtures) run against the NEW `src/` in a throwaway `.compat/` crate;
 * they must be green for a patch or minor. (2) SPEC — `SPEC_VERSION` in src/lib.rs must equal the
 * version of the reference `SPEC.md` on universalWasmLoader-js `origin/main` (read from the local
 * clone `upstream/universalWasmLoader-js`, fetched first); a SPEC_VERSION change since the tag
 * raises the floor by its own level. After writing Cargo.toml it syncs Cargo.lock (CI is --locked).
 *
 * Port of scripts/bump.sh (workspace letter H15: Rust has no scripting mechanism that does not
 * build an executable, so committed scripts are TypeScript on Bun). `node:` builtins only.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const cargoToml = fileURLToPath(new URL("../Cargo.toml", import.meta.url));

// The FIRST `version = "X.Y.Z"` line is the [package] one.
const VERSION_LINE = /^version[ \t]*=[ \t]*"(\d+)\.(\d+)\.(\d+)"/m;

let kind = "patch";
let dryRun = false;
for (const arg of process.argv.slice(2)) {
  if (arg === "patch" || arg === "minor" || arg === "major") kind = arg;
  else if (arg === "--dry-run" || arg === "-n") dryRun = true;
  else {
    console.error(`bump: unknown argument "${arg}" — use patch | minor | major [--dry-run]`);
    process.exit(1);
  }
}

if (!existsSync(cargoToml)) {
  console.error(`bump: Cargo.toml not found at ${cargoToml}`);
  process.exit(1);
}

const text = readFileSync(cargoToml, "utf8");
const m = text.match(VERSION_LINE);
if (!m) {
  console.error(`bump: could not find a 'version = "X.Y.Z"' field in Cargo.toml`);
  process.exit(1);
}

let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
const current = `${major}.${minor}.${patch}`;
if (kind === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (kind === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}
const next = `${major}.${minor}.${patch}`;

// ── compatibility gate ──
const KINDS = ["patch", "minor", "major"] as const;
const root = fileURLToPath(new URL("..", import.meta.url));
const tag = `v${current}`;
const haveTag = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: root }).status === 0;
const baseline = haveTag ? ["--baseline-rev", tag] : ["--baseline-version", current];

let floor: (typeof KINDS)[number] | null = null;
let lints: string[] = [];
for (const k of KINDS) {
  const r = spawnSync("cargo", ["semver-checks", "check-release", ...baseline, "--release-type", k], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.error || (r.status !== 0 && /no such command|not installed/i.test(r.stderr))) {
    console.error("bump: cargo-semver-checks is required — cargo install cargo-semver-checks --locked");
    process.exit(1);
  }
  if (r.status === 0) {
    floor = k;
    break;
  }
  // Each failing lint prints a `--- failure <name>: <description> ---` header.
  const found = [...`${r.stdout}${r.stderr}`.matchAll(/--- failure ([\w-]+):/g)].map((x) => x[1]);
  if (found.length === 0) {
    console.error(`bump: cargo semver-checks failed without naming a lint (exit ${r.status}):`);
    console.error(r.stderr.trim());
    process.exit(1);
  }
  lints = found;
}
if (floor === null) {
  console.error(`bump: cargo semver-checks rejects even a major bump: ${lints.join(", ")}`);
  process.exit(1);
}
// ── SPEC version: ours against the reference, and against the tag ──
const SPEC_CONST = /pub const SPEC_VERSION: &str = "(\d+)\.(\d+)\.(\d+)";/;
const ours = readFileSync(join(root, "src", "lib.rs"), "utf8").match(SPEC_CONST);
if (!ours) {
  console.error("bump: no `pub const SPEC_VERSION` in src/lib.rs");
  process.exit(1);
}
const spec = `${ours[1]}.${ours[2]}.${ours[3]}`;
const reference = join(root, "upstream", "universalWasmLoader-js");
if (!existsSync(join(reference, ".git"))) {
  console.error("bump: the reference clone is missing — git clone " +
    "https://github.com/synapticforge1/universalWasmLoader-js upstream/universalWasmLoader-js");
  process.exit(1);
}
if (spawnSync("git", ["-C", reference, "fetch", "-q", "origin"], { stdio: "inherit" }).status !== 0) {
  console.error("bump: could not fetch the reference clone");
  process.exit(1);
}
const refSpec = spawnSync("git", ["-C", reference, "show", "origin/main:SPEC.md"], { encoding: "utf8" })
  .stdout.match(/^Version:\s*(\d+\.\d+\.\d+)/m)?.[1];
if (refSpec !== spec) {
  console.error(`bump: SPEC_VERSION is ${spec} but the reference SPEC.md (-js origin/main) is ${refSpec ?? "unreadable"}`);
  process.exit(1);
}
const atTag = haveTag
  ? spawnSync("git", ["show", `${tag}:src/lib.rs`], { cwd: root, encoding: "utf8" }).stdout.match(SPEC_CONST)
  : null;
if (atTag) {
  const levels = [[atTag[1], ours[1]], [atTag[2], ours[2]], [atTag[3], ours[3]]];
  const moved = levels.findIndex(([a, b]) => a !== b);
  if (moved >= 0) {
    const specKind = KINDS[2 - moved];
    if (KINDS.indexOf(specKind) > KINDS.indexOf(floor)) floor = specKind;
    lints.push(`SPEC ${atTag.slice(1).join(".")} -> ${spec}`);
  }
}
console.log(`SPEC_VERSION ${spec} = reference SPEC.md ${refSpec}${atTag ? "" : ` (no SPEC_VERSION at ${tag})`}`);

const against = haveTag ? `tag ${tag}` : `crates.io ${current}`;
console.log(`compatibility floor vs ${against}: ${floor}${lints.length ? `  (set by: ${lints.join(", ")})` : ""}`);
if (KINDS.indexOf(kind as (typeof KINDS)[number]) < KINDS.indexOf(floor)) {
  console.error(`bump: ${kind} refused — the surface diff requires at least ${floor}`);
  process.exit(1);
}

// ── behaviour: the tag's tests/ against the new src/ ──
if (haveTag) {
  const compat = join(root, ".compat");
  let summary: string;
  let green: boolean;
  rmSync(compat, { recursive: true, force: true });
  try {
    mkdirSync(compat);
    for (const f of ["Cargo.toml", "Cargo.lock", "README.md"]) cpSync(join(root, f), join(compat, f));
    cpSync(join(root, "src"), join(compat, "src"), { recursive: true });
    const tar = join(compat, "tests.tar");
    const archived = spawnSync("git", ["archive", "--format=tar", "-o", tar, tag, "tests"], { cwd: root });
    const untarred = archived.status === 0 && spawnSync("tar", ["-xf", "tests.tar"], { cwd: compat }).status === 0;
    if (!untarred) {
      console.error(`bump: could not extract ${tag}:tests`);
      process.exit(1);
    }
    rmSync(tar);
    const r = spawnSync("cargo", ["test", "--locked", "--tests"], { cwd: compat, encoding: "utf8" });
    const out = `${r.stdout}\n${r.stderr}`;
    let passed = 0;
    let failed = 0;
    for (const m of out.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)) {
      passed += Number(m[1]);
      failed += Number(m[2]);
    }
    green = r.status === 0 && passed > 0 && failed === 0;
    summary = `${passed} passed, ${failed} failed (exit ${r.status})`;
    if (!green) console.error(out.split("\n").filter((l) => /FAILED|panicked|error(\[|:)/.test(l)).join("\n"));
  } finally {
    rmSync(compat, { recursive: true, force: true });
  }
  console.log(`${tag} tests/ against the new src/: ${green ? "green" : "RED"} — ${summary}`);
  if (!green && kind !== "major") {
    console.error(`bump: ${kind} refused — the previous release's tests are red; classify each failure`);
    process.exit(1);
  }
} else {
  console.log(`previous-release tests: skipped — no tag ${tag} to take them from`);
}

if (dryRun) {
  console.log(`bump (dry-run): ${current} -> ${next} (${kind}) — Cargo.toml NOT modified`);
  process.exit(0);
}

// Replace ONLY the first version line, leaving the rest of Cargo.toml untouched; write to a temp
// file and rename, so a failed write cannot truncate Cargo.toml.
const updated = text.replace(VERSION_LINE, (line) => line.replace(/"\d+\.\d+\.\d+"/, `"${next}"`));
if (updated === text) {
  console.error("bump: the version line was found but not replaced");
  process.exit(1);
}
writeFileSync(`${cargoToml}.tmp`, updated);
renameSync(`${cargoToml}.tmp`, cargoToml);

// Cargo.lock records this package's version too; CI builds --locked.
if (spawnSync("cargo", ["update", "--workspace", "--offline"], { cwd: root, stdio: "inherit" }).status !== 0) {
  console.error("bump: Cargo.toml was raised but `cargo update --workspace` failed — Cargo.lock is stale");
  process.exit(1);
}

console.log(`Cargo.toml -> ${next}  (${kind} bump from ${current})`);
console.log(`Next: review, commit, then run bun scripts/release.ts to tag v${next} and push.`);
