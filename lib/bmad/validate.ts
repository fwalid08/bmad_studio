import { draftSkeleton } from "./templates";
import type { Project, StepId } from "./types";

export interface ArtifactIssue {
  level: "error" | "warn";
  message: string;
}

function headingsOf(md: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    // Abaikan isi code fence (contoh placeholder YAML di dalam ```yaml).
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!/^#{1,6}\s+\S/.test(line)) continue;
    out.push(line.replace(/^#{1,6}\s+/, "").trim().toLowerCase());
  }
  return out;
}

/** Validasi ringan: heading skeleton hilang + cek isi khusus epics/sprint + blok mesin. */
export function validateArtifact(stepId: StepId, content: string, projectName = ""): ArtifactIssue[] {
  const issues: ArtifactIssue[] = [];
  const text = (content ?? "").trim();
  if (!text) return [{ level: "warn", message: "Artefak masih kosong." }];

  try {
    const skeletonHeads = headingsOf(draftSkeleton(stepId, projectName || "x"));
    const contentHeads = headingsOf(text);
    for (const h of skeletonHeads) {
      // Judul utama (# ...) mengandung nama project — cocokkan longgar.
      if (h.includes("—")) continue;
      const hit = contentHeads.some((c) => c === h || c.includes(h) || h.includes(c));
      if (!hit) issues.push({ level: "warn", message: `Heading hilang/berubah: "${h}"` });
    }
  } catch { /* skeleton tidak tersedia — lewati */ }

  if (stepId === "epics-stories") {
    const hasEpic = /epic\s*\d+\s*[—–-]/i.test(text) || /\*\*epic/i.test(text);
    const hasStory = /(\bstory\b|US[-\s]?\d+|as\s+a\b)/i.test(text);
    const hasAC = /\bAC\d*\s*:|acceptance/i.test(text);
    if (!hasEpic) issues.push({ level: "error", message: "Tidak ada Epic terdeteksi (harap ada 'Epic 1 — ...')." });
    if (!hasStory) issues.push({ level: "error", message: "Tidak ada Story terdeteksi." });
    if (hasStory && !hasAC) issues.push({ level: "warn", message: "Story tanpa acceptance criteria (AC1: ...)." });
    if (!/```(?:json\s+tasks|tasks)/i.test(text)) {
      issues.push({ level: "warn", message: "Blok mesin ```json tasks hilang — impor pakai tebakan regex (kurang akurat). Tambahkan lagi." });
    }
  }

  if (stepId === "sprint-planning") {
    // Terima ```json sprint, ```sprint, maupun ```json polos yang isinya
    // objek sprint (ada "taskTitles") — model sering menormalkan tag fence.
    const hasSprintFence = /```[^\n]*sprint/i.test(text);
    const hasSprintJson =
      hasSprintFence || /```(?:json)?\s*\n[\s\S]*?["']?taskTitles["']?\s*:/i.test(text);
    if (!hasSprintJson) {
      issues.push({ level: "warn", message: "Blok mesin ```json sprint hilang — saran sprint tidak bisa prefill." });
    }
  }

  return issues.slice(0, 8);
}

/** Ringkasan cepat untuk badge impor: berapa epic/story/AC + ada blok mesin? */
export function artifactTaskSignal(project: Project): { epics: number; stories: number; acs: number; hasMachine: boolean } {
  const combined = `${project.artifacts["epics-stories"]?.content ?? ""}\n${project.artifacts["sprint-planning"]?.content ?? ""}`;
  return {
    epics: (combined.match(/epic\s*\d+\s*[—–-]/gi) ?? []).length,
    stories: (combined.match(/(\bstory\s*\d*\s*:|US[-\s]?\d+)/gi) ?? []).length,
    acs: (combined.match(/\bAC\d*\s*:/gi) ?? []).length,
    hasMachine: /```(?:json\s+tasks|tasks)/i.test(combined),
  };
}
