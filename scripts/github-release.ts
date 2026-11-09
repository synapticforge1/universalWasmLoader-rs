/**
 * Create the GitHub Release page for a tag through GitHub's REST API — not the GitHub CLI
 * (workspace letters H30, H32). Run by `.github/workflows/publish.yml`'s `release` job, which
 * fetches this one file at `github.sha` and checks out nothing else (C30):
 *
 *   bun github-release.ts            # create the page (or find it already there)
 *   bun github-release.ts --dry-run  # every check, no write
 *
 * Environment (GitHub Actions sets all but the token, which the job passes in):
 *   GITHUB_REPOSITORY  owner/repo          GITHUB_REF_NAME  the tag, e.g. v1.0.4
 *   GITHUB_SHA         the commit the run is for
 *   GITHUB_TOKEN       contents: write (only needed for the POST; reads work without it)
 *   GITHUB_API_URL     default https://api.github.com
 *   CRATE              the crates.io name, for the link on top of the notes
 *   RELEASE_TIMEOUT_MS the limit for EACH request, request to last byte; default 30000
 *
 * H32's order, each step refusing with exit 1 on anything unexpected:
 *   1. The tag exists on GitHub and peels (annotated tags followed) to GITHUB_SHA. `POST
 *      /releases` CREATES a missing tag from the default branch, so this comes first.
 *   2. A page for the tag already exists → done, exit 0, nothing written (re-runs are safe).
 *   3. POST `generate_release_notes` with the crates.io link on top; read the page back (the tag,
 *      not a draft); peel the tag again (the POST must not have created or moved it).
 *
 * `node:` builtins and `fetch` only.
 */
import process from "node:process";

const dryRun = process.argv.slice(2).includes("--dry-run");
for (const arg of process.argv.slice(2)) {
  if (arg !== "--dry-run") fail(`unknown argument "${arg}" — use --dry-run or nothing`);
}

function fail(msg: string): never {
  console.error(`github-release: ${msg}`);
  process.exit(1);
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) fail(`${name} is not set`);
  return v;
}

const repo = need("GITHUB_REPOSITORY");
const tag = need("GITHUB_REF_NAME");
const sha = need("GITHUB_SHA");
const crate = need("CRATE");
const token = process.env.GITHUB_TOKEN ?? "";
const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
const timeoutMs = Number(process.env.RELEASE_TIMEOUT_MS ?? "30000");

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`GITHUB_REPOSITORY "${repo}" is not owner/repo`);
if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`GITHUB_REF_NAME "${tag}" is not a vX.Y.Z tag`);
if (!/^[0-9a-f]{40}$/.test(sha)) fail(`GITHUB_SHA "${sha}" is not a full commit id`);
if (!/^[a-z0-9_-]+$/.test(crate)) fail(`CRATE "${crate}" is not a crate name`);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail(`RELEASE_TIMEOUT_MS must be a positive number`);

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `${repo} release workflow`,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** One request under ONE time limit, from the request to the last byte of the body. */
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const signal = AbortSignal.timeout(timeoutMs);
  let status: number;
  let text: string;
  try {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: body === undefined ? headers() : { ...headers(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    if (signal.aborted) fail(`${method} ${path}: timed out after ${timeoutMs} ms`);
    fail(`${method} ${path}: ${(e as Error).message}`);
  }
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status, json };
}

/** The commit the tag peels to on GitHub (annotated tags followed), or null when it is absent. */
async function peel(): Promise<string | null> {
  const ref = await call("GET", `/repos/${repo}/git/ref/tags/${tag}`);
  if (ref.status === 404) return null;
  if (ref.status !== 200) fail(`GET tag ref ${tag}: HTTP ${ref.status} ${JSON.stringify(ref.json)}`);
  let object = ref.json?.object as { type: string; sha: string } | undefined;
  for (let depth = 0; object?.type === "tag"; depth++) {
    if (depth > 5) fail(`tag ${tag} nests more than 5 tag objects`);
    const t = await call("GET", `/repos/${repo}/git/tags/${object.sha}`);
    if (t.status !== 200) fail(`GET tag object ${object.sha}: HTTP ${t.status}`);
    object = t.json?.object;
  }
  if (object?.type !== "commit") fail(`tag ${tag} does not point to a commit (${JSON.stringify(object)})`);
  return object.sha;
}

// 1. The tag exists and peels to the commit this run is for.
const before = await peel();
if (before === null) fail(`tag ${tag} does not exist on GitHub; refusing (a release would create it)`);
if (before !== sha) fail(`tag ${tag} is ${before}, this run is for ${sha}; refusing`);
console.log(`tag ${tag} = ${sha}`);

// 2. Already released? Then nothing is written.
const existing = await call("GET", `/repos/${repo}/releases/tags/${tag}`);
if (existing.status === 200) {
  console.log(`GitHub Release ${tag} already exists, nothing written: ${existing.json?.html_url}`);
  process.exit(0);
}
if (existing.status !== 404) fail(`GET release ${tag}: HTTP ${existing.status} ${JSON.stringify(existing.json)}`);

// 3. Create it, read it back, peel the tag again.
const version = tag.slice(1);
const body = {
  tag_name: tag,
  name: tag,
  body: `crates.io: https://crates.io/crates/${crate}/${version}`,
  generate_release_notes: true,
  draft: false,
  prerelease: false,
};
if (dryRun) {
  console.log(`dry-run: would POST /repos/${repo}/releases ${JSON.stringify(body)}`);
  process.exit(0);
}
if (!token) fail("GITHUB_TOKEN is not set; cannot create the release");
const created = await call("POST", `/repos/${repo}/releases`, body);
if (created.status !== 201) fail(`POST release ${tag}: HTTP ${created.status} ${JSON.stringify(created.json)}`);
const back = await call("GET", `/repos/${repo}/releases/tags/${tag}`);
if (back.status !== 200) fail(`read-back of release ${tag}: HTTP ${back.status}`);
if (back.json?.tag_name !== tag || back.json?.draft !== false) {
  fail(`read-back of release ${tag}: tag_name ${back.json?.tag_name}, draft ${back.json?.draft}`);
}
const after = await peel();
if (after !== sha) fail(`after the POST, tag ${tag} is ${after ?? "missing"}, not ${sha}`);
console.log(`GitHub Release ${tag} created: ${back.json?.html_url}`);
