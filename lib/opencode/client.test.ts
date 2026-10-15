import test from "node:test";
import assert from "node:assert/strict";

import { opencode } from "./client";

test("chat forwards the abort signal to the fetch request", async () => {
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let seenSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_input, init) => {
    seenSignal = init?.signal as AbortSignal | undefined;
    return new Response(JSON.stringify({ text: "ok", sessionId: "session-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await opencode.chat({
      directory: "/tmp/project",
      message: "hello",
      signal: controller.signal,
    });

    assert.equal(result.text, "ok");
    assert.equal(seenSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
