"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AGENTS, agentForStep, AGENT_LIST } from "@/lib/bmad/agents";
import type { RoadmapStep } from "@/lib/bmad/roadmap";
import { useStudio } from "@/lib/store";
import { opencode } from "@/lib/opencode/client";
import { guidanceOutputRequirements, normalizeAgentGuidance } from "@/lib/bmad/agent-output";
import type { Project } from "@/lib/bmad/types";

interface Props {
  step: RoadmapStep;
  project: Project;
}

export function AgentPanel({ step, project }: Props) {
  const settings = useStudio((s) => s.settings);
  const setProjectSession = useStudio((s) => s.setProjectSession);
  const setArtifactContent = useStudio((s) => s.setArtifactContent);
  const lead = agentForStep(step.id);
  const [activeAgent, setActiveAgent] = useState(lead.id);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agent = AGENTS[activeAgent as keyof typeof AGENTS];

  async function requestGuidance() {
    if (!project.directory) {
      setError("This project has no working directory set.");
      return;
    }
    setLoading(true);
    setGuidance(null);
    setError(null);

    const prior = Object.entries(project.artifacts)
      .filter(([, a]) => a.content.trim().length > 0)
      .map(([stepId, a]) => `${stepId}: ${a.content.slice(0, 500)}`);

    const system = [
      `You are ${agent.name}, a ${agent.title} in the BMAD Method (Agile AI-Driven Development).`,
      `Communication style: ${agent.style}`,
      ``,
      `You are guiding the user through the "${step.name}" step (BMAD skill ${step.code}).`,
      `Goal of this step: ${step.description}`,
      `The output artifact will be: ${step.output}`,
      ``,
      `Project: ${project.name}. ${project.description}`,
      prior.length ? `Prior artifacts (excerpts):\n${prior.join("\n---\n")}` : `No prior artifacts yet.`,
      ``,
      guidanceOutputRequirements(step.id),
    ].join("\n");

    try {
      const res = await opencode.chat({
        directory: project.directory,
        sessionId: project.sessionId,
        message: `Guide me through the "${step.name}" step. Ask the key questions and give me BMAD-style direction.`,
        system,
        model: settings.defaultModel,
        agent: settings.defaultAgent,
        title: `${project.name} — BMAD`,
      });
      if (res.sessionId && res.sessionId !== project.sessionId) {
        setProjectSession(project.id, res.sessionId);
      }
      setGuidance(normalizeAgentGuidance(step.name, res.text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get guidance");
    } finally {
      setLoading(false);
    }
  }

  async function useAsDraft() {
    if (!guidance) return;
    setSavingDraft(true);
    setError(null);
    try {
      setArtifactContent(project.id, step.id, guidance, "draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-muted flex size-11 items-center justify-center rounded-full text-2xl">
          {agent.icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{agent.name}</span>
            <Badge variant="secondary" className="text-[10px]">
              {agent.title}
            </Badge>
          </div>
          <p className="text-muted-foreground truncate text-xs">OpenCode</p>
        </div>
      </div>

      <p className="text-muted-foreground text-sm italic">&ldquo;{agent.style}&rdquo;</p>

      <div className="flex flex-wrap gap-1.5">
        {AGENT_LIST.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setActiveAgent(a.id);
              setGuidance(null);
            }}
            className={
              "rounded-full border px-2.5 py-1 text-xs transition-colors " +
              (a.id === activeAgent
                ? "border-primary bg-primary/10 font-medium"
                : "hover:bg-accent")
            }
            title={a.essence}
          >
            {a.icon} {a.name}
          </button>
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={requestGuidance}
        disabled={loading || !project.directory}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        Ask {agent.name} to guide this step
      </Button>

      {guidance && (
        <Button
          size="sm"
          className="w-full"
          onClick={useAsDraft}
          disabled={savingDraft}
        >
          {savingDraft ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Use as draft
        </Button>
      )}

      {error && (
        <p className="text-destructive text-sm">{error}</p>
      )}

      {guidance && (
        <div className="bg-muted/50 space-y-2 rounded-md border p-3 text-sm whitespace-pre-wrap">
          {guidance}
        </div>
      )}
    </div>
  );
}
