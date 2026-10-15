"use client";

// Tombol Sync ke folder / Impor dari folder (docs/bmad) — dipakai di card
// "Progress workspace" tab Rencana. Sync menstempel project.lastFolderSyncAt
// yang mengunci tab Eksekusi sampai artefak tersinkron ke folder project.
import { useState } from "react";
import { FolderDown, FolderUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/store";
import { projectFiles } from "@/lib/project-files/client";
import { STEPS } from "@/lib/bmad/roadmap";
import type { Project, StepId } from "@/lib/bmad/types";

export function FolderSyncButtons({ project }: { project: Project }) {
  const setArtifactContent = useStudio((s) => s.setArtifactContent);
  const updateProject = useStudio((s) => s.updateProject);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const hasDirectory = Boolean(project.directory);

  async function handleSyncToFolder() {
    if (!project.directory || syncing) return;
    setSyncing(true);
    setMsg(null);
    try {
      const files = STEPS.map((s) => ({
        filename: s.output,
        content: project.artifacts[s.id]?.content ?? "",
      })).filter((f) => f.content.trim().length > 0);
      if (files.length === 0) {
        setMsg("Belum ada artefak berisi untuk disync.");
        return;
      }
      const res = await projectFiles.sync(project.directory, files);
      updateProject(project.id, { lastFolderSyncAt: new Date().toISOString() });
      setMsg(`Tersync ${res.written.length} file ke docs/bmad/${res.skipped.length > 0 ? ` (${res.skipped.length} dilewati)` : ""}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync gagal");
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportFromFolder() {
    if (!project.directory || importing) return;
    setImporting(true);
    setMsg(null);
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
      setMsg(n > 0 ? `Diimpor ${n} artefak dari docs/bmad/.` : "Tidak ada file baru di docs/bmad/.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Impor gagal");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <Button
          variant="outline"
          className="justify-start"
          disabled={!hasDirectory || syncing}
          onClick={handleSyncToFolder}
          title="Tulis semua artefak ke docs/bmad/ folder project (membuka tab Eksekusi)"
        >
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <FolderDown className="size-4" />} Sync folder
        </Button>
        <Button
          variant="outline"
          className="justify-start"
          disabled={!hasDirectory || importing}
          onClick={handleImportFromFolder}
          title="Baca artefak dari docs/bmad/ folder project"
        >
          {importing ? <Loader2 className="size-4 animate-spin" /> : <FolderUp className="size-4" />} Impor folder
        </Button>
      </div>
      {!hasDirectory && (
        <p className="text-muted-foreground text-[11px]">Set working directory dulu untuk sync.</p>
      )}
      {msg && <p className="text-muted-foreground text-[11px]">{msg}</p>}
    </div>
  );
}
