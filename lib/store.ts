"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Project, Artifact, ArtifactStatus, Settings, StepId, ExecTask, TaskStatus, TaskPriority, Sprint, TaskBuild } from "./bmad/types";
import { stepById } from "./bmad/roadmap";

const uid = () => Math.random().toString(36).slice(2, 10);
export const taskUid = () => `t_${Math.random().toString(36).slice(2, 10)}`;

function emptyArtifact(stepId: StepId): Artifact {
  const step = stepById(stepId);
  return {
    stepId,
    filename: step?.output ?? `${stepId}.md`,
    content: "",
    status: "not-started",
    updatedAt: new Date().toISOString(),
  };
}

interface NewProjectInput {
  name: string;
  description: string;
  scale: Project["scale"];
  /** Absolute path to the project working directory (must exist in OpenCode). */
  directory: string;
}

export interface StudioState {
  projects: Project[];
  settings: Settings;
  /** True once settings have been loaded from the server JSON file. */
  settingsLoaded: boolean;
  /** True once projects have been reconciled with the server JSON file. */
  projectsLoaded: boolean;
  createProject: (input: NewProjectInput) => string;
  deleteProject: (id: string) => void;
  updateProject: (id: string, patch: { name?: string; description?: string; directory?: string }) => void;
  getProject: (id: string) => Project | undefined;
  /** Attach the OpenCode chat session id to a project (created lazily). */
  setProjectSession: (projectId: string, sessionId: string | undefined) => void;
  /** Clear the current OpenCode session for a project. */
  clearProjectSession: (projectId: string) => void;
  /** Attach a dedicated OpenCode session to a specific task (isolated build). */
  setTaskSession: (projectId: string, taskId: string, sessionId: string | undefined) => void;
  setArtifactContent: (
    projectId: string,
    stepId: StepId,
    content: string,
    status: ArtifactStatus
  ) => void;
  setArtifactStatus: (
    projectId: string,
    stepId: StepId,
    status: ArtifactStatus
  ) => void;
  addTask: (projectId: string, input: { title: string; detail?: string; epic?: string; tags?: string[]; priority?: TaskPriority; status?: TaskStatus }) => string;
  updateTask: (projectId: string, taskId: string, patch: Partial<Pick<ExecTask, "title" | "detail" | "epic" | "tags" | "priority" | "builds" | "status">>) => void;
  deleteTask: (projectId: string, taskId: string) => void;
  importTasks: (projectId: string, tasks: Array<{ title: string; detail?: string; epic?: string; tags?: string[]; priority?: TaskPriority }>) => number;
  createSprint: (projectId: string, input: { name: string; goal?: string; taskIds: string[] }) => string;
  closeSprint: (projectId: string, sprintId: string) => void;
  /**
   * Update settings in memory and persist the JSON-backed keys
   * (`opencodeServerUrl`, `defaultModel`, `defaultAgent`, `buildAgent`) to
   * `~/.config/bmad-studio/opencode.json` via `/api/opencode/settings`.
   * Pass `{ persist: false }` when the caller already saved via the API
   * (e.g. the connection form which also sends username/password).
   */
  updateSettings: (patch: Partial<Settings>, opts?: { persist?: boolean }) => void;
  /** Load settings from the server JSON file (called once on app mount). */
  loadSettings: () => Promise<void>;
  /** Reconcile projects with the server JSON file (called once on app mount). */
  loadProjects: () => Promise<void>;
}

export const DEFAULT_SETTINGS: Settings = {
  opencodeServerUrl:
    process.env.NEXT_PUBLIC_OPENCODE_SERVER_URL?.trim() || "http://127.0.0.1:4096",
  defaultModel: "opencode/big-pickle",
  defaultAgent: "plan",
  buildAgent: "build",
  guidanceMode: "opencode",
};

/** Keys persisted to the server JSON file (never localStorage). */
const PERSISTED_SETTING_KEYS = [
  "opencodeServerUrl",
  "defaultModel",
  "defaultAgent",
  "buildAgent",
  "guidanceMode",
  "contextMode",
  "embeddingProviderId",
  "embeddingModel",
] as const;

function sanitizeSettings(value: unknown): Settings {
  const v = (value ?? {}) as Partial<Settings>;
  return {
    opencodeServerUrl:
      typeof v.opencodeServerUrl === "string" && v.opencodeServerUrl.trim()
        ? v.opencodeServerUrl.trim()
        : DEFAULT_SETTINGS.opencodeServerUrl,
    defaultModel: v.defaultModel || DEFAULT_SETTINGS.defaultModel,
    defaultAgent: v.defaultAgent || DEFAULT_SETTINGS.defaultAgent,
    buildAgent: v.buildAgent || DEFAULT_SETTINGS.buildAgent,
    guidanceMode: v.guidanceMode === "direct" ? "direct" : "opencode",
    contextMode: v.contextMode === "retrieval" ? "retrieval" : "full",
    embeddingProviderId: v.embeddingProviderId || undefined,
    embeddingModel: v.embeddingModel || undefined,
  };
}

let loadSettingsPromise: Promise<void> | undefined;
let loadProjectsPromise: Promise<void> | undefined;
let projectsSyncUnsub: (() => void) | undefined;

/** Normalize raw projects (server file or old cache) into valid Project objects. */
function normalizePriority(v: unknown): TaskPriority {
  return v === "high" || v === "low" ? v : "medium";
}

function normalizeBuilds(v: unknown): TaskBuild[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b) => b && typeof (b as TaskBuild).startedAt === "string")
    .map((b) => {
      const x = b as TaskBuild;
      const status = x.status === "done" || x.status === "error" || x.status === "stopped" ? x.status : "running" as const;
      return {
        id: String(x.id ?? taskUid()),
        goal: String(x.goal ?? ""),
        status,
        startedAt: String(x.startedAt),
        finishedAt: typeof x.finishedAt === "string" ? x.finishedAt : undefined,
        elapsedMs: typeof x.elapsedMs === "number" ? x.elapsedMs : undefined,
        eventCount: typeof x.eventCount === "number" ? x.eventCount : 0,
        files: Array.isArray(x.files) ? x.files.map((f) => String(f)).filter(Boolean).slice(0, 20) : [],
      };
    })
    .slice(0, 3);
}

function normalizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((t) => String(t).trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 10);
}

function normalizeProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Project[]).map((proj) => {
    const { directory } = proj as Project & { directory?: string };
    const rawTasks = Array.isArray((proj as Project).tasks) ? (proj as Project).tasks! : [];
    const rawSprints = Array.isArray((proj as Project).sprints) ? (proj as Project).sprints! : [];
    return {
      ...proj,
      directory: directory ?? "",
      sessionId: proj.sessionId,
      tasks: rawTasks.map((t) => ({ ...t, tags: normalizeTags((t as ExecTask).tags), priority: normalizePriority((t as ExecTask).priority), builds: normalizeBuilds((t as ExecTask).builds), sessionId: (t as ExecTask).sessionId })),
      sprints: rawSprints.map((s) => ({
        id: String((s as Sprint).id ?? taskUid()),
        name: String((s as Sprint).name ?? "Sprint"),
        goal: String((s as Sprint).goal ?? ""),
        taskIds: Array.isArray((s as Sprint).taskIds) ? (s as Sprint).taskIds : [],
        status: (s as Sprint).status === "done" ? "done" as const : "active" as const,
        createdAt: String((s as Sprint).createdAt ?? new Date().toISOString()),
        closedAt: (s as Sprint).closedAt,
      })),
    };
  });
}

async function pushProjects(projects: Project[]): Promise<void> {
  try {
    await fetch("/api/projects", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projects }),
    });
  } catch {
    // A failed push is retried on the next change (debounced subscriber below).
  }
}

/** After the initial load, mirror every projects change to the server JSON file. */
function ensureProjectsSync() {
  if (projectsSyncUnsub) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  projectsSyncUnsub = useStudio.subscribe((s, prev) => {
    if (!useStudio.getState().projectsLoaded) return;
    if (s.projects === prev.projects) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void pushProjects(useStudio.getState().projects);
    }, 800);
  });
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      projects: [],
      settings: DEFAULT_SETTINGS,
      settingsLoaded: false,
      projectsLoaded: false,

      createProject: (input) => {
        const id = uid();
        const now = new Date().toISOString();
        const project: Project = {
          id,
          name: input.name.trim() || "Untitled project",
          description: input.description.trim(),
          scale: input.scale,
          createdAt: now,
          updatedAt: now,
          artifacts: {},
          directory: input.directory.trim(),
          sessionId: undefined,
        };
        set((s) => ({ projects: [project, ...s.projects] }));
        return id;
      },

      deleteProject: (id) =>
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

      updateProject: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((p) => {
            if (p.id !== id) return p;
            const nextDir = patch.directory !== undefined ? patch.directory.trim() : p.directory;
            const dirChanged = nextDir !== p.directory;
            return {
              ...p,
              name: patch.name !== undefined ? patch.name.trim() || p.name : p.name,
              description: patch.description !== undefined ? patch.description.trim() : p.description,
              directory: nextDir,
              // Changing the working directory invalidates the chat session.
              sessionId: dirChanged ? undefined : p.sessionId,
              updatedAt: new Date().toISOString(),
            };
          }),
        })),

      getProject: (id) => get().projects.find((p) => p.id === id),

      setProjectSession: (projectId, sessionId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, sessionId, updatedAt: new Date().toISOString() }
              : p
          ),
        })),

      clearProjectSession: (projectId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, sessionId: undefined, updatedAt: new Date().toISOString() }
              : p
          ),
        })),

      setTaskSession: (projectId, taskId, sessionId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  updatedAt: new Date().toISOString(),
                  tasks: (p.tasks ?? []).map((t) =>
                    t.id === taskId ? { ...t, sessionId } : t
                  ),
                }
              : p
          ),
        })),

      setArtifactContent: (projectId, stepId, content, status) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  updatedAt: new Date().toISOString(),
                  artifacts: {
                    ...p.artifacts,
                    [stepId]: {
                      ...(emptyArtifact(stepId) as Artifact),
                      ...p.artifacts[stepId],
                      content,
                      status,
                      updatedAt: new Date().toISOString(),
                    },
                  },
                }
              : p
          ),
        })),

      setArtifactStatus: (projectId, stepId, status) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  updatedAt: new Date().toISOString(),
                  artifacts: {
                    ...p.artifacts,
                    [stepId]: {
                      ...(emptyArtifact(stepId) as Artifact),
                      ...p.artifacts[stepId],
                      status,
                      updatedAt: new Date().toISOString(),
                    },
                  },
                }
              : p
          ),
        })),

      addTask: (projectId, input) => {
        const id = taskUid();
        const now = new Date().toISOString();
        const task: ExecTask = {
          id,
          title: input.title.trim() || "Untitled task",
          detail: (input.detail ?? "").trim(),
          epic: (input.epic ?? "").trim(),
          tags: normalizeTags(input.tags ?? []),
          priority: normalizePriority(input.priority),
          status: input.status ?? "backlog",
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, tasks: [...(p.tasks ?? []), task], updatedAt: now }
              : p
          ),
        }));
        return id;
      },

      updateTask: (projectId, taskId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  updatedAt: new Date().toISOString(),
                  tasks: (p.tasks ?? []).map((t) =>
                    t.id === taskId
                      ? {
                          ...t,
                          ...patch,
                          ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : null),
                          ...(patch.priority !== undefined ? { priority: normalizePriority(patch.priority) } : null),
                          updatedAt: new Date().toISOString(),
                        }
                      : t
                  ),
                }
              : p
          ),
        })),

      deleteTask: (projectId, taskId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, tasks: (p.tasks ?? []).filter((t) => t.id !== taskId), updatedAt: new Date().toISOString() }
              : p
          ),
        })),

      importTasks: (projectId, tasks) => {
        const now = new Date().toISOString();
        const existing = new Set(
          (get().projects.find((p) => p.id === projectId)?.tasks ?? []).map((t) => t.title.toLowerCase())
        );
        const fresh: ExecTask[] = [];
        for (const t of tasks) {
          const title = t.title.trim();
          if (!title || existing.has(title.toLowerCase())) continue;
          existing.add(title.toLowerCase());
          fresh.push({
            id: taskUid(),
            title,
            detail: (t.detail ?? "").trim(),
            epic: (t.epic ?? "").trim(),
            tags: normalizeTags((t as { tags?: unknown }).tags),
            priority: normalizePriority((t as { priority?: unknown }).priority),
            status: "backlog",
            createdAt: now,
            updatedAt: now,
          });
        }
        if (fresh.length > 0) {
          set((s) => ({
            projects: s.projects.map((p) =>
              p.id === projectId ? { ...p, tasks: [...(p.tasks ?? []), ...fresh], updatedAt: now } : p
            ),
          }));
        }
        return fresh.length;
      },

      createSprint: (projectId, input) => {
        const id = taskUid();
        const now = new Date().toISOString();
        const sprint: Sprint = {
          id,
          name: input.name.trim() || "Sprint",
          goal: (input.goal ?? "").trim(),
          taskIds: [...new Set(input.taskIds)],
          status: "active",
          createdAt: now,
        };
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  // Hanya satu sprint aktif — sprint aktif lama otomatis ditutup.
                  sprints: [...(p.sprints ?? []).map((x) => (x.status === "active" ? { ...x, status: "done" as const, closedAt: now } : x)), sprint],
                  tasks: (p.tasks ?? []).map((t) =>
                    sprint.taskIds.includes(t.id) && t.status === "backlog" ? { ...t, status: "todo" as const, updatedAt: now } : t
                  ),
                  updatedAt: now,
                }
              : p
          ),
        }));
        return id;
      },

      closeSprint: (projectId, sprintId) => {
        const now = new Date().toISOString();
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  sprints: (p.sprints ?? []).map((x) => (x.id === sprintId ? { ...x, status: "done" as const, closedAt: now } : x)),
                  updatedAt: now,
                }
              : p
          ),
        }));
      },

      updateSettings: (patch, opts) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
        if (opts?.persist === false) return;
        const body: Record<string, string> = {};
        for (const key of PERSISTED_SETTING_KEYS) {
          if (patch[key] !== undefined) body[key] = patch[key] as string;
        }
        if (Object.keys(body).length === 0) return;
        void fetch("/api/opencode/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => {
          // UI already reflects the new value; a failed save is retried on the
          // next change. Settings page surfaces load errors separately.
        });
      },

      loadSettings: () => {
        if (loadSettingsPromise) return loadSettingsPromise;
        loadSettingsPromise = (async () => {
          try {
            const res = await fetch("/api/opencode/settings", { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = (await res.json()) as Partial<Settings>;
            set({ settings: sanitizeSettings(json), settingsLoaded: true });
          } catch {
            set({ settingsLoaded: true });
          } finally {
            loadSettingsPromise = undefined;
          }
        })();
        return loadSettingsPromise;
      },

      loadProjects: () => {
        if (loadProjectsPromise) return loadProjectsPromise;
        loadProjectsPromise = (async () => {
          try {
            const res = await fetch("/api/projects", { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = (await res.json()) as { projects?: unknown; persisted?: boolean };
            if (json.persisted) {
              // Server file is the source of truth — replace the local cache.
              set({ projects: normalizeProjects(json.projects), projectsLoaded: true });
            } else {
              // First run: migrate the localStorage cache to the server file.
              set({ projectsLoaded: true });
              if (get().projects.length > 0) await pushProjects(get().projects);
            }
          } catch {
            // Server unreachable: keep the localStorage cache, sync later changes.
            set({ projectsLoaded: true });
          } finally {
            ensureProjectsSync();
            loadProjectsPromise = undefined;
          }
        })();
        return loadProjectsPromise;
      },
    }),
    {
      name: "bmad-studio-store",
      version: 8,
      // Projects live in localStorage as an instant cache AND in the server
      // JSON file (`~/.config/bmad-studio/projects.json`) as the durable
      // source of truth (see loadProjects()). Settings are JSON-backed on the
      // server (`~/.config/bmad-studio/opencode.json`) and loaded via
      // loadSettings(), so stale browser-cached settings are dropped here.
      partialize: (s) => ({ projects: s.projects }) as StudioState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { projects?: Project[] };
        return {
          ...current,
          settings: current.settings,
          settingsLoaded: current.settingsLoaded,
          projects: normalizeProjects(p.projects ?? []),
        };
      },
    }
  )
);
