"use client";

import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { agentForStep } from "@/lib/bmad/agents";
import type { RoadmapStep } from "@/lib/bmad/roadmap";
import type { Project } from "@/lib/bmad/types";

interface Props {
  step: RoadmapStep;
  project: Project;
  drafting: boolean;
  error: string | null;
  draftDisabled: boolean;
  isComplete: boolean;
  isManual: boolean;
  onBuatkanDraft: () => void;
}

export function AgentPanel({
  step,
  project,
  drafting,
  error,
  draftDisabled,
  isComplete,
  isManual,
  onBuatkanDraft,
}: Props) {
  const agent = agentForStep(step.id);
  void project;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-muted flex size-14 shrink-0 items-center justify-center rounded-full text-3xl">
          {agent.icon}
        </div>
        <div className="min-w-0">
          <p className="font-semibold">{agent.name}</p>
          <Badge variant="secondary" className="mt-1 text-[10px]">
            {agent.title}
          </Badge>
        </div>
      </div>

      <p className="text-sm leading-6">{agent.essence}</p>
      <p className="text-muted-foreground text-sm italic">
        &ldquo;{agent.style}&rdquo;
      </p>

      <Button
        className="w-full"
        onClick={onBuatkanDraft}
        disabled={drafting || draftDisabled}
        title={isComplete ? "Step sudah complete — Reopen untuk membuat draft baru" : undefined}
      >
        {drafting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        {drafting ? "Membuat draft…" : "Buatkan draft"}
      </Button>

      {isComplete ? (
        <p className="text-muted-foreground text-xs">
          Draft dikunci karena step sudah complete — klik Reopen di editor untuk membuat draft baru.
        </p>
      ) : (
        isManual && (
          <p className="text-muted-foreground text-xs">
            Pindah ke mode Agent (toggle di atas editor) untuk membuat draft dengan AI.
          </p>
        )
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
