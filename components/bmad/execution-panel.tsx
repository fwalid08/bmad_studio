"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Rocket, Square, Loader2, ChevronLeft, ChevronRight, Pencil, Trash2, Wand2, FolderX, KanbanSquare, Sparkles, X, Check, ArrowRight, List, Search, CalendarDays, Maximize2, Minimize2, Archive, RotateCcw, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useStudio } from "@/lib/store";
import { ActivityLog } from "@/components/bmad/activity-log";
import { HaltDialog, type HaltAnswer } from "@/components/bmad/halt-dialog";
import type { ActivityEvent, HaltRequest, TokenUsage } from "@/lib/opencode/types";
import type { Project, ExecTask, TaskStatus, TaskPriority, TaskBuild, TaskImplementationReview } from "@/lib/bmad/types";
import { stepById } from "@/lib/bmad/roadmap";
import { agentForStep } from "@/lib/bmad/agents";
import { opencode } from "@/lib/opencode/client";
import { flattenModels } from "@/lib/opencode/client";
import { directAI } from "@/lib/ai/client";
import { parseMachineSprint, parseAgentBreakdown, taskStats, type BreakdownCandidate } from "@/lib/execution/tasks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNotifications } from "@/components/ui/notifications";

const COLUMNS: Array<{ id: TaskStatus; name: string; hint: string }> = [
  { id: "backlog", name: "Backlog", hint: "Ide / story belum masuk sprint" },
  { id: "todo", name: "Sprint", hint: "Siap dikerjakan" },
  { id: "in-progress", name: "Dikerjakan", hint: "Sedang di-build" },
  { id: "review", name: "Review", hint: "Butuh cek / QA" },
  { id: "done", name: "Selesai", hint: "Terverifikasi" },
];

function artifactContext(project: Project): string {
  const stack = project.artifacts["project-context"]?.content?.trim();
  const ids = ["prd", "ux", "architecture", "epics-stories", "sprint-planning"] as const;
  const parts: string[] = [];
  if (stack) {
    const clipped = stack.length > 4000 ? `${stack.slice(0, 4000)}\n…(dipotong)` : stack;
    parts.push(`### STACK & KONVENSI (Project Context — WAJIB dipatuhi agen build)\n${clipped}`);
  }
  for (const id of ids) {
    const content = project.artifacts[id]?.content?.trim();
    if (!content) continue;
    const name = stepById(id)?.name ?? id;
    const clipped = content.length > 6000 ? `${content.slice(0, 6000)}\n…(dipotong)` : content;
    parts.push(`### ${name}\n${clipped}`);
  }
  if (parts.length === 0) return "";
  return `Konteks rencana (dari tab Rencana, jangan abaikan):\n${parts.join("\n\n")}\n\n---\n`;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL: Record<string, string> = { high: "P1 · Duluan", medium: "P2", low: "P3" };
const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Sprint",
  "in-progress": "Dikerjakan",
  review: "Review",
  done: "Selesai",
};

function sortTasks<T extends { priority?: string; createdAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (PRIORITY_ORDER[a.priority ?? "medium"] ?? 1) - (PRIORITY_ORDER[b.priority ?? "medium"] ?? 1) || a.createdAt.localeCompare(b.createdAt));
}

function parseTagInput(v: string): string[] {
  return [...new Set(v.split(/[,#\n]/).map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 10);
}

type BugReport = { steps: string; actual: string; expected: string; environment: string };

function parseBugReport(detail: string): BugReport {
  const empty: BugReport = { steps: "", actual: "", expected: "", environment: "" };
  if (!detail.startsWith("[BUG REPORT]\n")) return { ...empty, actual: detail };
  const sections = detail.slice("[BUG REPORT]\n".length).split(/\n\n(?=(?:Steps|Actual|Expected|Environment):\n)/);
  for (const section of sections) {
    const match = section.match(/^(Steps|Actual|Expected|Environment):\n([\s\S]*)$/);
    if (!match) continue;
    const key = { Steps: "steps", Actual: "actual", Expected: "expected", Environment: "environment" }[match[1]] as keyof BugReport;
    empty[key] = match[2].trim();
  }
  return empty;
}

function formatBugReport(report: BugReport): string {
  return `[BUG REPORT]\nSteps:\n${report.steps.trim()}\n\nActual:\n${report.actual.trim()}\n\nExpected:\n${report.expected.trim()}\n\nEnvironment:\n${report.environment.trim()}`;
}

/** Ambil kandidat objek JSON dari teks: code fence dulu, lalu scan brace seimbang. */
function extractJsonObjects(text: string): string[] {
  const out: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) out.push(fence[1].trim());
  // Scan brace seimbang (abaikan isi string) untuk tiap kandidat objek.
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            out.push(text.slice(start, i + 1));
            start = i;
            break;
          }
        }
      }
    }
  }
  return out;
}

function tryParseSprintJson(raw: string): { name?: string; goal?: string; reason?: string; taskTitles?: unknown } | null {
  const attempts = [raw, raw.replace(/,\s*([}\]])/g, "$1")];
  for (const a of attempts) {
    try {
      const p = JSON.parse(a) as { name?: string; goal?: string; reason?: string; taskTitles?: unknown };
      if (p && typeof p === "object") return p;
    } catch { /* coba kandidat berikutnya */ }
  }
  return null;
}

/** Parse saran sprint agen: JSON (toleran) atau fallback daftar markdown yang dicocokkan ke backlog. */
function parseSprintResponse(
  text: string,
  backlogTitles: string[]
): { name: string; goal: string; reason: string; titles: string[] } | null {
  for (const cand of extractJsonObjects(text)) {
    const p = tryParseSprintJson(cand);
    if (p && Array.isArray(p.taskTitles) && p.taskTitles.length > 0) {
      return {
        name: String(p.name ?? "").trim(),
        goal: String(p.goal ?? "").trim(),
        reason: String(p.reason ?? "").trim(),
        titles: (p.taskTitles as unknown[]).map((x) => String(x).trim()).filter(Boolean),
      };
    }
  }
  // Fallback: agen menjawab list biasa — cocokkan tiap baris ke judul backlog.
  const norm = (s: string) => s.toLowerCase().trim();
  const found: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim().replace(/^[-*]\s*/, "").replace(/^\d+[.)]\s*/, "").replace(/^["“”']+|["“”']+$/g, "").trim();
    if (line.length < 4) continue;
    const hit = backlogTitles.find((t) => norm(t) === norm(line))
      ?? backlogTitles.find((t) => norm(line).includes(norm(t)) || norm(t).includes(norm(line)));
    if (hit && !found.includes(hit)) found.push(hit);
    if (found.length >= 8) break;
  }
  if (found.length > 0) return { name: "", goal: "", reason: "Diparse dari daftar agen (bukan JSON).", titles: found };
  return null;
}

function formatElapsed(ms?: number): string {
  if (ms === undefined) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt ${s % 60} dtk`;
  return `${Math.floor(m / 60)} jam ${m % 60} mnt`;
}

function formatTokenCount(count: number): string {
  return new Intl.NumberFormat("id-ID").format(count);
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(amount);
}

function interruptionStatusMessage(reason?: string): string {
  if (reason === "user") return "Run dihentikan oleh pengguna melalui OpenCode.";
  if (reason === "shutdown") return "Run terhenti karena OpenCode server dimatikan.";
  if (reason === "superseded") return "Run ini digantikan oleh run lain.";
  if (reason === "inactivity") return "Run dihentikan karena batas waktu tidak aktif.";
  return "Run dihentikan sebelum task selesai.";
}

function parseImplementationVerdict(text: string): TaskImplementationReview["verdict"] {
  // Normalisasi ringan: agen sering membungkus verdict dengan markdown
  // (**VERDICT: IMPLEMENTED**, ## Verdict, `VERDICT`, dsb).
  const normalized = text
    .replace(/[*_`#>|]/g, " ")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ");
  // 1. Pola eksplisit VERDICT (toleran: :, -, =, atau spasi).
  const explicit = normalized.match(/\bVERDICT\s*[:=\-]?\s*(NOT_IMPLEMENTED|NOT IMPLEMENTED|IMPLEMENTED|PARTIAL|UNCLEAR)\b/i)?.[1]?.toUpperCase().replace(/\s+/g, "_");
  if (explicit === "IMPLEMENTED") return "implemented";
  if (explicit === "PARTIAL") return "partial";
  if (explicit === "NOT_IMPLEMENTED") return "not_implemented";
  if (explicit === "UNCLEAR") return "unclear";
  // 2. Fallback label umum: Status / Kesimpulan / Hasil review.
  const labeled = normalized.match(/\b(?:STATUS|KESIMPULAN|HASIL(?: REVIEW)?|CONCLUSION)\s*[:=\-]?\s*(BELUM TERIMPLEMENTASI|BELUM DIIMPLEMENTASIKAN|TIDAK TERIMPLEMENTASI|NOT IMPLEMENTED|TERIMPLEMENTASI SEPENUHNYA|FULLY IMPLEMENTED|TERIMPLEMENTASI|IMPLEMENTED|SEBAGIAN|PARTIALLY|PARTIAL|BELUM JELAS|UNCLEAR)\b/i)?.[1]?.toUpperCase();
  if (labeled) {
    if (/BELUM|TIDAK|NOT/.test(labeled)) return "not_implemented";
    if (/SEPENUHNYA|FULLY|^TERIMPLEMENTASI$|^IMPLEMENTED$/.test(labeled)) return "implemented";
    if (/SEBAGIAN|PARTIALLY|^PARTIAL$/.test(labeled)) return "partial";
    return "unclear";
  }
  // 3. Fallback frasa bebas — NOT dicek dulu karena mengandung kata IMPLEMENTED.
  if (/\bNOT[_\s-]*IMPLEMENTED\b/i.test(normalized) || /belum (terimplementasi|diimplementasikan)|tidak terimplementasi/i.test(normalized)) return "not_implemented";
  if (/\bFULLY IMPLEMENTED\b/i.test(normalized) || /terimplementasi sepenuhnya|semua kriteria terpenuhi/i.test(normalized)) return "implemented";
  if (/\bPARTIALLY IMPLEMENTED\b/i.test(normalized) || /\bPARTIAL\b/i.test(normalized) || /terimplementasi sebagian|sebagian terpenuhi/i.test(normalized)) return "partial";
  if (/\bIMPLEMENTED\b/i.test(normalized) || /sudah terimplementasi|telah diimplementasikan/i.test(normalized)) return "implemented";
  return "unclear";
}

/** Ekstrak kandidat path file dari judul/detail event tool. */
function extractFiles(events: ActivityEvent[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /(?:^|[\s"'`(])([\w\-.~/][\w\-.~/]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|css|scss|html|json|yaml|yml|toml|sql|md|sh|vue|svelte))\b/g;
  for (const e of events) {
    const text = `${e.title ?? ""}\n${e.detail ?? ""}`;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const p = m[1].replace(/^\.\//, "");
      if (!seen.has(p) && p.length < 120) {
        seen.add(p);
        found.push(p);
      }
      if (found.length >= 20) return found;
    }
  }
  return found;
}

const NO_TASK_KEY = "__none__";

interface ActiveTaskRun {
  kind: "build" | "review";
  runId: string;
  startedAtMs: number;
  elapsedSec: number;
  sessionId?: string;
  halt?: HaltRequest;
}

interface TaskRunContext {
  kind: "build" | "review";
  runId: string;
  sessionId?: string;
  pendingInterrupt: boolean;
  stopRequested: boolean;
}

/** Parse output elaborasi agen menjadi daftar story. Dukung JSON array atau list markdown. */
function parseStories(text: string, fallbackEpic: string): Array<{ title: string; detail: string; epic: string }> {  // Cari blok JSON array di dalam teks (termasuk dalam code fence).
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as Array<{ title?: string; detail?: string; ac?: string }>;
      if (Array.isArray(arr)) {
        const mapped = arr
          .map((s) => ({
            title: String(s.title ?? "").trim(),
            detail: String(s.detail ?? s.ac ?? "").trim(),
            epic: fallbackEpic,
          }))
          .filter((s) => s.title.length > 0);
        if (mapped.length > 0) return mapped.slice(0, 12);
      }
    } catch { /* jatuh ke parsing markdown */ }
  }
  const out: Array<{ title: string; detail: string; epic: string }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("```")) continue;
    if (line.length < 8) continue;
    const title = line.length > 100 ? `${line.slice(0, 100)}…` : line;
    out.push({ title, detail: line, epic: fallbackEpic });
    if (out.length >= 12) break;
  }
  return out;
}

/** Kartu task kanban — dipakai ulang di strip Backlog horizontal & grid board.
 *  fixedHeight=true hanya untuk strip Backlog (flex stretch horizontal);
 *  kolom board pakai tinggi natural ngikutin konten. */
function TaskCard({
  t,
  selected,
  fixedHeight = false,
  running = null,
  runningElapsedSec = 0,
  awaitingHalt = false,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
  onCyclePriority,
  onSetStatus,
  onMove,
}: {
  t: ExecTask;
  selected: boolean;
  fixedHeight?: boolean;
  /** "build"/"review" saat task ini sedang diproses — tampilkan indikator loading di papan walau modal tertutup. */
  running?: "build" | "review" | null;
  runningElapsedSec?: number;
  awaitingHalt?: boolean;
  onOpen: (t: ExecTask) => void;
  onEdit: (t: ExecTask) => void;
  onArchive: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onCyclePriority: (t: ExecTask) => void;
  onSetStatus: (t: ExecTask, status: TaskStatus) => void;
  onMove: (t: ExecTask, dir: -1 | 1) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(t)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(t);
        }
      }}
      className={`${fixedHeight ? "flex h-full min-h-[172px] flex-col" : ""} cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-accent ${running ? (running === "review" ? "border-sky-500/60 ring-2 ring-sky-500/30" : "border-emerald-500/60 ring-2 ring-emerald-500/30") : selected ? "border-primary/50 bg-accent" : "bg-card"}`}
    >
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">{t.title}</p>
        <button
          type="button"
          title="Klik untuk ganti prioritas"
          disabled={t.status === "done"}
          onClick={(e) => {
            e.stopPropagation();
            onCyclePriority(t);
          }}
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${(t.priority ?? "medium") === "high" ? "bg-red-500/15 text-red-600 dark:text-red-400" : (t.priority ?? "medium") === "low" ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}
        >
          {PRIORITY_LABEL[t.priority ?? "medium"]}
        </button>
      </div>
      {running ? (
        <div className={`mt-1.5 flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10px] font-medium ${running === "review" ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span className="truncate">{running === "review" ? "Review berjalan" : "Build berjalan"}{runningElapsedSec > 0 ? ` · ${Math.floor(runningElapsedSec / 60)}:${String(runningElapsedSec % 60).padStart(2, "0")}` : ""}{awaitingHalt ? " · butuh keputusan" : ""}</span>
        </div>
      ) : null}
      {t.epic ? (
        <p className={`text-muted-foreground truncate text-[11px]${fixedHeight ? " h-[15px]" : ""}`}>{t.epic}</p>
      ) : fixedHeight ? (
        <p className="h-[15px] text-[11px]">&nbsp;</p>
      ) : null}
      {(t.tags ?? []).length > 0 ? (
        <div className={`mt-0.5 flex flex-wrap gap-1${fixedHeight ? " h-[20px] overflow-hidden" : ""}`}>
          {(t.tags ?? []).slice(0, 4).map((tag) => (
            <Badge key={tag} variant="outline" className="px-1 py-0 text-[10px]">#{tag}</Badge>
          ))}
        </div>
      ) : fixedHeight ? (
        <div className="mt-0.5 h-[20px]" />
      ) : null}
      {t.detail ? (
        <p className={`text-muted-foreground mt-0.5 text-[11px]${fixedHeight ? " line-clamp-2 min-h-[28px]" : " line-clamp-1"}`}>{t.detail}</p>
      ) : fixedHeight ? (
        <p className="mt-0.5 min-h-[28px] text-[11px]">&nbsp;</p>
      ) : null}
      {t.sessionId ? (
        <p className={`text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1 text-[10px] font-medium${fixedHeight ? " h-[15px]" : ""}`}>
          <span className="size-1.5 rounded-full bg-emerald-500" /> Session terisolasi
        </p>
      ) : fixedHeight ? (
        <p className="mt-0.5 h-[15px] text-[10px]">&nbsp;</p>
      ) : null}
      {(t.builds ?? [])[0] ? (
        <p className={`text-muted-foreground mt-0.5 truncate text-[10px] tabular-nums${fixedHeight ? " h-[14px]" : ""}`}>
          {(t.builds ?? [])[0].status === "done" ? "✔" : (t.builds ?? [])[0].status === "error" ? "✖" : "■"} build {formatElapsed((t.builds ?? [])[0].elapsedMs)}{(t.builds ?? [])[0].files.length > 0 ? ` · ${(t.builds ?? [])[0].files.length} file` : ""}
        </p>
      ) : fixedHeight ? (
        <p className="mt-0.5 h-[14px] text-[10px]">&nbsp;</p>
      ) : null}
      <div className={`${fixedHeight ? "mt-auto pt-1" : "mt-1"} flex items-center gap-0.5`}>
        {t.status === "done" && (
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); onSetStatus(t, "review"); }}>
            <RotateCcw className="size-3" /> Buka kembali
          </Button>
        )}
        <span className="flex-1" />
        <Button size="icon" variant="ghost" className="size-6" disabled={t.status === "done"} onClick={(e) => { e.stopPropagation(); onEdit(t); }}><Pencil className="size-3.5" /></Button>
        <Button size="icon" variant="ghost" className="size-6" title="Arsipkan task" disabled={t.status === "done"} onClick={(e) => { e.stopPropagation(); onArchive(t.id); }}><Archive className="size-3.5" /></Button>
        <Button size="icon" variant="ghost" className="size-6 text-destructive" title="Pindahkan ke sampah" disabled={t.status === "done"} onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}><Trash2 className="size-3.5" /></Button>
      </div>
      <div className="mt-1 flex items-center justify-between rounded-md bg-muted/70 px-1.5 py-1">
        <span className="text-muted-foreground text-[10px]">Ganti status</span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="size-6 bg-background" aria-label="Pindah ke status sebelumnya" title="Pindah ke status sebelumnya" disabled={t.status === "done" || COLUMNS[0].id === t.status} onClick={(e) => { e.stopPropagation(); onMove(t, -1); }}><ChevronLeft className="size-3.5" /></Button>
          <Button size="icon" variant="outline" className="size-6 bg-background" aria-label="Pindah ke status berikutnya" title="Pindah ke status berikutnya" disabled={t.status === "done" || COLUMNS[COLUMNS.length - 1].id === t.status} onClick={(e) => { e.stopPropagation(); onMove(t, 1); }}><ChevronRight className="size-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}

/** Kolom board selain Backlog (Backlog dirender sebagai strip horizontal di atas). */
const BOARD_COLUMNS = COLUMNS.slice(1);


export function ExecutionPanel({ project }: { project: Project }) {
  const notify = useNotifications();
  const projectsLoaded = useStudio((s) => s.projectsLoaded);
  const settings = useStudio((s) => s.settings);
  const updateSettings = useStudio((s) => s.updateSettings);
  const setProjectSession = useStudio((s) => s.setProjectSession);
  const clearProjectSession = useStudio((s) => s.clearProjectSession);
  const setTaskSession = useStudio((s) => s.setTaskSession);
  const addTask = useStudio((s) => s.addTask);
  const updateTask = useStudio((s) => s.updateTask);
  const archiveTask = useStudio((s) => s.archiveTask);
  const restoreTask = useStudio((s) => s.restoreTask);
  const deleteTask = useStudio((s) => s.deleteTask);
  const importTasks = useStudio((s) => s.importTasks);
  const createSprint = useStudio((s) => s.createSprint);
  const closeSprint = useStudio((s) => s.closeSprint);

  const allTasks = useMemo(() => project.tasks ?? [], [project.tasks]);
  const tasks = useMemo(() => allTasks.filter((t) => !t.archivedAt && !t.deletedAt), [allTasks]);
  const archivedTasks = useMemo(() => allTasks.filter((t) => t.archivedAt && !t.deletedAt), [allTasks]);
  const deletedTasks = useMemo(() => allTasks.filter((t) => t.deletedAt), [allTasks]);
  const stats = taskStats(tasks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  const selectedTaskDone = selected?.status === "done";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExecTask | null>(null);
  const [dialogKind, setDialogKind] = useState<"task" | "bug">("task");
  const [fTitle, setFTitle] = useState("");
  const [fEpic, setFEpic] = useState("");
  const [fDetail, setFDetail] = useState("");
  const [fBugSteps, setFBugSteps] = useState("");
  const [fBugActual, setFBugActual] = useState("");
  const [fBugExpected, setFBugExpected] = useState("");
  const [fBugEnvironment, setFBugEnvironment] = useState("");
  const [fTags, setFTags] = useState("");
  const [fPriority, setFPriority] = useState<TaskPriority>("medium");
  const [fStatus, setFStatus] = useState<TaskStatus>("backlog");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // Dialog daftar task (backlog besar): search + filter tag/prioritas/status
  const [listOpen, setListOpen] = useState(false);
  const [listQ, setListQ] = useState("");
  const [listTag, setListTag] = useState<string | null>(null);
  const [listPri, setListPri] = useState<TaskPriority | null>(null);
  const [listStat, setListStat] = useState<TaskStatus | "all">("all");
  const [listScope, setListScope] = useState<"active" | "archived" | "deleted">("active");
  const BOARD_LIMIT = 15;

  // Perencana sprint: agen memilihkan task backlog → nama + tujuan sprint
  const [sprintOpen, setSprintOpen] = useState(false);
  const [sprintFocus, setSprintFocus] = useState("");
  const [sprintAsking, setSprintAsking] = useState(false);
  const [sprintError, setSprintError] = useState<string | null>(null);
  const [sprintName, setSprintName] = useState("");
  const [sprintGoal, setSprintGoal] = useState("");
  const [sprintReason, setSprintReason] = useState("");
  const [sprintRaw, setSprintRaw] = useState<string | null>(null);
  const [sprintPicks, setSprintPicks] = useState<Array<{ id: string; title: string; checked: boolean }>>([]);
  const activeSprint = (project.sprints ?? []).find((s) => s.status === "active") ?? null;

  // Epic → elaborasi agen menjadi stories
  const [epicOpen, setEpicOpen] = useState(false);
  const [epicTitle, setEpicTitle] = useState("");
  const [epicDesc, setEpicDesc] = useState("");
  const [elaborating, setElaborating] = useState(false);
  const [elaborated, setElaborated] = useState<Array<{ title: string; detail: string; epic: string; checked: boolean }>>([]);
  const [elaborateError, setElaborateError] = useState<string | null>(null);

  // Breakdown full artefak → stories oleh agen (John/PM)
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownBusy, setBreakdownBusy] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [breakdownRaw, setBreakdownRaw] = useState<string | null>(null);
  const [breakdownItems, setBreakdownItems] = useState<Array<BreakdownCandidate & { checked: boolean; duplicate: boolean }>>([]);
  const breakdownAbort = useRef<AbortController | null>(null);
  const hasAnyArtifact = useMemo(
    () => ["product-brief", "prfaq", "prd", "ux", "architecture", "epics-stories", "sprint-planning"].some((id) => project.artifacts[id]?.content?.trim()),
    [project.artifacts],
  );
  const existingTitleList = useMemo(() => allTasks.map((t) => t.title.toLowerCase()), [allTasks]);

  function breakdownSystem(): string {
    const agent = agentForStep("epics-stories");
    return `Kamu ${agent.name} (${agent.title}) di BMAD Studio. ${agent.essence} Gaya: ${agent.style} Jawab Bahasa Indonesia, ringkas, tanpa basa-basi.`;
  }

  function buildBreakdownPrompt(): string {
    return `${artifactContext(project)}Project: ${project.name}\n${project.description ? `Deskripsi: ${project.description}\n` : ""}Tugas: pecah SELURUH artefak rencana di atas menjadi 8–25 stories konkret yang kecil (1–4 jam per story), tidak duplikat, urut dari prioritas tertinggi. Kelompokkan tiap story ke epic yang paling pas (pakai nama epic dari artefak bila ada). Tiap story wajib punya acceptance criteria bernomor di detail.\n\nAturan output KETAT — balas HANYA satu blok:\n\`\`\`json tasks\n[{"title": "aksi user yang spesifik", "epic": "nama epic", "priority": "high|medium|low", "tags": ["frontend"], "detail": "Story: Sebagai ... saya bisa ... agar ...\\nAkseptansi:\\n1. ...\\n2. ..."}]\n\`\`\`\nTanpa prosa di luar blok.`;
  }

  async function handleBreakdown() {
    if (breakdownBusy || Object.values(activeRuns).some((run) => run.kind === "build")) return;
    if (!hasAnyArtifact) {
      notify({ kind: "error", title: "Belum ada artefak", description: "Isi tab Rencana dulu (PRD / arsitektur / epics) sebelum breakdown." });
      return;
    }
    const isDirect = settings.guidanceMode === "direct";
    const modelId = settings.defaultModel;
    if (!isDirect && !modelId) {
      notify({ kind: "error", title: "Belum ada model default", description: "Pilih model AI di Settings → OpenCode dulu, atau pindah ke mode Direct AI." });
      return;
    }
    breakdownAbort.current?.abort();
    const controller = new AbortController();
    breakdownAbort.current = controller;
    setBreakdownBusy(true);
    setBreakdownError(null);
    setBreakdownRaw(null);
    setBreakdownItems([]);
    setBreakdownOpen(true);
    const t0 = Date.now();
    try {
      const system = breakdownSystem();
      const prompt = buildBreakdownPrompt();
      let text: string;
      if (isDirect) {
        // Direct AI: jangan kirim settings.defaultModel (format "provider/model"
        // ala OpenCode) — biarkan server pakai model bawaan provider Direct
        // aktif, kalau tidak provider balas 404 model not found.
        const res = await directAI.chat({
          system,
          messages: [{ role: "user", content: prompt }],
        });
        text = res.text;
      } else {
        const res = await opencode.chat({
          directory: project.directory,
          sessionId: project.sessionId,
          message: prompt,
          system,
          model: modelId,
          agent: settings.defaultAgent,
          title: `${project.name} — Breakdown stories`,
          signal: controller.signal,
        });
        text = res.text;
        if (res.sessionId && res.sessionId !== project.sessionId) setProjectSession(project.id, res.sessionId);
      }
      const raw = (text ?? "").trim();
      setBreakdownRaw(raw || null);
      const parsed = parseAgentBreakdown(raw);
      if (parsed.length === 0) {
        setBreakdownError("Agen tidak mengembalikan stories yang bisa diparse. Coba lagi atau lihat jawaban mentah di bawah.");
        return;
      }
      setBreakdownItems(
        parsed.map((c) => {
          const low = c.title.toLowerCase();
          const duplicate = existingTitleList.some((t) => t === low || t.includes(low) || low.includes(t));
          return { ...c, checked: !duplicate, duplicate };
        }),
      );
      notify({ kind: "success", title: "Breakdown selesai", description: `${parsed.length} stories dalam ${Math.round((Date.now() - t0) / 1000)}s — centang lalu impor.` });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const message = e instanceof Error ? e.message : "Breakdown gagal. Coba lagi.";
      setBreakdownError(message);
      notify({ kind: "error", title: "Breakdown gagal", description: message });
    } finally {
      setBreakdownBusy(false);
      breakdownAbort.current = null;
    }
  }

  function importBreakdown() {
    const picked = breakdownItems.filter((i) => i.checked);
    if (picked.length === 0) return;
    const n = importTasks(
      project.id,
      picked.map((i) => ({ title: i.title, detail: i.detail, epic: i.epic, tags: i.tags, priority: i.priority })),
    );
    setBreakdownItems((prev) =>
      prev.map((i) => (i.checked ? { ...i, checked: false, duplicate: true } : i)),
    );
    notify({ kind: "success", title: "Stories diimpor", description: `${n} story masuk backlog${picked.length - n > 0 ? `, ${picked.length - n} duplikat dilewati` : ""}.` });
  }
  // Build dialog (form build + info task terpilih)
  const [buildDialogOpen, setBuildDialogOpen] = useState(false);
  const [buildFullscreen, setBuildFullscreen] = useState(false);
  const [buildDetailsTab, setBuildDetailsTab] = useState<"info" | "history" | "activity" | "review">("info");
  const [runMode, setRunMode] = useState<"build" | "review">("build");
  const [activityMode, setActivityMode] = useState<"build" | "review">("build");

  // Build runner (per selected task, konteks artefak otomatis)
  const [goalOverride, setGoalOverride] = useState<string | null>(null);
  const [models, setModels] = useState<ReturnType<typeof flattenModels>>([]);
  const [activeRuns, setActiveRuns] = useState<Record<string, ActiveTaskRun>>({});
  const activeRunsRef = useRef<Record<string, ActiveTaskRun>>({});
  const runContextsRef = useRef<Record<string, TaskRunContext>>({});
  const selectedIdRef = useRef(selectedId);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(project.sessionId ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const recoveredRunsRef = useRef(new Set<string>());
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastDoneAt, setLastDoneAt] = useState<string | null>(null);
  const [answeringHaltByTask, setAnsweringHaltByTask] = useState<Record<string, boolean>>({});
  // Log per task disimpan di memori sesi agar tidak hilang saat ganti seleksi;
  // ringkasannya (status, durasi, file) dipersist ke store saat build selesai.
  const logsRef = useRef(new Map<string, ActivityEvent[]>());
  const selectedRunKey = selected?.id ?? NO_TASK_KEY;
  const activeRunCount = Object.keys(activeRuns).length;
  const selectedPersistedRun = selected?.builds?.find((build) => build.status === "running") ?? null;
  const selectedRun = activeRuns[selectedRunKey] ?? null;
  const busy = selectedRun?.kind === "build" || (!selectedRun && selectedPersistedRun?.mode !== "review" && selectedPersistedRun !== null);
  const reviewing = selectedRun?.kind === "review" || (!selectedRun && selectedPersistedRun?.mode === "review");
  const elapsedSec = selectedRun?.elapsedSec ?? 0;
  const halt = selectedRun?.halt ?? null;
  const answeringHalt = Boolean(answeringHaltByTask[selectedRunKey]);

  const setTaskRun = useCallback((taskKey: string, run: ActiveTaskRun | null) => {
    const next = { ...activeRunsRef.current };
    if (run) next[taskKey] = run;
    else delete next[taskKey];
    activeRunsRef.current = next;
    setActiveRuns(next);
  }, []);

  const patchTaskRun = useCallback((taskKey: string, runId: string, patch: Partial<ActiveTaskRun>) => {
    const current = activeRunsRef.current[taskKey];
    if (!current || current.runId !== runId) return;
    setTaskRun(taskKey, { ...current, ...patch });
  }, [setTaskRun]);

  const finishTaskRun = useCallback((taskKey: string, runId: string) => {
    if (activeRunsRef.current[taskKey]?.runId === runId) setTaskRun(taskKey, null);
    if (runContextsRef.current[taskKey]?.runId === runId) delete runContextsRef.current[taskKey];
  }, [setTaskRun]);

  const updateTaskEvents = useCallback((taskKey: string, update: ActivityEvent[] | ((current: ActivityEvent[]) => ActivityEvent[])) => {
    const current = logsRef.current.get(taskKey) ?? [];
    const next = typeof update === "function" ? update(current) : update;
    logsRef.current.set(taskKey, next);
    if ((selectedIdRef.current ?? NO_TASK_KEY) === taskKey) setEvents(next);
  }, []);

  const ready = Boolean(project.directory);
  const displayedSessionId = selected
    ? selected.sessionId ?? currentSessionId
    : currentSessionId ?? project.sessionId;

  function selectTask(id: string | null) {
    if (selectedId) logsRef.current.set(selectedId, events);
    if (id === NO_TASK_KEY) id = null;
    selectedIdRef.current = id;
    setSelectedId(id);
    setGoalOverride(null);
    // Teks "Selesai ..." dari task sebelumnya tidak boleh muncul di task baru.
    setLastDoneAt(null);
    setEvents(id ? (logsRef.current.get(id) ?? []) : (logsRef.current.get(NO_TASK_KEY) ?? []));
    setError(null);
    setReviewError(null);
    const task = id ? tasks.find((item) => item.id === id) : null;
    const taskSessionId = (id ? activeRunsRef.current[id]?.sessionId : undefined) ?? task?.sessionId ?? project.sessionId ?? null;
    setCurrentSessionId(taskSessionId);
    const activeRun = id ? activeRunsRef.current[id] : undefined;
    if (activeRun) {
      setActivityMode(activeRun.kind);
      setBuildDetailsTab("activity");
    }
  }

  // Ticker elapsed time selama build / review berjalan (dipakai modal + badge kartu).
  useEffect(() => {
    if (activeRunCount === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setActiveRuns((previous) => {
        const next = Object.fromEntries(Object.entries(previous).map(([taskKey, run]) => [
          taskKey,
          { ...run, elapsedSec: Math.max(0, Math.floor((now - run.startedAtMs) / 1000)) },
        ]));
        activeRunsRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [activeRunCount]);

  useEffect(() => {
    if (!projectsLoaded) return;
    void (async () => {
      let activeSessionIds = new Set<string>();
      try {
        const active = await opencode.activeSessions(project.directory);
        activeSessionIds = new Set(active.activeSessionIds);
      } catch { /* Persisted running records are still reattached below. */ }

      const candidates = tasks.flatMap((task) => {
        const builds = task.builds ?? [];
        return builds.filter((build) => {
          const sessionId = build.sessionId ?? task.sessionId ?? project.sessionId;
          if (build.status === "running") return true;
          if (!sessionId || !activeSessionIds.has(sessionId) || !["error", "interrupted", "stopped"].includes(build.status)) return false;
          return !builds.some((newer) => {
            const newerSessionId = newer.sessionId ?? task.sessionId ?? project.sessionId;
            return newerSessionId === sessionId && Date.parse(newer.startedAt) > Date.parse(build.startedAt);
          });
        }).map((build) => ({ task, build }));
      }).sort((a, b) => Date.parse(b.build.startedAt) - Date.parse(a.build.startedAt));
      const claimedSessions = new Set<string>();

      for (const { task, build } of candidates) {
      const taskKey = task.id;
      if (recoveredRunsRef.current.has(build.id) || activeRunsRef.current[taskKey]) continue;
      const candidateSessionId = build.sessionId ?? task.sessionId ?? project.sessionId;
      if (candidateSessionId && claimedSessions.has(candidateSessionId)) continue;
      if (candidateSessionId) claimedSessions.add(candidateSessionId);
      recoveredRunsRef.current.add(build.id);
      void (async () => {
        const mode = build.mode === "review" ? "review" : "build";
        const startedAtMs = Date.parse(build.startedAt) || Date.now();
        let sessionId = build.sessionId ?? task.sessionId ?? project.sessionId;
        if (!sessionId) {
          setTaskRun(taskKey, { kind: mode, runId: build.id, startedAtMs, elapsedSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) });
          const expectedTitle = mode === "review" ? `Implementation review — ${task.title}` : `${project.name} — Build ${task.title}`;
          for (let attempt = 0; attempt < 20 && !sessionId; attempt += 1) {
            try {
              const { sessions } = await opencode.sessions(project.directory);
              sessionId = sessions.find((session) => session.title === expectedTitle)?.id;
            } catch { /* Retry while the session list catches up. */ }
            if (!sessionId) await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
        if (!sessionId) {
          const finishedAt = new Date().toISOString();
          const current = useStudio.getState().getProject(project.id)?.tasks?.find((item) => item.id === task.id);
          updateTask(project.id, task.id, {
            builds: (current?.builds ?? task.builds ?? []).map((item) => item.id === build.id
              ? { ...item, status: "error", statusMessage: "Session OpenCode belum ditemukan; run tidak ditandai terinterupsi.", finishedAt }
              : item),
          });
          finishTaskRun(taskKey, build.id);
          return;
        }

        if (build.status !== "running") {
          const current = useStudio.getState().getProject(project.id)?.tasks?.find((item) => item.id === task.id);
          updateTask(project.id, task.id, {
            builds: (current?.builds ?? task.builds ?? []).map((item) => item.id === build.id
              ? { ...item, status: "running", finishedAt: undefined, statusMessage: undefined }
              : item),
          });
        }

        const context: TaskRunContext = { kind: mode, runId: build.id, sessionId, pendingInterrupt: false, stopRequested: false };
        runContextsRef.current[taskKey] = context;
        setTaskRun(taskKey, {
          kind: mode,
          runId: build.id,
          startedAtMs,
          elapsedSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
          sessionId,
        });
        updateTaskEvents(taskKey, [{ kind: "info", title: `Menyambungkan kembali — ${task.title}`, detail: `Session: ${sessionId}` }]);
        if (selectedIdRef.current === task.id) {
          setCurrentSessionId(sessionId);
          setActivityMode(mode);
          setBuildDetailsTab("activity");
        }

        let status: TaskBuild["status"] = "running";
        let summary: string | undefined;
        let statusMessage: string | undefined;
        let usage: TokenUsage | undefined;
        try {
          let statusCheckFailures = 0;
          while (status === "running") {
            const response = await fetch("/api/opencode/stream", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ directory: project.directory, sessionId, resumeOnly: true }),
            });
            if (!response.ok || !response.body) {
              const data = (await response.json().catch(() => ({}))) as { error?: string };
              throw new Error(data.error ?? `Request failed (${response.status})`);
            }
            const reader = response.body.getReader();
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
                try { payload = JSON.parse(dataStr); } catch { continue; }
                if (eventName === "log") updateTaskEvents(taskKey, (previous) => [...previous, payload as ActivityEvent]);
                else if (eventName === "halt") patchTaskRun(taskKey, build.id, { halt: payload as HaltRequest });
                else if (eventName === "halt_resolved") patchTaskRun(taskKey, build.id, { halt: undefined });
                else if (eventName === "done") {
                  status = "done";
                  const result = payload as { summary?: unknown; usage?: TokenUsage };
                  summary = typeof result.summary === "string" ? result.summary.trim() || undefined : undefined;
                  usage = result.usage;
                } else if (eventName === "error") {
                  status = "error";
                  const result = payload as { message?: string; usage?: TokenUsage };
                  statusMessage = result.message ?? "Run gagal setelah tersambung kembali.";
                  usage = result.usage;
                } else if (eventName === "interrupted") {
                  status = context.stopRequested ? "stopped" : "interrupted";
                  statusMessage = context.stopRequested ? "Run dihentikan melalui tombol Stop." : interruptionStatusMessage((payload as { reason?: string }).reason);
                  usage = (payload as { usage?: TokenUsage }).usage;
                }
              }
            }
            if (status !== "running") break;

            try {
              const sessionState = await opencode.sessionActive(project.directory, sessionId);
              statusCheckFailures = 0;
              if (sessionState.active) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                continue;
              }
              status = "interrupted";
              statusMessage = "OpenCode melaporkan session tidak aktif tanpa status akhir run.";
            } catch {
              statusCheckFailures += 1;
              const retryDelayMs = Math.min(10000, 1500 * 2 ** Math.min(statusCheckFailures - 1, 3));
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
          }
        } catch (failure) {
          status = context.stopRequested ? "stopped" : "error";
          statusMessage = failure instanceof Error ? failure.message : "Gagal menyambungkan kembali ke OpenCode.";
        }

        const finishedAt = new Date();
        const current = useStudio.getState().getProject(project.id)?.tasks?.find((item) => item.id === task.id);
        const currentBuild = current?.builds?.find((item) => item.id === build.id) ?? build;
        let reviewPatch: TaskImplementationReview | undefined;
        if (status === "done") {
          try {
            const result = await opencode.messages(project.directory, sessionId);
            let lastUserIndex = -1;
            result.messages.forEach((message, index) => { if (message.role === "user") lastUserIndex = index; });
            const latestText = result.messages.slice(lastUserIndex + 1)
              .filter((message) => message.role === "assistant" && message.text.trim())
              .map((message) => message.text.trim())
              .join("\n\n");
            if (latestText && (mode === "review" || !summary)) summary = latestText.length > 12000 ? latestText.slice(-12000) : latestText;
          } catch { /* Keep stream summary if session history is unavailable. */ }
          if (mode === "review" && summary) {
            reviewPatch = { verdict: parseImplementationVerdict(summary), summary, reviewedAt: finishedAt.toISOString(), model: build.model, agent: build.agent };
          }
        }
        const finalEvents = logsRef.current.get(taskKey) ?? [];
        const updatedBuild: TaskBuild = {
          ...currentBuild,
          status,
          summary: summary ?? currentBuild.summary,
          usage: usage ?? currentBuild.usage,
          statusMessage,
          finishedAt: finishedAt.toISOString(),
          elapsedMs: Math.max(0, finishedAt.getTime() - startedAtMs),
          eventCount: finalEvents.length,
          files: extractFiles(finalEvents),
        };
        updateTask(project.id, task.id, {
          builds: [updatedBuild, ...(current?.builds ?? task.builds ?? []).filter((item) => item.id !== build.id)],
          ...(reviewPatch ? { implementationReview: reviewPatch } : {}),
          ...(mode === "build" && status === "done" && current?.status === "in-progress" ? { status: "review" } : {}),
        });
        finishTaskRun(taskKey, build.id);
      })();
      }
    })();
  }, [projectsLoaded, project.directory, project.id, project.name, project.sessionId, tasks, updateTask, finishTaskRun, patchTaskRun, setTaskRun, updateTaskEvents]);

  const goalText = (goalOverride ?? "").trim();
  const buildModel = settings.defaultModel ?? "";
  const latestBuild = selected?.builds?.[0];
  const latestBuildRun = selected?.builds?.find((build) => (build.mode ?? "build") === "build");
  const cumulativeBuildDurationMs = (selected?.builds ?? []).reduce(
    (total, build) => total + (typeof build.elapsedMs === "number" ? build.elapsedMs : 0),
    0
  );
  const cumulativeTokenUsage = (selected?.builds ?? []).reduce(
    (total, build) => {
      if (!build.usage) return total;
      return {
        input: total.input + build.usage.input,
        output: total.output + build.usage.output,
        reasoning: total.reasoning + build.usage.reasoning,
        cacheRead: total.cacheRead + build.usage.cacheRead,
        cacheWrite: total.cacheWrite + build.usage.cacheWrite,
        total: total.total + build.usage.total,
        runCount: total.runCount + 1,
        costUsd: total.costUsd + (build.usage.costUsd ?? 0),
        costRunCount: total.costRunCount + (build.usage.costUsd === undefined ? 0 : 1),
      };
    },
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, runCount: 0, costUsd: 0, costRunCount: 0 }
  );
  const canResumeBuild = latestBuildRun?.status === "error" || latestBuildRun?.status === "stopped" || latestBuildRun?.status === "interrupted";
  const hasBuildHistory = Boolean(latestBuildRun);

  useEffect(() => {
    let active = true;
    void opencode.providers()
      .then(({ providers }) => {
        if (active) setModels(flattenModels(providers));
      })
      .catch(() => {
        if (active) setModels([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of allTasks) for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [allTasks]);
  const visibleTasks = sortTasks(tagFilter ? tasks.filter((t) => (t.tags ?? []).includes(tagFilter)) : tasks);
  const nextUp = sortTasks(visibleTasks.filter((t) => t.status === "todo")).concat(sortTasks(visibleTasks.filter((t) => t.status === "backlog")))[0] ?? null;

  // Strip Backlog horizontal di atas board.
  const backlogRef = useRef<HTMLDivElement | null>(null);
  const isBugFixTask = (task: ExecTask) => (task.tags ?? []).some((tag) => tag === "bug" || tag === "fix");
  const backlogAll = useMemo(() => {
    const base = tagFilter ? tasks.filter((t) => (t.tags ?? []).includes(tagFilter)) : tasks;
    return sortTasks(base.filter((t) => t.status === "backlog" && !isBugFixTask(t)));
  }, [tasks, tagFilter]);
  const backlogItems = backlogAll.slice(0, BOARD_LIMIT);
  const backlogRest = backlogAll.length - backlogItems.length;
  const bugFixTasks = sortTasks(visibleTasks.filter((task) => task.status === "backlog" && isBugFixTask(task)));
  function scrollBacklog(dir: -1 | 1) {
    backlogRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  }

  // Handler kartu (dipakai ulang strip Backlog + grid board).
  function cyclePriority(t: ExecTask) {
    const order: TaskPriority[] = ["high", "medium", "low"];
    const next = order[(order.indexOf(t.priority ?? "medium") + 1) % order.length];
    updateTask(project.id, t.id, { priority: next });
  }
  function setTaskStatus(t: ExecTask, status: TaskStatus) {
    updateTask(project.id, t.id, { status });
  }
  // Props indikator running untuk TaskCard — kartu task yang sedang di-build /
  // di-review menampilkan spinner + elapsed walau modal build tertutup.
  function runningPropsFor(taskId: string): { running: "build" | "review" | null; runningElapsedSec: number; awaitingHalt: boolean } {
    const activeRun = activeRuns[taskId];
    if (activeRun) return { running: activeRun.kind, runningElapsedSec: activeRun.elapsedSec, awaitingHalt: activeRun.kind === "build" && activeRun.halt !== undefined };
    const task = tasks.find((item) => item.id === taskId);
    const persistedRun = task?.builds?.find((build) => build.status === "running");
    if (!persistedRun) return { running: null, runningElapsedSec: 0, awaitingHalt: false };
    return { running: persistedRun.mode === "review" ? "review" : "build", runningElapsedSec: 0, awaitingHalt: false };
  }
  const cardHandlers = {
    onOpen: openBuildDialog,
    onEdit: openEdit,
    onArchive: handleArchiveTask,
    onDelete: handleDeleteTask,
    onCyclePriority: cyclePriority,
    onSetStatus: setTaskStatus,
    onMove: move,
  };

  function openList(status?: TaskStatus | "all", scope: "active" | "archived" | "deleted" = "active") {
    if (status !== undefined) setListStat(status);
    setListScope(scope);
    setListOpen(true);
  }
  const listFiltered = useMemo(() => {
    const q = listQ.trim().toLowerCase();
    const scopedTasks = listScope === "active" ? tasks : listScope === "archived" ? archivedTasks : deletedTasks;
    return sortTasks(
      scopedTasks.filter((t) => {
        if (listStat !== "all" && t.status !== listStat) return false;
        if (listPri && (t.priority ?? "medium") !== listPri) return false;
        if (listTag && !(t.tags ?? []).includes(listTag)) return false;
        if (q && !`${t.title}\n${t.detail}\n${t.epic}`.toLowerCase().includes(q)) return false;
        return true;
      })
    );
  }, [tasks, archivedTasks, deletedTasks, listScope, listQ, listTag, listPri, listStat]);

  function openNew() {
    setEditing(null);
    setDialogKind("task");
    setFTitle("");
    setFEpic("");
    setFDetail("");
    setFBugSteps("");
    setFBugActual("");
    setFBugExpected("");
    setFBugEnvironment("");
    setFTags("");
    setFPriority("medium");
    setFStatus("backlog");
    setDialogOpen(true);
  }
  function openNewBug() {
    openNew();
    setDialogKind("bug");
    setFTags("bug");
  }
  function openEdit(t: ExecTask) {
    setEditing(t);
    const isBug = (t.tags ?? []).some((tag) => tag === "bug" || tag === "fix");
    setDialogKind(isBug ? "bug" : "task");
    setFTitle(t.title);
    setFEpic(t.epic);
    setFDetail(t.detail);
    const report = parseBugReport(t.detail);
    setFBugSteps(report.steps);
    setFBugActual(report.actual);
    setFBugExpected(report.expected);
    setFBugEnvironment(report.environment);
    setFTags((t.tags ?? []).join(", "));
    setFPriority(t.priority ?? "medium");
    setFStatus(t.status);
    setDialogOpen(true);
  }

  function openBuildDialog(t: ExecTask) {
    // Buka dialog untuk task lain walau build/review lain sedang berjalan.
    selectTask(t.id);
    setGoalOverride(t.builds?.find((build) => (build.mode ?? "build") === "build")?.goal || null);
    const run = activeRunsRef.current[t.id];
    setBuildDetailsTab(run ? "activity" : "info");
    setActivityMode(run?.kind ?? "build");
    setBuildDialogOpen(true);
  }
  function saveDialog() {
    if (!fTitle.trim()) return;
    if (dialogKind === "bug" && (!fBugSteps.trim() || !fBugActual.trim() || !fBugExpected.trim())) {
      notify({ kind: "error", title: "Laporan bug belum lengkap", description: "Isi langkah reproduksi, hasil aktual, dan hasil yang diharapkan." });
      return;
    }
    const tags = dialogKind === "bug" ? [...new Set([...parseTagInput(fTags), "bug"])] : parseTagInput(fTags);
    const detail = dialogKind === "bug" ? formatBugReport({ steps: fBugSteps, actual: fBugActual, expected: fBugExpected, environment: fBugEnvironment }) : fDetail.trim();
    if (editing) {
      updateTask(project.id, editing.id, { title: fTitle.trim(), epic: fEpic.trim(), detail, tags, priority: fPriority, status: fStatus });
    } else {
      const id = addTask(project.id, { title: fTitle.trim(), epic: fEpic.trim(), detail, tags, priority: fPriority, status: fStatus });
      selectTask(id);
    }
    setDialogOpen(false);
    notify({ kind: "success", title: dialogKind === "bug" ? editing ? "Laporan bug diperbarui" : "Laporan bug dibuat" : editing ? "Task diperbarui" : "Task dibuat", description: fTitle.trim() });
  }

  function move(t: ExecTask, dir: -1 | 1) {
    const idx = COLUMNS.findIndex((c) => c.id === t.status);
    const next = COLUMNS[idx + dir];
    if (next) updateTask(project.id, t.id, { status: next.id });
  }

  function handleArchiveTask(taskId: string) {
    archiveTask(project.id, taskId);
    if (selectedId === taskId) selectTask(null);
    notify({ kind: "success", title: "Task diarsipkan" });
  }

  function handleDeleteTask(taskId: string) {
    deleteTask(project.id, taskId);
    if (selectedId === taskId) selectTask(null);
    notify({ kind: "success", title: "Task dipindahkan ke sampah" });
  }

  function handleRestoreTask(taskId: string) {
    restoreTask(project.id, taskId);
    notify({ kind: "success", title: "Task dipulihkan" });
  }

  function openEpic() {
    setEpicTitle("");
    setEpicDesc("");
    setElaborated([]);
    setElaborateError(null);
    setEpicOpen(true);
  }

  async function handleElaborateEpic() {
    const title = epicTitle.trim();
    if (!title || elaborating) return;
    const fresh = useStudio.getState().getProject(project.id) ?? project;
    const direct = settings.guidanceMode === "direct";
    if (!fresh.directory && !direct) {
      const message = "Set working directory dulu (atau pakai mode Direct AI di Settings) untuk memanggil agen.";
      setElaborateError(message);
      notify({ kind: "error", title: "Elaborasi epic tidak tersedia", description: message });
      return;
    }
    setElaborating(true);
    setElaborateError(null);
    setElaborated([]);
    try {
      const agent = agentForStep("epics-stories");
      const system = [
        `You are ${agent.name}, a ${agent.title} in the BMAD Method. Communication style: ${agent.style}`,
        `Break the given EPIC into 3-8 small, buildable user stories.`,
        ``,
        artifactContext(fresh),
        ``,
        `EPIC: ${title}`,
        epicDesc.trim() ? `Epic description: ${epicDesc.trim()}` : ``,
        ``,
        `Answer directly in this turn — do not call tools or browse files, all data you need is above.`,
        ``,
        `Rules:`,
        `- Each story must be independently buildable + testable, ordered by value.`,
        `- Title: short imperative ("User bisa ..."), max 12 words.`,
        `- Detail: 1-3 acceptance criteria, concise.`,
        `- Stay consistent with the plan context above; flag assumptions as proposal.`,
        `- Output ONLY a JSON array, no preamble, no code fences: [{"title": "...", "detail": "AC1: ... AC2: ..."}]`,
      ].filter(Boolean).join("\n");
      const res = direct
        ? await directAI.chat({ system, messages: [{ role: "user", content: `Elaborate this epic: ${title}` }] })
        : await opencode.chat({
            directory: fresh.directory,
            sessionId: fresh.sessionId,
            message: `Elaborate this epic into stories: ${title}`,
            system,
            model: settings.defaultModel,
            agent: settings.defaultAgent,
            title: `${fresh.name} — Elaborasi epic`,
          });
      if (!direct && "sessionId" in res && res.sessionId && res.sessionId !== fresh.sessionId) {
        setProjectSession(project.id, res.sessionId);
      }
      if (!res.text) throw new Error("Agen mengembalikan respons kosong.");
      const parsed = parseStories(res.text, title);
      if (parsed.length === 0) throw new Error("Tidak bisa mem-parse hasil agen. Coba lagi dengan deskripsi lebih jelas.");
      setElaborated(parsed.map((s) => ({ ...s, checked: true })));
      notify({ kind: "success", title: "Elaborasi epic selesai", description: `${parsed.length} story siap ditambahkan.` });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Elaborasi gagal";
      setElaborateError(message);
      notify({ kind: "error", title: "Elaborasi epic gagal", description: message });
    } finally {
      setElaborating(false);
    }
  }

  function saveElaborated() {
    const chosen = elaborated.filter((s) => s.checked && s.title.trim());
    if (chosen.length === 0) return;
    const n = importTasks(project.id, chosen.map((s) => ({ title: s.title.trim(), detail: s.detail, epic: s.epic })));
    setEpicOpen(false);
    setElaborated([]);
    if (n === 0) {
      const message = "Semua story sudah ada di papan (duplikat).";
      setError(message);
      notify({ kind: "error", title: "Story tidak ditambahkan", description: message });
    } else {
      notify({ kind: "success", title: "Story berhasil ditambahkan", description: `${n} story ditambahkan ke papan.` });
    }
  }

  function openSprintPlanner() {
    setSprintFocus("");
    setSprintError(null);
    setSprintRaw(null);
    setSprintName("");
    setSprintGoal("");
    setSprintReason("");
    setSprintPicks([]);
    // Prefill dari blok mesin sprint-planning bila ada.
    try {
      const combined = `${project.artifacts["epics-stories"]?.content ?? ""}\n${project.artifacts["sprint-planning"]?.content ?? ""}`;
      const ms = parseMachineSprint(combined);
      if (ms && (ms.name || ms.goal || ms.taskTitles.length > 0)) {
        if (ms.name) setSprintName(ms.name);
        if (ms.goal) setSprintGoal(ms.goal);
        if (ms.taskTitles.length > 0) {
          const norm = (s: string) => s.toLowerCase().trim();
          const matched = ms.taskTitles
            .map((wt) => tasks.find((t) => norm(t.title) === norm(wt)) ?? tasks.find((t) => norm(t.title).includes(norm(wt)) || norm(wt).includes(norm(t.title))))
            .filter((t): t is ExecTask => Boolean(t))
            .map((t) => ({ id: t.id, title: t.title, checked: true }));
          if (matched.length > 0) {
            setSprintPicks(matched);
            setSprintReason("Diprefill dari blok mesin sprint-planning.");
          }
        }
      }
    } catch { /* abaikan prefill */ }
    setSprintOpen(true);
  }

  async function handleAskSprint() {
    if (sprintAsking) return;
    const fresh = useStudio.getState().getProject(project.id) ?? project;
    const backlog = sortTasks((fresh.tasks ?? []).filter((t) => t.status === "backlog"));
    if (backlog.length === 0) {
      const message = "Backlog kosong — buat task atau impor dari artefak dulu.";
      setSprintError(message);
      notify({ kind: "error", title: "Saran sprint gagal", description: message });
      return;
    }
    // Saran sprint butuh jawaban terstruktur (JSON) — selalu via Direct AI,
    // bukan OpenCode yang menjawab konversasional / memakai tools.
    setSprintAsking(true);
    setSprintError(null);
    setSprintRaw(null);
    try {
      const agent = agentForStep("sprint-planning");
      const list = backlog.map((t, i) => `${i + 1}. "${t.title}" [${t.priority ?? "medium"}]${t.epic ? ` (Epic: ${t.epic})` : ""}${t.detail ? ` — ${t.detail.slice(0, 160)}` : ""}`).join("\n");
      const system = [
        `You are ${agent.name}, a ${agent.title} in the BMAD Method. Communication style: ${agent.style}`,
        `Pick the tasks for the NEXT sprint from the backlog below. Prefer high priority first, keep stories in dependency order, and keep the batch small and coherent (3-6 tasks unless the focus says otherwise).`,
        ``,
        artifactContext(fresh),
        ``,
        `BACKLOG (quote titles EXACTLY as written):\n${list}`,
        ``,
        sprintFocus.trim() ? `Sprint focus / capacity: ${sprintFocus.trim()}` : `No explicit focus — choose the highest-value coherent batch.`,
        ``,
        `Answer directly in this turn — do not call tools or browse files, all data you need is above.`,
        `Output ONLY a JSON object, no preamble, no code fences: {"name": "Sprint N — short theme", "goal": "one-paragraph sprint goal", "reason": "one line why this batch", "taskTitles": ["exact title 1", "exact title 2"]}`,
      ].filter(Boolean).join("\n");
      const res = await directAI.chat({
        system,
        messages: [{ role: "user", content: "Plan the next sprint from this backlog." }],
        temperature: 0.3,
      });
      if (!res.text) throw new Error("Agen mengembalikan respons kosong.");
      const suggestion = parseSprintResponse(res.text, backlog.map((t) => t.title));
      if (!suggestion) {
        setSprintRaw(res.text.slice(0, 2000));
        throw new Error("Tidak bisa mem-parse saran agen. Respons mentah ditampilkan di bawah — coba lagi atau pilih manual.");
      }
      setSprintRaw(null);
      const titles = suggestion.titles;
      if (titles.length === 0) throw new Error("Agen tidak memilih task apa pun. Coba tambah fokus yang lebih jelas.");
      const norm = (s: string) => s.toLowerCase().trim();
      const picks = titles.map((wt) => {
        const hit = backlog.find((t) => norm(t.title) === norm(wt))
          ?? backlog.find((t) => norm(t.title).includes(norm(wt)) || norm(wt).includes(norm(t.title)));
        return hit ? { id: hit.id, title: hit.title, checked: true } : null;
      });
      const matched = picks.filter((p) => p !== null);
      const missed = titles.length - matched.length;
      if (matched.length === 0) throw new Error("Judul dari agen tidak cocok dengan backlog. Coba lagi.");
      setSprintName(suggestion.name || "Sprint berikutnya");
      setSprintGoal(suggestion.goal);
      setSprintReason(`${suggestion.reason}${missed > 0 ? ` (${missed} usulan tidak cocok dan dilewati)` : ""}`.trim());
      setSprintPicks(matched as Array<{ id: string; title: string; checked: boolean }>);
      notify({ kind: "success", title: "Saran sprint siap", description: `${matched.length} task dipilih.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal meminta saran agen";
      const message = /No Direct|Multiple Direct|provider|No model|API key|Unauthorized|401/i.test(msg)
        ? `Direct AI belum siap (${msg}). Atur provider + API key + model di halaman Settings, lalu coba lagi.`
        : msg;
      setSprintError(message);
      notify({ kind: "error", title: "Saran sprint gagal", description: message });
    } finally {
      setSprintAsking(false);
    }
  }

  function saveSprint() {
    const ids = sprintPicks.filter((p) => p.checked).map((p) => p.id);
    if (!sprintName.trim() || ids.length === 0) return;
    createSprint(project.id, { name: sprintName.trim(), goal: sprintGoal.trim(), taskIds: ids });
    setSprintOpen(false);
    notify({ kind: "success", title: "Sprint dibuat", description: sprintName.trim() });
  }

  async function handleBuild(startedAtMs: number) {
    if (selectedTaskDone || (!selected && !goalText) || !ready) return;
    const buildTaskId = selected?.id ?? null;
    const logKey = buildTaskId ?? NO_TASK_KEY;
    if (activeRunsRef.current[logKey] || (buildTaskId && selected?.builds?.some((build) => build.status === "running"))) return;
    const previousBuild = selected?.builds?.find((build) => (build.mode ?? "build") === "build");
    const isResuming = previousBuild?.status === "error" || previousBuild?.status === "stopped" || previousBuild?.status === "interrupted";
    const isRebuild = Boolean(previousBuild && !isResuming);
    setActivityMode("build");
    const goalSnapshot = isResuming && previousBuild?.goal ? previousBuild.goal : goalText;
    const modelId = buildModel || settings.defaultModel;
    const modelName = models.find((model) => model.id === modelId)?.name ?? modelId;
    let effectiveSessionId = buildTaskId ? selected?.sessionId : project.sessionId;
    if (buildTaskId && !effectiveSessionId) {
      try {
        const session = await opencode.createSession(project.directory, `${project.name} — Build ${selected?.title ?? "Task"}`);
        effectiveSessionId = session.id;
        setTaskSession(project.id, buildTaskId, session.id);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Gagal membuat session untuk task.");
        return;
      }
    }
    setBuildDetailsTab("activity");
    setError(null);
    // eslint-disable-next-line react-hooks/purity -- build ids are created in the user action handler.
    const buildId = `b_${startedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    let activeSessionId = effectiveSessionId;
    let buildStatus: TaskBuild["status"] = "running";
    let buildStatusMessage: string | undefined;
    let buildCount = 0;
    const runContext: TaskRunContext = { kind: "build", runId: buildId, sessionId: effectiveSessionId, pendingInterrupt: false, stopRequested: false };
    setTaskRun(logKey, { kind: "build", runId: buildId, startedAtMs, elapsedSec: 0, sessionId: effectiveSessionId });
    runContextsRef.current[logKey] = runContext;
    updateTaskEvents(logKey, []);
    if (selectedIdRef.current === buildTaskId) setLastDoneAt(null);
    let buildSummary: string | undefined;
    let buildUsage: TokenUsage | undefined;
    let buildFailureMessage: string | undefined;
    let activityErrorNotified = false;
    const pushLog = (e: ActivityEvent) => {
      updateTaskEvents(logKey, (current) => [...current, e]);
      buildCount = logsRef.current.get(logKey)?.length ?? buildCount;
      if (e.kind === "error") {
        activityErrorNotified = true;
        notify({ kind: "error", title: e.title || "Aktivitas gagal", description: e.detail });
      }
    };
    const taskLine = selected ? `Task: ${selected.title}${selected.epic ? ` (Epic: ${selected.epic})` : ""}\n${selected.detail ? `Detail: ${selected.detail}\n` : ""}` : "";
    const previousSummary = previousBuild?.summary?.trim() || "—";
    const rebuildSummary = previousSummary.length > 1200
      ? `${previousSummary.slice(0, 1200)}… [ringkasan dipotong]`
      : previousSummary;
    const prompt = isResuming
      ? `${taskLine}Lanjutkan build dari kondisi terakhir setelah proses sebelumnya terputus. Periksa perubahan dan status kerja saat ini terlebih dahulu, jangan mengulang pekerjaan yang sudah selesai. Build sebelumnya: ${previousBuild?.summary ?? previousBuild?.statusMessage ?? "tidak ada ringkasan"}.${goalSnapshot ? `\n\nInstruksi tambahan tetap:\n${goalSnapshot}` : ""}`
      : isRebuild
        ? `${taskLine}Periksa implementasi saat ini terhadap acceptance criteria. Pertahankan bagian yang benar; perbaiki hanya kekurangan. Jalankan pemeriksaan relevan dan laporkan file yang berubah beserta hasilnya.${goalSnapshot ? `\n\nInstruksi tambahan:\n${goalSnapshot}` : ""}\n\nKonteks build sebelumnya (bukan bukti): status ${previousBuild?.status ?? "—"}; ringkasan ${rebuildSummary}; file ${(previousBuild?.files ?? []).slice(0, 8).join(", ") || "—"}`
      : `${taskLine}${goalSnapshot ? `Instruksi tambahan:\n${goalSnapshot}\n\n` : ""}Catatan: Artefak rencana (PRD, Architecture, Epics, Sprint, Project Context) tersedia di folder project. Baca dari disk sesuai kebutuhan.\n\nSetelah selesai, tandai file yang diubah dan cara verifikasi.`;
    // Tandai task sedang dikerjakan begitu build mulai (backlog/todo -> in-progress).
    if (buildTaskId) {
      const cur = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId);
      if (cur && cur.status !== "in-progress") {
        updateTask(project.id, buildTaskId, { status: "in-progress" });
      }
      if (cur) {
        updateTask(project.id, buildTaskId, {
          builds: [
            {
              id: buildId,
              goal: goalSnapshot,
              status: "running" as const,
              model: modelId,
              modelName,
              agent: settings.buildAgent,
              sessionId: effectiveSessionId,
              startedAt: new Date(startedAtMs).toISOString(),
              eventCount: 0,
              files: [],
            },
            ...(cur.builds ?? []),
          ],
        });
      }
    }
    if ((selectedIdRef.current ?? NO_TASK_KEY) === logKey) setCurrentSessionId(effectiveSessionId ?? null);
    try {
      const res = await fetch("/api/opencode/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: project.directory,
          sessionId: effectiveSessionId,
          prompt,
          model: modelId,
          agent: settings.buildAgent,
          title: `${project.name} — Build ${selected?.title ?? ""}`,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
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
          try { payload = JSON.parse(dataStr); } catch { continue; }
          if (eventName === "session") {
            const { sessionId } = payload as { sessionId?: string };
            if (sessionId) {
              activeSessionId = sessionId;
              runContextsRef.current[logKey]!.sessionId = sessionId;
              patchTaskRun(logKey, buildId, { sessionId });
              if ((selectedIdRef.current ?? NO_TASK_KEY) === logKey) setCurrentSessionId(sessionId);
              if (buildTaskId && sessionId !== selected?.sessionId) {
                setTaskSession(project.id, buildTaskId, sessionId);
              } else if (!buildTaskId && sessionId !== project.sessionId) {
                setProjectSession(project.id, sessionId);
              }
              if (runContext.pendingInterrupt) {
                runContext.pendingInterrupt = false;
                void opencode.interruptRun(sessionId).catch(() => {});
              }
            }
          } else if (eventName === "log") {
            pushLog(payload as ActivityEvent);
          } else if (eventName === "halt") {
            // Agent paused for a human decision; block the UI until answered.
            patchTaskRun(logKey, buildId, { halt: payload as HaltRequest });
          } else if (eventName === "halt_resolved") {
            patchTaskRun(logKey, buildId, { halt: undefined });
          } else if (eventName === "done") {
            sawDone = true;
            const donePayload = payload as { summary?: unknown; usage?: TokenUsage };
            buildSummary = typeof donePayload.summary === "string" ? donePayload.summary.trim() || undefined : undefined;
            buildUsage = donePayload.usage;
            if (buildStatus === "running") {
              buildStatus = "done";
              if ((selectedIdRef.current ?? NO_TASK_KEY) === logKey) setLastDoneAt(new Date().toISOString());
            }
          } else if (eventName === "error") {
            buildStatus = "error";
            const { message, usage } = payload as { message?: string; usage?: TokenUsage };
            buildFailureMessage = message ?? "Build error";
            buildStatusMessage = buildFailureMessage;
            buildUsage = usage;
            if ((selectedIdRef.current ?? NO_TASK_KEY) === logKey) setError(buildFailureMessage);
          } else if (eventName === "interrupted") {
            const { reason, usage } = payload as { reason?: string; usage?: TokenUsage };
            if (buildStatus === "running") {
              buildStatus = runContext.stopRequested ? "stopped" : "interrupted";
              buildStatusMessage = runContext.stopRequested ? "Run dihentikan melalui tombol Stop." : interruptionStatusMessage(reason);
            }
            buildUsage = usage;
          }
        }
      }
      if (!sawDone && buildStatus === "running") {
        buildStatus = "error";
        buildFailureMessage = "Koneksi terputus sebelum build selesai. Build dapat dilanjutkan.";
        buildStatusMessage = buildFailureMessage;
        if ((selectedIdRef.current ?? NO_TASK_KEY) === logKey) setError(buildFailureMessage);
      } else if (sawDone && (selectedIdRef.current ?? NO_TASK_KEY) === logKey) {
        setLastDoneAt((value) => value ?? new Date().toISOString());
      }
    } catch (e) {
      buildStatus = runContext.stopRequested ? "stopped" : "error";
      buildFailureMessage = e instanceof Error ? e.message : "Build failed";
      buildStatusMessage = runContext.stopRequested ? "Run dihentikan melalui tombol Stop." : buildFailureMessage;
      if (!runContext.stopRequested && (selectedIdRef.current ?? NO_TASK_KEY) === logKey) setError(buildFailureMessage);
    } finally {
      if (buildStatus === "running") buildStatus = "error";
      if (buildStatus === "done") {
        notify({ kind: "success", title: "Build selesai", description: buildTaskId ? selected?.title : undefined });
      } else if (buildStatus === "error" && !activityErrorNotified) {
        notify({ kind: "error", title: "Build gagal", description: buildFailureMessage ?? "Build tidak berhasil." });
      } else if (buildStatus === "stopped") {
        notify({ kind: "info", title: "Build dihentikan", description: buildTaskId ? selected?.title : undefined });
      } else if (buildStatus === "interrupted") {
        notify({ kind: "info", title: "Build terinterupsi", description: buildStatusMessage });
      }
      const finishedAt = new Date().toISOString();
      const elapsedMs = Date.now() - startedAtMs;
      const finalEvents = logsRef.current.get(logKey) ?? [];
      if (buildTaskId) {
        const prev = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId)?.builds ?? [];
        updateTask(project.id, buildTaskId, {
          builds: [
            {
              id: buildId,
              goal: goalSnapshot,
              summary: buildSummary,
              status: buildStatus,
              model: modelId,
              modelName,
              agent: settings.buildAgent,
              sessionId: activeSessionId ?? effectiveSessionId ?? undefined,
              usage: buildUsage,
              statusMessage: buildStatusMessage,
              startedAt: new Date(startedAtMs).toISOString(),
              finishedAt,
              elapsedMs,
              eventCount: Math.max(buildCount, finalEvents.length),
              files: extractFiles(finalEvents),
            },
            ...prev.filter((build) => build.id !== buildId),
          ],
        });
        // Build sukses -> task otomatis ke review agar siap dicek/QA.
        // Gagal / dihentikan -> status dibiarkan agar bisa diulang.
        if (buildStatus === "done") {
          const cur = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId);
          if (cur && (cur.status === "backlog" || cur.status === "todo" || cur.status === "in-progress")) {
            updateTask(project.id, buildTaskId, { status: "review" });
          }
        }
      }
      finishTaskRun(logKey, buildId);
    }
  }

  async function handleImplementationReview() {
    if (!selected || selectedTaskDone || !ready || activeRunsRef.current[selected.id] || selected.builds?.some((build) => build.status === "running")) return;
    const task = selected;
    const reviewModel = buildModel || settings.defaultModel;
    const reviewStartedAt = new Date();
    const reviewStartedAtMs = reviewStartedAt.getTime();
    // eslint-disable-next-line react-hooks/purity -- runId dibuat sekali per aksi review (event handler), bukan saat render.
    const runId = `rv_${reviewStartedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    let sessionId = task.sessionId;
    if (!sessionId) {
      try {
        const session = await opencode.createSession(project.directory, `${project.name} — Review ${task.title}`);
        sessionId = session.id;
        setTaskSession(project.id, task.id, session.id);
      } catch (failure) {
        setReviewError(failure instanceof Error ? failure.message : "Gagal membuat session review.");
        return;
      }
    }
    let activeSessionId = sessionId;
    const runContext: TaskRunContext = { kind: "review", runId, sessionId, pendingInterrupt: false, stopRequested: false };
    if (selectedIdRef.current === task.id) setCurrentSessionId(sessionId ?? null);
    setTaskRun(task.id, { kind: "review", runId, startedAtMs: reviewStartedAtMs, elapsedSec: 0, sessionId });
    runContextsRef.current[task.id] = runContext;
    updateTask(project.id, task.id, {
      status: "review",
      builds: [
        {
          id: runId,
          mode: "review",
          goal: `Review implementation — ${task.title}`,
          status: "running",
          model: reviewModel,
          modelName: models.find((model) => model.id === reviewModel)?.name ?? reviewModel,
          agent: settings.buildAgent,
          sessionId,
          startedAt: reviewStartedAt.toISOString(),
          eventCount: 0,
          files: [],
        },
        ...(task.builds ?? []),
      ],
    });
    if (selectedIdRef.current === task.id) setReviewError(null);
    if (selectedIdRef.current === task.id) setActivityMode("review");
    // Ikuti alur build: langsung buka tab Activity agar log realtime terlihat.
    // Kesimpulan review HANYA ditulis setelah event `done` dari stream OpenCode.
    if (selectedIdRef.current === task.id) setBuildDetailsTab("activity");
    updateTaskEvents(task.id, []);
    let reviewSummary: string | undefined;
    let reviewUsage: TokenUsage | undefined;
    let reviewStatus: "running" | "done" | "error" | "stopped" | "interrupted" = "running";
    let reviewStatusMessage: string | undefined;
    try {
      const lastBuildForPrompt = (task.builds ?? []).find((build) => (build.mode ?? "build") === "build") ?? task.builds?.[0];
      const prompt = [
        "Review apakah task ini benar-benar sudah diimplementasikan pada repository saat ini.",
        "Bersikap read-only: JANGAN mengubah file, JANGAN menjalankan perintah yang mengubah state (no write/edit/commit), hanya baca file dan jalankan perintah baca/test bila perlu.",
        "Periksa implementasi dan test yang relevan. Cocokkan setiap acceptance criteria dengan bukti kode/test.",
        "Jangan menyimpulkan dari build summary atau review sebelumnya — verifikasi langsung ke file di disk.",
        "Gunakan verdict tepat satu ini pada baris pertama: VERDICT: IMPLEMENTED, VERDICT: PARTIAL, VERDICT: NOT_IMPLEMENTED, atau VERDICT: UNCLEAR.",
        "Lalu tulis ulang summary review yang ringkas dengan bagian ## Summary, ## Evidence, dan ## Gaps. Sebutkan path file dan test konkret; jangan mengarang bukti.",
        `Task: ${task.title}`,
        `Epic: ${task.epic || "(tidak ada)"}`,
        `Detail dan acceptance criteria:\n${task.detail || "(tidak ada)"}`,
        `Build terakhir (mode build, bukan review lama):\nStatus: ${lastBuildForPrompt?.status ?? "belum ada"}\nInstruksi: ${lastBuildForPrompt?.goal ?? "(tidak ada)"}\nSummary agen: ${lastBuildForPrompt?.summary ?? "(tidak ada)"}\nFile tercatat: ${(lastBuildForPrompt?.files ?? []).join(", ") || "(tidak ada)"}\nReview sebelumnya (jangan jadikan bukti, hanya konteks):\n${task.implementationReview ? `Verdict: ${task.implementationReview.verdict}\n${task.implementationReview.summary}` : "(belum ada)"}`,
      ].join("\n\n") + (goalOverride?.trim() ? `\n\nKonteks tambahan dari user:\n${goalOverride.trim()}` : "");
      updateTaskEvents(task.id, [
        { kind: "info", title: `Review dimulai — ${task.title}`, detail: `Run: ${runId}\nSession: ${sessionId}\nModel: ${reviewModel}` },
      ]);
      const response = await fetch("/api/opencode/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory: project.directory, sessionId, prompt, model: reviewModel, agent: settings.buildAgent, title: `Implementation review — ${task.title}` }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
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
          try { payload = JSON.parse(dataStr); } catch { continue; }
          if (eventName === "session") {
            const { sessionId: nextSessionId } = payload as { sessionId?: string };
            if (nextSessionId) {
              activeSessionId = nextSessionId;
              runContext.sessionId = nextSessionId;
              patchTaskRun(task.id, runId, { sessionId: nextSessionId });
              if (selectedIdRef.current === task.id) setCurrentSessionId(nextSessionId);
              if (nextSessionId !== task.sessionId) setTaskSession(project.id, task.id, nextSessionId);
              if (runContext.pendingInterrupt) void opencode.interruptRun(nextSessionId).catch(() => {});
            }
          } else if (eventName === "log") {
            updateTaskEvents(task.id, (previous) => [...previous, payload as ActivityEvent]);
          } else if (eventName === "halt") {
            patchTaskRun(task.id, runId, { halt: payload as HaltRequest });
          } else if (eventName === "halt_resolved") {
            patchTaskRun(task.id, runId, { halt: undefined });
          } else if (eventName === "done") {
            sawDone = true;
            const result = payload as { summary?: unknown; usage?: TokenUsage };
            reviewSummary = typeof result.summary === "string" ? result.summary.trim() || undefined : undefined;
            reviewUsage = result.usage;
            if (reviewStatus === "running") reviewStatus = "done";
          } else if (eventName === "error") {
            reviewStatus = "error";
            const result = payload as { message?: string; usage?: TokenUsage };
            reviewStatusMessage = result.message ?? "Review error";
            reviewUsage = result.usage;
            if (selectedIdRef.current === task.id) setReviewError(reviewStatusMessage);
          } else if (eventName === "interrupted") {
            const result = payload as { reason?: string; usage?: TokenUsage };
            reviewStatus = runContext.stopRequested ? "stopped" : "interrupted";
            reviewStatusMessage = runContext.stopRequested ? "Review dihentikan melalui tombol Stop." : interruptionStatusMessage(result.reason);
            reviewUsage = result.usage;
          }
        }
      }
      if (!sawDone && reviewStatus === "running") {
        reviewStatus = "error";
        reviewStatusMessage = "Koneksi terputus sebelum review selesai. Review belum disimpulkan — jalankan ulang.";
        if (selectedIdRef.current === task.id) setReviewError(reviewStatusMessage);
      }
      if (sawDone && reviewStatus === "done" && reviewSummary) {
        // Summary SSE kadang hanya kalimat penutup — ambil teks penuh sesi agar
        // verdict tidak hilang (penyebab IMPLEMENTED terbaca UNCLEAR).
        const finalSessionId = activeSessionId ?? sessionId ?? undefined;
        let verdictSource = reviewSummary;
        try {
          if (finalSessionId) {
            const msgRes = await opencode.messages(project.directory, finalSessionId);
            const fullText = (msgRes.messages ?? [])
              .filter((m) => m.role === "assistant" && m.text?.trim())
              .map((m) => m.text.trim())
              .join("\n\n");
            if (fullText && parseImplementationVerdict(fullText) !== "unclear") {
              verdictSource = fullText.length > 12000 ? fullText.slice(-12000) : fullText;
            }
          }
        } catch {
          // Fallback ke summary SSE bila riwayat sesi gagal dibaca.
        }
        const review: TaskImplementationReview = {
          verdict: parseImplementationVerdict(verdictSource),
          summary: reviewSummary,
          reviewedAt: new Date().toISOString(),
          model: reviewModel,
          agent: settings.buildAgent,
        };
        const doneAt = new Date();
        const entry: TaskBuild = {
          id: runId,
          mode: "review",
          goal: goalOverride?.trim() ? `Review implementation — ${task.title}\n\nKonteks tambahan:\n${goalOverride.trim()}` : `Review implementation — ${task.title}`,
          summary: reviewSummary,
          status: "done",
          model: reviewModel,
          modelName: models.find((m) => m.id === reviewModel)?.name ?? reviewModel,
          agent: settings.buildAgent,
          sessionId: activeSessionId ?? sessionId ?? undefined,
          usage: reviewUsage,
          statusMessage: `Verdict review: ${review.verdict}`,
          startedAt: reviewStartedAt.toISOString(),
          finishedAt: doneAt.toISOString(),
          elapsedMs: doneAt.getTime() - reviewStartedAtMs,
          eventCount: 0,
          files: [],
        };
        updateTaskEvents(task.id, (prev) => {
          entry.eventCount = prev.length;
          entry.files = extractFiles(prev);
          return [...prev, { kind: "done", title: `Review selesai · ${review.verdict}`, detail: `Run: ${runId}\n${review.summary}` }];
        });
        updateTask(project.id, task.id, {
          implementationReview: review,
          builds: [entry, ...(task.builds ?? []).filter((build) => build.id !== runId)],
        });
        if (selectedIdRef.current === task.id) setBuildDetailsTab("review");
        notify({ kind: "success", title: `Review selesai: ${review.verdict}`, description: task.title });
      } else if (reviewStatus !== "running") {
        const doneAt = new Date();
        const aborted = runContext.stopRequested;
        const entry: TaskBuild = {
          id: runId,
          mode: "review",
          goal: `Review implementation — ${task.title}`,
          summary: reviewStatusMessage ?? reviewSummary ?? "Review tidak selesai.",
          status: aborted || reviewStatus === "stopped" ? "stopped" : reviewStatus === "interrupted" ? "interrupted" : "error",
          statusMessage: aborted ? "Review dihentikan melalui tombol Stop." : reviewStatusMessage,
          model: reviewModel,
          modelName: models.find((m) => m.id === reviewModel)?.name ?? reviewModel,
          agent: settings.buildAgent,
          sessionId: activeSessionId ?? sessionId ?? undefined,
          usage: reviewUsage,
          startedAt: reviewStartedAt.toISOString(),
          finishedAt: doneAt.toISOString(),
          elapsedMs: doneAt.getTime() - reviewStartedAtMs,
          eventCount: 0,
          files: [],
        };
        updateTaskEvents(task.id, (prev) => {
          entry.eventCount = prev.length;
          return [...prev, { kind: "error", title: "Review gagal", detail: `Run: ${runId}\n${entry.summary}` }];
        });
        updateTask(project.id, task.id, { builds: [entry, ...(task.builds ?? []).filter((build) => build.id !== runId)] });
        const stopped = aborted || reviewStatus === "stopped";
        notify({ kind: stopped ? "info" : "error", title: stopped ? "Review dihentikan" : "Review gagal", description: stopped ? task.title : (reviewStatusMessage ?? "Review tidak selesai.") });
      }
    } catch (reviewFailure) {
      // Guard: error dari run lama tidak boleh menimpa run baru.
      const aborted = runContext.stopRequested;
      const message = aborted ? "Review dihentikan." : reviewFailure instanceof Error ? reviewFailure.message : "Review gagal dijalankan.";
      if (selectedIdRef.current === task.id) setReviewError(message);
      updateTaskEvents(task.id, (prev) => [
        ...prev,
        { kind: "error", title: "Review gagal", detail: `Run: ${runId}\n${message}` },
      ]);
      const reviewFinishedAt = new Date();
      const failedReviewBuild: TaskBuild = {
        id: runId,
        mode: "review",
        goal: `Review implementation — ${task.title}`,
        summary: message,
        status: aborted ? "stopped" : "error",
        statusMessage: aborted ? "Review dihentikan melalui tombol Stop." : message,
        model: reviewModel,
        modelName: models.find((model) => model.id === reviewModel)?.name ?? reviewModel,
        agent: settings.buildAgent,
        sessionId: activeSessionId ?? sessionId ?? undefined,
        startedAt: reviewStartedAt.toISOString(),
        finishedAt: reviewFinishedAt.toISOString(),
        elapsedMs: reviewFinishedAt.getTime() - reviewStartedAtMs,
        eventCount: 0,
        files: [],
      };
      updateTaskEvents(task.id, (prev) => {
        failedReviewBuild.eventCount = prev.length;
        return prev;
      });
      const latestBuilds = useStudio.getState().getProject(project.id)?.tasks?.find((item) => item.id === task.id)?.builds ?? task.builds ?? [];
      updateTask(project.id, task.id, { builds: [failedReviewBuild, ...latestBuilds.filter((build) => build.id !== runId)] });
      notify({ kind: aborted ? "info" : "error", title: aborted ? "Review dihentikan" : "Review gagal", description: aborted ? task.title : message });
    } finally {
      // Hanya run aktif yang boleh membuka kunci waiting state.
      finishTaskRun(task.id, runId);
    }
  }

  function handleStopReview() {
    const run = activeRunsRef.current[selectedRunKey];
    const context = runContextsRef.current[selectedRunKey];
    if (!run || run.kind !== "review" || !context) {
      const sessionId = selectedPersistedRun?.sessionId ?? selected?.sessionId ?? project.sessionId;
      if (selectedPersistedRun?.mode === "review" && sessionId) void opencode.interruptRun(sessionId).catch((failure) => setReviewError(failure instanceof Error ? failure.message : "Gagal menghentikan review."));
      return;
    }
    context.stopRequested = true;
    setReviewError("Review dihentikan.");
    const sessionId = context.sessionId ?? run.sessionId;
    if (sessionId) void opencode.interruptRun(sessionId).catch((failure) => setReviewError(failure instanceof Error ? failure.message : "Gagal menghentikan review."));
    else context.pendingInterrupt = true;
  }

  async function handleDeleteSession() {
    const sessionId = selected
      ? selected.sessionId ?? activeRunsRef.current[selected.id]?.sessionId ?? currentSessionId
      : currentSessionId ?? project.sessionId;
    if (!sessionId || !project.directory) return;
    try {
      await opencode.deleteSession(project.directory, sessionId);
      if (selected) setTaskSession(project.id, selected.id, undefined);
      else clearProjectSession(project.id);
      setCurrentSessionId(null);
      setError(null);
      notify({ kind: "success", title: "Session OpenCode dihapus" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Gagal menghapus session OpenCode.";
      setError(message);
      notify({ kind: "error", title: "Gagal menghapus session", description: message });
    }
  }

  function handleStop() {
    const run = activeRunsRef.current[selectedRunKey];
    const context = runContextsRef.current[selectedRunKey];
    if (!run || run.kind !== "build" || !context) {
      const sessionId = selectedPersistedRun?.sessionId ?? selected?.sessionId ?? project.sessionId;
      if (selectedPersistedRun && selectedPersistedRun.mode !== "review" && sessionId) void opencode.interruptRun(sessionId).catch((failure) => setError(failure instanceof Error ? failure.message : "Gagal menghentikan build."));
      return;
    }
    context.stopRequested = true;
    const sessionId = context.sessionId ?? run.sessionId;
    if (sessionId) void opencode.interruptRun(sessionId).catch((failure) => setError(failure instanceof Error ? failure.message : "Gagal menghentikan build."));
    else context.pendingInterrupt = true;
    patchTaskRun(selectedRunKey, run.runId, { halt: undefined });
  }

  // Resolve a halt the agent paused on: approve/reject a tool permission or
  // answer an agent question. The stream stays open and resumes on reply.
  // Dipakai bersama oleh build (busy) maupun review (reviewing) karena
  // keduanya sekarang memakai /api/opencode/stream yang sama.
  async function handleHaltAnswer(answer: HaltAnswer) {
    const current = halt;
    const sessionId = selectedRun?.sessionId ?? selected?.sessionId ?? currentSessionId;
    if (!current || !sessionId || answeringHalt) return;
    setAnsweringHaltByTask((previous) => ({ ...previous, [selectedRunKey]: true }));
    setError(null);
    try {
      if (answer.kind === "permission") {
        await opencode.replyPermission({
          sessionId,
          id: current.id,
          decision: answer.decision,
        });
      } else {
        await opencode.replyForm({ sessionId, id: current.id, answer: answer.answer });
      }
      if (selectedRun) patchTaskRun(selectedRunKey, selectedRun.runId, { halt: undefined });
      notify({ kind: "success", title: "Jawaban dikirim ke agen" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Gagal mengirim jawaban";
      setError(message);
      notify({ kind: "error", title: "Gagal mengirim jawaban", description: message });
    } finally {
      setAnsweringHaltByTask((previous) => ({ ...previous, [selectedRunKey]: false }));
    }
  }

  return (
    <div className="space-y-5">
      {/* Papan monitor */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Backlog</p>
          <p className="text-xl font-bold tabular-nums">{stats.backlog}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Sprint aktif</p>
          <p className="text-xl font-bold tabular-nums">{stats.todo + stats.doing + stats.review}</p>
          <p className="text-muted-foreground text-[11px] tabular-nums">todo {stats.todo} · jalan {stats.doing} · review {stats.review}</p>
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Selesai</p>
          <p className="text-xl font-bold tabular-nums">{stats.done}/{stats.total}</p>
          <Progress value={stats.pct} className="mt-1.5 h-1.5" />
        </div>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Session</p>
          <p className="text-sm font-semibold">{project.sessionId ? "Aktif" : "Tanpa session"}</p>
          <p className="text-muted-foreground truncate text-[11px]" title={project.directory}>{project.directory || "belum ada folder"}</p>
        </div>
      </div>

      {/* Urutan pengerjaan + stack */}
      {activeSprint ? (
        (() => {
          const inSprint = tasks.filter((t) => activeSprint.taskIds.includes(t.id));
          const done = inSprint.filter((t) => t.status === "done").length;
          const pct = inSprint.length ? Math.round((done / inSprint.length) * 100) : 0;
          return (
            <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.09] via-card to-card p-3 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 sm:max-w-[70%]">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
                    <CalendarDays className="size-3.5" /> {activeSprint.name}
                  </p>
                  {activeSprint.goal && <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{activeSprint.goal}</p>}
                  <p className="text-muted-foreground mt-1 text-[11px] tabular-nums">{done}/{inSprint.length} task selesai · {pct}%</p>
                  <Progress value={pct} className="mt-1.5 h-1.5" />
                </div>
                <div className="flex shrink-0 gap-1.5 sm:ml-auto">
                  <Button size="sm" className="bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200" onClick={() => openSprintPlanner()}>Susun ulang</Button>
                  <Button size="sm" className="bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200" onClick={() => closeSprint(project.id, activeSprint.id)}>Tutup sprint</Button>
                </div>
              </div>
            </div>
          );
        })()
      ) : nextUp ? (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.09] via-card to-card p-3 shadow-sm sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 sm:max-w-[70%]">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Kerjakan berikutnya</p>
            <p className="truncate text-sm font-bold">{nextUp.title}</p>
            <p className="text-muted-foreground truncate text-xs">
              {PRIORITY_LABEL[nextUp.priority ?? "medium"]} · {nextUp.status === "todo" ? "Sprint" : "Backlog"}{nextUp.epic ? ` · ${nextUp.epic}` : ""}
            </p>
          </div>
          <Button size="sm" className="shrink-0 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white sm:ml-auto dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200" onClick={() => selectTask(nextUp.id)}>
            Buka task <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        stats.total > 0 && (
          <div className="rounded-xl border bg-card p-3 text-xs text-muted-foreground shadow-sm">
            Tidak ada antrian — semua task di luar Backlog/Sprint sudah jalan atau selesai.
          </div>
        )
      )}

      {/* Aksi papan */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={openNew}><Plus className="size-4" /> Task baru</Button>
        <Button size="sm" variant="secondary" onClick={openEpic}><Sparkles className="size-4" /> Epic baru</Button>
        <Button size="sm" variant="outline" onClick={handleBreakdown} disabled={breakdownBusy || busy || !hasAnyArtifact} title={hasAnyArtifact ? "Pecah seluruh artefak rencana jadi stories oleh agen" : "Isi artefak di tab Rencana dulu"}>{breakdownBusy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} Breakdown</Button>
        <Button size="sm" variant="outline" onClick={() => openList("all")}><List className="size-4" /> Semua task ({allTasks.length})</Button>
        <Button size="sm" variant="outline" onClick={openSprintPlanner}><CalendarDays className="size-4" /> Susun sprint</Button>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-[11px]">Filter tag:</span>
          <Button size="sm" variant={tagFilter === null ? "secondary" : "ghost"} className="h-6 px-2 text-[11px]" onClick={() => setTagFilter(null)}>Semua</Button>
          {allTags.map((tag) => (
            <Button key={tag} size="sm" variant={tagFilter === tag ? "secondary" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>#{tag}</Button>
          ))}
        </div>
      )}

      {/* Backlog — strip horizontal swipable di atas board, maks BOARD_LIMIT + lihat semua */}
      <Card role="region" aria-label="Backlog" className={`gap-0 overflow-hidden border-amber-500/40 bg-amber-500/[0.06] py-0 shadow-md ring-1 ring-amber-500/20 dark:bg-amber-400/[0.07] ${selected?.status === "backlog" ? "border-primary/60 ring-primary/30" : ""}`}>
        <CardHeader className="gap-1 border-b border-amber-500/25 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent p-3 pb-2 dark:from-amber-400/20 dark:via-amber-400/10">
          <CardTitle className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-bold tracking-wide text-amber-700 uppercase dark:text-amber-300"><KanbanSquare className="size-3.5" />Backlog</span>
            <span className="flex items-center gap-1.5">
              <Badge className="border-amber-600/30 bg-amber-500/20 text-[10px] font-bold text-amber-800 tabular-nums dark:bg-amber-400/20 dark:text-amber-200">{backlogAll.length}</Badge>
              <Button size="icon" variant="outline" className="size-6" aria-label="Geser backlog ke kiri" title="Geser ke kiri" disabled={backlogAll.length === 0} onClick={() => scrollBacklog(-1)}><ChevronLeft className="size-3.5" /></Button>
              <Button size="icon" variant="outline" className="size-6" aria-label="Geser backlog ke kanan" title="Geser ke kanan" disabled={backlogAll.length === 0} onClick={() => scrollBacklog(1)}><ChevronRight className="size-3.5" /></Button>
            </span>
          </CardTitle>
          <CardDescription className="text-[11px] text-amber-800/80 dark:text-amber-200/70">Ide / story belum masuk sprint — geser horizontal atau pakai tombol panah</CardDescription>
        </CardHeader>
        <CardContent className="px-3 pt-2.5 pb-3">
          {backlogAll.length === 0 && <p className="text-muted-foreground rounded-md border border-dashed p-2 text-center text-[11px]">Kosong</p>}
          {backlogAll.length > 0 && (
            <div ref={backlogRef} className="flex snap-x snap-mandatory items-stretch gap-2 overflow-x-auto scroll-smooth pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
              {backlogItems.map((t) => (
                <div key={t.id} className="flex w-[270px] min-w-[260px] max-w-[300px] shrink-0 snap-start">
                  <div className="w-full"><TaskCard t={t} fixedHeight selected={selectedId === t.id} {...runningPropsFor(t.id)} {...cardHandlers} /></div>
                </div>
              ))}
              {backlogRest > 0 && (
                <button
                  type="button"
                  onClick={() => openList("backlog")}
                  className="text-muted-foreground hover:text-foreground hover:border-primary/40 flex min-h-[172px] w-[160px] shrink-0 snap-start flex-col items-center justify-center rounded-lg border border-dashed px-2 py-1.5 text-center text-[11px] font-medium transition-colors"
                >
                  +{backlogRest} lainnya<br />lihat semua
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card role="region" aria-label="Bug dan fix" className="gap-0 overflow-hidden border-rose-500/35 bg-rose-500/[0.04] py-0 shadow-sm">
        <CardHeader className="gap-1 border-b border-rose-500/20 bg-gradient-to-r from-rose-500/15 via-rose-500/[0.06] to-transparent p-3 pb-2">
          <CardTitle className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-bold tracking-wide text-rose-700 uppercase dark:text-rose-300"><Bug className="size-3.5" />Bug / Fix</span>
            <span className="flex items-center gap-1.5">
              <Badge variant="outline" className="border-rose-600/30 text-[10px] font-bold tabular-nums">{bugFixTasks.length}</Badge>
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={openNewBug}><Plus className="size-3.5" />Tambah</Button>
            </span>
          </CardTitle>
          <CardDescription className="text-[11px]">Bug / fix bertag #bug atau #fix yang belum masuk sprint.</CardDescription>
        </CardHeader>
        <CardContent className="px-3 pt-2.5 pb-3">
          {bugFixTasks.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-2 text-center text-[11px]">Belum ada bug atau fix.</p>
          ) : (
            <div className="flex snap-x snap-mandatory items-stretch gap-2 overflow-x-auto scroll-smooth pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
              {bugFixTasks.map((task) => (
                <div key={task.id} className="flex w-[270px] min-w-[260px] max-w-[300px] shrink-0 snap-start">
                  <div className="w-full"><TaskCard t={task} fixedHeight selected={selectedId === task.id} {...runningPropsFor(task.id)} {...cardHandlers} /></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kanban — ringkas, maks BOARD_LIMIT kartu per kolom, sisanya di dialog */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((col) => {
          const all = visibleTasks.filter((t) => t.status === col.id);
          const items = all.slice(0, BOARD_LIMIT);
          const rest = all.length - items.length;
          return (
            <Card key={col.id} className={selected && col.id === selected.status ? "border-primary/40" : ""}>
              <CardHeader className="gap-1 p-3 pb-1.5">
                <CardTitle className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5"><KanbanSquare className="size-3.5" />{col.name}</span>
                  <Badge variant="secondary" className="text-[10px] tabular-nums">{all.length}</Badge>
                </CardTitle>
                <CardDescription className="text-[11px]">{col.hint}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5 px-3 pb-3">
                {all.length === 0 && <p className="text-muted-foreground rounded-md border border-dashed p-2 text-center text-[11px]">Kosong</p>}
                {items.map((t) => (
                  <TaskCard key={t.id} t={t} selected={selectedId === t.id} {...runningPropsFor(t.id)} {...cardHandlers} />
                ))}
                {rest > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 w-full text-[11px]" onClick={() => openList(col.id)}>
                    +{rest} lainnya — lihat semua
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Build dialog — dibuka dari kartu task */}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{dialogKind === "bug" ? editing ? "Edit laporan bug" : "Laporan bug baru" : editing ? "Edit task" : "Task baru"}</DialogTitle>
            <DialogDescription>{dialogKind === "bug" ? "Catat kondisi yang dapat direproduksi agar masalah mudah diverifikasi dan diperbaiki." : "Task tersimpan di papan Eksekusi project ini."}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{dialogKind === "bug" ? "Ringkasan bug" : "Judul"}</Label>
                <Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder={dialogKind === "bug" ? "cth. Tombol Simpan tidak merespons" : "cth. Story 1.2 — User bisa membuat task"} />
              </div>
              {dialogKind === "task" && (
                <div className="space-y-1.5">
                  <Label>Epic</Label>
                  <Input value={fEpic} onChange={(e) => setFEpic(e.target.value)} placeholder="Opsional" />
                </div>
              )}
              {dialogKind === "bug" ? (
                <>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Langkah reproduksi <span className="text-destructive">*</span></Label>
                    <Textarea value={fBugSteps} onChange={(e) => setFBugSteps(e.target.value)} rows={3} placeholder={"1. Buka halaman ...\n2. Pilih ...\n3. Klik ..."} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Hasil aktual <span className="text-destructive">*</span></Label>
                    <Textarea value={fBugActual} onChange={(e) => setFBugActual(e.target.value)} rows={3} placeholder="Apa yang terjadi?" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Hasil yang diharapkan <span className="text-destructive">*</span></Label>
                    <Textarea value={fBugExpected} onChange={(e) => setFBugExpected(e.target.value)} rows={3} placeholder="Apa yang seharusnya terjadi?" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Lingkungan <span className="text-muted-foreground">(opsional)</span></Label>
                    <Input value={fBugEnvironment} onChange={(e) => setFBugEnvironment(e.target.value)} placeholder="Browser, OS, versi aplikasi, atau kondisi data" />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Detail / acceptance criteria</Label>
                  <Textarea value={fDetail} onChange={(e) => setFDetail(e.target.value)} rows={4} placeholder="AC1: …&#10;AC2: …" />
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Tag</Label>
                <Input value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="Pisahkan dengan koma" />
                {parseTagInput(fTags).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {parseTagInput(fTags).map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">#{tag}</Badge>)}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{dialogKind === "bug" ? "Tingkat dampak" : "Prioritas"}</Label>
                <Select value={fPriority} onValueChange={(value) => setFPriority(value as TaskPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["high", "medium", "low"] as TaskPriority[]).map((priority) => (
                      <SelectItem key={priority} value={priority}>{dialogKind === "bug" ? { high: "Tinggi · P1", medium: "Sedang · P2", low: "Rendah · P3" }[priority] : PRIORITY_LABEL[priority]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={fStatus} onValueChange={(value) => setFStatus(value as TaskStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map((column) => <SelectItem key={column.id} value={column.id}>{column.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Batal</Button>
            <Button onClick={saveDialog} disabled={!fTitle.trim()}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={epicOpen} onOpenChange={setEpicOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Epic baru — elaborasi agen</DialogTitle>
            <DialogDescription>
              Tulis epic, lempar ke agen (John · PM). Agen memecahnya jadi 3–8 story siap build pakai konteks PRD & arsitektur.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Judul epic</Label>
              <Input value={epicTitle} onChange={(e) => setEpicTitle(e.target.value)} placeholder="cth. Epic 3 — Pembayaran langganan" disabled={elaborating} />
            </div>
            <div className="space-y-1.5">
              <Label>Deskripsi / tujuan epic (opsional)</Label>
              <Textarea value={epicDesc} onChange={(e) => setEpicDesc(e.target.value)} rows={3} placeholder="User bisa upgrade ke Pro dan bayar via QRIS. MVP: satu paket, satu metode." disabled={elaborating} />
            </div>
            <Button onClick={handleElaborateEpic} disabled={!epicTitle.trim() || elaborating} className="w-full">
              {elaborating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {elaborating ? "Agen mengelaborasi…" : "Lempar ke agen"}
            </Button>
            {elaborateError && <p className="text-destructive text-xs">{elaborateError}</p>}
            {elaborated.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold">Hasil elaborasi — centang yang mau disimpan ({elaborated.filter((s) => s.checked).length}/{elaborated.length})</p>
                <ul className="max-h-64 space-y-1.5 overflow-auto">
                  {elaborated.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setElaborated((prev) => prev.map((p, j) => (j === i ? { ...p, checked: !p.checked } : p)))}
                        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${s.checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                        aria-label="Pilih story"
                      >
                        {s.checked && <Check className="size-3" />}
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{s.title}</span>
                        {s.detail && <span className="text-muted-foreground block whitespace-pre-wrap">{s.detail}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setElaborated((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        aria-label="Hapus story"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEpicOpen(false)}>Tutup</Button>
            <Button onClick={saveElaborated} disabled={elaborated.filter((s) => s.checked).length === 0}>
              Simpan {elaborated.filter((s) => s.checked).length} story ke Backlog
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="flex h-[85vh] max-w-[92vw] flex-col overflow-hidden xl:max-w-7xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Daftar task ({listFiltered.length}/{listScope === "active" ? tasks.length : listScope === "archived" ? archivedTasks.length : deletedTasks.length})</DialogTitle>
            <DialogDescription>Klik baris untuk memilih task dan menutup dialog.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder="Cari judul, detail, epic…" className="pl-8" />
            </div>
            <div role="group" aria-label="Filter task" className="grid grid-cols-3 gap-1">
              <Button size="sm" variant={listScope === "active" ? "secondary" : "outline"} aria-pressed={listScope === "active"} onClick={() => { setListScope("active"); setListStat("all"); setListPri(null); setListTag(null); }}>Aktif ({tasks.length})</Button>
              <Button size="sm" variant={listScope === "archived" ? "secondary" : "outline"} aria-pressed={listScope === "archived"} onClick={() => { setListScope("archived"); setListStat("all"); setListPri(null); setListTag(null); }}>Arsip ({archivedTasks.length})</Button>
              <Button size="sm" variant={listScope === "deleted" ? "secondary" : "outline"} aria-pressed={listScope === "deleted"} onClick={() => { setListScope("deleted"); setListStat("all"); setListPri(null); setListTag(null); }}>Sampah ({deletedTasks.length})</Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant={listStat === "all" ? "secondary" : "ghost"} className="h-6 px-2 text-[11px]" onClick={() => setListStat("all")}>Semua status</Button>
              {COLUMNS.map((c) => (
                <Button key={c.id} size="sm" variant={listStat === c.id ? "secondary" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => setListStat(listStat === c.id ? "all" : c.id)}>{c.name}</Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant={listPri === null ? "secondary" : "ghost"} className="h-6 px-2 text-[11px]" onClick={() => setListPri(null)}>Semua prioritas</Button>
              {(["high", "medium", "low"] as TaskPriority[]).map((p) => (
                <Button key={p} size="sm" variant={listPri === p ? "secondary" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => setListPri(listPri === p ? null : p)}>{PRIORITY_LABEL[p]}</Button>
              ))}
            </div>
            {allTags.length > 0 && (
              <div className="flex max-h-16 flex-wrap gap-1.5 overflow-auto">
                <Button size="sm" variant={listTag === null ? "secondary" : "ghost"} className="h-6 px-2 text-[11px]" onClick={() => setListTag(null)}>Semua tag</Button>
                {allTags.map((tag) => (
                  <Button key={tag} size="sm" variant={listTag === tag ? "secondary" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => setListTag(listTag === tag ? null : tag)}>#{tag}</Button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 min-h-0 lg:grid-cols-3">
              {listFiltered.length === 0 && (
                <p className="text-muted-foreground col-span-2 rounded-md border border-dashed p-4 text-center text-xs">Tidak ada task yang cocok.</p>
              )}
              {listFiltered.map((t) => (
                <div key={t.id} className={`rounded-md border bg-card p-3 flex flex-col gap-2 ${selectedId === t.id ? "border-primary/50" : ""}`}>
                  <div
                    role={listScope === "active" ? "button" : undefined}
                    tabIndex={listScope === "active" ? 0 : undefined}
                    onClick={listScope === "active" ? () => { selectTask(t.id); setListOpen(false); } : undefined}
                    onKeyDown={listScope === "active" ? (event) => { if (event.key === "Enter") { selectTask(t.id); setListOpen(false); } } : undefined}
                    className={`flex items-start gap-2 text-left ${listScope === "active" ? "cursor-pointer" : ""}`}
                  >
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${(t.priority ?? "medium") === "high" ? "bg-red-500/15 text-red-600 dark:text-red-400" : (t.priority ?? "medium") === "low" ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                      {PRIORITY_LABEL[t.priority ?? "medium"]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{t.title}</span>
                      <span className="text-muted-foreground block truncate text-[10px]">
                        {COLUMNS.find((c) => c.id === t.status)?.name}{t.epic ? ` · ${t.epic}` : ""}{(t.tags ?? []).length > 0 ? ` · ${(t.tags ?? []).map((g) => `#${g}`).join(" ")}` : ""}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {listScope === "active" && (
                      <>
                        <Button size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[10px]" disabled={t.status === "done"} onClick={() => { setListOpen(false); openBuildDialog(t); }}>
                          <Rocket className="size-3" /> Build
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" disabled={t.status === "done"} onClick={() => { setListOpen(false); openEdit(t); }}>
                          <Pencil className="size-3" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" disabled={t.status === "done"} onClick={() => handleArchiveTask(t.id)}>
                          <Archive className="size-3" /> Arsip
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-destructive" disabled={t.status === "done"} onClick={() => handleDeleteTask(t.id)}>
                          <Trash2 className="size-3" /> Ke sampah
                        </Button>
                      </>
                    )}
                    {listScope === "archived" && (
                      <>
                        <Button size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[10px]" disabled={t.status === "done"} onClick={() => handleRestoreTask(t.id)}>
                          <RotateCcw className="size-3" /> Pulihkan
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-destructive" disabled={t.status === "done"} onClick={() => handleDeleteTask(t.id)}>
                          <Trash2 className="size-3" /> Ke sampah
                        </Button>
                      </>
                    )}
                    {listScope === "deleted" && (
                      <Button size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[10px]" disabled={t.status === "done"} onClick={() => handleRestoreTask(t.id)}>
                        <RotateCcw className="size-3" /> Pulihkan
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => setListOpen(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={breakdownOpen} onOpenChange={(v) => { if (!breakdownBusy) setBreakdownOpen(v); }}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Breakdown artefak jadi stories</DialogTitle>
            <DialogDescription>
              Agen John (PM) memecah PRD, arsitektur, UX, epics & sprint jadi stories kecil ber-acceptance criteria. Centang lalu impor ke backlog.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {breakdownBusy && (
              <div className="flex items-center gap-2 rounded-md border p-3 text-xs">
                <Loader2 className="size-4 animate-spin" /> Agen membaca artefak & menyusun stories…
                <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => breakdownAbort.current?.abort()}>Batal</Button>
              </div>
            )}
            {breakdownError && <p className="text-destructive text-xs">{breakdownError}</p>}
            {breakdownItems.length > 0 && (
              <div className="flex items-center gap-2 text-[11px]">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setBreakdownItems((prev) => prev.map((i) => ({ ...i, checked: !i.duplicate })))}>Pilih semua</Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setBreakdownItems((prev) => prev.map((i) => ({ ...i, checked: false })))}>Bersihkan</Button>
                <span className="text-muted-foreground ml-auto tabular-nums">{breakdownItems.filter((i) => i.checked).length}/{breakdownItems.length} dipilih</span>
              </div>
            )}
            <ul className="space-y-1.5">
              {breakdownItems.map((s, i) => (
                <li key={i} className={`flex items-start gap-2 rounded-md border p-2 text-xs ${s.duplicate ? "opacity-60" : ""}`}>
                  <button
                    type="button"
                    onClick={() => setBreakdownItems((prev) => prev.map((c, j) => (j === i ? { ...c, checked: !c.checked } : c)))}
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${s.checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                    aria-label="Pilih story"
                  >
                    {s.checked && <Check className="size-3" />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {s.title}{" "}
                      <Badge variant={s.priority === "high" ? "destructive" : s.priority === "low" ? "outline" : "secondary"} className="ml-1 text-[10px]">{PRIORITY_LABEL[s.priority]}</Badge>
                      {s.duplicate && <Badge variant="outline" className="ml-1 text-[10px]">duplikat — dilewati</Badge>}
                    </span>
                    {s.epic && <span className="text-muted-foreground block truncate">Epic: {s.epic}</span>}
                    {s.tags.length > 0 && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {s.tags.map((tag) => (<Badge key={tag} variant="outline" className="px-1 py-0 text-[10px]">#{tag}</Badge>))}
                      </span>
                    )}
                    {s.detail && <span className="text-muted-foreground block whitespace-pre-wrap">{s.detail.slice(0, 400)}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {breakdownRaw && breakdownItems.length === 0 && !breakdownBusy && (
              <details className="rounded-md border p-2 text-[11px]">
                <summary className="cursor-pointer font-medium">Lihat jawaban mentah agen</summary>
                <pre className="text-muted-foreground mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{breakdownRaw.slice(0, 4000)}</pre>
              </details>
            )}
          </div>
          <DialogFooter className="shrink-0">
            {!breakdownBusy && breakdownItems.length === 0 && (
              <Button onClick={handleBreakdown} disabled={!hasAnyArtifact}>
                <Wand2 className="size-4" /> Coba breakdown lagi
              </Button>
            )}
            <Button variant="ghost" onClick={() => setBreakdownOpen(false)} disabled={breakdownBusy}>Tutup</Button>
            <Button onClick={importBreakdown} disabled={breakdownItems.filter((i) => i.checked).length === 0}>
              Impor {breakdownItems.filter((i) => i.checked).length} ke Backlog
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sprintOpen} onOpenChange={setSprintOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Susun sprint dengan agen</DialogTitle>
            <DialogDescription>
              Agen (Winston · Architect) via Direct AI memilihkan task backlog untuk sprint berikutnya, lalu mengelompokkannya jadi nama + tujuan sprint.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>Fokus / kapasitas sprint (opsional)</Label>
              <Textarea value={sprintFocus} onChange={(e) => setSprintFocus(e.target.value)} rows={2} placeholder="cth. 1 minggu, fokus auth saja, maks 4 task" disabled={sprintAsking} />
            </div>
            <Button onClick={handleAskSprint} disabled={sprintAsking} className="w-full">
              {sprintAsking ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {sprintAsking ? "Agen menyusun…" : "Minta saran agen"}
            </Button>
            {sprintError && <p className="text-destructive text-xs">{sprintError}</p>}
            {sprintRaw && (
              <details className="rounded-md border bg-muted/40 p-2.5 text-xs">
                <summary className="cursor-pointer font-semibold">Respons mentah agen</summary>
                <pre className="text-muted-foreground mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{sprintRaw}</pre>
              </details>
            )}
            {sprintPicks.length > 0 && (
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <Label>Nama sprint</Label>
                  <Input value={sprintName} onChange={(e) => setSprintName(e.target.value)} placeholder="cth. Sprint 1 — Fondasi auth" />
                </div>
                <div className="space-y-1.5">
                  <Label>Tujuan sprint</Label>
                  <Textarea value={sprintGoal} onChange={(e) => setSprintGoal(e.target.value)} rows={3} />
                </div>
                {sprintReason && <p className="text-muted-foreground text-xs italic">Alasan agen: {sprintReason}</p>}
                <p className="text-xs font-semibold">Task terpilih ({sprintPicks.filter((p) => p.checked).length}/{sprintPicks.length}) — masuk kolom Sprint saat disimpan</p>
                <ul className="space-y-1.5">
                  {sprintPicks.map((p, i) => (
                    <li key={p.id} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setSprintPicks((prev) => prev.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))}
                        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${p.checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                        aria-label="Pilih task"
                      >
                        {p.checked && <Check className="size-3" />}
                      </button>
                      <span className="min-w-0 flex-1 font-medium">{p.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => setSprintOpen(false)}>Tutup</Button>
            <Button onClick={saveSprint} disabled={!sprintName.trim() || sprintPicks.filter((p) => p.checked).length === 0}>
              Mulai sprint ({sprintPicks.filter((p) => p.checked).length} task)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{canResumeBuild ? "Lanjutkan build?" : hasBuildHistory ? "Build ulang?" : "Jalankan build?"}</DialogTitle>
            <DialogDescription>
              Agen akan mengerjakan dan mengubah file di folder project. Pastikan instruksi sudah benar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {selected && (
              <p><span className="text-muted-foreground">Task:</span> <strong>{selected.title}</strong></p>
            )}
            <p className="text-muted-foreground">Folder:</p>
            <code className="block max-w-full truncate rounded bg-muted px-2 py-1 font-mono text-[11px]" title={project.directory}>{project.directory || "belum di-set"}</code>
            <p className="text-muted-foreground">Instruksi tambahan:</p>
            <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{goalText || "Tidak ada instruksi tambahan."}</pre>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button onClick={(event) => { setConfirmOpen(false); void handleBuild(performance.timeOrigin + event.timeStamp); }} disabled={selectedTaskDone || (!selected && !goalText) || !ready}>
              <Rocket className="size-4" /> {canResumeBuild ? "Lanjutkan" : hasBuildHistory ? "Build ulang" : "Jalankan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Build Dialog — form build + info task terpilih */}
      <Dialog
        open={buildDialogOpen}
        onOpenChange={(open) => {
          setBuildDialogOpen(open);
          if (!open) setBuildFullscreen(false);
        }}
      >
        <DialogContent
          className={`flex flex-col gap-4 overflow-hidden ${buildFullscreen ? "h-dvh w-screen !max-w-none rounded-none" : "h-[90dvh] w-[96vw] !max-w-[1200px]"}`}
        >
          <DialogHeader className="shrink-0 pr-8">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="flex items-center gap-2"><Rocket className="size-4" /> Build task</DialogTitle>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => setBuildFullscreen(!buildFullscreen)}
                title={buildFullscreen ? "Kecilkan" : "Perbesar full page"}
              >
                {buildFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
            </div>
            <DialogDescription>
              Agen mengerjakan task terpilih + konteks artefak otomatis di folder project.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <div className="shrink-0 rounded-md border bg-muted/30 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{selected.title}</p>
                      <Badge variant="secondary" className="text-[10px]">{PRIORITY_LABEL[selected.priority ?? "medium"]}</Badge>
                    </div>
                    {selected.epic && <p className="text-muted-foreground text-xs">Epic: {selected.epic}</p>}
                    {(selected.tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(selected.tags ?? []).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">#{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1 sm:justify-end sm:self-center">
                    <Button size="sm" variant="outline" className="h-7 px-2" disabled={selectedTaskDone || busy || reviewing} onClick={() => { setBuildDialogOpen(false); openEdit(selected); }}>
                      <Pencil className="size-3" /> Edit task
                    </Button>
                    {selected.status !== "done" && (
                      <Button size="sm" className="h-7 bg-emerald-600 px-2 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400" disabled={busy || reviewing} onClick={() => updateTask(project.id, selected.id, { status: "done" })}>
                        <Check className="size-3" /> Selesai
                      </Button>
                    )}
                    {selected.status === "done" && (
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => updateTask(project.id, selected.id, { status: "review" })}>
                        <RotateCcw className="size-3" /> Buka kembali
                      </Button>
                    )}
                    {displayedSessionId && (
                      <Button size="sm" variant="outline" className="h-7 px-2" disabled={selectedTaskDone || busy || reviewing} onClick={() => void handleDeleteSession()}>
                        <Trash2 className="size-3" /> Hapus session
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:overflow-hidden">
                {/* Kolom kiri: dua row — atas form build, bawah box file tersentuh */}
                <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-hidden">
                  {/* Row atas: form build (auto height, tidak fill) */}
                  <div className="shrink-0 rounded-md border bg-card p-3 shadow-sm">
                    {!ready && (
                      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                        <FolderX className="mt-0.5 size-4 shrink-0" /><p>Set working directory dulu di header project.</p>
                      </div>
                    )}
                    <div className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-2 rounded-md border p-1" role="group" aria-label="Mode eksekusi">
                    <Button type="button" size="sm" variant="ghost" className={runMode === "build" ? "bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white" : ""} aria-pressed={runMode === "build"} onClick={() => setRunMode("build")} disabled={selectedTaskDone || busy || reviewing}>
                      <Rocket className="size-3.5" /> Build
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className={runMode === "review" ? "bg-sky-600 text-white hover:bg-sky-700 hover:text-white" : ""} aria-pressed={runMode === "review"} onClick={() => setRunMode("review")} disabled={selectedTaskDone || busy || reviewing}>
                      <Search className="size-3.5" /> Review
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    <Select value={buildModel} disabled={selectedTaskDone || busy || reviewing} onValueChange={(modelId) => updateSettings({ defaultModel: modelId })}>
                      <SelectTrigger className="w-full min-w-0" aria-label="Model untuk build">
                        <SelectValue placeholder="Pilih model" />
                      </SelectTrigger>
                      <SelectContent>
                        {buildModel && !models.some((model) => model.id === buildModel) && (
                          <SelectItem value={buildModel}>{buildModel}</SelectItem>
                        )}
                        {models.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name} — {model.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="exec-goal">Instruksi tambahan</Label>
                      {goalOverride !== null && selected && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setGoalOverride(null)} disabled={selectedTaskDone || busy || reviewing}>
                          Kosongkan
                        </Button>
                      )}
                    </div>
                    <Textarea id="exec-goal" rows={7} className="min-h-40 resize-y" value={goalOverride ?? ""} onChange={(e) => setGoalOverride(e.target.value)} placeholder="Opsional. Tambahkan konteks atau batasan khusus untuk agen…" disabled={selectedTaskDone || busy || reviewing} />
                  </div>
                  <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2">
                    {busy ? (
                      <div className="flex min-w-0 items-center gap-2 sm:col-span-2">
                        <Button variant="destructive" className="shrink-0" onClick={handleStop}><Square className="size-4" /> Stop</Button>
                        <span
                          className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs tabular-nums"
                          title={`Agen bekerja… ${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")} · ${events.length} event`}
                        >
                          <Loader2 className="size-3.5 shrink-0 animate-spin" />
                          <span className="truncate">Agen bekerja… {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")} · {events.length} event</span>
                        </span>
                      </div>
                    ) : reviewing ? (
                      <Button variant="destructive" className="w-full sm:col-span-2" onClick={handleStopReview}>
                        <Square className="size-4" /> Stop review
                      </Button>
                    ) : (
                      <Button className="w-full sm:col-span-2" onClick={() => runMode === "review" ? void handleImplementationReview() : setConfirmOpen(true)} disabled={selectedTaskDone || (!selected && (runMode === "review" || !goalText)) || !ready}>
                        {runMode === "review" ? <Search className="size-4" /> : <Rocket className="size-4" />}
                        {runMode === "review" ? "Jalankan review" : canResumeBuild ? "Lanjutkan build" : hasBuildHistory ? "Build ulang" : "Jalankan build"}
                      </Button>
                    )}
                    {!busy && lastDoneAt && !error && <span className="text-xs text-emerald-600 sm:col-span-2">Selesai {new Date(lastDoneAt).toLocaleTimeString()}</span>}
                  </div>
                  {error && <p className="text-destructive text-xs">{error}</p>}
                  </div>
                  </div>
                  {/* Row bawah: box file tersentuh (tersendiri dari form build, mengisi sisa ruang) */}
                  <div className="flex min-h-40 flex-1 flex-col overflow-hidden rounded-md border bg-muted/30 p-3">
                    {(() => {
                      const touchedFiles = extractFiles(events);
                      if (events.length === 0 || touchedFiles.length === 0) {
                        return <p className="text-muted-foreground text-[11px]">Belum ada file tersentuh.</p>;
                      }
                      return (
                        <>
                          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                            <p className="text-muted-foreground text-[11px] font-medium">File tersentuh</p>
                            <Badge variant="outline" className="text-[10px]">{touchedFiles.length}</Badge>
                          </div>
                          <ul className="min-h-0 flex-1 list-inside list-disc space-y-1 overflow-y-auto pl-1 marker:text-muted-foreground">
                            {touchedFiles.map((file) => (
                              <li key={file} className="min-w-0">
                                <code className="break-all font-mono text-[10px]">{file}</code>
                              </li>
                            ))}
                          </ul>
                        </>
                      );
                    })()}
                  </div>
                </div>
                {/* Kolom kanan: tabs riwayat + review + aktivitas, full height */}
                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                  <Tabs value={buildDetailsTab} onValueChange={(value) => setBuildDetailsTab(value as "info" | "history" | "activity" | "review")} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <TabsList className="grid w-full shrink-0 grid-cols-4">
                      <TabsTrigger value="info" disabled={!selected}>Info Task</TabsTrigger>
                      <TabsTrigger value="history" disabled={busy || reviewing}>Riwayat build ({(selected.builds ?? []).length})</TabsTrigger>
                      <TabsTrigger value="review" disabled={busy}>Review</TabsTrigger>
                      <TabsTrigger value="activity">Aktivitas</TabsTrigger>
                    </TabsList>
                    <TabsContent value="info" className="mt-2 min-h-0 flex-1 flex-col overflow-y-auto data-[state=active]:flex data-[state=inactive]:hidden">
                      {!selected ? (
                        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-xs">Pilih task untuk melihat informasi.</p>
                      ) : (
                        <div className="space-y-4 pb-2">
                          <header className="rounded-md border bg-muted/30 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wide">Task</p>
                                <h3 className="break-words text-base font-semibold leading-snug">{selected.title}</h3>
                                {selected.epic && <p className="text-muted-foreground mt-1 text-xs">{selected.epic}</p>}
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-1.5">
                                <Badge variant={selected.status === "done" ? "secondary" : "outline"}>{TASK_STATUS_LABEL[selected.status]}</Badge>
                                <Badge variant={selected.priority === "high" ? "destructive" : selected.priority === "low" ? "outline" : "secondary"}>{PRIORITY_LABEL[selected.priority ?? "medium"]}</Badge>
                              </div>
                            </div>
                            {(selected.tags ?? []).length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                                {selected.tags.map((tag) => <Badge key={tag} variant="outline" className="font-normal">#{tag}</Badge>)}
                              </div>
                            )}
                          </header>

                          {selected.detail ? (
                            <section className="space-y-2">
                              <h4 className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Detail &amp; acceptance criteria</h4>
                              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selected.detail}</p>
                            </section>
                          ) : (
                            <p className="text-muted-foreground text-xs">Belum ada detail atau acceptance criteria.</p>
                          )}

                          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3">
                            <div>
                              <dt className="text-muted-foreground text-[10px]">Run tercatat</dt>
                              <dd className="mt-0.5 text-sm font-medium tabular-nums">{selected.builds?.length ?? 0}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground text-[10px]">Durasi terakhir</dt>
                              <dd className="mt-0.5 text-sm font-medium tabular-nums">{latestBuild?.status === "running" ? `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")} berjalan` : formatElapsed(latestBuild?.elapsedMs)}</dd>
                            </div>
                            <div className="col-span-2 min-w-0">
                              <dt className="text-muted-foreground text-[10px]">Session OpenCode</dt>
                              <dd className="mt-0.5 truncate font-mono text-[11px]">{selected.sessionId ?? "Belum ada session"}</dd>
                            </div>
                          </dl>

                          {latestBuild && (
                            <section className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Run terakhir</h4>
                                <Badge variant={latestBuild.status === "done" ? "secondary" : latestBuild.status === "running" ? "default" : "outline"}>
                                  {latestBuild.mode === "review" ? "Review" : "Build"} · {latestBuild.status === "done" ? "Sukses" : latestBuild.status === "running" ? "Berjalan" : latestBuild.status === "error" ? "Gagal" : latestBuild.status === "stopped" ? "Dihentikan" : "Terinterupsi"}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground text-xs">{latestBuild.modelName ?? latestBuild.model ?? "Model tidak tercatat"}{latestBuild.startedAt ? ` · ${new Date(latestBuild.startedAt).toLocaleString()}` : ""}</p>
                              {(latestBuild.summary || latestBuild.statusMessage) && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{latestBuild.summary ?? latestBuild.statusMessage}</p>}
                            </section>
                          )}

                          {selected.implementationReview && (
                            <section className="space-y-2 border-t pt-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Hasil review</h4>
                                <Badge variant={selected.implementationReview.verdict === "implemented" ? "secondary" : "outline"}>
                                  {selected.implementationReview.verdict === "implemented" ? "Terimplementasi" : selected.implementationReview.verdict === "partial" ? "Parsial" : selected.implementationReview.verdict === "not_implemented" ? "Belum terimplementasi" : "Belum jelas"}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground text-[10px]">{new Date(selected.implementationReview.reviewedAt).toLocaleString()}</p>
                              <div className="md-preview text-xs"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{selected.implementationReview.summary}</ReactMarkdown></div>
                            </section>
                          )}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="activity" className="mt-2 min-h-0 flex-1 flex-col gap-2 overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden">
                      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Session</p>
                          <p className="truncate font-mono text-[11px] tabular-nums">{displayedSessionId ?? "Belum ada session"}</p>
                        </div>
                        {displayedSessionId && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={selectedTaskDone || busy || reviewing} onClick={() => void handleDeleteSession()}>
                            <Trash2 className="size-3" /> Hapus
                          </Button>
                        )}
                      </div>
                      <div className="text-muted-foreground flex items-center justify-between text-xs tabular-nums">
                        <span>
                          {activityMode === "review"
                            ? (reviewing ? "Review berjalan" : "Review")
                            : busy ? `Berjalan · ${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}` : lastDoneAt ? `Selesai ${new Date(lastDoneAt).toLocaleTimeString()}` : "Log build"}
                        </span>
                        <span>{events.length} event</span>
                      </div>
                      <ActivityLog events={events} className="h-auto min-h-0 flex-1 overflow-y-auto" />
                    </TabsContent>
                    <TabsContent value="review" className="mt-2 min-h-0 flex-1 flex-col gap-2 overflow-y-auto data-[state=active]:flex data-[state=inactive]:hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">Review implementasi</p>
                        {reviewing ? (
                          <Button size="sm" variant="destructive" onClick={handleStopReview} disabled={busy || !ready}>
                            <Square className="size-3.5" />
                            Stop review
                          </Button>
                        ) : (
                          <p className="text-muted-foreground text-xs">Pilih mode Review untuk menjalankan pemeriksaan.</p>
                        )}
                      </div>
                      {reviewError && <p className="text-destructive text-xs">{reviewError}</p>}
                      {reviewing && <p className="text-muted-foreground text-xs">Memeriksa implementasi dan test secara read-only… ikuti log realtime di tab Activity.</p>}
                      {selected.implementationReview ? (
                        <article className="min-h-0 space-y-2 rounded-md border bg-background p-3 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge
                              variant="outline"
                              className={
                                selected.implementationReview.verdict === "implemented"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : selected.implementationReview.verdict === "partial"
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                    : selected.implementationReview.verdict === "not_implemented"
                                      ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
                                      : ""
                              }
                            >
                              {selected.implementationReview.verdict === "implemented" ? "Terimplementasi" : selected.implementationReview.verdict === "partial" ? "Parsial" : selected.implementationReview.verdict === "not_implemented" ? "Belum terimplementasi" : "Belum jelas"}
                            </Badge>
                            <span className="text-muted-foreground text-[10px] tabular-nums">
                              {new Date(selected.implementationReview.reviewedAt).toLocaleString()}
                              {selected.implementationReview.agent ? ` · ${selected.implementationReview.agent}` : ""}
                            </span>
                          </div>
                          <div className="md-preview font-sans text-xs text-foreground">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{selected.implementationReview.summary}</ReactMarkdown>
                          </div>
                        </article>
                      ) : (
                        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-xs">Belum ada review implementasi untuk task ini.</p>
                      )}
                    </TabsContent>
                    <TabsContent value="history" className="mt-2 min-h-0 flex-1 flex-col overflow-y-auto data-[state=active]:flex data-[state=inactive]:hidden">
                      {(selected.builds ?? []).length === 0 ? (
                        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-xs">Belum ada riwayat build.</p>
                      ) : (
                        <div className="min-h-0 flex-1 space-y-2">
                          <div className="flex items-center justify-between gap-3 border-b px-1 pb-2">
                            <div>
                              <p className="text-xs font-semibold">Total penggunaan task</p>
                              <p className="text-muted-foreground text-[10px]">Akumulasi {selected.builds?.length ?? 0} run · {cumulativeTokenUsage.runCount} run dengan data token</p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono text-sm font-semibold tabular-nums">
                                {cumulativeTokenUsage.runCount > 0 ? `${formatTokenCount(cumulativeTokenUsage.total)} token` : "Data token belum tersedia"}
                              </p>
                              <p className="text-muted-foreground text-[10px]">{formatElapsed(cumulativeBuildDurationMs)} total durasi</p>
                              {cumulativeTokenUsage.costRunCount > 0 && (
                                <p className="text-muted-foreground text-[10px]">{formatUsd(cumulativeTokenUsage.costUsd)} estimasi biaya</p>
                              )}
                            </div>
                          </div>
                          {(selected.builds ?? []).map((build) => (
                            <article
                              key={build.id}
                              className={`space-y-3 rounded-md border border-l-[3px] bg-background p-3 text-xs shadow-sm ${
                                build.status === "done"
                                  ? "border-l-emerald-500"
                                  : build.status === "error"
                                    ? "border-l-destructive"
                                    : build.status === "stopped"
                                      ? "border-l-amber-500"
                                      : build.status === "interrupted"
                                        ? "border-l-orange-500"
                                      : "border-l-sky-500"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={build.status === "done" ? "secondary" : build.status === "running" ? "default" : "outline"}>
                                      {build.status === "done" ? "Sukses" : build.status === "error" ? "Gagal" : build.status === "stopped" ? "Dihentikan" : build.status === "interrupted" ? "Terinterupsi" : "Berjalan"}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">{build.mode === "review" ? "Review" : "Build"}</Badge>
                                    <p className="min-w-0 truncate text-sm font-semibold">{build.modelName ?? build.model ?? "Model tidak tercatat"}</p>
                                  </div>
                                  {build.modelName && build.model && build.modelName !== build.model && (
                                    <p className="text-muted-foreground break-all font-mono text-[10px]">{build.model}</p>
                                  )}
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="font-mono text-sm font-semibold tabular-nums">{formatElapsed(build.elapsedMs)}</p>
                                  <p className="text-muted-foreground text-[10px]">durasi run</p>
                                </div>
                              </div>
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-2 sm:grid-cols-4">
                                <div className="min-w-0">
                                  <dt className="text-muted-foreground text-[10px]">Mulai</dt>
                                  <dd className="mt-0.5 tabular-nums">{new Date(build.startedAt).toLocaleString()}</dd>
                                </div>
                                <div className="min-w-0">
                                  <dt className="text-muted-foreground text-[10px]">Selesai</dt>
                                  <dd className="mt-0.5 tabular-nums">{build.finishedAt ? new Date(build.finishedAt).toLocaleString() : "Berjalan"}</dd>
                                </div>
                                <div className="min-w-0">
                                  <dt className="text-muted-foreground text-[10px]">Agent</dt>
                                  <dd className="mt-0.5 truncate">{build.agent ?? "—"}</dd>
                                </div>
                                <div className="min-w-0">
                                  <dt className="text-muted-foreground text-[10px]">Event</dt>
                                  <dd className="mt-0.5 tabular-nums">{build.eventCount}</dd>
                                </div>
                              </dl>
                              {build.statusMessage && <p className="rounded-sm bg-muted/40 px-2 py-1.5 text-muted-foreground">{build.statusMessage}</p>}
                              {build.usage && (
                                <div className="space-y-1 border-t pt-2">
                                  <p className="text-muted-foreground text-[10px] font-semibold">Penggunaan token</p>
                                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                                    <div><dt className="text-muted-foreground text-[10px]">Total</dt><dd className="font-mono tabular-nums">{formatTokenCount(build.usage.total)}</dd></div>
                                    <div><dt className="text-muted-foreground text-[10px]">Input</dt><dd className="font-mono tabular-nums">{formatTokenCount(build.usage.input)}</dd></div>
                                    <div><dt className="text-muted-foreground text-[10px]">Output</dt><dd className="font-mono tabular-nums">{formatTokenCount(build.usage.output)}</dd></div>
                                    <div><dt className="text-muted-foreground text-[10px]">Reasoning</dt><dd className="font-mono tabular-nums">{formatTokenCount(build.usage.reasoning)}</dd></div>
                                    <div><dt className="text-muted-foreground text-[10px]">Cache read / write</dt><dd className="font-mono tabular-nums">{formatTokenCount(build.usage.cacheRead)} / {formatTokenCount(build.usage.cacheWrite)}</dd></div>
                                    {build.usage.costUsd !== undefined && <div><dt className="text-muted-foreground text-[10px]">Biaya</dt><dd className="font-mono tabular-nums">{formatUsd(build.usage.costUsd)}</dd></div>}
                                  </dl>
                                </div>
                              )}
                              {build.sessionId && (
                                <p className="text-muted-foreground break-all font-mono text-[10px]">Sesi {build.sessionId}</p>
                              )}
                              {build.summary && (
                                <details className="rounded-md bg-muted/30 px-2 py-1.5">
                                  <summary className="text-muted-foreground cursor-pointer text-[10px]">Ringkasan build</summary>
                                  <div className="md-preview mt-1 max-h-56 overflow-y-auto font-sans text-xs text-foreground">
                                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{build.summary}</ReactMarkdown>
                                  </div>
                                </details>
                              )}
                              {build.goal && (
                                <div className="space-y-0.5">
                                  <p className="text-muted-foreground text-[10px]">Instruksi tambahan</p>
                                  <p className="line-clamp-3 whitespace-pre-wrap">{build.goal}</p>
                                </div>
                              )}
                              {build.files.length > 0 && (
                                <div className="space-y-1">
                                  <p className="text-muted-foreground text-[10px]">File tersentuh · {build.files.length}</p>
                                  <ul className="max-h-28 list-inside list-disc space-y-1 overflow-y-auto pl-1 marker:text-muted-foreground">
                                    {build.files.map((file) => <li key={file} className="min-w-0"><code className="break-all font-mono text-[10px]">{file}</code></li>)}
                                  </ul>
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <HaltDialog
        halt={halt}
        busy={answeringHalt}
        onSubmit={handleHaltAnswer}
        onClose={() => { if (selectedRun) patchTaskRun(selectedRunKey, selectedRun.runId, { halt: undefined }); }}
      />
    </div>
  );
}
