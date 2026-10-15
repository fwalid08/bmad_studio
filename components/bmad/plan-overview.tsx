"use client";

import { ArrowRight, Check, Circle, CircleDashed, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PHASES, stepById, stepsForScale } from "@/lib/bmad/roadmap";
import { projectProgress, phaseProgress, nextStepId } from "@/lib/progress";
import { agentForStep } from "@/lib/bmad/agents";
import type { Project, StepId } from "@/lib/bmad/types";

interface Props {
  project: Project;
  onSelect: (stepId: StepId) => void;
}

function statusOf(project: Project, stepId: string) {
  return project.artifacts[stepId]?.status ?? "not-started";
}

export function PlanOverview({ project, onSelect }: Props) {
  const prog = projectProgress(project);
  const nextId = nextStepId(project) as StepId | undefined;
  const nextStep = nextId ? stepById(nextId) : undefined;
  const allowed = new Set(stepsForScale(project.scale).map((s) => s.id));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutDashboard className="size-4" /> Overview
          </CardTitle>
          <CardDescription>
            Ringkasan progres per fase. Klik sebuah langkah untuk mengerjakan artefaknya.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold">Total {prog.done}/{prog.total} selesai</span>
            <span className="text-muted-foreground tabular-nums">{prog.pct}%</span>
          </div>
          <Progress value={prog.pct} className="h-2" />
          <div className="space-y-2 pt-1">
            {PHASES.filter((p) => p.id !== "anytime").map((phase) => {
              const pp = phaseProgress(project, phase.id);
              return (
                <div key={phase.id} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 truncate font-medium">
                    <span aria-hidden>{phase.icon} </span>{phase.name}
                  </span>
                  <Progress value={pp.pct} className="h-1.5 flex-1" />
                  <span className="text-muted-foreground w-12 shrink-0 text-right tabular-nums">
                    {pp.done}/{pp.total}
                  </span>
                </div>
              );
            })}
          </div>
          {nextStep && (
            <Button size="sm" className="mt-1 w-full sm:w-auto" onClick={() => nextId && onSelect(nextId)}>
              Lanjutkan: {nextStep.name} <ArrowRight className="size-4" />
            </Button>
          )}
        </CardContent>
      </Card>

      {PHASES.filter((p) => p.id !== "anytime").map((phase) => {
        const steps = phase.steps.filter((id) => allowed.has(id));
        if (steps.length === 0) return null;
        return (
          <Card key={phase.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                <span aria-hidden>{phase.icon} </span>{phase.name}
              </CardTitle>
              <CardDescription className="text-xs">{phase.tagline}</CardDescription>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              <ul className="space-y-0.5">
                {steps.map((stepId) => {
                  const step = stepById(stepId);
                  if (!step) return null;
                  const status = statusOf(project, stepId);
                  const agent = agentForStep(stepId as StepId);
                  return (
                    <li key={stepId}>
                      <button
                        type="button"
                        onClick={() => onSelect(stepId as StepId)}
                        className="hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors"
                      >
                        {status === "complete" ? (
                          <Check className="size-4 shrink-0 text-emerald-500" />
                        ) : status === "draft" ? (
                          <CircleDashed className="size-4 shrink-0 text-amber-500" />
                        ) : (
                          <Circle className="size-4 shrink-0 text-muted-foreground/50" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{step.name}</span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {agent.name} · {step.output}
                          </span>
                        </span>
                        <Badge
                          variant={status === "complete" ? "secondary" : "outline"}
                          className="shrink-0 text-[10px]"
                        >
                          {status === "complete" ? "Selesai" : status === "draft" ? "Draft" : "Belum"}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
