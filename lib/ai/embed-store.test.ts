import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point HOME at a throwaway dir BEFORE the store module loads, so the real
// ~/.config/bmad-studio/embeddings.json is never touched by tests.
const home = mkdtempSync(join(tmpdir(), "bmad-embed-idx-"));
process.env.HOME = home;

const {
  planStepChunks,
  commitVectors,
  saveEmbedIndex,
  loadEmbedIndex,
  chunksForStep,
  dropProject,
  indexStats,
  searchChunks,
  chunkKey,
} = await import("@/lib/ai/embed-store");

const preparedFor = (text: string) => {
  // 4 lines → 4 chunks so the index has something to store.
  return text
    .split("\n")
    .map((t, i) => ({ index: i, heading: `H${i}`, text: `${t.trim()} body ${i}` }))
    .filter((c) => c.text.trim());
};

function indexArtifact(projectId: string, stepId: string, content: string, vectors: number[][]) {
  const prepared = preparedFor(content);
  const plan = planStepChunks(loadEmbedIndex(), {
    projectId,
    stepId,
    hash: content,
    prepared,
  });
  commitVectors(plan.index, projectId, stepId, vectors);
  saveEmbedIndex(plan.index);
  return plan;
}

test("embed-store: persists and reloads chunks with vectors", () => {
  indexArtifact("p1", "prd", "Goal A\nGoal B", [
    [1, 0, 0],
    [0, 1, 0],
  ]);
  const loaded = loadEmbedIndex();
  const chunks = chunksForStep(loaded, "p1", "prd");
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].vector, [1, 0, 0]);
  assert.equal(chunks[0].dim, 3);
  // Scoped to this project (tests share one index file by design).
  assert.equal(indexStats(loaded).embedded >= 2, true);
  assert.equal(indexStats(loaded).projects >= 1, true);
});

test("embed-store: unchanged content is reused, not re-embedded", () => {
  const first = indexArtifact("p2", "prd", "one\ntwo", [[1, 0], [0, 1]]);
  const again = planStepChunks(loadEmbedIndex(), {
    projectId: "p2",
    stepId: "prd",
    hash: "one\ntwo",
    prepared: preparedFor("one\ntwo"),
  });
  assert.equal(again.toEmbed.length, 0);
  assert.equal(again.reused, 2);
  // Index is still readable after a no-op plan.
  assert.equal(chunksForStep(again.index, "p2", "prd").length, 2);
  assert.ok(first.index.chunks[chunkKey("p2", "prd", 0)]);
});

test("embed-store: changed content replaces the step's chunks", () => {
  indexArtifact("p3", "prd", "one\ntwo", [[1, 0], [0, 1]]);
  const plan = planStepChunks(loadEmbedIndex(), {
    projectId: "p3",
    stepId: "prd",
    hash: "changed",
    prepared: [{ index: 0, heading: "H0", text: "brand new content" }],
  });
  assert.equal(plan.toEmbed.length, 1);
  const chunks = chunksForStep(plan.index, "p3", "prd");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "brand new content");
});

test("embed-store: searchChunks ranks by similarity and caps per step", () => {
  indexArtifact("p4s", "prd", "a\nb\nc\n", [[1, 0, 0], [0.9, 0.1, 0], [0, 1, 0]]);
  indexArtifact("p4s", "arch", "d\ne", [[0.95, 0.05, 0], [0, 0, 1]]);
  const found = searchChunks(loadEmbedIndex(), [1, 0, 0], {
    projectId: "p4s",
    topK: 5,
    maxPerStep: 2,
  });
  assert.ok(found.length > 0);
  assert.equal(found[0].stepId, "prd");
  // Descending by score.
  for (let i = 1; i < found.length; i++) {
    assert.ok(found[i - 1].score >= found[i].score);
  }
  // Per-step cap holds.
  const counts = new Map<string, number>();
  for (const f of found) counts.set(f.stepId, (counts.get(f.stepId) ?? 0) + 1);
  for (const n of counts.values()) assert.ok(n <= 2);
});

test("embed-store: searchChunks ignores mismatched dimensions", () => {
  indexArtifact("p5s", "prd", "a", [[1, 0, 0]]);
  const found = searchChunks(loadEmbedIndex(), [1, 0], { projectId: "p5s", topK: 3 });
  assert.equal(found.length, 0);
});

test("embed-store: projectId scopes the search to one project", () => {
  indexArtifact("p6s", "prd", "a\nb", [[1, 0, 0], [0.9, 0.1, 0]]);
  indexArtifact("p6t", "arch", "c", [[0.99, 0.01, 0]]);
  const scoped = searchChunks(loadEmbedIndex(), [1, 0, 0], {
    projectId: "p6s",
    topK: 5,
  });
  assert.equal(scoped.length, 2);
  for (const s of scoped) assert.equal(s.projectId, "p6s");
  // Without a projectId the whole shared index is searched (by design).
  const all = searchChunks(loadEmbedIndex(), [1, 0, 0], { topK: 50 });
  assert.ok(all.length > 2);
});

test("embed-store: dropProject removes only that project's chunks", () => {
  indexArtifact("p7", "prd", "a", [[1, 0, 0]]);
  indexArtifact("p8", "prd", "a", [[1, 0, 0]]);
  saveEmbedIndex(dropProject(loadEmbedIndex(), "p7"));
  const loaded = loadEmbedIndex();
  assert.equal(chunksForStep(loaded, "p7", "prd").length, 0);
  assert.equal(chunksForStep(loaded, "p8", "prd").length, 1);
});
