"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Rocket, ArrowRight, RefreshCcw, Plus, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlanWorkspace } from "@/components/bmad/plan-workspace";
import { ExecutionPanel } from "@/components/bmad/execution-panel";
import { EditProjectButton } from "@/components/bmad/project-actions";
import { useStudio } from "@/lib/store";
import { opencode } from "@/lib/opencode/client";
import { nextStepId, projectProgress } from "@/lib/progress";
import { useHydrated } from "@/lib/use-hydrated";
import { stepById, PHASES, stepsForScale } from "@/lib/bmad/roadmap";
import { agentForStep } from "@/lib/bmad/agents";

function Workspace() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrated = useHydrated();
  const projects = useStudio((s) => s.projects);
  const setProjectSession = useStudio((s) => s.setProjectSession);
  const clearProjectSession = useStudio((s) => s.clearProjectSession);

  const id = typeof params.id === "string" ? params.id : undefined;
  const project = id ? projects.find((p) => p.id === id) : undefined;

  const urlTab = searchParams.get("tab");
  const tab = urlTab === "eksekusi" ? "eksekusi" : "rencana";
  const nextStep = project ? nextStepId(project) : undefined;
  const nextStepInfo = nextStep ? stepById(nextStep) : undefined;
  function setTab(v: string, stepId?: string) {
    const q = new URLSearchParams(searchParams.toString());
    if (v === "eksekusi") {
      q.set("tab", "eksekusi");
      q.delete("step");
    } else {
      q.delete("tab");
      if (stepId) q.set("step", stepId);
      else q.delete("step");
    }
    const qs = q.toString();
    router.replace(`/projects/${id}${qs ? `?${qs}` : ""}`);
  }

  async function createFreshSession() {
    if (!project?.directory) return;
    try {
      const res = await opencode.createSession(project.directory, `${project.name} — BMAD`);
      setProjectSession(project.id, res.id);
    } catch {
      // no-op here; user can retry from the app or inspect OpenCode status
    }
  }

  async function resetSession() {
    if (!project?.directory || !project.sessionId) return;
    try {
      await opencode.deleteSession(project.directory, project.sessionId);
      clearProjectSession(project.id);
    } catch {
      // no-op here; if delete fails, leave the current session intact
    }
  }

  if (!hydrated) {
    return <main className="flex-1 p-10"><p className="text-muted-foreground text-sm">Loading…</p></main>;
  }

  if (!project) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">Project not found</h1>
        <Link href="/projects"><Button>Back to projects</Button></Link>
      </main>
    );
  }

  const prog = projectProgress(project);
  const recAgent = nextStepInfo ? agentForStep(nextStepInfo.id) : undefined;
  const recPhase = nextStepInfo ? PHASES.find((p) => p.id === nextStepInfo.phase) : undefined;
  const planSteps = stepsForScale(project.scale).filter((s) => s.phase !== "anytime");
  const recIndex = nextStepInfo ? planSteps.findIndex((s) => s.id === nextStepInfo.id) : -1;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/projects" className="shrink-0">
            <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
          </Link>
          <div className="from-primary/90 to-primary/50 flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-lg font-bold text-white shadow-sm">
            {project.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight">{project.name}</h1>
              <EditProjectButton project={project} />
              <Badge variant="secondary" className="text-[11px] capitalize">{project.scale}</Badge>
              {project.sessionId ? (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Session aktif
                </span>
              ) : (
                <span className="text-muted-foreground text-[11px]">Tanpa session</span>
              )}
            </div>
            <p className="text-muted-foreground line-clamp-1 text-sm">{project.description || "BMAD workspace"}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={createFreshSession} disabled={!project.directory}>
            <Plus className="size-4" /> New session
          </Button>
          <Button size="sm" variant="ghost" onClick={resetSession} disabled={!project.sessionId}>
            <RefreshCcw className="size-4" /> Reset session
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v, searchParams.get("step") ?? undefined)} className="gap-4">
        <TabsList>
          <TabsTrigger value="rencana">Rencana</TabsTrigger>
          <TabsTrigger value="eksekusi">
            <Rocket className="size-4" /> Eksekusi
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rencana" className="space-y-5">
          {nextStepInfo && recAgent && (
            <div className="overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.09] via-card to-card shadow-sm">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
                <div className="bg-primary/10 flex size-13 shrink-0 items-center justify-center rounded-xl text-3xl">
                  <span aria-hidden>{recAgent.icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    Rekomendasi langkah berikutnya
                  </p>
                  <p className="mt-1 text-lg leading-tight font-bold">{nextStepInfo.name}</p>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">{nextStepInfo.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {recPhase && (
                      <Badge variant="secondary" className="text-[11px]">
                        {recPhase.icon} {recPhase.name}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[11px]">{nextStepInfo.code}</Badge>
                    {recIndex >= 0 && (
                      <span className="text-muted-foreground text-[11px] tabular-nums">
                        Langkah {recIndex + 1} dari {planSteps.length}
                      </span>
                    )}
                    <span className="text-muted-foreground text-[11px]">
                      · Dipandu {recAgent.name} ({recAgent.title})
                    </span>
                  </div>
                </div>
                <Button onClick={() => setTab("rencana", nextStepInfo.id)} className="w-full shrink-0 sm:w-auto">
                  Lanjutkan <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Progress workspace</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {prog.done}/{prog.total} step selesai · {prog.pct}%
              </p>
            </div>
            <Progress value={prog.pct} className="h-2.5" />
            <div className="bg-muted/60 mt-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5">
              <FolderGit2 className="text-muted-foreground size-3.5 shrink-0" />
              <code className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={project.directory}>
                {project.directory || "Belum ada working directory"}
              </code>
            </div>
          </div>
          <PlanWorkspace project={project} />
        </TabsContent>
        <TabsContent value="eksekusi">
          <ExecutionPanel project={project} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default function ProjectWorkspace() {
  return <Suspense fallback={<main className="flex-1 p-10"><p className="text-muted-foreground text-sm">Loading…</p></main>}><Workspace /></Suspense>;
}
