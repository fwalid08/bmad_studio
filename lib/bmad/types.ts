// Core data model for BMAD Studio.
// Mirrors the official BMad Method roadmap (see module-help.csv).

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
  /**
   * Absolute path to the project working directory (folder). This MUST match a
   * project/directory known to the local OpenCode server — every chat session
   * and build is scoped to this folder.
   */
  directory: string;
  /** The OpenCode chat session id used for guidance + build on this project. */
  sessionId?: string;
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
}
