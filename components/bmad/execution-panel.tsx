"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Rocket, Square, Loader2, ChevronLeft, ChevronRight, Pencil, Trash2, Wand2, FolderX, KanbanSquare, Sparkles, X, Check, ArrowRight, List, Search, CalendarDays, Maximize2, Minimize2, Archive, RotateCcw } from "lucide-react";
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

function sortTasks<T extends { priority?: string; createdAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (PRIORITY_ORDER[a.priority ?? "medium"] ?? 1) - (PRIORITY_ORDER[b.priority ?? "medium"] ?? 1) || a.createdAt.localeCompare(b.createdAt));
}

function parseTagInput(v: string): string[] {
  return [...new Set(v.split(/[,#\n]/).map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 10);
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
  const value = text.match(/(?:^|\n)\s*VERDICT\s*:\s*(IMPLEMENTED|PARTIAL|NOT_IMPLEMENTED|UNCLEAR)\b/i)?.[1]?.toUpperCase();
  if (value === "IMPLEMENTED") return "implemented";
  if (value === "PARTIAL") return "partial";
  if (value === "NOT_IMPLEMENTED") return "not_implemented";
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

export function ExecutionPanel({ project }: { project: Project }) {
  const notify = useNotifications();
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
  const [fTitle, setFTitle] = useState("");
  const [fEpic, setFEpic] = useState("");
  const [fDetail, setFDetail] = useState("");
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
    if (breakdownBusy || busy) return;
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
  const [buildDetailsTab, setBuildDetailsTab] = useState<"history" | "activity" | "review">("history");
  const [runMode, setRunMode] = useState<"build" | "review">("build");
  const [activityMode, setActivityMode] = useState<"build" | "review">("build");

  // Build runner (per selected task, konteks artefak otomatis)
  const [goalOverride, setGoalOverride] = useState<string | null>(null);
  const [models, setModels] = useState<ReturnType<typeof flattenModels>>([]);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(project.sessionId ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastDoneAt, setLastDoneAt] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  // A pending human decision (tool permission or agent question) blocks the build.
  const [halt, setHalt] = useState<HaltRequest | null>(null);
  const [answeringHalt, setAnsweringHalt] = useState(false);
  const activeSessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Log per task disimpan di memori sesi agar tidak hilang saat ganti seleksi;
  // ringkasannya (status, durasi, file) dipersist ke store saat build selesai.
  const logsRef = useRef(new Map<string, ActivityEvent[]>());
  const buildTaskRef = useRef<string | null>(null);
  const buildStartRef = useRef(0);
  const buildStatusRef = useRef<"running" | "done" | "error" | "stopped" | "interrupted">("running");
  const buildStatusMessageRef = useRef<string | undefined>(undefined);
  const buildCountRef = useRef(0);
  const buildGoalRef = useRef("");
  const ready = Boolean(project.directory);
  const displayedSessionId = selected
    ? selected.sessionId ?? currentSessionId
    : currentSessionId ?? project.sessionId;

  function selectTask(id: string | null) {
    if ((busy || reviewing) && id !== selectedId) return;
    if (selectedId) logsRef.current.set(selectedId, events);
    if (id === NO_TASK_KEY) id = null;
    setSelectedId(id);
    setGoalOverride(null);
    setEvents(id ? (logsRef.current.get(id) ?? []) : (logsRef.current.get(NO_TASK_KEY) ?? []));
    if (!busy && !reviewing) {
      const taskSessionId = id ? tasks.find((task) => task.id === id)?.sessionId ?? null : project.sessionId ?? null;
      activeSessionRef.current = taskSessionId;
      setCurrentSessionId(taskSessionId);
    }
  }

  // Ticker elapsed time selama build berjalan.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - buildStartRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const goalText = (goalOverride ?? "").trim();
  const buildModel = settings.defaultModel ?? "";
  const latestBuild = selected?.builds?.[0];
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
  const canResumeBuild = latestBuild?.status === "error" || latestBuild?.status === "stopped" || latestBuild?.status === "interrupted";

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
    setFTitle("");
    setFEpic("");
    setFDetail("");
    setFTags("");
    setFPriority("medium");
    setFStatus("backlog");
    setDialogOpen(true);
  }
  function openEdit(t: ExecTask) {
    setEditing(t);
    setFTitle(t.title);
    setFEpic(t.epic);
    setFDetail(t.detail);
    setFTags((t.tags ?? []).join(", "));
    setFPriority(t.priority ?? "medium");
    setFStatus(t.status);
    setDialogOpen(true);
  }

  function openBuildDialog(t: ExecTask) {
    if ((busy || reviewing) && t.id !== selectedId) return;
    selectTask(t.id);
    setGoalOverride(t.builds?.[0]?.goal || null);
    setBuildDetailsTab(busy ? "activity" : reviewing ? "review" : "history");
    setActivityMode("build");
    setBuildDialogOpen(true);
  }
  function saveDialog() {
    if (!fTitle.trim()) return;
    const tags = parseTagInput(fTags);
    if (editing) {
      updateTask(project.id, editing.id, { title: fTitle.trim(), epic: fEpic.trim(), detail: fDetail.trim(), tags, priority: fPriority, status: fStatus });
    } else {
      const id = addTask(project.id, { title: fTitle.trim(), epic: fEpic.trim(), detail: fDetail.trim(), tags, priority: fPriority, status: fStatus });
      selectTask(id);
    }
    setDialogOpen(false);
    notify({ kind: "success", title: editing ? "Task diperbarui" : "Task dibuat", description: fTitle.trim() });
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
    if (selectedTaskDone || (!selected && !goalText) || !ready || busy || reviewing) return;
    const buildTaskId = selected?.id ?? null;
    const logKey = buildTaskId ?? NO_TASK_KEY;
    const isResuming = latestBuild?.status === "error" || latestBuild?.status === "stopped" || latestBuild?.status === "interrupted";
    setActivityMode("build");
    const goalSnapshot = isResuming && latestBuild.goal ? latestBuild.goal : goalText;
    const modelId = buildModel || settings.defaultModel;
    const modelName = models.find((model) => model.id === modelId)?.name ?? modelId;
    const effectiveSessionId = selected ? selected.sessionId : project.sessionId;
    setBuildDetailsTab("activity");
    setElapsedSec(0);
    setBusy(true);
    setError(null);
    setEvents([]);
    setLastDoneAt(null);
    logsRef.current.set(logKey, []);
    buildTaskRef.current = buildTaskId;
    buildStartRef.current = startedAtMs;
    const buildId = `b_${buildStartRef.current.toString(36)}`;
    buildStatusRef.current = "running";
    buildStatusMessageRef.current = undefined;
    buildCountRef.current = 0;
    buildGoalRef.current = goalSnapshot;
    const controller = new AbortController();
    abortRef.current = controller;
    setHalt(null);
    let buildSummary: string | undefined;
    let buildUsage: TokenUsage | undefined;
    let buildFailureMessage: string | undefined;
    let activityErrorNotified = false;
    const pushLog = (e: ActivityEvent) => {
      const arr = [...(logsRef.current.get(logKey) ?? []), e];
      logsRef.current.set(logKey, arr);
      buildCountRef.current = arr.length;
      setEvents(arr);
      if (e.kind === "error") {
        activityErrorNotified = true;
        notify({ kind: "error", title: e.title || "Aktivitas gagal", description: e.detail });
      }
    };
    const taskLine = selected ? `Task: ${selected.title}${selected.epic ? ` (Epic: ${selected.epic})` : ""}\n${selected.detail ? `Detail: ${selected.detail}\n` : ""}` : "";
    const prompt = isResuming
      ? `${taskLine}Lanjutkan build dari kondisi terakhir setelah proses sebelumnya terputus. Periksa perubahan dan status kerja saat ini terlebih dahulu, jangan mengulang pekerjaan yang sudah selesai.${goalSnapshot ? `\n\nInstruksi tambahan tetap:\n${goalSnapshot}` : ""}`
      : `${taskLine}${goalSnapshot ? `Instruksi tambahan:\n${goalSnapshot}\n\n` : ""}Catatan: Artefak rencana (PRD, Architecture, Epics, Sprint, Project Context) tersedia di folder project. Baca dari disk sesuai kebutuhan.\n\nSetelah selesai, tandai file yang diubah dan cara verifikasi.`;
    // Tandai task sedang dikerjakan begitu build mulai (backlog/todo -> in-progress).
    if (buildTaskId) {
      const cur = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId);
      if (cur && (cur.status === "backlog" || cur.status === "todo")) {
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
              startedAt: new Date(buildStartRef.current).toISOString(),
              eventCount: 0,
              files: [],
            },
            ...(cur.builds ?? []),
          ],
        });
      }
    }
    activeSessionRef.current = effectiveSessionId ?? null;
    setCurrentSessionId(effectiveSessionId ?? null);
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
        signal: controller.signal,
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
              activeSessionRef.current = sessionId;
              setCurrentSessionId(sessionId);
              if (buildTaskId && sessionId !== selected?.sessionId) {
                setTaskSession(project.id, buildTaskId, sessionId);
              } else if (!buildTaskId && sessionId !== project.sessionId) {
                setProjectSession(project.id, sessionId);
              }
            }
          } else if (eventName === "log") {
            pushLog(payload as ActivityEvent);
          } else if (eventName === "halt") {
            // Agent paused for a human decision; block the UI until answered.
            setHalt(payload as HaltRequest);
          } else if (eventName === "halt_resolved") {
            setHalt(null);
          } else if (eventName === "done") {
            sawDone = true;
            const donePayload = payload as { summary?: unknown; usage?: TokenUsage };
            buildSummary = typeof donePayload.summary === "string" ? donePayload.summary.trim() || undefined : undefined;
            buildUsage = donePayload.usage;
            if (buildStatusRef.current === "running") {
              buildStatusRef.current = "done";
              setLastDoneAt(new Date().toISOString());
            }
          } else if (eventName === "error") {
            buildStatusRef.current = "error";
            const { message, usage } = payload as { message?: string; usage?: TokenUsage };
            buildFailureMessage = message ?? "Build error";
            buildStatusMessageRef.current = buildFailureMessage;
            buildUsage = usage;
            setError(buildFailureMessage);
          } else if (eventName === "interrupted") {
            const { reason, usage } = payload as { reason?: string; usage?: TokenUsage };
            buildStatusRef.current = "interrupted";
            buildStatusMessageRef.current = interruptionStatusMessage(reason);
            buildUsage = usage;
          }
        }
      }
      if (!sawDone && !controller.signal.aborted && buildStatusRef.current === "running") {
        buildStatusRef.current = "error";
        buildFailureMessage = "Koneksi terputus sebelum build selesai. Build dapat dilanjutkan.";
        buildStatusMessageRef.current = buildFailureMessage;
        setError(buildFailureMessage);
      } else if (sawDone) {
        setLastDoneAt((v) => v ?? new Date().toISOString());
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        buildStatusRef.current = "error";
        buildFailureMessage = e instanceof Error ? e.message : "Build failed";
        buildStatusMessageRef.current = buildFailureMessage;
        setError(buildFailureMessage);
      }
    } finally {
      if (buildStatusRef.current === "running") {
        buildStatusRef.current = controller.signal.aborted ? "stopped" : "done";
      }
      if (buildStatusRef.current === "stopped" && !buildStatusMessageRef.current) {
        buildStatusMessageRef.current = "Run dihentikan melalui tombol Stop.";
      }
      if (buildStatusRef.current === "done") {
        notify({ kind: "success", title: "Build selesai", description: selected?.title });
      } else if (buildStatusRef.current === "error" && !activityErrorNotified) {
        notify({ kind: "error", title: "Build gagal", description: buildFailureMessage ?? "Build tidak berhasil." });
      } else if (buildStatusRef.current === "stopped") {
        notify({ kind: "info", title: "Build dihentikan", description: selected?.title });
      } else if (buildStatusRef.current === "interrupted") {
        notify({ kind: "info", title: "Build terinterupsi", description: buildStatusMessageRef.current });
      }
      const finishedAt = new Date().toISOString();
      const elapsedMs = Date.now() - buildStartRef.current;
      const finalEvents = logsRef.current.get(logKey) ?? [];
      if (buildTaskId) {
        const prev = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId)?.builds ?? [];
        updateTask(project.id, buildTaskId, {
          builds: [
            {
              id: buildId,
              goal: buildGoalRef.current,
              summary: buildSummary,
              status: buildStatusRef.current,
              model: modelId,
              modelName,
              agent: settings.buildAgent,
              sessionId: activeSessionRef.current ?? effectiveSessionId ?? undefined,
              usage: buildUsage,
              statusMessage: buildStatusMessageRef.current,
              startedAt: new Date(buildStartRef.current).toISOString(),
              finishedAt,
              elapsedMs,
              eventCount: finalEvents.length,
              files: extractFiles(finalEvents),
            },
            ...prev.filter((build) => build.id !== buildId),
          ],
        });
        // Build sukses -> task otomatis ke review agar siap dicek/QA.
        // Gagal / dihentikan -> status dibiarkan agar bisa diulang.
        if (buildStatusRef.current === "done") {
          const cur = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId);
          if (cur && (cur.status === "backlog" || cur.status === "todo" || cur.status === "in-progress")) {
            updateTask(project.id, buildTaskId, { status: "review" });
          }
        }
      }
      setBusy(false);
      setHalt(null);
      abortRef.current = null;
    }
  }

  async function handleImplementationReview() {
    if (!selected || selectedTaskDone || !ready || busy || reviewing) return;
    const task = selected;
    const reviewModel = buildModel || settings.defaultModel;
    const controller = new AbortController();
    const reviewStartedAt = new Date();
    const reviewStartedAtMs = reviewStartedAt.getTime();
    const sessionId = task.sessionId;
    activeSessionRef.current = sessionId ?? null;
    setCurrentSessionId(sessionId ?? null);
    reviewAbortRef.current = controller;
    setReviewing(true);
    setReviewError(null);
    setActivityMode("review");
    setBuildDetailsTab("activity");
    setEvents([
      { kind: "info", title: `Review dimulai — ${task.title}`, detail: `Session: ${sessionId ?? "baru"}\nModel: ${reviewModel}` },
      { kind: "thought", title: "Memeriksa implementasi dan bukti test", detail: "Membaca task, build terakhir, dan acceptance criteria tanpa mengubah file." },
    ]);
    try {
      const message = [
        "Review apakah task ini benar-benar sudah diimplementasikan pada repository saat ini.",
        "Bersikap read-only: jangan mengubah file, jangan membuat commit, dan jangan menyatakan selesai hanya dari build summary.",
        "Periksa implementasi dan test yang relevan. Cocokkan setiap acceptance criteria dengan bukti kode/test.",
        "Gunakan verdict tepat satu ini pada baris pertama: VERDICT: IMPLEMENTED, VERDICT: PARTIAL, VERDICT: NOT_IMPLEMENTED, atau VERDICT: UNCLEAR.",
        "Lalu tulis ulang summary review yang ringkas dengan bagian ## Summary, ## Evidence, dan ## Gaps. Sebutkan path file dan test konkret; jangan mengarang bukti.",
        `Task: ${task.title}`,
        `Epic: ${task.epic || "(tidak ada)"}`,
        `Detail dan acceptance criteria:\n${task.detail || "(tidak ada)"}`,
        `Build terakhir:\nStatus: ${task.builds?.[0]?.status ?? "belum ada"}\nInstruksi: ${task.builds?.[0]?.goal ?? "(tidak ada)"}\nSummary agen: ${task.builds?.[0]?.summary ?? "(tidak ada)"}\nFile tercatat: ${(task.builds?.[0]?.files ?? []).join(", ") || "(tidak ada)"}`,
      ].join("\n\n");
      const result = await opencode.chat({
        directory: project.directory,
        sessionId,
        message,
        model: reviewModel,
        agent: "plan",
        title: `Implementation review — ${task.title}`,
        signal: controller.signal,
      });
      if (result.sessionId !== task.sessionId) setTaskSession(project.id, task.id, result.sessionId);
      activeSessionRef.current = result.sessionId;
      setCurrentSessionId(result.sessionId);
      const review: TaskImplementationReview = {
        verdict: parseImplementationVerdict(result.text),
        summary: result.text.trim(),
        reviewedAt: new Date().toISOString(),
        model: reviewModel,
        agent: "plan",
      };
      const reviewFinishedAt = new Date();
      const reviewFinishedAtMs = reviewFinishedAt.getTime();
      const reviewBuildEntry: TaskBuild = {
        id: `rv_${reviewStartedAtMs.toString(36)}`,
        mode: "review",
        goal: `Review implementation — ${task.title}`,
        summary: result.text.trim(),
        status: "done",
        model: reviewModel,
        modelName: models.find((model) => model.id === reviewModel)?.name ?? reviewModel,
        agent: "plan",
        sessionId: result.sessionId,
        usage: result.usage,
        statusMessage: `Verdict review: ${review.verdict}`,
        startedAt: reviewStartedAt.toISOString(),
        finishedAt: reviewFinishedAt.toISOString(),
        elapsedMs: reviewFinishedAtMs - reviewStartedAtMs,
        eventCount: 2,
        files: extractFiles(events),
      };
      updateTask(project.id, task.id, {
        implementationReview: review,
        builds: [reviewBuildEntry, ...(task.builds ?? [])],
      });
      setEvents((prev) => [
        ...prev,
        { kind: "done", title: `Review selesai · ${review.verdict}`, detail: review.summary },
      ]);
      notify({ kind: "success", title: `Review selesai: ${review.verdict}`, description: task.title });
    } catch (reviewFailure) {
      const aborted = reviewFailure instanceof Error && reviewFailure.name === "AbortError";
      const message = aborted ? "Review dihentikan." : reviewFailure instanceof Error ? reviewFailure.message : "Review gagal dijalankan.";
      setReviewError(message);
      setEvents((prev) => [
        ...prev,
        { kind: "error", title: "Review gagal", detail: message },
      ]);
      const reviewFinishedAt = new Date();
      const failedReviewBuild: TaskBuild = {
        id: `rv_${reviewStartedAtMs.toString(36)}`,
        mode: "review",
        goal: `Review implementation — ${task.title}`,
        summary: message,
        status: aborted ? "stopped" : "error",
        statusMessage: aborted ? "Review dihentikan melalui tombol Stop." : message,
        model: reviewModel,
        modelName: models.find((model) => model.id === reviewModel)?.name ?? reviewModel,
        agent: "plan",
        sessionId: task.sessionId,
        startedAt: reviewStartedAt.toISOString(),
        finishedAt: reviewFinishedAt.toISOString(),
        elapsedMs: reviewFinishedAt.getTime() - reviewStartedAtMs,
        eventCount: 2,
        files: [],
      };
      updateTask(project.id, task.id, { builds: [failedReviewBuild, ...(task.builds ?? [])] });
      notify({ kind: aborted ? "info" : "error", title: aborted ? "Review dihentikan" : "Review gagal", description: aborted ? task.title : message });
    } finally {
      if (reviewAbortRef.current === controller) reviewAbortRef.current = null;
      setReviewing(false);
    }
  }

  function handleStopReview() {
    if (!reviewAbortRef.current) return;
    reviewAbortRef.current.abort();
    setReviewError("Review dihentikan.");
    setReviewing(false);
  }

  async function handleDeleteSession() {
    const sessionId = selected
      ? selected.sessionId ?? (buildTaskRef.current === selected.id ? currentSessionId : null)
      : currentSessionId ?? project.sessionId;
    if (!sessionId || !project.directory) return;
    try {
      await opencode.deleteSession(project.directory, sessionId);
      if (selected) setTaskSession(project.id, selected.id, undefined);
      else clearProjectSession(project.id);
      activeSessionRef.current = null;
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
    if (buildStatusRef.current === "running") {
      buildStatusRef.current = "stopped";
      buildStatusMessageRef.current = "Run dihentikan melalui tombol Stop.";
    }
    abortRef.current?.abort();
    setBusy(false);
    setHalt(null);
  }

  // Resolve a halt the agent paused on: approve/reject a tool permission or
  // answer an agent question. The stream stays open and resumes on reply.
  async function handleHaltAnswer(answer: HaltAnswer) {
    const current = halt;
    const sessionId = activeSessionRef.current;
    if (!current || !sessionId || answeringHalt) return;
    setAnsweringHalt(true);
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
      setHalt(null);
      notify({ kind: "success", title: "Jawaban dikirim ke agen" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Gagal mengirim jawaban";
      setError(message);
      notify({ kind: "error", title: "Gagal mengirim jawaban", description: message });
    } finally {
      setAnsweringHalt(false);
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

      {/* Kanban — ringkas, maks BOARD_LIMIT kartu per kolom, sisanya di dialog */}
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {COLUMNS.map((col) => {
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
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openBuildDialog(t)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openBuildDialog(t);
                      }
                    }}
                    className={`cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-accent ${selectedId === t.id ? "border-primary/50 bg-accent" : "bg-card"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold">{t.title}</p>
                      <button
                        type="button"
                        title="Klik untuk ganti prioritas"
                        disabled={t.status === "done"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const order: TaskPriority[] = ["high", "medium", "low"];
                          const next = order[(order.indexOf(t.priority ?? "medium") + 1) % order.length];
                          updateTask(project.id, t.id, { priority: next });
                        }}
                        className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${(t.priority ?? "medium") === "high" ? "bg-red-500/15 text-red-600 dark:text-red-400" : (t.priority ?? "medium") === "low" ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}
                      >
                        {PRIORITY_LABEL[t.priority ?? "medium"]}
                      </button>
                    </div>
                    {t.epic && <p className="text-muted-foreground truncate text-[11px]">{t.epic}</p>}
                    {(t.tags ?? []).length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {(t.tags ?? []).slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="outline" className="px-1 py-0 text-[10px]">#{tag}</Badge>
                        ))}
                      </div>
                    )}
                    {t.detail && <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px]">{t.detail}</p>}
                    {t.sessionId && (
                      <p className="text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1 text-[10px] font-medium">
                        <span className="size-1.5 rounded-full bg-emerald-500" /> Session terisolasi
                      </p>
                    )}
                    {(t.builds ?? [])[0] && (
                      <p className="text-muted-foreground mt-0.5 truncate text-[10px] tabular-nums">
                        {(t.builds ?? [])[0].status === "done" ? "✔" : (t.builds ?? [])[0].status === "error" ? "✖" : "■"} build {formatElapsed((t.builds ?? [])[0].elapsedMs)}{(t.builds ?? [])[0].files.length > 0 ? ` · ${(t.builds ?? [])[0].files.length} file` : ""}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-0.5">
                      {t.status === "done" && (
                        <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); updateTask(project.id, t.id, { status: "review" }); }}>
                          <RotateCcw className="size-3" /> Buka kembali
                        </Button>
                      )}
                      <span className="flex-1" />
                      <Button size="icon" variant="ghost" className="size-6" disabled={t.status === "done"} onClick={(e) => { e.stopPropagation(); openEdit(t); }}><Pencil className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-6" title="Arsipkan task" disabled={t.status === "done"} onClick={(e) => { e.stopPropagation(); handleArchiveTask(t.id); }}><Archive className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-6 text-destructive" title="Pindahkan ke sampah" disabled={t.status === "done"} onClick={(e) => { e.stopPropagation(); handleDeleteTask(t.id); }}><Trash2 className="size-3.5" /></Button>
                    </div>
                    <div className="mt-1 flex items-center justify-between rounded-md bg-muted/70 px-1.5 py-1">
                      <span className="text-muted-foreground text-[10px]">Ganti status</span>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="size-6 bg-background" aria-label="Pindah ke status sebelumnya" title="Pindah ke status sebelumnya" disabled={t.status === "done" || COLUMNS[0].id === t.status} onClick={(e) => { e.stopPropagation(); move(t, -1); }}><ChevronLeft className="size-3.5" /></Button>
                        <Button size="icon" variant="outline" className="size-6 bg-background" aria-label="Pindah ke status berikutnya" title="Pindah ke status berikutnya" disabled={t.status === "done" || COLUMNS[COLUMNS.length - 1].id === t.status} onClick={(e) => { e.stopPropagation(); move(t, 1); }}><ChevronRight className="size-3.5" /></Button>
                      </div>
                    </div>
                  </div>
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
            <DialogTitle>{editing ? "Edit task" : "Task baru"}</DialogTitle>
            <DialogDescription>Task tersimpan di papan Eksekusi project ini.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Judul</Label>
                <Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="cth. Story 1.2 — User bisa membuat task" />
              </div>
              <div className="space-y-1.5">
                <Label>Epic</Label>
                <Input value={fEpic} onChange={(e) => setFEpic(e.target.value)} placeholder="Opsional" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Detail / acceptance criteria</Label>
                <Textarea value={fDetail} onChange={(e) => setFDetail(e.target.value)} rows={4} placeholder="AC1: …&#10;AC2: …" />
              </div>
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
                <Label>Prioritas</Label>
                <Select value={fPriority} onValueChange={(value) => setFPriority(value as TaskPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["high", "medium", "low"] as TaskPriority[]).map((priority) => (
                      <SelectItem key={priority} value={priority}>{PRIORITY_LABEL[priority]}</SelectItem>
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
            <DialogTitle>{canResumeBuild ? "Lanjutkan build?" : "Jalankan build?"}</DialogTitle>
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
              <Rocket className="size-4" /> {canResumeBuild ? "Lanjutkan" : "Jalankan"}
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
                        {runMode === "review" ? "Jalankan review" : canResumeBuild ? "Lanjutkan build" : "Jalankan build"}
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
                  <Tabs value={buildDetailsTab} onValueChange={(value) => setBuildDetailsTab(value as "history" | "activity" | "review")} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <TabsList className="grid w-full shrink-0 grid-cols-3">
                      <TabsTrigger value="history" disabled={busy || reviewing}>Riwayat build ({(selected.builds ?? []).length})</TabsTrigger>
                      <TabsTrigger value="review" disabled={busy}>Review</TabsTrigger>
                      <TabsTrigger value="activity">Aktivitas</TabsTrigger>
                    </TabsList>
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
                      {reviewing && <p className="text-muted-foreground text-xs">Memeriksa implementasi dan test secara read-only…</p>}
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
        onClose={() => setHalt(null)}
      />
    </div>
  );
}
