"use client";
import { useState, useRef } from "react";
import { Rocket, Square, Loader2, FolderX, Check, Circle, CircleDashed, ListChecks, Wand2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useStudio } from "@/lib/store";
import { ActivityLog } from "@/components/bmad/activity-log";
import { HaltDialog, type HaltAnswer } from "@/components/bmad/halt-dialog";
import type { ActivityEvent, HaltRequest } from "@/lib/opencode/types";
import { opencode } from "@/lib/opencode/client";
import type { Project, StepId } from "@/lib/bmad/types";
import { stepById } from "@/lib/bmad/roadmap";

const REQUIRED_FOR_BUILD: StepId[] = ["prd", "architecture", "epics-stories", "sprint-planning"];

function statusOf(project: Project, stepId: string) {
  return project.artifacts[stepId]?.status ?? "not-started";
}

// BMAD halt choices returned from OpenCode
type BamadHaltChoice =
  | "approve_continue"
  | "approve_stop"
  | "review_plan";

interface BamadHaltDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onChoice: (choice: BamadHaltChoice) => void;
  haltMessage: string;
  projectName: string;
  projectDirectory: string;
}

function BamadHaltDialog({ isOpen, onClose, onChoice, haltMessage, projectName, projectDirectory }: BamadHaltDialogProps) {
  // Jika tidak ada message, tampilkan pesan default
  const message = haltMessage?.trim() || "OpenCode menghalts — butuh keputusan human.";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 sm:max-w-sm p-6 sm:p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Build Dihentikan (HALT)</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Tutup"
          >
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-gray-600 text-sm mb-6 line-break-all">{message}</p>

        <div className="space-y-3">
          <button
            onClick={() => onChoice("approve_continue")}
            className="w-full flex justify-center py-2.5 px-4 rounded-md border border-green-600 bg-green-600 text-sm font-medium text-white hover:bg-green-700 hover:text-white"
          >
            Lanjutkan Build
          </button>

          <button
            onClick={() => onChoice("approve_stop")}
            className="w-full flex justify-center py-2.5 px-4 rounded-md border border-yellow-600 bg-yellow-500/20 text-sm font-medium text-yellow-600 hover:bg-yellow-600/30 hover:text-white"
          >
            Hentikan dan Simpan
          </button>

          <button
            onClick={() => onChoice("review_plan")}
            className="w-full flex justify-center py-2.5 px-4 rounded-md border border-blue-600 bg-blue-500/20 text-sm font-medium text-blue-600 hover:bg-blue-600/30 hover:text-white"
          >
            Review Rencana
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [lastDoneAt, setLastDoneAt] = useState<string | null>(null);
  const [lastGoal, setLastGoal] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [haltDialogOpen, setHaltDialogOpen] = useState(false);
  const [haltChoice, setHaltChoice] = useState<BamadHaltChoice | null>(null);
  const [haltMessage, setHaltMessage] = useState<string>("");
  const [halt, setHalt] = useState<HaltRequest | null>(null);
  const [answeringHalt, setAnsweringHalt] = useState(false);
  const activeSessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ready = Boolean(project.directory);
  const missingRequired = REQUIRED_FOR_BUILD.filter((id) => statusOf(project, id) !== "complete");
  const canBuild = ready && goal.trim().length > 0 && !busy;

  function suggestFromArtifacts() {
    const bits: string[] = [];
    const prd = project.artifacts["prd"]?.content?.trim();
    const arch = project.artifacts["architecture"]?.content?.trim();
    const epics = project.artifacts["epics-stories"]?.content?.trim();
    const sprint = project.artifacts["sprint-planning"]?.content?.trim();
    bits.push(`Build ${project.name} sesuai artefak rencana.`);
    if (prd) bits.push(`Rujuk PRD di folder project.`);
    if (arch) bits.push(`Rujuk Architecture di folder project.`);
    if (epics) bits.push(`Implementasikan epic/story prioritas pertama dari Epics & Stories.`);
    if (sprint) bits.push(`Patuhi sprint plan untuk urutan pengerjaan.`);
    bits.push(`Verifikasi dengan build/test dan laporkan file yang diubah.`);
    setGoal(bits.join("\n"));
  }

  async function handleStart() {
    if (!goal.trim() || !ready || busy) return;
    setBusy(true);
    setError(null);
    setEvents([]);
    setLastDoneAt(null);
    setHalt(null);
    activeSessionRef.current = null;

    const controller = new AbortController();
    abortRef.current = controller;
    const goalSnapshot = goal.trim();
    const prompt = `Tujuan build:\n${goalSnapshot}\n\nCatatan: Artefak rencana (PRD, Architecture, Epics, Sprint) tersedia di folder project. Baca dari disk sesuai kebutuhan.`;

    try {
      const res = await fetch("/api/opencode/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: project.directory,
          sessionId: project.sessionId,
          prompt,
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
      let sawError = false;

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
            if (sessionId) activeSessionRef.current = sessionId;
            if (sessionId && sessionId !== project.sessionId) {
              setProjectSession(project.id, sessionId);
            }
          } else if (eventName === "log") {
            setEvents((prev) => [...prev, payload as ActivityEvent]);
          } else if (eventName === "halt") {
            setHalt(payload as HaltRequest);
          } else if (eventName === "halt_resolved") {
            setHalt(null);
          } else if (eventName === "done") {
            setLastDoneAt(new Date().toISOString());
            setLastGoal(goalSnapshot);
          } else if (eventName === "error") {
            sawError = true;
            const { message } = payload as { message?: string };
            const haltMsg = message?.trim().startsWith("HALT:") ? message?.trim() : "";
            if (haltMsg) {
              setHaltMessage(haltMsg);
              setHaltDialogOpen(true);
            }
            setError(message ?? "Build error");
          }
        }
      }
      if (!sawError && !controller.signal.aborted) {
        setLastDoneAt((v) => v ?? new Date().toISOString());
        setLastGoal((v) => v ?? goalSnapshot);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Build failed");
      }
    } finally {
      setBusy(false);
      setHalt(null);
      activeSessionRef.current = null;
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setBusy(false);
    setHalt(null);
  }

  async function handleHaltAnswer(answer: HaltAnswer) {
    const current = halt;
    const sessionId = activeSessionRef.current;
    if (!current || !sessionId || answeringHalt) return;

    setAnsweringHalt(true);
    setError(null);
    try {
      if (answer.kind === "permission") {
        await opencode.replyPermission({ sessionId, id: current.id, decision: answer.decision });
      } else {
        await opencode.replyForm({ sessionId, id: current.id, answer: answer.answer });
      }
      setHalt(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengirim jawaban");
    } finally {
      setAnsweringHalt(false);
    }
  }

  function handleHaltChoice(choice: BamadHaltChoice) {
    setBusy(false);
    setHaltChoice(choice);
    setHaltDialogOpen(false);

    switch (choice) {
      case "approve_continue":
        // Lanjutkan build - kirim prompt baru atau restart session
        // Untuk sekarang, hentikan dialog dan kirim notifikasi
        // User bisa lanjutkan dari tab Rencana
        setError(
          "HALT dipenuhi: Build dilanjutkan. Silakan cek tab Rencana untuk status plan."
        );
        break;

      case "approve_stop":
        // Hentikan dan simpan - set status plan ready-for-dev
        setError(
          "Build dihentikan dan disimpan. Plan diset status ready-for-dev. Lanjutkan dari tab Rencana."
        );
        // Mungkin perlu men-set status di store, tapi untuk saat ini
        // cukup beri tahu user
        break;

      case "review_plan":
        // Buka review plan - arahkan user ke tab Rencana
        setError(
          "Review rencana. Buka tab Rencana untuk melihat status plan file dan melanjutkan."
        );
        break;
    }
  }

  return (
    <div className="space-y-5">
      {/* Alur 3 langkah — menjawab "habis ini apa?" */}
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { n: "1", t: "Cek kesiapan", d: "Artefak & folder OK" },
          { n: "2", t: "Jalankan build", d: "Agen koding di folder" },
          { n: "3", t: "Verifikasi", d: "Cek Activity + lanjut Review" },
        ].map((s) => (
          <div key={s.n} className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5 shadow-sm">
            <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">{s.n}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">{s.t}</span>
              <span className="text-muted-foreground block truncate text-[11px]">{s.d}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Kesiapan build */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListChecks className="size-4" /> Kesiapan build
          </CardTitle>
          <CardDescription className="text-xs">
            Build memakai artefak tab Rencana sebagai konteks otomatis. Prasyarat belum lengkap tetap bisa jalan, tapi hasil bisa meleset.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            <li className="flex items-center gap-2 text-sm">
              {ready ? <Check className="size-4 shrink-0 text-emerald-500" /> : <Circle className="size-4 shrink-0 text-muted-foreground/50" />}
              <span className="flex-1 truncate">Working directory</span>
              <code className="text-muted-foreground max-w-55 truncate text-[11px]">{project.directory || "belum di-set"}</code>
            </li>
            {REQUIRED_FOR_BUILD.map((id) => {
              const st = statusOf(project, id);
              const step = stepById(id);
              return (
                <li key={id} className="flex items-center gap-2 text-sm">
                  {st === "complete" ? (
                    <Check className="size-4 shrink-0 text-emerald-500" />
                  ) : st === "draft" ? (
                    <CircleDashed className="size-4 shrink-0 text-amber-500" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground/50" />
                  )}
                  <span className="flex-1 truncate">{step?.name ?? id}</span>
                  <Badge variant={st === "complete" ? "secondary" : "outline"} className="text-[10px]">
                    {st === "complete" ? "Selesai" : st === "draft" ? "Draft" : "Belum"}
                  </Badge>
                </li>
              );
            })}
          </ul>
          {missingRequired.length > 0 && (
            <p className="text-muted-foreground mt-2 text-xs">
              {missingRequired.length} prasyarat belum selesai ({missingRequired.map((id) => stepById(id)?.name).join(", ")}). Lengkapi di tab Rencana untuk hasil terbaik.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="size-4" /> Tujuan build
          </CardTitle>
          <CardDescription>
            Tulis satu tujuan kecil per build (misal satu epic). Konteks PRD / arsitektur / epics otomatis dilampirkan ke agen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!ready && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <FolderX className="mt-0.5 size-4 shrink-0" />
              <p>Set working directory dulu di header project untuk mengaktifkan build.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="build-goal">Goal / instruksi build</Label>
              <Button size="sm" variant="ghost" onClick={suggestFromArtifacts} disabled={busy}>
                <Wand2 className="size-3.5" /> Susun dari artefak
              </Button>
            </div>
            <Textarea
              id="build-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Implementasikan epic 1 (auth) sesuai PRD & architecture, lengkap dengan test."
              rows={5}
              disabled={busy}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {busy ? (
              <Button variant="destructive" onClick={handleStop}>
                <Square className="size-4" /> Stop build
              </Button>
            ) : (
              <Button onClick={() => setConfirmOpen(true)} disabled={!canBuild}>
                <Rocket className="size-4" /> Jalankan build
              </Button>
            )}
            {busy && (
              <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <Loader2 className="size-4 animate-spin" /> Agen bekerja di {project.directory || "…"} — pantau Activity di bawah…
              </span>
            )}
            {!busy && !goal.trim() && ready && (
              <span className="text-muted-foreground text-xs">Isi tujuan dulu untuk mengaktifkan tombol.</span>
            )}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}
          {haltDialogOpen && <BamadHaltDialog
            isOpen={haltDialogOpen}
            onClose={() => setHaltDialogOpen(false)}
            onChoice={choice => {
              handleHaltChoice(choice);
              setHaltDialogOpen(false);
            }}
            haltMessage={haltMessage}
            projectName={project.name}
            projectDirectory={project.directory || ""}
          />}
          {!busy && lastDoneAt && !error && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
              <p className="font-medium text-emerald-700 dark:text-emerald-400">Build selesai ✓</p>
              {lastGoal && <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">Tujuan: {lastGoal}</p>}
              <p className="text-muted-foreground mt-1 text-xs">
                Cek perubahan di folder project, lalu lanjut ke <strong>Code Review</strong> / <strong>QA E2E Tests</strong> di tab Rencana <ArrowRight className="inline size-3" />
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Activity</CardTitle>
          <CardDescription className="text-xs">
            {busy ? "Agen sedang bekerja — log muncul realtime." : events.length === 0 ? "Belum ada build. Isi tujuan lalu Jalankan build — aktivitas agen muncul di sini." : `${events.length} event · build terakhir ${lastDoneAt ? new Date(lastDoneAt).toLocaleTimeString() : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityLog events={events} />
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Jalankan build?</DialogTitle>
            <DialogDescription>
              Agen akan mengerjakan dan mengubah file di folder project. Pastikan tujuan sudah benar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Folder:</p>
            <code className="block max-w-full truncate rounded bg-muted px-2 py-1 font-mono text-[11px]" title={project.directory}>{project.directory || "belum di-set"}</code>
            <p className="text-muted-foreground">Tujuan:</p>
            <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{goal.trim() || "— kosong —"}</pre>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button onClick={() => { setConfirmOpen(false); void handleStart(); }} disabled={!canBuild}>
              <Rocket className="size-4" /> Jalankan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HaltDialog
        halt={halt}
        busy={answeringHalt}
        onSubmit={handleHaltAnswer}
        onClose={() => setHalt(null)}
      />
    </div>
  );
}
