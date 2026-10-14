import type { Project, ArtifactStatus } from "./bmad/types";
import { STEPS, stepsForScale, requiredSteps } from "./bmad/roadmap";

export interface PhaseProgress {
  total: number;
  done: number;
  pct: number;
}

function statusOf(project: Project, stepId: string): ArtifactStatus {
  return project.artifacts[stepId]?.status ?? "not-started";
}

const isDone = (s: ArtifactStatus) => s === "complete";

/** Overall progress across the steps relevant to this project's scale. */
export function projectProgress(project: Project): PhaseProgress {
  const steps = stepsForScale(project.scale).filter((s) => s.phase !== "anytime");
  const total = steps.length;
  const done = steps.filter((s) => isDone(statusOf(project, s.id))).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** Progress within a single phase id. */
export function phaseProgress(project: Project, phaseId: string): PhaseProgress {
  const steps = stepsForScale(project.scale).filter((s) => s.phase === phaseId);
  const total = steps.length;
  const done = steps.filter((s) => isDone(statusOf(project, s.id))).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** Which required gate steps are still incomplete, in order. */
export function nextRequiredSteps(project: Project): string[] {
  return requiredSteps()
    .filter((s) => !isDone(statusOf(project, s.id)))
    .map((s) => s.name);
}

/** The recommended next step id: first not-complete step in roadmap order. */
export function nextStepId(project: Project): string | undefined {
  const order = ["brainstorming", "forge-idea", "deep-recon", "project-context", "product-brief", "prfaq", "prd", "ux", "architecture", "epics-stories", "sprint-planning", "build", "code-review", "qa-tests", "retrospective"];
  const relevant = new Set(stepsForScale(project.scale).map((s) => s.id));
  for (const id of order) {
    if (!relevant.has(id as never)) continue;
    if (!isDone(statusOf(project, id))) return id;
  }
  return undefined;
}

export function statusLabel(s: ArtifactStatus): string {
  switch (s) {
    case "complete":
      return "Complete";
    case "draft":
      return "Draft";
    default:
      return "Not started";
  }
}

export { STEPS };
