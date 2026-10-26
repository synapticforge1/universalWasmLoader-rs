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
 * Port of scripts/bump.sh (workspace letter H15: Rust has no scripting mechanism that does not
 * build an executable, so committed scripts are TypeScript on Bun). Same arguments, output and
 * exit codes; the proof is recorded in the commit that replaced the .sh. `node:` builtins only.
 */
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
