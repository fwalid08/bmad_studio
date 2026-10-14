"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Rocket, ArrowRight, RefreshCcw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlanWorkspace } from "@/components/bmad/plan-workspace";
import { BuildPanel } from "@/components/bmad/build-panel";
import { useStudio } from "@/lib/store";
import { opencode } from "@/lib/opencode/client";
import { nextStepId, projectProgress } from "@/lib/progress";
import { useHydrated } from "@/lib/use-hydrated";
import { stepById } from "@/lib/bmad/roadmap";

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

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold">{project.name}</h1>
            <p className="text-muted-foreground text-sm">{project.description || "BMAD workspace"}</p>
          </div>
        </div>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <Progress value={prog.pct} className="h-2 flex-1" />
        <span className="text-muted-foreground text-xs tabular-nums">
          {prog.done}/{prog.total} step selesai
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={createFreshSession} disabled={!project.directory}>
            <Plus className="size-4" /> New session
          </Button>
          <Button size="sm" variant="ghost" onClick={resetSession} disabled={!project.sessionId}>
            <RefreshCcw className="size-4" /> Reset session
          </Button>
        </div>
        <code className="text-muted-foreground hidden max-w-[40%] truncate text-xs sm:block" title={project.directory}>
          {project.directory || "no directory"}
        </code>
      </div>

      {nextStepInfo && (
        <div className="mb-5 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-[0.12em]">Next recommended step</p>
              <p className="mt-1 text-base font-semibold">{nextStepInfo.name}</p>
              <p className="text-muted-foreground text-sm">{nextStepInfo.description}</p>
            </div>
            <Button size="sm" onClick={() => setTab("rencana", nextStepInfo.id)}>
              Continue <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v, searchParams.get("step") ?? undefined)} className="gap-4">
        <TabsList>
          <TabsTrigger value="rencana">Rencana</TabsTrigger>
          <TabsTrigger value="eksekusi">
            <Rocket className="size-4" /> Eksekusi
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rencana">
          <PlanWorkspace project={project} />
        </TabsContent>
        <TabsContent value="eksekusi">
          <BuildPanel project={project} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default function ProjectWorkspace() {
  return <Suspense fallback={<main className="flex-1 p-10"><p className="text-muted-foreground text-sm">Loading…</p></main>}><Workspace /></Suspense>;
}
