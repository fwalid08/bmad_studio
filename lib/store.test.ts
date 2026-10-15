import test from "node:test";
import assert from "node:assert/strict";

import { reconcileProjects, useStudio } from "./store";
import type { Project } from "./bmad/types";

test("archives, soft-deletes, and restores tasks without removing them", () => {
  const originalProjects = useStudio.getState().projects;
  const now = new Date().toISOString();
  const project: Project = {
    id: "lifecycle-test",
    name: "Lifecycle test",
    description: "",
    scale: "light",
    createdAt: now,
    updatedAt: now,
    artifacts: {},
    tasks: [],
    directory: "",
  };
  useStudio.setState({ projects: [project], projectsLoaded: false });

  try {
    const store = useStudio.getState();
    const taskId = store.addTask("lifecycle-test", { title: "Persistent task" });

    useStudio.getState().archiveTask("lifecycle-test", taskId);
    let task = useStudio.getState().getProject("lifecycle-test")?.tasks?.[0];
    assert.ok(task?.archivedAt);

    useStudio.getState().restoreTask("lifecycle-test", taskId);
    task = useStudio.getState().getProject("lifecycle-test")?.tasks?.[0];
    assert.equal(task?.archivedAt, undefined);

    useStudio.getState().deleteTask("lifecycle-test", taskId);
    task = useStudio.getState().getProject("lifecycle-test")?.tasks?.[0];
    assert.ok(task?.deletedAt);
    assert.equal(useStudio.getState().getProject("lifecycle-test")?.tasks?.length, 1);

    useStudio.getState().restoreTask("lifecycle-test", taskId);
    task = useStudio.getState().getProject("lifecycle-test")?.tasks?.[0];
    assert.equal(task?.deletedAt, undefined);
  } finally {
    useStudio.setState({ projects: originalProjects, projectsLoaded: false });
  }
});

test("preserves review entries as part of the build history", () => {
  const project = {
    id: "review-mode-test",
    name: "Review mode test",
    description: "",
    scale: "light" as const,
    createdAt: "2026-10-15T10:00:00.000Z",
    updatedAt: "2026-10-15T10:00:00.000Z",
    artifacts: {},
    tasks: [
      {
        id: "task-review",
        title: "Review task",
        detail: "",
        epic: "",
        tags: [],
        priority: "medium" as const,
        status: "review" as const,
        createdAt: "2026-10-15T10:00:00.000Z",
        updatedAt: "2026-10-15T10:00:00.000Z",
        builds: [
          {
            id: "review-1",
            mode: "review",
            goal: "Review implementation",
            summary: "Verdict: IMPLEMENTED",
            status: "done",
            startedAt: "2026-10-15T10:00:00.000Z",
            finishedAt: "2026-10-15T10:00:05.000Z",
            elapsedMs: 5000,
            eventCount: 2,
            files: ["src/app.ts"],
            usage: { input: 120, output: 40, reasoning: 5, cacheRead: 10, cacheWrite: 2, total: 177, costUsd: 0.004 },
          },
          {
            id: "interrupted-1",
            mode: "build",
            goal: "Build implementation",
            summary: "Partial work",
            status: "interrupted",
            statusMessage: "Run dihentikan karena OpenCode shutdown.",
            startedAt: "2026-10-15T10:01:00.000Z",
            eventCount: 1,
            files: [],
          },
        ],
      },
    ],
    directory: "/tmp/project",
  } as Project;

  const normalized = reconcileProjects([project], [project]).projects[0];
  assert.equal(normalized?.tasks?.[0]?.builds?.[0]?.mode, "review");
  assert.equal(normalized?.tasks?.[0]?.builds?.[0]?.summary, "Verdict: IMPLEMENTED");
  assert.equal(normalized?.tasks?.[0]?.builds?.[0]?.usage?.total, 177);
  assert.equal(normalized?.tasks?.[0]?.builds?.[0]?.usage?.costUsd, 0.004);
  assert.equal(normalized?.tasks?.[0]?.builds?.[1]?.status, "interrupted");
  assert.equal(normalized?.tasks?.[0]?.builds?.[1]?.statusMessage, "Run dihentikan karena OpenCode shutdown.");
});

test("reconciliation keeps newer cached task status and build history", () => {
  const createdAt = "2026-10-15T10:00:00.000Z";
  const task = {
    id: "task-1",
    title: "Persist build result",
    detail: "",
    epic: "",
    tags: [],
    priority: "medium" as const,
    status: "todo" as const,
    createdAt,
    updatedAt: createdAt,
  };
  const project = (updatedAt: string, tasks: Project["tasks"]): Project => ({
    id: "persist-test",
    name: "Persist test",
    description: "",
    scale: "light",
    createdAt,
    updatedAt,
    artifacts: {},
    tasks,
    directory: "",
  });
  const serverProject = project(createdAt, [task]);
  const cachedProject = project("2026-10-15T10:01:00.000Z", [
    {
      ...task,
      status: "done",
      builds: [
        {
          id: "build-1",
          goal: "Persist result",
          status: "done",
          startedAt: createdAt,
          eventCount: 3,
          files: ["src/task.ts"],
        },
      ],
    },
  ]);

  const reconciled = reconcileProjects([serverProject], [cachedProject]);
  assert.equal(reconciled.usedNewerCache, true);
  assert.equal(reconciled.projects[0]?.tasks?.[0]?.status, "done");
  assert.equal(reconciled.projects[0]?.tasks?.[0]?.builds?.[0]?.id, "build-1");

  const newerServerProject = project("2026-10-15T10:02:00.000Z", [{ ...task, status: "review" }]);
  const serverWins = reconcileProjects([newerServerProject], [cachedProject]);
  assert.equal(serverWins.usedNewerCache, false);
  assert.equal(serverWins.projects[0]?.tasks?.[0]?.status, "review");
});