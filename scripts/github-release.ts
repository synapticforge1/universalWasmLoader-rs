/**
 * Create the GitHub Release for a tag through GitHub's REST API — not the GitHub CLI (workspace letter H30,
 * owner 2026-11-08: "yes change those"). Run by `.github/workflows/publish.yml`'s `release` job:
 *
 *   bun scripts/github-release.ts            # create the release (or find it already there)
 *   bun scripts/github-release.ts --dry-run  # every check, no POST
 *
 * Environment (GitHub Actions sets all but the token, which the job passes in):
 *   GITHUB_REPOSITORY  owner/repo          GITHUB_REF_NAME  the tag, e.g. v1.0.2
 *   GITHUB_SHA         the commit the run is for
 *   GITHUB_TOKEN       contents: write (only needed for the POST; reads work without it)
 *   GITHUB_API_URL     default https://api.github.com
 *
 * Steps, each refusing with exit 1 on anything unexpected:
 *   1. The tag must exist on GitHub and peel to GITHUB_SHA. `POST /releases` CREATES a missing
 *      tag from the default branch, so this check is what the CLI's `--verify-tag` used to give.
 *   2. A release for the tag already exists → done, exit 0 (a re-run is safe).
 *   3. `POST /releases` {tag_name, name, generate_release_notes}, then read the release back.
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
const token = process.env.GITHUB_TOKEN ?? "";
const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`GITHUB_REPOSITORY "${repo}" is not owner/repo`);
if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`GITHUB_REF_NAME "${tag}" is not a vX.Y.Z tag`);
if (!/^[0-9a-f]{40}$/.test(sha)) fail(`GITHUB_SHA "${sha}" is not a full commit id`);

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `${repo} release workflow`,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  let res: Response;
  try {
    res = await fetch(`${api}${path}`, {
      method,
      headers: body === undefined ? headers() : { ...headers(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    fail(`${method} ${path}: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

// 1. The tag exists and peels to the commit this run is for.
const ref = await call("GET", `/repos/${repo}/git/ref/tags/${tag}`);
if (ref.status === 404) fail(`tag ${tag} does not exist on GitHub; refusing (a release would create it)`);
if (ref.status !== 200) fail(`GET tag ref ${tag}: HTTP ${ref.status} ${JSON.stringify(ref.json)}`);
let object = ref.json?.object as { type: string; sha: string } | undefined;
for (let depth = 0; object?.type === "tag"; depth++) {
  if (depth > 5) fail(`tag ${tag} nests more than 5 tag objects`);
  const t = await call("GET", `/repos/${repo}/git/tags/${object.sha}`);
  if (t.status !== 200) fail(`GET tag object ${object.sha}: HTTP ${t.status}`);
  object = t.json?.object;
}
if (object?.type !== "commit") fail(`tag ${tag} does not point to a commit (${JSON.stringify(object)})`);
if (object.sha !== sha) fail(`tag ${tag} is ${object.sha}, this run is for ${sha}; refusing`);
console.log(`tag ${tag} = ${sha}`);

// 2. Already released?
const existing = await call("GET", `/repos/${repo}/releases/tags/${tag}`);
if (existing.status === 200) {
  console.log(`GitHub Release ${tag} already exists: ${existing.json?.html_url}`);
  process.exit(0);
}
if (existing.status !== 404) fail(`GET release ${tag}: HTTP ${existing.status} ${JSON.stringify(existing.json)}`);

// 3. Create it, then read it back.
const body = { tag_name: tag, name: tag, generate_release_notes: true, draft: false, prerelease: false };
if (dryRun) {
  console.log(`dry-run: would POST /repos/${repo}/releases ${JSON.stringify(body)}`);
  process.exit(0);
}
if (!token) fail("GITHUB_TOKEN is not set; cannot create the release");
const created = await call("POST", `/repos/${repo}/releases`, body);
if (created.status !== 201) fail(`POST release ${tag}: HTTP ${created.status} ${JSON.stringify(created.json)}`);
const back = await call("GET", `/repos/${repo}/releases/tags/${tag}`);
if (back.status !== 200 || back.json?.tag_name !== tag) fail(`read-back of release ${tag}: HTTP ${back.status}`);
console.log(`GitHub Release ${tag} created: ${back.json?.html_url}`);
