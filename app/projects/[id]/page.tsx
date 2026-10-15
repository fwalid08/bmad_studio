"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Rocket, ArrowRight, FolderGit2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlanWorkspace } from "@/components/bmad/plan-workspace";
import { ExecutionPanel } from "@/components/bmad/execution-panel";
import { EditProjectButton } from "@/components/bmad/project-actions";
import { FolderSyncButtons } from "@/components/bmad/folder-sync-buttons";
import { useStudio } from "@/lib/store";
import { nextStepId, projectProgress } from "@/lib/progress";
import { useHydrated } from "@/lib/use-hydrated";
import { stepById, PHASES, stepsForScale, STEPS } from "@/lib/bmad/roadmap";
import { agentForStep } from "@/lib/bmad/agents";
import { useNotifications } from "@/components/ui/notifications";

/** True bila masih ada artefak berisi yang BELUM tersinkron ke folder project:
 *  belum pernah sync, atau ada artefak yang diubah setelah stempel sync terakhir. */
function hasUnsyncedArtifacts(project: NonNullable<ReturnType<typeof useStudio.getState>["projects"][number]>): boolean {
  const hasContent = STEPS.some((s) => project.artifacts[s.id]?.content.trim());
  if (!hasContent) return false; // belum ada isi → tidak ada yang perlu disync
  const stamp = project.lastFolderSyncAt ? Date.parse(project.lastFolderSyncAt) : NaN;
  if (!Number.isFinite(stamp)) return true;
  return STEPS.some((s) => {
    const a = project.artifacts[s.id];
    if (!a?.content.trim()) return false;
    const t = Date.parse(a.updatedAt);
    return Number.isFinite(t) && t > stamp;
  });
}

function Workspace() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hydrated = useHydrated();
  const projects = useStudio((s) => s.projects);
  const notify = useNotifications();

  const id = typeof params.id === "string" ? params.id : undefined;
  const project = id ? projects.find((p) => p.id === id) : undefined;

  const urlTab = searchParams.get("tab");
  const unsynced = project ? hasUnsyncedArtifacts(project) : false;
  // Tab Eksekusi terkunci sampai artefak tersinkron; URL ?tab=eksekusi paksa
  // fallback ke Rencana supaya project lama yang sudah "terlanjur" tidak aneh.
  const tab = urlTab === "eksekusi" && !unsynced ? "eksekusi" : "rencana";
  const nextStep = project ? nextStepId(project) : undefined;
  const nextStepInfo = nextStep ? stepById(nextStep) : undefined;
  function setTab(v: string, stepId?: string) {
    if (v === "eksekusi" && unsynced) {
      notify({
        kind: "error",
        title: "Tab Eksekusi terkunci",
        description:
          "Artefak belum di-sync ke folder project. Klik Sync folder di card Progress workspace dulu.",
      });
      return;
    }
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
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
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
            </div>
            <p className="text-muted-foreground line-clamp-1 text-sm">{project.description || "BMAD workspace"}</p>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v, searchParams.get("step") ?? undefined)} className="gap-4">
        <TabsList>
          <TabsTrigger value="rencana">Rencana</TabsTrigger>
          <TabsTrigger value="eksekusi" disabled={unsynced} title={unsynced ? "Artefak belum di-sync ke folder project — klik Sync folder dulu" : undefined}>
            <Rocket className="size-4" /> Eksekusi
            {unsynced && (
              <TriangleAlert className="size-3.5 text-amber-500" aria-label="Belum sync" />
            )}
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
            <FolderSyncButtons project={project} />
            {unsynced && (
              <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Artefak belum di-sync ke folder project — tab <strong>Eksekusi</strong> terkunci. Klik <strong>Sync folder</strong> dulu.
                </span>
              </div>
            )}
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
