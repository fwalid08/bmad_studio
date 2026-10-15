import type { Project } from "@/lib/bmad/types";

/** Ambil blok ```json tasks [...] / ```json sprint — sumber kebenaran impor. */
function parseMachineTasks(combined: string): Array<{ title: string; detail: string; epic: string; fromMachine: boolean }> {
  const out: Array<{ title: string; detail: string; epic: string; fromMachine: boolean }> = [];
  const fenceRe = /```(?:json\s+tasks|tasks|json\s+sprint|sprint)\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(combined)) !== null) {
    const body = m[1].trim();
    // Sprint block: {name, goal, taskTitles} — bukan daftar task, lewati di sini.
    if (/["']?taskTitles["']?\s*:/.test(body)) continue;
    // Coba parse array langsung, atau bungkus objek {tasks:[...]}.
    const candidates = [body];
    const arrMatch = body.match(/\[[\s\S]*\]/);
    if (arrMatch) candidates.push(arrMatch[0]);
    for (const cand of candidates) {
      try {
        const parsed: unknown = JSON.parse(cand);
        const arr = Array.isArray(parsed) ? parsed : (parsed as { tasks?: unknown }).tasks;
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const o = item as { title?: unknown; detail?: unknown; epic?: unknown };
          const title = String(o.title ?? "").trim();
          if (title.length < 2) continue;
          out.push({
            title: title.length > 140 ? `${title.slice(0, 140)}…` : title,
            detail: String(o.detail ?? "").trim() || title,
            epic: String(o.epic ?? "").trim(),
            fromMachine: true,
          });
        }
        if (out.length > 0) return out.slice(0, 40);
      } catch { /* coba kandidat berikutnya */ }
    }
  }
  return out;
}

/** Ambil blok ```json sprint {name, goal, taskTitles} bila ada.
 *  Toleran: terima ```json sprint, ```sprint, maupun ```json polos yang
 *  isinya objek sprint; perbaiki trailing comma sebelum JSON.parse. */
export function parseMachineSprint(combined: string): { name: string; goal: string; taskTitles: string[] } | null {
  const fenceRe = /```[^\n]*\n([\s\S]*?)```/gi;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(combined)) !== null) {
    candidates.push(m[1].trim());
  }
  // Fallback: objek JSON seimbang di luar fence (jawaban agen yang longgar).
  for (let start = 0; start < combined.length; start++) {
    if (combined[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < combined.length; i++) {
      const ch = combined[i];
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
            candidates.push(combined.slice(start, i + 1));
            start = i;
            break;
          }
        }
      }
    }
  }
  for (const raw of candidates) {
    // Objek sprint selalu punya taskTitles — lewati blok tasks murni.
    if (!/["']?taskTitles["']?\s*:/.test(raw)) continue;
    const body = raw.replace(/,\s*([}\]])/g, "$1");
    const objMatch = body.match(/\{[\s\S]*\}/);
    for (const cand of objMatch ? [body, objMatch[0]] : [body]) {
      try {
        const o = JSON.parse(cand) as { name?: unknown; goal?: unknown; taskTitles?: unknown };
        if (o && Array.isArray(o.taskTitles)) {
          return {
            name: String(o.name ?? "").trim(),
            goal: String(o.goal ?? "").trim(),
            taskTitles: (o.taskTitles as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
          };
        }
      } catch { /* coba kandidat berikutnya */ }
    }
  }
  return null;
}
/** Bersihkan penanda markdown (**, *, `) di awal/akhir dan dalam teks. */
function cleanMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\*+\s*/, "")
    .replace(/\s*\*+$/, "")
    .replace(/(^|\s)\*(\S)/g, "$1$2")
    .trim();
}

/** Parse artefak Epics & Stories / Sprint Planning menjadi kandidat task.
 *  Prioritas: blok mesin ```json tasks [...] (sumber kebenaran).
 *  Fallback: regex heuristik untuk draft lama / tanpa blok mesin.
 *  Melewati baris metadata murni (ID:, Status:, dst.) agar tidak jadi task sampah
 *  seperti "**ID:** US-1.1". Baris AC ditempel sebagai detail task terakhir.
 */
export function suggestTasksFromArtifacts(project: Project): Array<{ title: string; detail: string; epic: string; fromMachine?: boolean }> {
  const epicsRaw = project.artifacts["epics-stories"]?.content ?? "";
  const sprintRaw = project.artifacts["sprint-planning"]?.content ?? "";
  const combined = `${epicsRaw}\n${sprintRaw}`;

  // 1) Blok mesin utama — akurat, jangan ditebak ulang.
  const machine = parseMachineTasks(combined);
  if (machine.length > 0) {
    const seen = new Set<string>();
    return machine.filter((t) => {
      const k = t.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const out: Array<{ title: string; detail: string; epic: string }> = [];

  const push = (title: string, detail: string, epic: string) => {
    const t = cleanMd(title).replace(/\s+/g, " ").trim();
    if (t.length < 4) return;
    // Buang sisa label ID di depan ("US-1.1 — ...", "Story 2: ...").
    const short = t.replace(/^(US[-\s]?\d+(\.\d+)?|story\s*\d+)\s*[:—–-]\s*/i, "").trim();
    out.push({ title: short.length >= 4 ? short : t, detail: cleanMd(detail).trim() || t, epic });
  };

  let currentEpic = "";
  for (const rawLine of combined.split("\n")) {
    const stripped = rawLine
      .trim()
      .replace(/^>\s*/, "")
      .replace(/^(-\s+|\*\s+|\d+[.)]\s+)(\[[ xX]\]\s*)?/, "")
      .trim();
    if (!stripped || stripped.startsWith("#") || stripped.startsWith("_Generated") || stripped.startsWith("```") || /^\|.*\|$/.test(stripped)) continue;
    const line = cleanMd(stripped);
    if (!line) continue;
    const low = line.toLowerCase();

    // Header / catatan artefak — lewati.
    if (/^(basis|readiness|development_status|notes|catatan)\b/i.test(line) && line.length < 80 && !/[:—–-]\s*\S.{10,}/.test(line)) continue;

    // Header epic: "Epic 1 — Judul" atau "epic-1:" (+ title di baris "title:").
    // Catatan: epic BUKAN task — hanya jadi pengelompok (field `epic`).
    // Jangan push task di sini, kalau tidak backlog terisi task duplikat
    // "Judul == Epic" dengan detail placeholder "Epic dari artefak...".
    const epicMatch = line.match(/^Epic\s*\d+\s*[—–-]\s*(.+)$/i);
    if (epicMatch) {
      currentEpic = epicMatch[1].replace(/["']/g, "").trim();
      continue;
    }
    if (/^epic-\d+\s*:?\s*$/i.test(line)) continue; // kunci yaml, judul ada di baris title:

    // Pasangan kunci YAML / label metadata.
    const kv = line.match(/^([A-Za-z][\w -]{0,24})\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1].toLowerCase().trim();
      const valClean = cleanMd(kv[2].replace(/^["']|["']$/g, "").trim());
      if (/^epic(\s*\d+)?$/.test(key)) {
        // Gaya agen: "**Epic:** Nama epic" — jadikan epic aktif saja,
        // bukan task. Task hanya dibuat dari story/title/AC.
        if (valClean) {
          currentEpic = valClean;
        }
        continue;
      }
      if (/^(title|judul|story(\s*\d+)?|ringkasan)$/.test(key)) {
        if (valClean) push(valClean, valClean, currentEpic);
        continue;
      }
      if (/^(ac\d*|acceptance( criteria)?|kriteria)$/.test(key)) {
        if (valClean) {
          const last = out[out.length - 1];
          const dl = `${kv[1].trim()}: ${valClean}`;
          if (last) last.detail = `${last.detail}\n${dl}`.trim();
          else push(valClean, dl, currentEpic);
        }
        continue;
      }
      // Metadata murni (id, status, epic, priority, dst.) — buang.
      continue;
    }

    // Awal story: "Story ...", "US-1.2 ...", "As a ...".
    if (/^(as\s+a(n)?\b|story\b|US[-\s]?\d+)/i.test(line)) {
      push(line, line, currentEpic);
      continue;
    }

    // Prosa bebas (format wizard lama) — hanya bila menempel pada epic dan cukup panjang.
    if (currentEpic && line.length > 24 && /\s/.test(line)) {
      push(line.length > 100 ? `${line.slice(0, 100)}…` : line, line, currentEpic);
    }
    if (out.length >= 30) break;
  }
  // Dedupe berdasarkan title
  const seen = new Set<string>();
  return out.filter((t) => {
    const k = t.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function taskStats(tasks: Project["tasks"]) {
  const list = tasks ?? [];
  const by = (s: string) => list.filter((t) => t.status === s).length;
  const done = by("done");
  return {
    total: list.length,
    backlog: by("backlog"),
    todo: by("todo"),
    doing: by("in-progress"),
    review: by("review"),
    done,
    pct: list.length ? Math.round((done / list.length) * 100) : 0,
  };
}
