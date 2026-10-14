"use client";
import { useState, useRef } from "react";
import { Rocket, Square, Loader2, FolderX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useStudio } from "@/lib/store";
import { ActivityLog } from "@/components/bmad/activity-log";
import type { ActivityEvent } from "@/lib/opencode/types";
import type { Project } from "@/lib/bmad/types";

// Drives a build turn on the project's OpenCode session via the SSE stream
// endpoint. The session id is persisted on the project so guidance + build share
// one conversation, in the same folder OpenCode uses.
export function BuildPanel({ project }: { project: Project }) {
  const settings = useStudio((s) => s.settings);
  const setProjectSession = useStudio((s) => s.setProjectSession);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ready = Boolean(project.directory);

  async function handleStart() {
    if (!goal.trim() || !ready || busy) return;
    setBusy(true);
    setError(null);
    setEvents([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/opencode/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: project.directory,
          sessionId: project.sessionId,
          prompt: goal.trim(),
          model: settings.defaultModel,
          agent: settings.buildAgent,
          title: `${project.name} — Build`,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          let eventName = "message";
          let dataStr = "";
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (eventName === "session") {
            const { sessionId } = payload as { sessionId?: string };
            if (sessionId && sessionId !== project.sessionId) {
              setProjectSession(project.id, sessionId);
            }
          } else if (eventName === "log") {
            setEvents((prev) => [...prev, payload as ActivityEvent]);
          } else if (eventName === "error") {
            const { message } = payload as { message?: string };
            setError(message ?? "Build error");
          }
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Build failed");
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="size-4" /> Build with OpenCode
          </CardTitle>
          <CardDescription>
            Beri satu tujuan. Agen OpenCode membangun &amp; memverifikasi kode di folder project
            ini (<code className="text-xs">{project.directory || "— belum di-set —"}</code>),
            memakai sesi chat yang sama.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!ready && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <FolderX className="mt-0.5 size-4 shrink-0" />
              <p>Set a working directory on this project to enable builds.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="build-goal">Goal / instruksi build</Label>
            <Textarea
              id="build-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Build a small REST API for a todo app in Node + Express with tests, sesuai artefak PRD & architecture."
              rows={4}
              disabled={busy}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {busy ? (
              <Button variant="destructive" onClick={handleStop}>
                <Square className="size-4" /> Stop build
              </Button>
            ) : (
              <Button onClick={handleStart} disabled={!goal.trim() || !ready}>
                <Rocket className="size-4" /> Jalankan build
              </Button>
            )}
            {busy && (
              <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <Loader2 className="size-4 animate-spin" /> Agen bekerja…
              </span>
            )}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityLog events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
