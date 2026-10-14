import test from "node:test";
import assert from "node:assert/strict";

import { ensureSession } from "./session";

test("reuses a session that still exists", async () => {
  let created = false;
  const session = {
    list: async () => ({ data: [{ id: "existing" }] }),
    create: async () => {
      created = true;
      return { id: "new" };
    },
  };

  const sessionId = await ensureSession(session, {
    directory: "/project",
    sessionId: "existing",
    title: "Project",
  });

  assert.equal(sessionId, "existing");
  assert.equal(created, false);
});

test("creates a replacement when the saved session was deleted", async () => {
  const session = {
    list: async () => ({ data: [{ id: "other" }] }),
    create: async () => ({ id: "replacement" }),
  };

  const sessionId = await ensureSession(session, {
    directory: "/project",
    sessionId: "deleted",
    title: "Project",
  });

  assert.equal(sessionId, "replacement");
});