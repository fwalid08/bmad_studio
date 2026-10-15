import test from "node:test";
import assert from "node:assert/strict";

import { aggregateTokenUsage } from "./messages";

test("aggregates only assistant usage from the current run", () => {
  const usage = aggregateTokenUsage(
    [
      { id: "old", type: "assistant", tokens: { input: 100, output: 20, reasoning: 3, cache: { read: 10, write: 2 } }, cost: 0.01 },
      { id: "user", type: "user", tokens: { input: 500 } },
      { id: "new", type: "assistant", tokens: { input: 40, output: 12, reasoning: 5, cache: { read: 4, write: 1 } }, cost: 0.002 },
    ],
    new Set(["old", "user"])
  );

  assert.deepEqual(usage, {
    input: 40,
    output: 12,
    reasoning: 5,
    cacheRead: 4,
    cacheWrite: 1,
    total: 62,
    costUsd: 0.002,
  });
});

test("returns no usage when assistant messages have no token metadata", () => {
  assert.equal(aggregateTokenUsage([{ id: "assistant", type: "assistant" }]), undefined);
});