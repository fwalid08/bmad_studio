"use client";

import { Check, Circle, CircleDashed, CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHASES, stepById, stepsForScale } from "@/lib/bmad/roadmap";
import type { Project } from "@/lib/bmad/types";
import type { ArtifactStatus } from "@/lib/bmad/types";
import { phaseProgress } from "@/lib/progress";

interface Props {
  project: Project;
  activeStepId?: string;
  /** Step currently being drafted (bulk mode) — shown with a spinner. */
  processingStepId?: string | null;
  onSelect?: (stepId: string) => void;
}

function statusOf(project: Project, stepId: string): ArtifactStatus {
  return project.artifacts[stepId]?.status ?? "not-started";
}

function StatusIcon({ status }: { status: ArtifactStatus }) {
  if (status === "complete")
    return <Check className="size-4 text-emerald-500" />;
  if (status === "draft")
    return <CircleDashed className="size-4 text-amber-500" />;
  return <Circle className="size-4 text-muted-foreground/50" />;
}

export function PhaseStepper({ project, activeStepId, processingStepId, onSelect }: Props) {
  const allowed = new Set(stepsForScale(project.scale).map((s) => s.id));
  return (
    <nav className="space-y-5">
      {PHASES.map((phase) => {
        const steps = phase.steps.filter((id) => allowed.has(id));
        if (steps.length === 0) return null;
        const prog = phaseProgress(project, phase.id);
        return (
          <div key={phase.id}>
            <div className="mb-1.5 flex items-center justify-between gap-2 border-l-2 border-primary/30 px-2 py-0.5 pl-2.5">
              <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
                <span aria-hidden className="text-xs">{phase.icon}</span>
                {phase.name}
              </div>
              {prog.total > 0 && (
                <span className="text-muted-foreground/80 shrink-0 text-[10px] tabular-nums">
                  {prog.done}/{prog.total}
                </span>
              )}
            </div>
            <ul className="space-y-0.5">
              {steps.map((stepId) => {
                const step = stepById(stepId);
                if (!step) return null;
                const status = statusOf(project, stepId);
                const active = activeStepId === stepId;
                const processing = processingStepId === stepId;
                return (
                  <li key={stepId}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(stepId)}
                      className={cn(
                        "group hover:bg-accent flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left text-sm transition-colors",
                        active
                          ? "border-primary/20 bg-accent font-medium"
                          : "text-foreground/80"
                      )}
                    >
                      {processing ? (
                        <Loader2 className="size-4 animate-spin text-primary" />
                      ) : (
                        <StatusIcon status={status} />
                      )}
                      <span className="flex-1 truncate">{step.name}</span>
                      {step.required && status !== "complete" && (
                        <CircleAlert
                          className="size-3.5 shrink-0 text-red-500"
                          aria-label="Step wajib"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
