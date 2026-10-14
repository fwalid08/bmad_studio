"use client";
import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Sparkles, Loader2, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useStudio } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { stepsForScale, stepById, STEPS } from "@/lib/bmad/roadmap";
import { TEMPLATES } from "@/lib/bmad/templates";
import { agentForStep } from "@/lib/bmad/agents";
import { nextStepId } from "@/lib/progress";
import { PhaseStepper } from "@/components/bmad/phase-stepper";
import { ArtifactEditor } from "@/components/bmad/artifact-editor";
import { AgentPanel } from "@/components/bmad/agent-panel";
import { opencode } from "@/lib/opencode/client";
import type { Project, StepId, Artifact } from "@/lib/bmad/types";

/** Build an ordered context chain from the project's artifacts (roadmap order),
 *  so later phases are drafted from what earlier phases already captured.
 *  project.description acts as the seed when nothing is authored yet. */
function artifactContext(project: Project): string {
  const order = STEPS.map((s) => s.id);
  const entries = Object.entries(project.artifacts)
    .filter(([, a]) => a.content.trim().length > 0)
    .sort(([a], [b]) => order.indexOf(a as StepId) - order.indexOf(b as StepId));

  if (!entries.length) {
    return `Project: ${project.name}. ${project.description}`;
  }
  const chain = entries
    .map(([stepId, a]) => `### ${stepById(stepId as StepId)?.name ?? stepId}\n${a.content.trim()}`)
    .join("\n\n");
  return `Project: ${project.name}. ${project.description}\n\nContext (prior BMAD artifacts, in order):\n${chain}`;
}

export function PlanWorkspace({ project }: { project: Project }) {
  const settings = useStudio((s) => s.settings);
  const setArtifactContent = useStudio((s) => s.setArtifactContent);
  const setProjectSession = useStudio((s) => s.setProjectSession);
  const mounted = useHydrated();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [elaborating, setElaborating] = useState<string | null>(null);
  const [elaborateAllBusy, setElaborateAllBusy] = useState(false);
  const [elabProgress, setElabProgress] = useState<{ done: number; total: number } | null>(null);
  const stepFromUrl = searchParams.get("step");
  const selectedStepId: StepId | null = stepFromUrl && stepById(stepFromUrl as StepId)
    ? (stepFromUrl as StepId)
    : ((nextStepId(project) as StepId | undefined) ?? null);

  const steps = stepsForScale(project.scale).filter((s) => s.phase !== "anytime");
  const selectedStep = selectedStepId ? stepById(selectedStepId) : undefined;

  const hasDirectory = Boolean(project.directory);
  const hasSeedArtifact = Object.values(project.artifacts).some(
    (a: Artifact) => a.content.trim().length > 0
  );

  async function elaborateStep(stepId: StepId): Promise<string | null> {
    const step = stepById(stepId);
    if (!step || !project.directory) return null;
    const agent = agentForStep(stepId);
    const tpl = TEMPLATES[stepId];
    const questions = (tpl?.questions ?? []).map((q) => `- ${q.label}`).join("\n");

    const system = [
      `You are ${agent.name}, a ${agent.title} in the BMAD Method. Communication style: ${agent.style}`,
      `Write a first-draft for the "${step.name}" step. Output artifact: ${step.output}.`,
      `Step goal: ${step.description}`,
      ``,
      artifactContext(project),
      ``,
      `Answer these BMAD questions in the artifact where relevant:\n${questions}`,
      ``,
      `Rules: Output ONLY the artifact content (Markdown/YAML), no preamble, no code fences, no commentary.`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await opencode.chat({
      directory: project.directory,
      sessionId: project.sessionId,
      message: `Write the draft for "${step.name}".`,
      system,
      model: settings.defaultModel,
      agent: settings.defaultAgent,
      title: `${project.name} — BMAD`,
    });
    if (res.sessionId && res.sessionId !== project.sessionId) {
      setProjectSession(project.id, res.sessionId);
    }
    if (!res.text) throw new Error("Empty response");
    setArtifactContent(project.id, stepId, res.text, "draft");
    return res.text;
  }

  async function handleElaborateAll() {
    if (!hasDirectory || elaborateAllBusy) return;
    setElaborateAllBusy(true);
    setElabProgress({ done: 0, total: steps.length });
    for (let i = 0; i < steps.length; i++) {
      setElaborating(steps[i].id);
      try {
        await elaborateStep(steps[i].id);
      } catch {
        // skip failed steps; user can retry individually
      }
      setElabProgress({ done: i + 1, total: steps.length });
    }
    setElaborating(null);
    setElaborateAllBusy(false);
  }

  async function handleElaborateOne(stepId: StepId) {
    if (!hasDirectory) return;
    setElaborating(stepId);
    try {
      await elaborateStep(stepId);
    } catch {
      // ignore — draft stays empty
    }
    setElaborating(null);
  }

  return (
    <div className="space-y-6">
      {/* Top — seed hint (the project description is the seed; artifacts chain forward) */}
      {!hasSeedArtifact && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Mulai dari ide</CardTitle>
            <CardDescription className="text-xs">
              Belum ada artefak. Kerjakan langkah <strong>Brainstorming</strong> (atau isi
              artefak awal lain) dulu — setiap langkah dielaborasi dari artefak sebelumnya,
              jadi draft selanjutnya selalu menyambung dari keputusan yang sudah dibuat.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        {/* Left column — BMAD roadmap sidebar */}
        <aside className="space-y-4 lg:pr-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Roadmap</CardTitle>
            </CardHeader>
          <CardContent>
            <PhaseStepper
              project={project}
              activeStepId={selectedStepId ?? undefined}
              onSelect={(id) => {
                const stepId = id as StepId;
                const q = new URLSearchParams(searchParams.toString());
                q.set("step", stepId);
                q.delete("tab");
                router.replace(`/projects/${project.id}${q.toString() ? `?${q.toString()}` : ""}`);
              }}
            />
          </CardContent>
        </Card>
      </aside>

      {/* Center column — wizard / editor for the selected step */}
      <div className="min-w-0">
        {selectedStep ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span aria-hidden>{agentForStep(selectedStep.id).icon}</span>
                    {selectedStep.name}
                  </CardTitle>
                  <CardDescription>{selectedStep.description}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {elabProgress && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {elabProgress.done}/{elabProgress.total} langkah
                    </span>
                  )}
                  <Button size="sm" variant="outline" title="Susun draft semua langkah dari artefak yang sudah ada"
                    disabled={!hasDirectory || elaborateAllBusy}
                    onClick={handleElaborateAll}>
                    {elaborateAllBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {elaborateAllBusy ? "Mengelaborasi…" : "Elaborasi semua fase"}
                  </Button>
                  <Button size="sm" variant="outline" title="Minta agen tuliskan draft"
                    disabled={!hasDirectory || elaborating === selectedStep.id}
                    onClick={() => handleElaborateOne(selectedStep.id)}>
                    {elaborating === selectedStep.id ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Draft
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ArtifactEditor
                key={`${selectedStep.id}:${project.artifacts[selectedStep.id]?.updatedAt ?? ""}`}
                step={selectedStep}
                project={project}
                onSave={(content, status) => setArtifactContent(project.id, selectedStep.id, content, status)}
              />
              {!hasDirectory && mounted && (
                <p className="text-muted-foreground mt-3 text-xs">
                  Set a working directory on this project to enable agent drafting.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <MousePointerClick className="text-muted-foreground size-8" />
            <CardTitle className="text-base">Pilih sebuah langkah</CardTitle>
            <CardDescription>
              Klik salah satu langkah di roadmap (kiri) untuk mulai mengerjakan artefaknya.
            </CardDescription>
          </Card>
        )}
      </div>

      {/* Right column — BMAD agent */}
      <aside className="space-y-6 lg:pl-1">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Agen BMAD</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedStep ? (
              <AgentPanel key={selectedStep.id} step={selectedStep} project={project} />
            ) : (
              <p className="text-muted-foreground text-sm">
                Pilih langkah untuk melihat agen yang memandu pekerjaan ini.
              </p>
            )}
          </CardContent>
        </Card>
      </aside>
      </div>
    </div>
  );
}
