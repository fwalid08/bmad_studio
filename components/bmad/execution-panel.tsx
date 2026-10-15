"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Rocket, Square, Loader2, ChevronLeft, ChevronRight, Pencil, Trash2, Wand2, FolderX, KanbanSquare, Sparkles, X, Check, ArrowRight, List, Search, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useStudio } from "@/lib/store";
import { ActivityLog } from "@/components/bmad/activity-log";
import type { ActivityEvent } from "@/lib/opencode/types";
import type { Project, ExecTask, TaskStatus, TaskPriority } from "@/lib/bmad/types";
import { stepById } from "@/lib/bmad/roadmap";
import { agentForStep } from "@/lib/bmad/agents";
import { opencode } from "@/lib/opencode/client";
import { directAI } from "@/lib/ai/client";
import { suggestTasksFromArtifacts, parseMachineSprint, taskStats } from "@/lib/execution/tasks";

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

function excerpt(text?: string, n = 400) {
  const t = (text ?? "").trim();
  if (!t) return "— belum ada —";
  return t.length > n ? `${t.slice(0, n)}…` : t;
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
  const settings = useStudio((s) => s.settings);
  const setProjectSession = useStudio((s) => s.setProjectSession);
  const setTaskSession = useStudio((s) => s.setTaskSession);
  const addTask = useStudio((s) => s.addTask);
  const updateTask = useStudio((s) => s.updateTask);
  const deleteTask = useStudio((s) => s.deleteTask);
  const importTasks = useStudio((s) => s.importTasks);
  const createSprint = useStudio((s) => s.createSprint);
  const closeSprint = useStudio((s) => s.closeSprint);

  const tasks = useMemo(() => project.tasks ?? [], [project.tasks]);
  const stats = taskStats(project.tasks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

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
  const BOARD_LIMIT = 3;

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
  const [elaborateError, setElaborateError] = useState<string | null>(null);
  const [elaborated, setElaborated] = useState<Array<{ title: string; detail: string; epic: string; checked: boolean }>>([]);

  // Build runner (per selected task, konteks artefak otomatis)
  const [goalOverride, setGoalOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastDoneAt, setLastDoneAt] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Log per task disimpan di memori sesi agar tidak hilang saat ganti seleksi;
  // ringkasannya (status, durasi, file) dipersist ke store saat build selesai.
  const logsRef = useRef(new Map<string, ActivityEvent[]>());
  const buildTaskRef = useRef<string | null>(null);
  const buildStartRef = useRef(0);
  const buildStatusRef = useRef<"running" | "done" | "error" | "stopped">("running");
  const buildCountRef = useRef(0);
  const buildGoalRef = useRef("");
  const ready = Boolean(project.directory);

  function selectTask(id: string | null) {
    if (selectedId) logsRef.current.set(selectedId, events);
    if (id === NO_TASK_KEY) id = null;
    setSelectedId(id);
    setGoalOverride(null);
    setEvents(id ? (logsRef.current.get(id) ?? []) : (logsRef.current.get(NO_TASK_KEY) ?? []));
  }

  // Ticker elapsed time selama build berjalan.
  useEffect(() => {
    if (!busy) return;
    setElapsedSec(0);
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - buildStartRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const taskDefaultGoal = selected ? `${selected.title}${selected.detail ? `\n${selected.detail}` : ""}` : "";
  const goalText = (goalOverride ?? taskDefaultGoal).trim();
  const suggestions = useMemo(() => suggestTasksFromArtifacts(project), [project.artifacts]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }, [tasks]);
  const visibleTasks = sortTasks(tagFilter ? tasks.filter((t) => (t.tags ?? []).includes(tagFilter)) : tasks);
  const nextUp = sortTasks(visibleTasks.filter((t) => t.status === "todo")).concat(sortTasks(visibleTasks.filter((t) => t.status === "backlog")))[0] ?? null;

  function openList(status?: TaskStatus | "all") {
    if (status !== undefined) setListStat(status);
    setListOpen(true);
  }
  const listFiltered = useMemo(() => {
    const q = listQ.trim().toLowerCase();
    return sortTasks(
      tasks.filter((t) => {
        if (listStat !== "all" && t.status !== listStat) return false;
        if (listPri && (t.priority ?? "medium") !== listPri) return false;
        if (listTag && !(t.tags ?? []).includes(listTag)) return false;
        if (q && !`${t.title}\n${t.detail}\n${t.epic}`.toLowerCase().includes(q)) return false;
        return true;
      })
    );
  }, [tasks, listQ, listTag, listPri, listStat]);

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
  }

  // Preview impor: centang kandidat, tandai duplikat sebelum masuk papan.
  const [importOpen, setImportOpen] = useState(false);
  const [importChecks, setImportChecks] = useState<boolean[]>([]);
  const existingTitles = useMemo(
    () => new Set(tasks.map((t) => t.title.toLowerCase())),
    [tasks]
  );
  const fromMachine = useMemo(
    () => suggestions.some((s) => (s as { fromMachine?: boolean }).fromMachine),
    [suggestions]
  );

  function openImport() {
    if (suggestions.length === 0) {
      setError("Belum ada artefak Epics/Stories untuk diimpor — isi dulu di tab Rencana.");
      return;
    }
    setError(null);
    setImportChecks(suggestions.map((s) => !existingTitles.has(s.title.toLowerCase())));
    setImportOpen(true);
  }

  function handleImportSelected() {
    const chosen = suggestions.filter((_, i) => importChecks[i]);
    const n = importTasks(project.id, chosen);
    setImportOpen(false);
    if (n === 0) setError("Semua kandidat sudah ada di papan (duplikat).");
    else setError(null);
  }

  function move(t: ExecTask, dir: -1 | 1) {
    const idx = COLUMNS.findIndex((c) => c.id === t.status);
    const next = COLUMNS[idx + dir];
    if (next) updateTask(project.id, t.id, { status: next.id });
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
      setElaborateError("Set working directory dulu (atau pakai mode Direct AI di Settings) untuk memanggil agen.");
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
    } catch (e) {
      setElaborateError(e instanceof Error ? e.message : "Elaborasi gagal");
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
    if (n === 0) setError("Semua story sudah ada di papan (duplikat).");
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
      setSprintError("Backlog kosong — buat task atau impor dari artefak dulu.");
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal meminta saran agen";
      setSprintError(
        /No Direct|Multiple Direct|provider|No model|API key|Unauthorized|401/i.test(msg)
          ? `Direct AI belum siap (${msg}). Atur provider + API key + model di halaman Settings, lalu coba lagi.`
          : msg
      );
    } finally {
      setSprintAsking(false);
    }
  }

  function saveSprint() {
    const ids = sprintPicks.filter((p) => p.checked).map((p) => p.id);
    if (!sprintName.trim() || ids.length === 0) return;
    createSprint(project.id, { name: sprintName.trim(), goal: sprintGoal.trim(), taskIds: ids });
    setSprintOpen(false);
  }

  async function handleBuild() {
    if (!goalText || !ready || busy) return;
    const buildTaskId = selected?.id ?? null;
    const logKey = buildTaskId ?? NO_TASK_KEY;
    const goalSnapshot = goalText;
    setBusy(true);
    setError(null);
    setEvents([]);
    setLastDoneAt(null);
    logsRef.current.set(logKey, []);
    buildTaskRef.current = buildTaskId;
    buildStartRef.current = Date.now();
    buildStatusRef.current = "running";
    buildCountRef.current = 0;
    buildGoalRef.current = goalSnapshot;
    const controller = new AbortController();
    abortRef.current = controller;
    const pushLog = (e: ActivityEvent) => {
      const arr = [...(logsRef.current.get(logKey) ?? []), e];
      logsRef.current.set(logKey, arr);
      buildCountRef.current = arr.length;
      setEvents(arr);
    };
    const taskLine = selected ? `Task: ${selected.title}${selected.epic ? ` (Epic: ${selected.epic})` : ""}\n${selected.detail ? `Detail: ${selected.detail}\n` : ""}` : "";
    const prompt = `${artifactContext(project)}${taskLine}Tujuan build:\n${goalSnapshot}\n\nSetelah selesai, tandai file yang diubah dan cara verifikasi.`;
    // Tandai task sedang dikerjakan begitu build mulai (backlog/todo -> in-progress).
    if (buildTaskId) {
      const cur = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId);
      if (cur && (cur.status === "backlog" || cur.status === "todo")) {
        updateTask(project.id, buildTaskId, { status: "in-progress" });
      }
    }
    const effectiveSessionId = selected?.sessionId ?? project.sessionId;
    try {
      const res = await fetch("/api/opencode/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: project.directory,
          sessionId: effectiveSessionId,
          prompt,
          model: settings.defaultModel,
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
              if (buildTaskId && sessionId !== selected?.sessionId) {
                setTaskSession(project.id, buildTaskId, sessionId);
              } else if (!buildTaskId && sessionId !== project.sessionId) {
                setProjectSession(project.id, sessionId);
              }
            }
          } else if (eventName === "log") {
            pushLog(payload as ActivityEvent);
          } else if (eventName === "done") {
            if (buildStatusRef.current === "running") buildStatusRef.current = "done";
            setLastDoneAt(new Date().toISOString());
          } else if (eventName === "error") {
            buildStatusRef.current = "error";
            const { message } = payload as { message?: string };
            setError(message ?? "Build error");
          }
        }
      }
      setLastDoneAt((v) => v ?? new Date().toISOString());
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        buildStatusRef.current = "error";
        setError(e instanceof Error ? e.message : "Build failed");
      }
    } finally {
      if (buildStatusRef.current === "running") {
        buildStatusRef.current = controller.signal.aborted ? "stopped" : "done";
      }
      const finishedAt = new Date().toISOString();
      const elapsedMs = Date.now() - buildStartRef.current;
      const finalEvents = logsRef.current.get(logKey) ?? [];
      if (buildTaskId) {
        const prev = useStudio.getState().getProject(project.id)?.tasks?.find((t) => t.id === buildTaskId)?.builds ?? [];
        updateTask(project.id, buildTaskId, {
          builds: [
            {
              id: `b_${Date.now().toString(36)}`,
              goal: buildGoalRef.current,
              status: buildStatusRef.current,
              startedAt: new Date(buildStartRef.current).toISOString(),
              finishedAt,
              elapsedMs,
              eventCount: finalEvents.length,
              files: extractFiles(finalEvents),
            },
            ...prev,
          ].slice(0, 3),
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
      abortRef.current = null;
    }
  }

  function handleStop() {
    if (buildStatusRef.current === "running") buildStatusRef.current = "stopped";
    abortRef.current?.abort();
    setBusy(false);
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
                    <CalendarDays className="size-3.5" /> {activeSprint.name}
                  </p>
                  {activeSprint.goal && <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{activeSprint.goal}</p>}
                  <p className="text-muted-foreground mt-1 text-[11px] tabular-nums">{done}/{inSprint.length} task selesai · {pct}%</p>
                  <Progress value={pct} className="mt-1.5 h-1.5" />
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => openSprintPlanner()}>Susun ulang</Button>
                  <Button size="sm" variant="ghost" onClick={() => closeSprint(project.id, activeSprint.id)}>Tutup sprint</Button>
                </div>
              </div>
            </div>
          );
        })()
      ) : nextUp ? (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.09] via-card to-card p-3 shadow-sm sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Kerjakan berikutnya</p>
            <p className="truncate text-sm font-bold">{nextUp.title}</p>
            <p className="text-muted-foreground truncate text-xs">
              {PRIORITY_LABEL[nextUp.priority ?? "medium"]} · {nextUp.status === "todo" ? "Sprint" : "Backlog"}{nextUp.epic ? ` · ${nextUp.epic}` : ""}
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => selectTask(nextUp.id)}>
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
        <Button size="sm" variant="outline" onClick={() => openList("all")}><List className="size-4" /> Semua task ({tasks.length})</Button>
        <Button size="sm" variant="outline" onClick={openSprintPlanner}><CalendarDays className="size-4" /> Susun sprint</Button>
        <Button size="sm" variant="outline" onClick={openImport} disabled={suggestions.length === 0}>
          <Wand2 className="size-4" /> Impor {suggestions.length > 0 ? `${suggestions.length} ` : ""}dari artefak{fromMachine ? " · akurat" : " · tebakan"}
        </Button>
        {suggestions.length === 0 && (
          <span className="text-muted-foreground text-xs">Isi Epics & Stories di tab Rencana dulu untuk mengimpor otomatis.</span>
        )}
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
                    onClick={() => selectTask(t.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") selectTask(t.id); }}
                    className={`cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-accent ${selectedId === t.id ? "border-primary/50 bg-accent" : "bg-card"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold">{t.title}</p>
                      <button
                        type="button"
                        title="Klik untuk ganti prioritas"
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
                      <Button size="icon" variant="ghost" className="size-6" disabled={COLUMNS[0].id === t.status} onClick={(e) => { e.stopPropagation(); move(t, -1); }}><ChevronLeft className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-6" disabled={COLUMNS[COLUMNS.length - 1].id === t.status} onClick={(e) => { e.stopPropagation(); move(t, 1); }}><ChevronRight className="size-3.5" /></Button>
                      <span className="flex-1" />
                      <Button size="icon" variant="ghost" className="size-6" onClick={(e) => { e.stopPropagation(); openEdit(t); }}><Pencil className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-6 text-destructive" onClick={(e) => { e.stopPropagation(); deleteTask(project.id, t.id); if (selectedId === t.id) selectTask(null); }}><Trash2 className="size-3.5" /></Button>
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

      {/* Detail task + build — tidak perlu bolak-balik ke Rencana */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Story / Task terpilih</CardTitle>
            <CardDescription className="text-xs">Klik kartu di papan untuk melihat detail + konteks rencana di sini.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selected ? (
              <p className="text-muted-foreground text-sm">Belum ada yang dipilih. Klik salah satu kartu, atau buat task baru.</p>
            ) : (
              <>
                <div>
                  <p className="text-sm font-bold">{selected.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selected.epic && <Badge variant="secondary" className="text-[10px]">{selected.epic}</Badge>}
                    {(selected.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px]">#{tag}</Badge>
                    ))}
                  </div>
                  {selected.detail && <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">{selected.detail}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => openEdit(selected)}><Pencil className="size-3.5" /> Edit</Button>
                    {selected.status !== "done" && (
                      <Button size="sm" variant="ghost" onClick={() => updateTask(project.id, selected.id, { status: "done" })}>Tandai selesai</Button>
                    )}
                    <span className="mx-1 h-4 w-px bg-border" />
                    {selected.sessionId ? (
                      <>
                        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-500" /> Session terisolasi
                        </span>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setTaskSession(project.id, selected.id, undefined)}>
                          Pakai session project
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        title="Buat chat session khusus untuk task ini — konteks tidak bercampur dengan task lain"
                        onClick={() => {
                          const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
                          setTaskSession(project.id, selected.id, `task_session_${id}`);
                        }}
                      >
                        <Plus className="size-3" /> Session terisolasi
                      </Button>
                    )}
                  </div>
                </div>
                {(selected.builds ?? []).length > 0 && (
                  <div className="space-y-1.5 rounded-md border bg-muted/40 p-2.5 text-xs">
                    <p className="font-semibold">Riwayat build ({(selected.builds ?? []).length})</p>
                    {(selected.builds ?? []).map((b) => (
                      <div key={b.id} className="flex flex-col gap-1 rounded border bg-card p-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={b.status === "done" ? "secondary" : b.status === "running" ? "default" : "outline"} className="text-[10px]">
                            {b.status === "done" ? "Selesai" : b.status === "error" ? "Gagal" : b.status === "stopped" ? "Dihentikan" : "Berjalan"}
                          </Badge>
                          <span className="text-muted-foreground tabular-nums">
                            {new Date(b.startedAt).toLocaleString()} · {formatElapsed(b.elapsedMs)} · {b.eventCount} event
                          </span>
                        </div>
                        {b.files.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {b.files.map((f) => (
                              <code key={f} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{f}</code>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <details className="rounded-md border bg-muted/40 p-2.5 text-xs" open>
                  <summary className="cursor-pointer font-semibold">Konteks Rencana (tidak perlu buka tab Rencana)</summary>
                  <div className="mt-2 space-y-2">
                    <div><p className="font-semibold">PRD</p><p className="text-muted-foreground whitespace-pre-wrap">{excerpt(project.artifacts["prd"]?.content)}</p></div>
                    <div><p className="font-semibold">Architecture</p><p className="text-muted-foreground whitespace-pre-wrap">{excerpt(project.artifacts["architecture"]?.content)}</p></div>
                    <div><p className="font-semibold">Epics & Stories</p><p className="text-muted-foreground whitespace-pre-wrap">{excerpt(project.artifacts["epics-stories"]?.content)}</p></div>
                  </div>
                </details>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Rocket className="size-4" /> Build task</CardTitle>
            <CardDescription className="text-xs">Agen mengerjakan task terpilih + konteks artefak otomatis di folder project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!ready && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                <FolderX className="mt-0.5 size-4 shrink-0" /><p>Set working directory dulu di header project.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="exec-goal">Instruksi untuk agen (terisi dari task)</Label>
                {goalOverride !== null && selected && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setGoalOverride(null)} disabled={busy}>
                    Ikuti task lagi
                  </Button>
                )}
              </div>
              <Textarea id="exec-goal" rows={5} value={goalOverride ?? taskDefaultGoal} onChange={(e) => setGoalOverride(e.target.value)} placeholder="Pilih task di papan, atau tulis instruksi manual…" disabled={busy} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {busy ? (
                <Button variant="destructive" onClick={handleStop}><Square className="size-4" /> Stop</Button>
              ) : (
                <Button onClick={() => setConfirmOpen(true)} disabled={!goalText || !ready}><Rocket className="size-4" /> Jalankan build</Button>
              )}
              {busy && <span className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums"><Loader2 className="size-3.5 animate-spin" /> Agen bekerja… {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")} · {events.length} event</span>}
              {!busy && lastDoneAt && !error && <span className="text-xs text-emerald-600">Selesai {new Date(lastDoneAt).toLocaleTimeString()}</span>}
            </div>
            {error && <p className="text-destructive text-xs">{error}</p>}
            {events.length > 0 && extractFiles(events).length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground text-[11px]">File tersentuh:</span>
                {extractFiles(events).map((f) => (
                  <code key={f} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{f}</code>
                ))}
              </div>
            )}
            <ActivityLog events={events} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit task" : "Task baru"}</DialogTitle>
            <DialogDescription>Task tersimpan di papan Eksekusi project ini.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Judul</Label>
              <Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="cth. Story 1.2 — User bisa membuat task" />
            </div>
            <div className="space-y-1.5">
              <Label>Epic (opsional)</Label>
              <Input value={fEpic} onChange={(e) => setFEpic(e.target.value)} placeholder="cth. Epic 1 — Onboarding" />
            </div>
            <div className="space-y-1.5">
              <Label>Tag (pisahkan koma, tanpa #)</Label>
              <Input value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="cth. frontend, urgent, bug" />
              {parseTagInput(fTags).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {parseTagInput(fTags).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">#{tag}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Detail / acceptance criteria</Label>
              <Textarea value={fDetail} onChange={(e) => setFDetail(e.target.value)} rows={4} placeholder="AC1: …&#10;AC2: …" />
            </div>
            <div className="space-y-1.5">
              <Label>Prioritas (menentukan urutan)</Label>
              <div className="flex flex-wrap gap-1.5">
                {(["high", "medium", "low"] as TaskPriority[]).map((p) => (
                  <Button key={p} size="sm" variant={fPriority === p ? "secondary" : "outline"} onClick={() => setFPriority(p)}>{PRIORITY_LABEL[p]}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <div className="flex flex-wrap gap-1.5">
                {COLUMNS.map((c) => (
                  <Button key={c.id} size="sm" variant={fStatus === c.id ? "secondary" : "outline"} onClick={() => setFStatus(c.id)}>{c.name}</Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
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
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Daftar task ({listFiltered.length}/{tasks.length})</DialogTitle>
            <DialogDescription>Klik baris untuk memilih task dan menutup dialog.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder="Cari judul, detail, epic…" className="pl-8" />
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
            <ul className="space-y-1">
              {listFiltered.length === 0 && (
                <li className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-xs">Tidak ada task yang cocok.</li>
              )}
              {listFiltered.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => { selectTask(t.id); setListOpen(false); }}
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:bg-accent ${selectedId === t.id ? "border-primary/50 bg-accent" : ""}`}
                  >
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold ${(t.priority ?? "medium") === "high" ? "bg-red-500/15 text-red-600 dark:text-red-400" : (t.priority ?? "medium") === "low" ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
                      {PRIORITY_LABEL[t.priority ?? "medium"]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{t.title}</span>
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {COLUMNS.find((c) => c.id === t.status)?.name}{t.epic ? ` · ${t.epic}` : ""}{(t.tags ?? []).length > 0 ? ` · ${(t.tags ?? []).map((g) => `#${g}`).join(" ")}` : ""}
                      </span>
                    </span>
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => setListOpen(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Preview impor ({suggestions.length})</DialogTitle>
            <DialogDescription>
              {fromMachine
                ? "Dibaca dari blok mesin ```json tasks — akurat."
                : "Tanpa blok mesin — hasil tebakan regex, periksa judul/detail sebelum impor."}
            </DialogDescription>
          </DialogHeader>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {suggestions.map((s, i) => {
              const dup = existingTitles.has(s.title.toLowerCase());
              return (
                <li key={i} className={`flex items-start gap-2 rounded-md border p-2 text-xs ${dup ? "opacity-60" : ""}`}>
                  <button
                    type="button"
                    onClick={() => setImportChecks((prev) => prev.map((c, j) => (j === i ? !c : c)))}
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${importChecks[i] ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                    aria-label="Pilih kandidat"
                  >
                    {importChecks[i] && <Check className="size-3" />}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.title} {dup && <Badge variant="outline" className="ml-1 text-[10px]">duplikat — dilewati</Badge>}</span>
                    {s.epic && <span className="text-muted-foreground block truncate">Epic: {s.epic}</span>}
                    {s.detail && <span className="text-muted-foreground block whitespace-pre-wrap">{s.detail.slice(0, 300)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Batal</Button>
            <Button onClick={handleImportSelected} disabled={importChecks.filter(Boolean).length === 0}>
              Impor {importChecks.filter(Boolean).length} ke Backlog
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
            <DialogTitle>Jalankan build?</DialogTitle>
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
            <p className="text-muted-foreground">Instruksi:</p>
            <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{goalText || "— kosong —"}</pre>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button onClick={() => { setConfirmOpen(false); void handleBuild(); }} disabled={!goalText || !ready}>
              <Rocket className="size-4" /> Jalankan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
