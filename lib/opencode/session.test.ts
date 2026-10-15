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

test("creates a new session when no task session is assigned", async () => {
  let listed = false;
  const session = {
    list: async () => {
      listed = true;
      return { data: [{ id: "other-task-session" }] };
    },
    create: async () => ({ id: "new-task-session" }),
  };

  const sessionId = await ensureSession(session, {
    directory: "/project",
    title: "Task build",
  });

  assert.equal(sessionId, "new-task-session");
  assert.equal(listed, false);
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