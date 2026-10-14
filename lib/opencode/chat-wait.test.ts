import test from "node:test";
import assert from "node:assert/strict";

import { waitForAssistantReply } from "./chat-wait";

test("resolves when a new assistant reply appears", async () => {
  const snapshots = [
    [
      {
        id: "u1",
        type: "user",
        text: "hello",
        time: { created: 1 },
      },
    ] as any,
    [
      {
        id: "u1",
        type: "user",
        text: "hello",
        time: { created: 1 },
      },
      {
        id: "a1",
        type: "assistant",
        content: [{ type: "text", text: "hi there" }],
        time: { created: 2 },
      },
    ] as any,
  ];

  const result = await waitForAssistantReply(async () => snapshots.shift() ?? snapshots.at(-1) ?? [], 200, 10);
  assert.equal(result, "hi there");
});

test("throws when the assistant reply never arrives within the timeout", async () => {
  await assert.rejects(
    () =>
      waitForAssistantReply(
        async () => [
          {
            id: "u1",
            type: "user",
            text: "hello",
            time: { created: 1 },
          },
        ] as any,
        30,
        5
      ),
    /timed out/i
  );
});
