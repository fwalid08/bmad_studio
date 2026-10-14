"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ArrowRight, Trash2, Boxes, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStudio } from "@/lib/store";
import { projectProgress, nextStepId, nextRequiredSteps } from "@/lib/progress";
import { stepById } from "@/lib/bmad/roadmap";
import { useHydrated } from "@/lib/use-hydrated";
import { DirectoryPicker } from "@/components/bmad/directory-picker";
import type { ProjectScale } from "@/lib/bmad/types";

const SCALE_INFO: Record<ProjectScale, { label: string; hint: string }> = {
  express: { label: "Express", hint: "Small, clear change — minimal planning, go straight to Build." },
  light: { label: "Light", hint: "Standard feature — PRD, architecture, epics, then build." },
  full: { label: "Full", hint: "Large initiative — every planning gate including UX and retrospective." },
};

export default function ProjectsPage() {
  const projects = useStudio((s) => s.projects);
  const createProject = useStudio((s) => s.createProject);
  const deleteProject = useStudio((s) => s.deleteProject);
  const setProjectDirectory = useStudio((s) => s.setProjectDirectory);
  const router = useRouter();
  const mounted = useHydrated();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scale, setScale] = useState<ProjectScale>("light");
  const [directory, setDirectory] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const canCreate = Boolean(name.trim() && directory.trim());

  function handleCreate() {
    if (!canCreate) return;
    const id = createProject({ name, description, scale, directory });
    setName("");
    setDescription("");
    setScale("light");
    setDirectory("");
    setOpen(false);
    router.push(`/projects/${id}`);
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Boxes className="size-6" /> Projects
          </h1>
          <p className="text-muted-foreground text-sm">
            Each project maps to a working directory in your local OpenCode server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="size-4" /> New project</Button>
            </DialogTrigger>
            <DialogContent className="grid-cols-1 min-w-0">
              <DialogHeader>
                <DialogTitle>New BMAD project</DialogTitle>
                <DialogDescription>
                  Right-size the process and pick the working directory OpenCode will use.
                </DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pname">Project name</Label>
                  <Input id="pname" value={name} placeholder="e.g. Task tracker for teams" onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdesc">Description (optional)</Label>
                  <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line about what you're building." rows={2} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pscale">Process scale</Label>
                  <Select value={scale} onValueChange={(v) => setScale(v as ProjectScale)}>
                    <SelectTrigger id="pscale"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SCALE_INFO) as ProjectScale[]).map((k) => (
                        <SelectItem key={k} value={k}>{SCALE_INFO[k].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">{SCALE_INFO[scale].hint}</p>
                </div>
                <DirectoryPicker value={directory} onChange={setDirectory} />
              </div>
              <DialogFooter>
                <Button onClick={handleCreate} disabled={!canCreate}>Create project</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {!mounted ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Boxes className="text-muted-foreground size-10" />
            <h2 className="font-semibold">No projects yet</h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              Create your first project to start moving through the BMAD Method — from a rough idea to shipped, verified software.
            </p>
            <Button onClick={() => setOpen(true)}><Plus className="size-4" /> New project</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => {
            const prog = projectProgress(p);
            const nextId = nextStepId(p);
            const nextName = nextId ? stepById(nextId)?.name : undefined;
            const gates = nextRequiredSteps(p);
            return (
              <Card key={p.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <Badge variant="secondary" className="text-[10px] uppercase">{SCALE_INFO[p.scale].label}</Badge>
                  </div>
                  {p.description && <p className="text-muted-foreground line-clamp-2 text-sm">{p.description}</p>}
                  <div className="flex items-center gap-1.5 pt-1">
                    <code className="text-muted-foreground flex-1 truncate text-[11px]" title={p.directory}>
                      {p.directory || "no directory set"}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      title="Change working directory"
                      onClick={() => setEditing(editing === p.id ? null : p.id)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  </div>
                  {editing === p.id && (
                    <div className="pt-2 flex flex-col items-start space-y-2">
                      <DirectoryPicker
                        value={p.directory}
                        onChange={(dir) => {
                          if (dir && dir !== p.directory) setProjectDirectory(p.id, dir);
                        }}
                      />
                      <p className="text-muted-foreground pt-1 text-[11px]">
                        Changing the directory resets this project&apos;s chat session.
                      </p>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="space-y-1">
                    <div className="text-muted-foreground flex justify-between text-xs">
                      <span>{prog.done} of {prog.total} steps complete</span>
                      <span>{prog.pct}%</span>
                    </div>
                    <Progress value={prog.pct} />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {nextName ? (
                      <>Next: <span className="text-foreground">{nextName}</span>{gates.length > 0 && <> · {gates.length} required gate(s) open</>}</>
                    ) : (
                      "All steps complete 🎉"
                    )}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <Link href={`/projects/${p.id}`}>
                      <Button size="sm" variant="outline">Open <ArrowRight className="size-4" /></Button>
                    </Link>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => deleteProject(p.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
