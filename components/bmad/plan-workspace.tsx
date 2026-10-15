"use client";
import { useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Sparkles, Check, X, Circle, TriangleAlert, LayoutDashboard, FolderDown, FolderUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useStudio } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { stepById, STEPS, PHASES, stepsForScale } from "@/lib/bmad/roadmap";
import { PlanOverview } from "@/components/bmad/plan-overview";
import { TEMPLATES, draftSkeleton } from "@/lib/bmad/templates";
import { normalizeMarkdown } from "@/lib/bmad/markdown";
import { markdownOutline } from "@/lib/bmad/chunking";
import { buildDraftContext } from "@/lib/bmad/context";
import { agentForStep } from "@/lib/bmad/agents";
import { nextStepId } from "@/lib/progress";
import { PhaseStepper } from "@/components/bmad/phase-stepper";
import { ArtifactEditor, type DraftMode } from "@/components/bmad/artifact-editor";
import { AgentPanel } from "@/components/bmad/agent-panel";
import { opencode } from "@/lib/opencode/client";
import { directAI } from "@/lib/ai/client";
import { projectFiles } from "@/lib/project-files/client";
import type { Project, StepId } from "@/lib/bmad/types";

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
  const [draftError, setDraftError] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkStepId, setBulkStepId] = useState<StepId | null>(null);
  const [bulkTargets, setBulkTargets] = useState<StepId[]>([]);
  const [bulkStatus, setBulkStatus] = useState<Record<string, "pending" | "doing" | "done" | "failed">>({});
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkFailed, setBulkFailed] = useState(0);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const bulkCancelRef = useRef(false);
  // Sync artefak ↔ folder project (docs/bmad).
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  // Explicit choice: Manual (wizard form, local) vs Agent (AI draft via
  // OpenCode / Direct AI depending on Settings → Guidance via).
  const [draftMode, setDraftMode] = useState<DraftMode>("manual");
  const stepFromUrl = searchParams.get("step");
  // Default tab Rencana = Overview (tidak auto-pilih step).
  // Step hanya terpilih jika ?step= ada di URL.
  const selectedStepId: StepId | null = stepFromUrl && stepById(stepFromUrl as StepId)
    ? (stepFromUrl as StepId)
    : null;

  const selectedStep = selectedStepId ? stepById(selectedStepId) : undefined;

  // Prev/Next order follows the sidebar: phases in order, steps filtered by scale.
  const allowed = new Set(stepsForScale(project.scale).map((s) => s.id));
  const navOrder = PHASES.flatMap((p) => p.steps.filter((id) => allowed.has(id)));
  const navIndex = selectedStepId ? navOrder.indexOf(selectedStepId) : -1;
  const prevNavId = navIndex > 0 ? (navOrder[navIndex - 1] as StepId) : null;
  const nextNavId =
    navIndex >= 0 && navIndex < navOrder.length - 1 ? (navOrder[navIndex + 1] as StepId) : null;

  function goToStep(stepId: StepId) {
    const q = new URLSearchParams(searchParams.toString());
    q.set("step", stepId);
    q.delete("tab");
    router.replace(`/projects/${project.id}${q.toString() ? `?${q.toString()}` : ""}`);
  }

  function goToOverview() {
    const q = new URLSearchParams(searchParams.toString());
    q.delete("step");
    q.delete("tab");
    router.replace(`/projects/${project.id}${q.toString() ? `?${q.toString()}` : ""}`);
  }

  const overviewActive = selectedStepId === null;
  const nextOverviewId = nextStepId(project) as StepId | undefined;
  const nextOverviewStep = nextOverviewId ? stepById(nextOverviewId) : undefined;

  async function handleSyncToFolder() {
    if (!project.directory || syncing) return;
    setSyncing(true);
    setFileMsg(null);
    try {
      const files = STEPS.map((s) => ({
        filename: s.output,
        content: project.artifacts[s.id]?.content ?? "",
      })).filter((f) => f.content.trim().length > 0);
      if (files.length === 0) {
        setFileMsg("Belum ada artefak berisi untuk disync.");
        return;
      }
      const res = await projectFiles.sync(project.directory, files);
      setFileMsg(`Tersync ${res.written.length} file ke docs/bmad/${res.skipped.length > 0 ? ` (${res.skipped.length} dilewati)` : ""}.`);
    } catch (e) {
      setFileMsg(e instanceof Error ? e.message : "Sync gagal");
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportFromFolder() {
    if (!project.directory || importing) return;
    setImporting(true);
    setFileMsg(null);
    try {
      const res = await projectFiles.read(project.directory);
      const byOutput = new Map(STEPS.map((s) => [s.output, s.id]));
      let n = 0;
      for (const [filename, content] of Object.entries(res.files)) {
        const stepId = byOutput.get(filename) as StepId | undefined;
        if (!stepId || !content.trim()) continue;
        const cur = project.artifacts[stepId];
        if (cur?.content.trim() === content.trim()) continue;
        setArtifactContent(project.id, stepId, content, cur?.status === "complete" ? "complete" : "draft");
        n++;
      }
      setFileMsg(n > 0 ? `Diimpor ${n} artefak dari docs/bmad/.` : "Tidak ada file baru di docs/bmad/.");
    } catch (e) {
      setFileMsg(e instanceof Error ? e.message : "Impor gagal");
    } finally {
      setImporting(false);
    }
  }

  const hasDirectory = Boolean(project.directory);
  // Direct AI needs no OpenCode session, so drafting works without a directory.
  const needsDirectory = settings.guidanceMode !== "direct";
  const hasSeedArtifact = Object.values(project.artifacts).some((a) =>
    a.content.trim().length > 0
  );

  async function elaborateStep(stepId: StepId): Promise<string | null> {
    // Always read the freshest project so chained drafts (bulk mode) build on
    // drafts created moments ago in the same run.
    const fresh = useStudio.getState().getProject(project.id) ?? project;
    const step = stepById(stepId);
    const direct = settings.guidanceMode === "direct";
    if (!step || (!fresh.directory && !direct)) return null;
    const agent = agentForStep(stepId);
    const tpl = TEMPLATES[stepId];
    // The best-practice draft skeleton: same shape the manual wizard fills.
    // The agent elaborates THIS skeleton using prior phase drafts as context.
    const skeleton = draftSkeleton(stepId, fresh.name);
    const questions = (tpl?.questions ?? []).map((q) => `- ${q.label}`).join("\n");
    // Prior-phase context: full artifacts, or (retrieval mode) outline +
    // top-k chunks retrieved by bge-m3 — much smaller prompt, same chain.
    const context = await buildDraftContext({
      project: fresh,
      query: `${step.name}. ${step.description} ${markdownOutline(skeleton).headings.join(" · ")}`,
      settings,
    });

    const machineRule =
      stepId === "epics-stories"
        ? `MANDATORY: end the artifact with a "## Machine Data" section containing a fenced block:\n\`\`\`json tasks\n[{"title": "User bisa ...", "epic": "Epic title", "detail": "AC1: ... AC2: ..."}]\n\`\`\`\nOne entry per story, titles short imperative. This block is read by software — keep it valid JSON.`
        : stepId === "sprint-planning"
          ? `MANDATORY: end the artifact with a "## Machine Data" section containing a fenced block with the EXACT fence language "json sprint":\n\`\`\`json sprint\n{"name": "Sprint 1 — theme", "goal": "...", "taskTitles": ["exact story title"]}\n\`\`\`\nRules for this block: valid JSON object (no trailing commas, no comments, double quotes only). taskTitles MUST be an array of exact story-title strings (not objects). Do not rename the fence to plain "json".`
          : ``;
    const system = [
      `You are ${agent.name}, a ${agent.title} in the BMAD Method. Communication style: ${agent.style}`,
      `Write the draft for the "${step.name}" step. Output artifact: ${step.output}.`,
      `Step goal: ${step.description}`,
      ``,
      context.text,
      ``,
      `Elaborate the draft skeleton below into a complete, high-quality draft. Keep every section heading exactly as-is, replace each "—" placeholder with real content grounded in the prior-phase drafts above, and stay consistent with decisions already made. Where a prior draft is silent, make a sensible proposal and flag it as a proposal.`,
      ``,
      `--- DRAFT SKELETON (keep this structure) ---`,
      skeleton,
      `--- END SKELETON ---`,
      ``,
      machineRule,
      questions ? `Ensure these BMAD aspects are covered in the matching sections:\n${questions}` : ``,
      ``,
      `Rules: Output ONLY the artifact content (Markdown/YAML), no preamble, no commentary. Fenced json tasks/sprint blocks ARE part of the artifact and must be kept.`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = direct
      ? await directAI.chat({
          system,
          messages: [{ role: "user", content: `Write the draft for "${step.name}".` }],
        })
      : await opencode.chat({
          directory: fresh.directory,
          sessionId: fresh.sessionId,
          message: `Write the draft for "${step.name}".`,
          system,
          model: settings.defaultModel,
          agent: settings.defaultAgent,
          title: `${fresh.name} — BMAD`,
        });
    if (!direct && "sessionId" in res && res.sessionId && res.sessionId !== fresh.sessionId) {
      setProjectSession(project.id, res.sessionId);
    }
    if (!res.text) throw new Error("Empty response");
    const clean = normalizeMarkdown(res.text);
    setArtifactContent(project.id, stepId, clean, "draft");
    return clean;
  }

  async function handleBuatkanDraft() {
    if (!selectedStepId) return;
    if (!hasDirectory && needsDirectory) return;
    if (project.artifacts[selectedStepId]?.status === "complete") return;
    if (elaborating || bulkRunning) return;
    setElaborating(selectedStepId);
    setDraftError(null);
    try {
      await elaborateStep(selectedStepId);
      // Show the result in the agent editor.
      setDraftMode("agent");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Failed to create draft");
    }
    setElaborating(null);
  }

  /** Targets for bulk generation: visible plan steps, skipping locked (complete) ones. */
  function computeBulkTargets(): StepId[] {
    const live = useStudio.getState().getProject(project.id) ?? project;
    return navOrder.filter(
      (id) =>
        stepById(id)?.phase !== "anytime" &&
        (live.artifacts[id]?.status ?? "not-started") !== "complete"
    ) as StepId[];
  }

  async function handleBulkDraft() {
    if (bulkRunning || elaborating) return;
    if (!hasDirectory && needsDirectory) return;
    const targets = computeBulkTargets();
    if (targets.length === 0) return;
    setBulkConfirmOpen(false);
    bulkCancelRef.current = false;
    setBulkTargets(targets);
    setBulkStatus(Object.fromEntries(targets.map((id) => [id, "pending"])));
    setBulkRunning(true);
    setBulkFailed(0);
    setBulkProgress({ done: 0, total: targets.length });
    setBulkModalOpen(true);
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (bulkCancelRef.current) break;
      setBulkStepId(targets[i]);
      setBulkStatus((m) => ({ ...m, [targets[i]]: "doing" }));
      try {
        await elaborateStep(targets[i]);
        setBulkStatus((m) => ({ ...m, [targets[i]]: "done" }));
      } catch {
        failed += 1;
        setBulkStatus((m) => ({ ...m, [targets[i]]: "failed" }));
      }
      setBulkProgress({ done: i + 1, total: targets.length });
    }
    setBulkStepId(null);
    setBulkRunning(false);
    setBulkFailed(failed);
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
            <div className="mb-4 space-y-2">
              <Button
                size="sm"
                variant={overviewActive ? "secondary" : "ghost"}
                className="w-full justify-start"
                onClick={goToOverview}
              >
                <LayoutDashboard className="size-4" /> Overview
              </Button>
            </div>
            <div className="mb-6 space-y-2 border-b pb-5">
              <Button
                size="sm"
                className="w-full"
                disabled={(!hasDirectory && needsDirectory) || !!elaborating}
                onClick={() => {
                  if (bulkRunning) {
                    setBulkModalOpen(true);
                    return;
                  }
                  setBulkFailed(0);
                  setBulkProgress(null);
                  setBulkConfirmOpen(true);
                }}
              >
                {bulkRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {bulkRunning && bulkProgress
                  ? `Membuat ${bulkProgress.done}/${bulkProgress.total}… (lihat)`
                  : "Generate semua draft"}
              </Button>
              {!bulkRunning && bulkProgress && bulkProgress.done > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Terakhir: {bulkProgress.done}/{bulkProgress.total} draft
                  {bulkFailed > 0 && (
                    <span className="text-destructive"> · {bulkFailed} gagal, ulangi untuk sisa</span>
                  )}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Button size="sm" variant="outline" className="w-full justify-start" disabled={!hasDirectory || syncing} onClick={handleSyncToFolder}>
                  {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <FolderDown className="size-3.5" />} Sync ke folder
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start" disabled={!hasDirectory || importing} onClick={handleImportFromFolder}>
                  {importing ? <Loader2 className="size-3.5 animate-spin" /> : <FolderUp className="size-3.5" />} Impor dari folder
                </Button>
              </div>
              {fileMsg && <p className="text-xs text-muted-foreground">{fileMsg}</p>}
            </div>
            <PhaseStepper
              project={project}
              activeStepId={selectedStepId ?? undefined}
              processingStepId={bulkStepId}              onSelect={(id) => {
                const stepId = id as StepId;
                goToStep(stepId);
              }}
            />
          </CardContent>
        </Card>
      </aside>

      {/* Center column — overview default, wizard / editor for the selected step */}
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
              </div>
            </CardHeader>
            <CardContent>
              {(elaborating || draftError) && (
                <div className="mb-3 flex items-center gap-2 text-xs">
                  {elaborating === selectedStep.id && (
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" /> Agent sedang membuat draft…
                    </span>
                  )}
                </div>
              )}
              <ArtifactEditor
                key={selectedStep.id}
                step={selectedStep}
                project={project}
                draftMode={draftMode}
                onDraftModeChange={setDraftMode}
                onSave={(content, status) => setArtifactContent(project.id, selectedStep.id, content, status)}
                prevStep={
                  prevNavId && stepById(prevNavId)
                    ? { id: prevNavId, name: stepById(prevNavId)!.name }
                    : null
                }
                nextStep={
                  nextNavId && stepById(nextNavId)
                    ? { id: nextNavId, name: stepById(nextNavId)!.name }
                    : null
                }
                onNavigate={goToStep}
              />
              {!hasDirectory && needsDirectory && mounted && (
                <p className="text-muted-foreground mt-3 text-xs">
                  Set a working directory on this project to enable agent drafting.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <PlanOverview project={project} onSelect={goToStep} />
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
              <AgentPanel
                key={selectedStep.id}
                step={selectedStep}
                project={project}
                drafting={elaborating === selectedStep.id || bulkStepId === selectedStep.id}
                error={draftError}
                draftDisabled={
                  (!hasDirectory && needsDirectory) ||
                  draftMode === "manual" ||
                  bulkRunning ||
                  project.artifacts[selectedStep.id]?.status === "complete"
                }
                isComplete={project.artifacts[selectedStep.id]?.status === "complete"}
                isManual={draftMode === "manual"}
                onBuatkanDraft={handleBuatkanDraft}
              />
            ) : nextOverviewStep && nextOverviewId ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  <span aria-hidden>{agentForStep(nextOverviewId).icon} </span>
                  {agentForStep(nextOverviewId).name}
                </p>
                <p className="text-muted-foreground text-xs">
                  Memandu langkah berikutnya: <strong>{nextOverviewStep.name}</strong>. Klik
                  langkah di Overview atau Roadmap untuk mulai.
                </p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => goToStep(nextOverviewId)}>
                  Buka {nextOverviewStep.name}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Semua langkah selesai. Siap ke Eksekusi.
              </p>
            )}
          </CardContent>
        </Card>
      </aside>
      </div>

      <Dialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <DialogContent className="grid-cols-1 min-w-0">
          <DialogHeader>
            <DialogTitle>Generate semua draft otomatis?</DialogTitle>
            <DialogDescription>
              Agent akan mengisi {computeBulkTargets().length} draft fase berurutan — tiap draft
              disusun dari draft fase-fase sebelumnya. Proses ini memakan {computeBulkTargets().length} panggilan AI
              dan bisa dibatalkan antar fase.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>Perhatian:</strong> SEMUA fase yang belum complete akan diisi ulang oleh agent —
              termasuk draft yang sudah ada isinya akan <strong>ditimpa</strong>. Step yang sudah
              complete dilewati dan aman.
            </span>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkConfirmOpen(false)}>Batal</Button>
            <Button onClick={handleBulkDraft} disabled={computeBulkTargets().length === 0}>
              <Sparkles className="size-4" /> Generate {computeBulkTargets().length} draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkModalOpen} onOpenChange={setBulkModalOpen}>
        <DialogContent className="grid-cols-1 min-w-0" onInteractOutside={(e) => bulkRunning && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>
              {bulkRunning
                ? `Membuat draft ${bulkProgress?.done ?? 0}/${bulkProgress?.total ?? 0}…`
                : "Generate semua draft selesai"}
            </DialogTitle>
            <DialogDescription>
              {bulkRunning
                ? "Tiap fase tersimpan otomatis begitu selesai — sidebar ikut berubah realtime."
                : bulkFailed > 0
                  ? `${(bulkProgress?.done ?? 0) - bulkFailed} berhasil, ${bulkFailed} gagal. Klik Generate lagi untuk memproses sisanya.`
                  : "Semua draft berhasil dibuat dari konteks fase sebelumnya."}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-1 overflow-auto">
            {bulkTargets.map((id) => {
              const st = bulkStatus[id] ?? "pending";
              return (
                <li
                  key={id}
                  className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm"
                >
                  {st === "doing" ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                  ) : st === "done" ? (
                    <Check className="size-4 shrink-0 text-emerald-500" />
                  ) : st === "failed" ? (
                    <X className="size-4 shrink-0 text-destructive" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground/50" />
                  )}
                  <span className={st === "doing" ? "font-medium" : "text-muted-foreground"}>
                    {stepById(id)?.name ?? id}
                  </span>
                  <span className="text-muted-foreground ml-auto text-[11px]">
                    {st === "doing" ? "memproses…" : st === "done" ? "selesai" : st === "failed" ? "gagal" : "antri"}
                  </span>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            {bulkRunning ? (
              <Button variant="outline" onClick={() => { bulkCancelRef.current = true; }}>
                Batalkan (setelah fase ini)
              </Button>
            ) : (
              <Button onClick={() => setBulkModalOpen(false)}>Tutup</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
