"use client";

import { Check, Circle, CircleDashed, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHASES, stepById, stepsForScale } from "@/lib/bmad/roadmap";
import type { Project } from "@/lib/bmad/types";
import type { ArtifactStatus } from "@/lib/bmad/types";
import { phaseProgress } from "@/lib/progress";

interface Props {
  project: Project;
  activeStepId?: string;
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

export function PhaseStepper({ project, activeStepId, onSelect }: Props) {
  const allowed = new Set(stepsForScale(project.scale).map((s) => s.id));
  return (
    <nav className="space-y-5">
      {PHASES.map((phase) => {
        const steps = phase.steps.filter((id) => allowed.has(id));
        if (steps.length === 0) return null;
        const prog = phaseProgress(project, phase.id);
        return (
          <div key={phase.id}>
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden>{phase.icon}</span>
                {phase.name}
              </div>
              {prog.total > 0 && (
                <span className="text-muted-foreground text-xs tabular-nums">
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
                return (
                  <li key={stepId}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(stepId)}
                      className={cn(
                        "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        active && "bg-accent font-medium"
                      )}
                    >
                      <StatusIcon status={status} />
                      <span className="flex-1 truncate">{step.name}</span>
                      {step.required && status !== "complete" && (
                        <Lock className="text-muted-foreground/60 size-3" aria-label="required" />
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
