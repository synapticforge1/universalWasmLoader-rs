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
 * Port of scripts/bump.sh (workspace letter H15: Rust has no scripting mechanism that does not
 * build an executable, so committed scripts are TypeScript on Bun). `node:` builtins only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
const against = haveTag ? `tag ${tag}` : `crates.io ${current}`;
console.log(`compatibility floor vs ${against}: ${floor}${lints.length ? `  (set by: ${lints.join(", ")})` : ""}`);
if (KINDS.indexOf(kind as (typeof KINDS)[number]) < KINDS.indexOf(floor)) {
  console.error(`bump: ${kind} refused — the surface diff requires at least ${floor}`);
  process.exit(1);
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

console.log(`Cargo.toml -> ${next}  (${kind} bump from ${current})`);
console.log(`Next: review, commit, then run bun scripts/release.ts to tag v${next} and push.`);
