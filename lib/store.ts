"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Project, Artifact, ArtifactStatus, Settings, StepId } from "./bmad/types";
import { stepById } from "./bmad/roadmap";

const uid = () => Math.random().toString(36).slice(2, 10);

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
  createProject: (input: NewProjectInput) => string;
  deleteProject: (id: string) => void;
  getProject: (id: string) => Project | undefined;
  /** Attach the OpenCode chat session id to a project (created lazily). */
  setProjectSession: (projectId: string, sessionId: string | undefined) => void;
  /** Clear the current OpenCode session for a project. */
  clearProjectSession: (projectId: string) => void;
  /** Update the working directory of a project (resets its session). */
  setProjectDirectory: (projectId: string, directory: string) => void;
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
  updateSettings: (patch: Partial<Settings>) => void;
}

const DEFAULT_SETTINGS: Settings = {
  opencodeServerUrl:
    process.env.NEXT_PUBLIC_OPENCODE_SERVER_URL?.trim() || "http://127.0.0.1:4096",
  defaultModel: "opencode/big-pickle",
  defaultAgent: "plan",
  buildAgent: "build",
};

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      projects: [],
      settings: DEFAULT_SETTINGS,

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

      setProjectDirectory: (projectId, directory) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  directory: directory.trim(),
                  sessionId: undefined,
                  updatedAt: new Date().toISOString(),
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

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: "bmad-studio-store",
      version: 7,
      // Deep-merge persisted state and drop fields removed in the OpenCode-only
      // refactor (runs, run locks, old AI/provider/E2B settings).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StudioState> & {
          settings?: Partial<Settings>;
        };
        const settings: Settings = {
          opencodeServerUrl:
            p.settings?.opencodeServerUrl?.trim() || DEFAULT_SETTINGS.opencodeServerUrl,
          defaultModel: p.settings?.defaultModel ?? DEFAULT_SETTINGS.defaultModel,
          defaultAgent: p.settings?.defaultAgent ?? DEFAULT_SETTINGS.defaultAgent,
          buildAgent: p.settings?.buildAgent ?? DEFAULT_SETTINGS.buildAgent,
        };
        const projects = (p.projects ?? []).map((proj) => {
          const { directory } = proj as Project & { directory?: string };
          return {
            ...proj,
            directory: directory ?? "",
            sessionId: proj.sessionId,
          };
        });
        return {
          ...current,
          ...p,
          settings,
          projects,
        };
      },
    }
  )
);
