"use client";

import { useState } from "react";
import { Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useStudio } from "@/lib/store";
import { DirectoryPicker } from "@/components/bmad/directory-picker";
import type { Project } from "@/lib/bmad/types";

/** Icon button + dialog to edit a project's name, description, and working directory. */
export function EditProjectButton({ project }: { project: Project }) {
  const updateProject = useStudio((s) => s.updateProject);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [directory, setDirectory] = useState(project.directory);

  function openDialog() {
    setName(project.name);
    setDescription(project.description);
    setDirectory(project.directory);
    setOpen(true);
  }

  function handleSave() {
    if (!name.trim() || !directory.trim()) return;
    updateProject(project.id, { name, description, directory });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        title="Edit project"
        onClick={openDialog}
      >
        <Pencil className="size-4" />
      </Button>
      <DialogContent className="grid-cols-1 min-w-0">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Ubah nama, deskripsi, dan working directory project ini.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`edit-name-${project.id}`}>Project name</Label>
            <Input
              id={`edit-name-${project.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`edit-desc-${project.id}`}>Description</Label>
            <Textarea
              id={`edit-desc-${project.id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line about what you're building."
              rows={2}
            />
          </div>
          <div className="min-w-0">
            <DirectoryPicker value={directory} onChange={setDirectory} />
            <p className="text-muted-foreground pt-1 text-[11px]">
              Mengganti directory akan me-reset chat session project ini.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={handleSave} disabled={!name.trim() || !directory.trim()}>Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Icon button + confirmation dialog to delete a project. */
export function DeleteProjectButton({ project }: { project: Project }) {
  const deleteProject = useStudio((s) => s.deleteProject);
  const [open, setOpen] = useState(false);
  const draftCount = Object.values(project.artifacts).filter((a) =>
    a.content.trim()
  ).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        title="Hapus project"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <DialogContent className="grid-cols-1 min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="text-destructive size-5" />
            Hapus project?
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">{project.name}</span>{" "}
            akan dihapus permanen
            {draftCount > 0 && (
              <> beserta {draftCount} draft artefak yang sudah dibuat</>
            )}
            . Aksi ini tidak bisa dibatalkan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
          <Button
            variant="destructive"
            onClick={() => {
              deleteProject(project.id);
              setOpen(false);
            }}
          >
            Hapus project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
