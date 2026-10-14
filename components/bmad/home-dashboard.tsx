"use client";

import Link from "next/link";
import { ArrowRight, Boxes, LayoutDashboard, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useStudio } from "@/lib/store";
import { nextStepId, projectProgress } from "@/lib/progress";
import { stepById } from "@/lib/bmad/roadmap";
import { useHydrated } from "@/lib/use-hydrated";

export function HomeDashboard() {
  const projects = useStudio((state) => state.projects);
  const hydrated = useHydrated();
  const sortedProjects = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const currentProject = sortedProjects[0];
  const nextId = currentProject ? nextStepId(currentProject) : undefined;
  const nextStep = nextId ? stepById(nextId) : undefined;
  const progress = currentProject ? projectProgress(currentProject) : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
            <Boxes className="size-4" /> BMAD Studio
          </p>
          <h1 className="text-2xl font-bold">Ruang kerja proyek</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Lanjutkan dari langkah terakhir, atau mulai proyek baru.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/settings">
            <Button variant="outline"><Settings className="size-4" /> OpenCode</Button>
          </Link>
          <Link href="/projects">
            <Button><Plus className="size-4" /> Proyek baru</Button>
          </Link>
        </div>
      </header>

      {!hydrated ? (
        <p className="text-muted-foreground py-12 text-center text-sm">Memuat proyek…</p>
      ) : currentProject && progress ? (
        <>
          <section aria-labelledby="continue-heading" className="mb-10">
            <h2 id="continue-heading" className="mb-3 text-sm font-semibold">Lanjutkan proyek</h2>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{currentProject.name}</CardTitle>
                <CardDescription>
                  {currentProject.description || "Belum ada deskripsi proyek."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="text-muted-foreground flex justify-between text-xs">
                    <span>{progress.done} dari {progress.total} langkah selesai</span>
                    <span>{progress.pct}%</span>
                  </div>
                  <Progress value={progress.pct} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm">
                    {nextStep ? <>Langkah berikutnya: <strong>{nextStep.name}</strong></> : "Semua langkah selesai"}
                  </p>
                  <Link href={`/projects/${currentProject.id}`}>
                    <Button>
                      <LayoutDashboard className="size-4" />
                      {nextStep ? "Lanjutkan" : "Buka proyek"}
                      <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </section>

          {sortedProjects.length > 1 && (
            <section aria-labelledby="other-projects-heading">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="other-projects-heading" className="text-sm font-semibold">Proyek lainnya</h2>
                <Link href="/projects" className="text-muted-foreground hover:text-foreground text-sm">
                  Lihat semua
                </Link>
              </div>
              <div className="divide-y rounded-lg border">
                {sortedProjects.slice(1, 5).map((project) => {
                  const stepId = nextStepId(project);
                  const step = stepId ? stepById(stepId) : undefined;
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="hover:bg-muted/50 flex items-center justify-between gap-4 px-4 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{project.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {step ? `Berikutnya: ${step.name}` : "Semua langkah selesai"}
                        </span>
                      </span>
                      <ArrowRight className="text-muted-foreground size-4 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Boxes className="text-muted-foreground size-10" />
            <h2 className="font-semibold">Belum ada proyek</h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              Mulai dari ide, susun rencana seperlunya, lalu bangun dan verifikasi software di folder proyek.
            </p>
            <Link href="/projects">
              <Button><Plus className="size-4" /> Buat proyek pertama</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}