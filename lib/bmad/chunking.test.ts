import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkMarkdown,
  cosine,
  estimateTokens,
  markdownOutline,
  textHash,
} from "@/lib/bmad/chunking";

function para(i: number): string {
  // ~100 tokens per paragraph
  return `Paragraph ${i}: ` + "lorem ipsum dolor sit amet ".repeat(12);
}

test("chunkMarkdown: single short document yields one chunk", () => {
  const chunks = chunkMarkdown("# Title\n\nHello world.");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, "Title");
  assert.ok(chunks[0].text.includes("Hello world."));
});

test("chunkMarkdown: empty document yields no chunks", () => {
  assert.equal(chunkMarkdown("   \n\n  ").length, 0);
});

test("chunkMarkdown: long document splits and stays under the size budget", () => {
  const body = Array.from({ length: 40 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkMarkdown(body, { maxTokens: 200, overlapTokens: 50 });
  assert.ok(chunks.length > 5);
  for (const c of chunks) {
    assert.ok(estimateTokens(c.text) <= 250);
  }
});

test("chunkMarkdown: chunks overlap so context is not lost at the seam", () => {
  const body = Array.from({ length: 20 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkMarkdown(body, { maxTokens: 300, overlapTokens: 150 });
  assert.ok(chunks.length > 2);
  // Each chunk re-carries the tail of the previous chunk across the seam.
  for (let i = 1; i < chunks.length; i++) {
    const prevTail = chunks[i - 1].text.split("\n\n").slice(-1)[0];
    assert.ok(chunks[i].text.includes(prevTail));
  }
});

test("chunkMarkdown: tracks the nearest heading per chunk", () => {
  const body = [
    "# One\n\n" + para(1),
    "## Two\n\n" + para(2),
    "## Three\n\n" + para(3),
  ].join("\n\n");
  const chunks = chunkMarkdown(body, { maxTokens: 120, overlapTokens: 20 });
  assert.equal(chunks[0].heading, "One");
  assert.equal(chunks[chunks.length - 1].heading, "Three");
});

test("chunkMarkdown: oversized block is hard-split", () => {
  const block = "# Big\n\n" + "word ".repeat(5000);
  const chunks = chunkMarkdown(block, { maxTokens: 400, overlapTokens: 50 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(estimateTokens(c.text) < 500);
  // Every chunk keeps the section heading for context.
  for (const c of chunks) assert.equal(c.heading, "Big");
});

test("chunkMarkdown: no content is dropped", () => {
  const parts = Array.from({ length: 30 }, (_, i) => para(i));
  const body = parts.join("\n\n");
  const chunks = chunkMarkdown(body, { maxTokens: 350, overlapTokens: 120 });
  assert.ok(chunks.length > 3);
  // Overlap aside, every paragraph must survive at least once. (Chunks are
  // trimmed, so compare on trimmed text.)
  for (const p of parts) {
    const needle = p.trim();
    assert.ok(
      chunks.some((c) => c.text.includes(needle)),
      `paragraph missing from chunks: ${needle.slice(0, 12)}`
    );
  }
});

test("markdownOutline: extracts headings and a summary line", () => {
  const outline = markdownOutline(
    "# PRD\n\n## Goals\n\n\n80% users finish onboarding in under three minutes.\n\n## Scope\n"
  );
  assert.deepEqual(outline.headings, ["PRD", "Goals", "Scope"]);
  assert.ok(outline.summary.includes("80% users"));
});

test("markdownOutline: empty document yields empty outline", () => {
  assert.deepEqual(markdownOutline("").headings, []);
  assert.equal(markdownOutline("").summary, "");
});

test("textHash is stable and differs for different text", () => {
  assert.equal(textHash("abc"), textHash("abc"));
  assert.notEqual(textHash("abc"), textHash("abd"));
});

test("cosine: similar vs orthogonal", () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
  assert.ok(Math.abs(cosine([1, 1], [2, 2]) - 1) < 1e-9);
  assert.equal(cosine([], [1]), 0);
  assert.equal(cosine([1, 2], [1, 2, 3]), 0);
});

test("estimateTokens is positive and monotonic", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(40)), 10);
});
