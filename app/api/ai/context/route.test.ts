import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Integration test for /api/ai/context. The probe runs in a child process with
// a throwaway HOME (bun caches homedir(), so this cannot be done in-process)
// and prints one JSON object with every scenario.

const repoRoot = process.cwd();
const probePath = join(repoRoot, "test", "probe-context.ts");

interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

function runProbe() {
  const home = mkdtempSync(join(tmpdir(), "bmad-probe-home-"));
  const proc = spawnSync("bun", ["--conditions", "react-server", probePath], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(proc.status, 0, `probe failed: ${proc.stderr || proc.stdout}`);
  return JSON.parse(proc.stdout.trim().split("\n").pop() ?? "{}") as Record<string, never>;
}

const raw = runProbe();
const full = raw.full as unknown as Outcome;
const retrieval = raw.retrieval as unknown as Outcome;
const warm = raw.warm as unknown as Outcome;
const edited = raw.edited as unknown as Outcome;
const empty = raw.empty as unknown as Outcome;
const failure = raw.failure as unknown as Outcome;
const stale = raw.stale as unknown as Outcome;
const missing = raw.missingProjectId as unknown as Outcome;
const stats = raw.stats as { coldEmbedCalls: number; indexChunks: number; warmEmbedCalls: number; editedEmbedCalls: number; staleAfter: number };

test("context route: full mode ships every artifact in roadmap order", () => {
  assert.equal(full.status, 200);
  assert.equal(full.body.mode, "full");
  assert.match(String(full.body.full), /Goals & Success Metrics/);
  assert.match(String(full.body.full), /Next.js 15/);
  assert.equal(
    String(full.body.full).indexOf("### PRD") < String(full.body.full).indexOf("### Architecture"),
    true
  );
});

test("context route: retrieval returns outline + chunks and persists an index", () => {
  assert.equal(retrieval.status, 200);
  assert.equal(retrieval.body.mode, "retrieval");

  const outline = retrieval.body.outline as Array<{
    stepId: string;
    headings: string[];
    summary: string;
  }>;
  assert.equal(outline.length, 2);
  assert.equal(outline[0].stepId, "prd");
  assert.ok(outline[0].headings.includes("Goals & Success Metrics"));
  assert.ok(outline[0].summary.length > 0);

  const chunks = retrieval.body.chunks as Array<{ stepId: string; text: string; score: number }>;
  assert.ok(chunks.length > 0);
  for (const c of chunks) {
    assert.ok(c.stepId === "prd" || c.stepId === "architecture");
    assert.ok(c.text.length > 0);
    assert.equal(typeof c.score, "number");
  }

  const chunkStats = retrieval.body.stats as { embedded: number; indexedChunks: number };
  assert.ok(chunkStats.embedded > 0);
  assert.ok(chunkStats.indexedChunks >= chunks.length);

  // Index file was written under the throwaway HOME with safe permissions.
  assert.equal(raw.indexExists, true);
  assert.ok(stats.indexChunks > 0);
  assert.equal(raw.indexPerms, "600");
  assert.ok(stats.coldEmbedCalls > 0);
});

test("context route: warm index embeds only the query", () => {
  assert.equal(warm.status, 200);
  assert.equal((warm.body.stats as { embedded: number }).embedded, 0);
  assert.equal(stats.warmEmbedCalls, 1);
});

test("context route: edited artifact is re-chunked and re-embedded", () => {
  assert.equal(edited.status, 200);
  assert.ok(stats.editedEmbedCalls > 0);
  assert.ok((edited.body.stats as { embedded: number }).embedded > 0);
});

test("context route: empty artifacts yield an empty outline and no error", () => {
  assert.equal(empty.status, 200);
  assert.equal((empty.body.outline as unknown[]).length, 0);
});

test("context route: provider failure returns 502 with a readable message", () => {
  assert.equal(failure.status, 502);
  assert.equal(failure.body.ok, false);
  assert.match(String(failure.body.error), /model bge-m3 not found/);
});

test("context route: chunks of a removed artifact are dropped from the index", () => {
  assert.equal(stale.status, 200);
  assert.equal(stats.staleAfter, 0);
});

test("context route: missing projectId is rejected", () => {
  assert.equal(missing.status, 400);
});
