"use client";

import { useEffect, useId, useState } from "react";
import { ArrowUp, Folder, FolderOpen, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { opencode } from "@/lib/opencode/client";
import type { OpenCodeProject } from "@/lib/opencode/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

// Lets the user pick any local folder, an OpenCode project, or type an absolute path.
export function DirectoryPicker({ value, onChange }: Props) {
  const inputId = useId();
  const [projects, setProjects] = useState<OpenCodeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [directoryPath, setDirectoryPath] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [directories, setDirectories] = useState<Array<{ name: string; path: string }>>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  async function fetchProjects() {
    try {
      const res = await opencode.projects();
      setProjects(res.projects);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load OpenCode projects");
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    setLoading(true);
    void fetchProjects();
  }

  async function browseLocal(path?: string) {
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const res = await opencode.directories(path);
      setDirectoryPath(res.directory);
      setParentPath(res.parent);
      setDirectories(res.directories);
    } catch (e) {
      setDirectoryError(e instanceof Error ? e.message : "Failed to load local folders");
    } finally {
      setDirectoryLoading(false);
    }
  }

  function toggleBrowser() {
    const shouldOpen = !browserOpen;
    setBrowserOpen(shouldOpen);
    if (shouldOpen) void browseLocal();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await opencode.projects();
        if (!cancelled) {
          setProjects(res.projects);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load OpenCode projects");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>Working directory</Label>
        <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          <span className="ml-1 text-xs">Refresh</span>
        </Button>
      </div>

      <Input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/absolute/path/to/project"
        className="font-mono text-sm"
      />
      <p className="text-muted-foreground text-xs">
        Pick a local folder or an OpenCode project, or enter an absolute path.
      </p>

      <Button type="button" variant="outline" size="sm" onClick={toggleBrowser} aria-expanded={browserOpen}>
        <FolderOpen className="size-3.5" />
        <span className="ml-1 text-xs">{browserOpen ? "Hide local folders" : "Browse local folders"}</span>
      </Button>

      {browserOpen && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Go to parent folder"
              onClick={() => void browseLocal(parentPath)}
              disabled={directoryLoading || directoryPath === parentPath}
            >
              <ArrowUp className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={directoryPath}>
              {directoryPath || "Loading directory…"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(directoryPath)}
              disabled={!directoryPath || directoryLoading}
            >
              Use folder
            </Button>
          </div>

          {directoryError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{directoryError}</span>
            </div>
          )}

          <div className="max-h-48 space-y-1 overflow-auto">
            {directoryLoading ? (
              <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading folders…
              </p>
            ) : directories.length > 0 ? (
              directories.map((directory) => (
                <button
                  key={directory.path}
                  type="button"
                  onClick={() => void browseLocal(directory.path)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                  title={directory.path}
                >
                  <Folder className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono">{directory.name}</span>
                </button>
              ))
            ) : (
              !directoryError && <p className="px-2 py-1.5 text-xs text-muted-foreground">No subfolders</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {projects.length > 0 && (
        <div className="max-h-48 space-y-1 overflow-auto rounded-md border p-1">
          {projects.map((p) => {
            const active = p.worktree === value;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.worktree)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                  active ? "bg-primary/10 font-medium" : "hover:bg-accent"
                )}
                title={p.worktree}
              >
                {active ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 truncate font-mono">{p.worktree}</span>
                {active && <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">selected</Badge>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
