/**
 * tests/watcher/watcher.test.ts — integration tests for the universal watcher
 * `templates/watcher/chantier-watch.mjs`. No network, no mocks of the script
 * itself: we run the REAL script with `node` against local-only endpoints.
 *
 *   (a) `--selftest` proves the watcher works with zero installation.
 *   (b) fail-open: a dead CHANTIER_URL never crashes it, and SIGINT == exit 0.
 *   (c) contract: a capture server asserts /touch carries exactly
 *       {session_id, tool_input.file_path, cwd, hook_event_name} (nothing else)
 *       plus the X-Chantier-Repo header.
 */

import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { type Readable } from "node:stream";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "..", "..", "templates", "watcher", "chantier-watch.mjs");
const REPO_SLUG = "acme/test";

type WatchChild = ChildProcessByStdio<null, Readable, Readable>;

interface Captured {
  route: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "chantier-watch-test-"));
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "watch test"]);
  writeFileSync(join(dir, "seed.txt"), "hi\n");
  git(["add", "seed.txt"]);
  git(["commit", "-q", "-m", "seed"]);
  return dir;
}

function spawnWatch(repo: string, url: string, session = "test-session"): WatchChild {
  return spawn(process.execPath, [SCRIPT], {
    cwd: repo,
    env: {
      ...process.env,
      CHANTIER_URL: url,
      CHANTIER_TOKEN: "test-token",
      CHANTIER_REPO: REPO_SLUG,
      CHANTIER_SESSION: session,
      CHANTIER_WATCH_DIR: repo,
      CHANTIER_DEBOUNCE_MS: "150",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function collectOutput(child: WatchChild): () => string {
  const buf: string[] = [];
  child.stdout.on("data", (c) => buf.push(String(c)));
  child.stderr.on("data", (c) => buf.push(String(c)));
  return () => buf.join("");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise((done) => {
    const tick = () => {
      if (pred()) return done(true);
      if (Date.now() - started >= timeoutMs) return done(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

function stop(child: WatchChild): Promise<number | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve(-1);
    }, 3000);
    child.once("exit", (code) => {
      clearTimeout(t);
      resolve(code);
    });
    child.kill("SIGINT");
  });
}

function startCapture(): Promise<{ url: string; requests: Captured[]; close: () => void }> {
  return new Promise((resolve) => {
    const requests: Captured[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          body = {};
        }
        requests.push({ route: (req.url ?? "").split("?")[0].replace(/\/+$/, ""), headers: req.headers, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "ctx" } }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/ingest`,
        requests,
        close: () => server.close(),
      });
    });
  });
}

describe("chantier-watch (universal watcher)", () => {
  it("--selftest prints SELFTEST OK and exits 0", async () => {
    const child = spawn(process.execPath, [SCRIPT, "--selftest"], { stdio: ["ignore", "pipe", "pipe"] });
    const out = collectOutput(child);
    const code = await new Promise<number | null>((resolve) => child.once("exit", (c) => resolve(c)));
    expect(code).toBe(0);
    expect(out()).toContain("SELFTEST OK");
  }, 60_000);

  it("fails open on a dead endpoint and exits 0 on SIGINT", async () => {
    const repo = makeRepo();
    const cap = await startCapture();
    const dead = `http://127.0.0.1:${(cap.url.match(/:(\d+)\//) as RegExpMatchArray)[1]}/ingest`;
    cap.close(); // reclaim the port: it is now dead
    try {
      const child = spawnWatch(repo, dead);
      writeFileSync(join(repo, "x.txt"), "hello\n");
      await delay(3000);
      expect(child.exitCode).toBeNull(); // still alive: fail-open, never crashed
      const code = await stop(child);
      expect(code).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it("POSTs the exact /touch contract with the X-Chantier-Repo header", async () => {
    const repo = makeRepo();
    const cap = await startCapture();
    try {
      const child = spawnWatch(repo, cap.url, "c-session");
      const out = collectOutput(child);
      await waitFor(() => cap.requests.some((r) => r.route.endsWith("/open")), 15000);

      const target = join(repo, "edit.txt");
      writeFileSync(target, "one\n");
      writeFileSync(target, "two\n");
      await waitFor(() => cap.requests.some((r) => r.route.endsWith("/touch")), 15000);
      await stop(child);

      const open = cap.requests.find((r) => r.route.endsWith("/open"));
      const touch = cap.requests.find((r) => r.route.endsWith("/touch"));

      expect(open).toBeDefined();
      expect(Object.keys(open!.body).sort()).toEqual(["branch", "cwd", "sessionRef"]);
      expect(open!.body.sessionRef).toBe("c-session");
      expect(open!.headers["x-chantier-repo"]).toBe(REPO_SLUG);

      expect(touch).toBeDefined();
      expect(touch!.headers["x-chantier-repo"]).toBe(REPO_SLUG);
      expect(Object.keys(touch!.body).sort()).toEqual(["cwd", "hook_event_name", "session_id", "tool_input"]);
      expect(touch!.body.session_id).toBe("c-session");
      expect(touch!.body.cwd).toBe(repo);
      expect(Object.keys(touch!.body.tool_input as Record<string, unknown>).sort()).toEqual(["file_path"]);
      expect((touch!.body.tool_input as { file_path: string }).file_path).toBe(target);
      expect(out()).toContain("[chantier]");
    } finally {
      cap.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);
});