/**
 * Tests for scripts/github-release.ts (workspace letters H30, H32): the script runs as a child
 * process against a mock GitHub REST API (Bun.serve) that records every request. Run with
 * `bun test scripts/`; CI's `checks` job runs it before any tag can publish.
 *
 * The child is started with `Bun.spawn`, never `Bun.spawnSync`: a synchronous spawn blocks the
 * event loop that serves the mock, so every request would hang.
 */
import { afterAll, beforeEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./github-release.ts", import.meta.url));
const REPO = "o/r";
const TAG = "v9.8.7";
const SHA = "c".repeat(40);
const OTHER = "d".repeat(40);
const TAGOBJ = "a".repeat(40);

type Hit = { method: string; path: string; auth: string | null; body: any };

/** The mock's state; each test sets what it needs. */
let state: {
  tag: "lightweight" | "annotated" | "missing" | "other";
  release: "absent" | "present";
  postStatus: number;
  readBackDraft: boolean;
  moveTagOnPost: boolean;
  stall: boolean;
};
let hits: Hit[];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = req.method === "POST" ? await req.json() : null;
    hits.push({ method: req.method, path, auth: req.headers.get("authorization"), body });
    if (state.stall) return new Promise<Response>(() => {});
    if (path === `/repos/${REPO}/git/ref/tags/${TAG}`) {
      if (state.tag === "missing") return Response.json({ message: "Not Found" }, { status: 404 });
      if (state.tag === "annotated") return Response.json({ object: { type: "tag", sha: TAGOBJ } });
      return Response.json({ object: { type: "commit", sha: state.tag === "other" ? OTHER : SHA } });
    }
    if (path === `/repos/${REPO}/git/tags/${TAGOBJ}`) return Response.json({ object: { type: "commit", sha: SHA } });
    if (path === `/repos/${REPO}/releases/tags/${TAG}`) {
      if (state.release === "absent") return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json({ tag_name: TAG, draft: state.readBackDraft, html_url: `https://example.invalid/${TAG}` });
    }
    if (path === `/repos/${REPO}/releases` && req.method === "POST") {
      if (state.postStatus === 201) {
        state.release = "present";
        if (state.moveTagOnPost) state.tag = "other";
      }
      return Response.json({ message: state.postStatus === 201 ? "created" : "Validation Failed" }, { status: state.postStatus });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  },
});

afterAll(() => server.stop(true));
beforeEach(() => {
  state = { tag: "lightweight", release: "absent", postStatus: 201, readBackDraft: false, moveTagOnPost: false, stall: false };
  hits = [];
});

async function run(opts: { args?: string[]; token?: string | null; tag?: string; timeoutMs?: number } = {}) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["GITHUB_TOKEN", "RELEASE_TIMEOUT_MS"]) delete env[k];
  Object.assign(env, {
    GITHUB_API_URL: `http://127.0.0.1:${server.port}`,
    GITHUB_REPOSITORY: REPO,
    GITHUB_REF_NAME: opts.tag ?? TAG,
    GITHUB_SHA: SHA,
    CRATE: "universal-wasm-loader",
  });
  if (opts.token !== null) env.GITHUB_TOKEN = opts.token ?? "tok";
  if (opts.timeoutMs) env.RELEASE_TIMEOUT_MS = String(opts.timeoutMs);
  const p = Bun.spawn(["bun", SCRIPT, ...(opts.args ?? [])], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
}

const posts = () => hits.filter((h) => h.method === "POST");

test("lightweight tag: creates the page, crates.io link on top, read back, peeled again", async () => {
  const r = await run();
  expect(r.code).toBe(0);
  expect(r.out).toContain(`GitHub Release ${TAG} created`);
  expect(posts().length).toBe(1);
  expect(posts()[0].auth).toBe("Bearer tok");
  expect(posts()[0].body).toMatchObject({ tag_name: TAG, generate_release_notes: true, draft: false });
  expect(posts()[0].body.body).toBe("crates.io: https://crates.io/crates/universal-wasm-loader/9.8.7");
  // the second peel runs after the POST
  const lastRef = hits.map((h) => h.path).lastIndexOf(`/repos/${REPO}/git/ref/tags/${TAG}`);
  expect(lastRef).toBeGreaterThan(hits.findIndex((h) => h.method === "POST"));
});

test("annotated tag: followed to its commit, then created", async () => {
  state.tag = "annotated";
  const r = await run();
  expect(r.code).toBe(0);
  expect(hits.some((h) => h.path === `/repos/${REPO}/git/tags/${TAGOBJ}`)).toBe(true);
  expect(posts().length).toBe(1);
});

test("missing tag: refused, nothing written", async () => {
  state.tag = "missing";
  const r = await run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("does not exist on GitHub");
  expect(posts().length).toBe(0);
});

test("tag at another commit: refused, nothing written", async () => {
  state.tag = "other";
  const r = await run();
  expect(r.code).toBe(1);
  expect(r.out).toContain(`this run is for ${SHA}; refusing`);
  expect(posts().length).toBe(0);
});

test("existing page: done, nothing written", async () => {
  state.release = "present";
  const r = await run();
  expect(r.code).toBe(0);
  expect(r.out).toContain("already exists, nothing written");
  expect(posts().length).toBe(0);
});

test("POST rejected: exit 1", async () => {
  state.postStatus = 422;
  const r = await run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("HTTP 422");
});

test("read-back is a draft: exit 1", async () => {
  state.readBackDraft = true;
  const r = await run();
  expect(r.code).toBe(1);
  expect(r.out).toContain("draft true");
});

test("tag moved by the POST: exit 1", async () => {
  state.moveTagOnPost = true;
  const r = await run();
  expect(r.code).toBe(1);
  expect(r.out).toContain(`after the POST, tag ${TAG} is ${OTHER}`);
});

test("stalled API: fails at the time limit instead of hanging", async () => {
  state.stall = true;
  const t = Date.now();
  const r = await run({ timeoutMs: 300 });
  expect(r.code).toBe(1);
  expect(r.out).toContain("timed out after 300 ms");
  expect(Date.now() - t).toBeLessThan(8000);
}, 10000);

test("dry-run: every check, no POST", async () => {
  const r = await run({ args: ["--dry-run"] });
  expect(r.code).toBe(0);
  expect(r.out).toContain("dry-run: would POST");
  expect(posts().length).toBe(0);
});

test("no token: refused before any write", async () => {
  const r = await run({ token: null });
  expect(r.code).toBe(1);
  expect(r.out).toContain("GITHUB_TOKEN is not set");
  expect(posts().length).toBe(0);
});

test("not a vX.Y.Z tag: refused before any request", async () => {
  const r = await run({ tag: "main" });
  expect(r.code).toBe(1);
  expect(hits.length).toBe(0);
});
