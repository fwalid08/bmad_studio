import test from "node:test";
import assert from "node:assert/strict";
import type { EventSubscribeOutput } from "@opencode/client";

import { ActivityMapper } from "./events";

function event(type: string, data: unknown) {
  return { type, data } as unknown as EventSubscribeOutput;
}

test("emits only the unseen part when final text follows streamed deltas", () => {
  const mapper = new ActivityMapper();
  const delta = mapper.map(event("session.text.delta", { messageID: "message-1", delta: "Hello " }));
  const final = mapper.map(event("session.text.ended", { messageID: "message-1", text: "Hello world" }));

  assert.equal(delta[0]?.detail, "Hello ");
  assert.equal(final[0]?.detail, "world");
});

test("emits the full final text when no deltas were received", () => {
  const mapper = new ActivityMapper();
  const final = mapper.map(event("session.text.ended", { messageID: "message-2", text: "Complete response" }));

  assert.equal(final[0]?.detail, "Complete response");
});

test("exposes final assistant text as the build summary, not reasoning text", () => {
  const mapper = new ActivityMapper();
  mapper.map(event("session.reasoning.ended", { messageID: "reasoning-1", text: "Internal reasoning" }));
  assert.equal(mapper.summary(), undefined);

  mapper.map(event("session.text.ended", { messageID: "message-1", text: "## Summary\nBuild complete" }));
  assert.equal(mapper.summary(), "## Summary\nBuild complete");
});

test("maps the tool name and actual text from OpenCode tool events", () => {
  const mapper = new ActivityMapper();
  mapper.map(event("session.tool.input.started", { id: "call-1", name: "bash" }));
  const call = mapper.map(
    event("session.tool.called", { id: "call-1", input: { command: "printf hello" }, executed: true })
  );
  const result = mapper.map(
    event("session.tool.success", { id: "call-1", content: [{ type: "text", text: "hello" }], executed: true })
  );

  assert.equal(call[0]?.title, "▶ bash");
  assert.equal(result[0]?.title, "✔ bash");
  assert.equal(result[0]?.detail, "hello");
});

test("does not substitute the word tool when the tool name is unavailable", () => {
  const mapper = new ActivityMapper();
  const result = mapper.map(
    event("session.tool.success", { id: "call-2", content: [{ type: "text", text: "actual response" }], executed: true })
  );

  assert.equal(result[0]?.title, "✔ Hasil");
  assert.equal(result[0]?.detail, "actual response");
});

test("restores a pending permission halt from session state", () => {
  const mapper = new ActivityMapper();
  const halt = mapper.haltRequest(
    event("permission.asked", {
      id: "permission-1",
      sessionID: "session-1",
      action: "bash",
      resources: ["npm test"],
    }),
    "session-1"
  );

  assert.deepEqual(halt, {
    id: "permission-1",
    kind: "permission",
    title: "Menunggu izin: bash",
    message: undefined,
    resources: ["npm test"],
  });
});

test("restores a pending form halt with normalized fields", () => {
  const mapper = new ActivityMapper();
  const halt = mapper.haltRequest(
    event("form.created", {
      form: {
        id: "form-1",
        sessionID: "session-1",
        title: "Choose a version",
        fields: [{ key: "version", type: "string", required: true, options: [{ value: "v1", label: "Version 1" }] }],
      },
    }),
    "session-1"
  );

  assert.deepEqual(halt, {
    id: "form-1",
    kind: "form",
    title: "Choose a version",
    fields: [{
      key: "version",
      type: "string",
      title: undefined,
      description: undefined,
      required: true,
      options: [{ value: "v1", label: "Version 1" }],
    }],
  });
});