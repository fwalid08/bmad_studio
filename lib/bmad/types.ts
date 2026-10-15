// Core data model for BMAD Studio.
// Mirrors the official BMad Method roadmap (see module-help.csv).

import type { TokenUsage } from "../opencode/types";

export type ArtifactStatus = "not-started" | "draft" | "complete";

/** The high-level BMAD phases, in delivery order. */
export type PhaseId = "clarify" | "plan" | "ship" | "anytime";

/** Identifiers for the skills/steps the app models. */
export type StepId =
  // clarify (optional, core)
  | "brainstorming"
  | "forge-idea"
  | "deep-recon"
  // plan
  | "project-context"
  | "product-brief"
  | "prfaq"
  | "prd"
  | "ux"
  | "architecture"
  | "epics-stories"
  | "sprint-planning"
  // ship
  | "build"
  | "code-review"
  | "qa-tests"
  | "retrospective"
  // anytime
  | "party-mode"
  | "advanced-elicitation"
  | "review"
  | "correct-course";

export type AgentId =
  | "mary"
  | "john"
  | "sally"
  | "winston"
  | "amelia";

/** A right-sized process scale (BMAD "right-sized process"). */
export type ProjectScale = "express" | "light" | "full";

/** A single artifact produced by a step. */
export interface Artifact {
  stepId: StepId;
  /** File name this artifact maps to in a real BMAD project. */
  filename: string;
  /** Markdown (or YAML) content the user has authored. */
  content: string;
  status: ArtifactStatus;
  updatedAt: string;
}

/** Status kolom di papan Eksekusi. */
export type TaskStatus = "backlog" | "todo" | "in-progress" | "review" | "done";

/** Ringkasan satu run build pada task (log penuh hanya di memori sesi). */
export interface TaskBuild {
  id: string;
  mode?: "build" | "review";
  goal: string;
  summary?: string;
  status: "running" | "done" | "error" | "stopped" | "interrupted";
  statusMessage?: string;
  model?: string;
  modelName?: string;
  agent?: string;
  sessionId?: string;
  usage?: TokenUsage;
  startedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  eventCount: number;
  /** Path file yang tersentuh agen (diekstrak dari judul tool). */
  files: string[];
}

export type ImplementationVerdict = "implemented" | "partial" | "not_implemented" | "unclear";

export interface TaskImplementationReview {
  verdict: ImplementationVerdict;
  summary: string;
  reviewedAt: string;
  model?: string;
  agent?: string;
}

/** Satu unit kerja di papan Eksekusi (story/task). */
export interface ExecTask {
  id: string;
  title: string;
  detail: string;
  epic: string;
  /** Tag bebas, misal: frontend, bug, urgent. */
  tags: string[];
  /** Prioritas pengerjaan — menentukan urutan "kerjakan berikutnya". */
  priority: TaskPriority;
  status: TaskStatus;
  /** Riwayat semua build task, terbaru dulu. */
  builds?: TaskBuild[];
  implementationReview?: TaskImplementationReview;
  archivedAt?: string;
  deletedAt?: string;
  /**
   * Session khusus task ini. Jika undefined, build memakai project.sessionId
   * (shared session). Saat user klik "New session", field ini diisi dengan
   * session id baru dan semua build berikutnya berjalan di session terisolasi.
   */
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Waktu terakhir artefak berhasil di-sync ke folder project (docs/bmad).
   * Undefined untuk project lama (dianggap belum sync → tab Eksekusi terkunci).
   */
  lastFolderSyncAt?: string;
}

/** Prioritas task: high dikerjakan dulu. */
export type TaskPriority = "high" | "medium" | "low";

/** Satu sprint: kelompok task + nama dan tujuan. */
export interface Sprint {
  id: string;
  name: string;
  goal: string;
  taskIds: string[];
  status: "active" | "done";
  createdAt: string;
  closedAt?: string;
}

/** A guided question used by the local wizard for a step. */
export interface WizardQuestion {
  id: string;
  label: string;
  placeholder: string;
  /** Optional helper text shown under the field. */
  help?: string;
  multiline?: boolean;
}

export interface Project {
  id: string;
  name: string;
  /** One-line description of what is being built. */
  description: string;
  scale: ProjectScale;
  createdAt: string;
  updatedAt: string;
  /** Keyed by StepId. */
  artifacts: Record<string, Artifact>;
  /** Papan Eksekusi — daftar story/task (opsional untuk migrasi project lama). */
  tasks?: ExecTask[];
  /** Daftar sprint (opsional untuk migrasi project lama). */
  sprints?: Sprint[];
  /**
   * Absolute path to the project working directory (folder). This MUST match a
   * project/directory known to the local OpenCode server — every chat session
   * and build is scoped to this folder.
   */
  directory: string;
  /** The OpenCode chat session id used for guidance + build on this project. */
  sessionId?: string;
  /**
   * Waktu terakhir artefak berhasil di-sync ke folder project (docs/bmad).
   * Undefined untuk project lama (dianggap belum sync → tab Eksekusi terkunci).
   * Direset saat working directory berganti.
   */
  lastFolderSyncAt?: string;
}

/**
 * App settings. Intentionally minimal: everything AI-related lives on the local
 * OpenCode server. Here we only remember how to reach that server and the
 * default model/agent to use. Provider API keys are NOT stored here — they are
 * set on the OpenCode server via Settings (see /api/opencode/auth).
 */
export interface Settings {
  /** Base URL of the local OpenCode server (e.g. http://127.0.0.1:4096). */
  opencodeServerUrl: string;
  /** Default model id in "providerID/modelID" form (e.g. "opencode/big-pickle"). */
  defaultModel?: string;
  /** Default agent name for guidance turns (e.g. "plan"). */
  defaultAgent?: string;
  /** Agent name used for build turns (e.g. "build"). */
  buildAgent?: string;
  /**
   * Which backend answers BMAD guidance/draft turns: the local OpenCode
   * server (`"opencode"`) or a provider called directly (`"direct"`).
   * Build turns always use OpenCode.
   */
  guidanceMode?: "opencode" | "direct";
  /**
   * How prior-phase context reaches a draft turn: ship every artifact
   * (`"full"`) or embed them (bge-m3) and ship outline + top-k chunks
   * (`"retrieval"`).
   */
  contextMode?: "full" | "retrieval";
  /** Direct AI provider used for embeddings (defaults to the Direct default). */
  embeddingProviderId?: string;
  /** Embedding model id, e.g. "bge-m3". */
  embeddingModel?: string;
}
