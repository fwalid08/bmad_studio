import type { StepId } from "./types";
import type { WizardQuestion } from "./types";

export interface StepTemplate {
  questions: WizardQuestion[];
  build: (answers: Record<string, string>, projectName: string) => string;
}

const now = () => new Date().toISOString().slice(0, 10);

function md(parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join("\n\n");
}

const list = (v?: string) =>
  (v || "").split("\n").filter(Boolean).map((l) => `- ${l}`).join("\n");

const orDash = (v?: string) => (v && v.trim() ? v.trim() : "—");

/**
 * Best-practice empty draft skeleton for a step. This is the structure the
 * manual wizard fills in (via `build`) AND the structure handed to the agent
 * inside the "Buatkan draft" system prompt — so manual and agent output share
 * the same document shape, and the agent elaborates the skeleton using the
 * drafts of previous phases as context.
 */
export function draftSkeleton(stepId: StepId, projectName: string): string {
  const tpl = TEMPLATES[stepId];
  if (!tpl) return `# ${projectName}\n\n_BMAD Studio · ${now()}_`;
  return tpl.build({}, projectName);
}

export const TEMPLATES: Record<StepId, StepTemplate> = {
  brainstorming: {
    questions: [
      { id: "topic", label: "Topik / masalah yang di-brainstorm", placeholder: "cth. Aplikasi habit-tracking untuk orang tua sibuk", multiline: true },
      { id: "technique", label: "Teknik yang dipakai", placeholder: "cth. SCAMPER / Six Thinking Hats / Brainwriting", help: "Teknik yang memandu sesi ini." },
      { id: "constraints", label: "Batasan keras (waktu, budget, platform)", placeholder: "cth. Harus jalan di mobile web, timeline 4 minggu" },
      { id: "ideas", label: "Ide yang dihasilkan (satu per baris)", placeholder: "Ide 1\nIde 2\nIde 3", multiline: true },
      { id: "clusters", label: "Pengelompokan / tema ide", placeholder: "Tema A: ...\nTema B: ...", multiline: true },
      { id: "nextStep", label: "Ide yang dilanjutkan & langkah berikutnya", placeholder: "Ide terpilih + alasan singkat", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Brainstorming Session — ${name}`,
        `**Topik:** ${orDash(a.topic)}\n\n**Teknik:** ${orDash(a.technique)}\n\n**Batasan:** ${orDash(a.constraints)}`,
        `## Ide yang Dihasilkan\n${list(a.ideas) || "—"}`,
        `## Pengelompokan / Tema\n${orDash(a.clusters)}`,
        `## Dilanjutkan ke Tahap Berikutnya\n${orDash(a.nextStep)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "forge-idea": {
    questions: [
      { id: "idea", label: "Nyatakan ide dalam satu kalimat", placeholder: "cth. Aplikasi yang mengubah voice note menjadi task terstruktur", multiline: true },
      { id: "audience", label: "Siapa yang paling merasakan masalahnya?", placeholder: "Pengguna target / early adopter", multiline: true },
      { id: "assumptions", label: "Asumsi kunci (satu per baris)", placeholder: "User lebih suka voice daripada mengetik\nOrang mau membayar untuk kerapian", multiline: true },
      { id: "weakpoints", label: "Titik lemah hasil probing", placeholder: "Apa yang rusak jika asumsinya salah?", multiline: true },
      { id: "verdict", label: "Verdict", placeholder: "Act on it / Rework it / Drop it — dan alasannya", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Forged Idea — ${name}`,
        `**Ide:** ${orDash(a.idea)}\n\n**Audiens:** ${orDash(a.audience)}`,
        `## Asumsi Kunci\n${list(a.assumptions) || "—"}`,
        `## Titik Lemah\n${orDash(a.weakpoints)}`,
        `## Verdict\n${orDash(a.verdict)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "deep-recon": {
    questions: [
      { id: "type", label: "Tipe riset", placeholder: "market / domain / technical / competitive / user-voice" },
      { id: "question", label: "Keputusan yang didukung riset ini", placeholder: "Apa yang ingin diputuskan?", multiline: true },
      { id: "sources", label: "Sumber yang dirujuk", placeholder: "Satu per baris, sertakan link/tanggal jika ada", multiline: true },
      { id: "findings", label: "Temuan (sertakan sumber)", placeholder: "Temuan 1 — [sumber]\nTemuan 2 — [sumber]", multiline: true },
      { id: "recommendation", label: "Rekomendasi untuk keputusan di atas", placeholder: "Apa yang sebaiknya dilakukan berdasarkan temuan?", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Research Report — ${name}`,
        `**Tipe:** ${orDash(a.type)}\n\n**Keputusan yang didukung:** ${orDash(a.question)}`,
        `## Sumber\n${list(a.sources) || "—"}`,
        `## Temuan\n${orDash(a.findings)}`,
        `## Rekomendasi\n${orDash(a.recommendation)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "project-context": {
    questions: [
      { id: "stack", label: "Stack & perintah terverifikasi (install/test/build)", placeholder: "bun install\nbun test\nbun run build", multiline: true },
      { id: "structure", label: "Struktur repo (direktori kunci)", placeholder: "cth. app/ = routes, components/ = UI, lib/ = logic", multiline: true },
      { id: "conventions", label: "Konvensi yang berbeda dari default", placeholder: "cth. Pakai bun bukan npm; tab bukan spasi", multiline: true },
      { id: "pitfalls", label: "Pitfall yang diketahui", placeholder: "cth. Jangan edit dist/ langsung", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Project Context — ${name}`,
        `## Stack & Verified Commands\n\`\`\`bash\n${orDash(a.stack)}\n\`\`\``,
        `## Struktur Repo\n${orDash(a.structure)}`,
        `## Konvensi\n${orDash(a.conventions)}`,
        `## Pitfall\n${orDash(a.pitfalls)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "product-brief": {
    questions: [
      { id: "problem", label: "Masalah apa yang diselesaikan?", placeholder: "Ceritakan pain-nya dengan kata-kata user", multiline: true },
      { id: "audience", label: "Siapa yang paling merasakan masalah ini?", placeholder: "Target user / early adopter", multiline: true },
      { id: "solution", label: "Solusi yang diusulkan (satu paragraf)", placeholder: "Apa yang akan dibangun?", multiline: true },
      { id: "differentiator", label: "Kenapa sekarang, dan kenapa kamu?", placeholder: "Apa yang membuat ini timely dan milikmu?", multiline: true },
      { id: "success", label: "Sukses terlihat seperti apa?", placeholder: "Sinyal paling awal bahwa ini bekerja", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Product Brief — ${name}`,
        `## Masalah\n${orDash(a.problem)}`,
        `## Audiens\n${orDash(a.audience)}`,
        `## Solusi\n${orDash(a.solution)}`,
        `## Kenapa Sekarang / Kenapa Kami\n${orDash(a.differentiator)}`,
        `## Sukses Terlihat Seperti\n${orDash(a.success)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  prfaq: {
    questions: [
      { id: "headline", label: "Headline press release", placeholder: "Apa bunyi pengumumannya?" },
      { id: "summary", label: "Ringkasan produk satu paragraf", placeholder: "Apa itu, untuk siapa, manfaatnya", multiline: true },
      { id: "customerQuote", label: "Kutipan pelanggan imajiner", placeholder: "Apa kata user yang bahagia?", multiline: true },
      { id: "faq", label: "Pertanyaan sulit & jawaban (Q: ... / A: ...)", placeholder: "Q: Kenapa ini sulit ditiru?\nA: ...", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# PRFAQ — ${name}`,
        `## Press Release\n### ${orDash(a.headline)}\n\n${orDash(a.summary)}\n\n> ${orDash(a.customerQuote)}`,
        `## FAQ\n${orDash(a.faq)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  prd: {
    questions: [
      { id: "background", label: "Latar belakang & konteks", placeholder: "Kenapa PRD ini ada? Keputusan fase sebelumnya yang relevan", multiline: true, help: "Ringkasan dari brief/PRFAQ/riset yang melandasi PRD ini." },
      { id: "goals", label: "Tujuan & metrik sukses", placeholder: "cth. 80% user menyelesaikan onboarding dalam <3 mnt", multiline: true },
      { id: "personas", label: "Persona pengguna (ringkas)", placeholder: "Siapa user utamanya?", multiline: true },
      { id: "scope", label: "In scope / Out of scope", placeholder: "In: ...\nOut: ...", multiline: true },
      { id: "requirements", label: "Functional requirements (satu per baris)", placeholder: "FR1: User bisa daftar dengan email\nFR2: ...", multiline: true },
      { id: "nfr", label: "Non-functional requirements", placeholder: "Performa, keamanan, aksesibilitas...", multiline: true },
      { id: "openQuestions", label: "Pertanyaan terbuka / asumsi berisiko", placeholder: "Satu per baris", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# PRD — ${name}`,
        `## Latar Belakang\n${orDash(a.background)}`,
        `## Tujuan & Metrik Sukses\n${orDash(a.goals)}`,
        `## Persona\n${orDash(a.personas)}`,
        `## Scope\n${orDash(a.scope)}`,
        `## Functional Requirements\n${list(a.requirements) || "—"}`,
        `## Non-Functional Requirements\n${orDash(a.nfr)}`,
        `## Pertanyaan Terbuka\n${list(a.openQuestions) || "—"}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  ux: {
    questions: [
      { id: "formFactor", label: "Form factor & platform", placeholder: "cth. Mobile-first responsive web" },
      { id: "uiSystem", label: "Sistem UI (jika ada)", placeholder: "cth. shadcn/ui, MUI, native" },
      { id: "users", label: "Konteks pengguna & skenario utama", placeholder: "Siapa, di mana, dalam situasi apa memakai ini?", multiline: true },
      { id: "design", label: "DESIGN.md — identitas visual (warna, tipografi, layout, do & don't)", placeholder: "Seperti apa tampilannya...", multiline: true },
      { id: "experience", label: "EXPERIENCE.md — IA, state, alur kunci, aksesibilitas", placeholder: "Bagaimana cara kerjanya...", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# UX — ${name}`,
        `**Form factor:** ${orDash(a.formFactor)}\n\n**Sistem UI:** ${orDash(a.uiSystem)}`,
        `## Konteks & Skenario Pengguna\n${orDash(a.users)}`,
        `## DESIGN.md — Identitas Visual\n${orDash(a.design)}`,
        `## EXPERIENCE.md — Perilaku & Alur\n${orDash(a.experience)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  architecture: {
    questions: [
      { id: "context", label: "Konteks & batasan dari PRD/UX", placeholder: "Keputusan hulu yang mengikat arsitektur ini", multiline: true },
      { id: "stack", label: "Tech stack & pilihan kunci", placeholder: "cth. Next.js 15, Postgres, deploy di Vercel", multiline: true },
      { id: "structure", label: "Struktur high-level / model data", placeholder: "Modul utama, service, entitas data...", multiline: true },
      { id: "decisions", label: "Keputusan kunci & trade-off (satu per baris)", placeholder: "Pilih X dibanding Y karena...", multiline: true },
      { id: "risks", label: "Risiko & mitigasi", placeholder: "Risiko → mitigasi", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Architecture — ${name}`,
        `## Konteks & Batasan\n${orDash(a.context)}`,
        `## Stack & Pilihan Kunci\n${orDash(a.stack)}`,
        `## Struktur & Model Data\n${orDash(a.structure)}`,
        `## Keputusan & Trade-off\n${list(a.decisions) || "—"}`,
        `## Risiko & Mitigasi\n${orDash(a.risks)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "epics-stories": {
    questions: [
      { id: "basis", label: "Basis dari PRD & arsitektur", placeholder: "Ringkasan keputusan hulu yang dipecah menjadi epic ini", multiline: true },
      { id: "epics", label: "Epic (satu per baris: Epic N — judul)", placeholder: "Epic 1 — Onboarding\nEpic 2 — Alur task inti", multiline: true },
      { id: "stories", label: "Story + acceptance criteria", placeholder: "As a user, I can ... so that ...\n  AC1: ...\n  AC2: ...", multiline: true },
    ],
    build: (a, name) => {
      const epics = (a.epics || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const machine = epics.length
        ? epics.map((e) => {
            const title = e.replace(/^Epic\s*\d+\s*[—–-]\s*/i, "").trim() || e;
            return `{"title": ${JSON.stringify(title)}, "epic": ${JSON.stringify(title)}, "detail": ""}`;
          })
        : [];
      return md([
        `# Epics & Stories — ${name}`,
        `## Basis (PRD & Arsitektur)\n${orDash(a.basis)}`,
        `## Epic\n${list(a.epics) || "—"}`,
        `## Stories\n${orDash(a.stories)}`,
        `## Machine Data (JANGAN DIHAPUS — dibaca papan Eksekusi)\n\`\`\`json tasks\n[${machine.join(",\n")}]\n\`\`\``,
        `_Generated with BMAD Studio · ${now()}_`,
      ]);
    },
  },
  "sprint-planning": {
    questions: [
      { id: "readiness", label: "Catatan readiness (apakah planning cukup lengkap?)", placeholder: "Gap yang ditemukan saat readiness gate...", multiline: true },
      { id: "epics", label: "Epic yang di-track (satu per baris)", placeholder: "Epic 1 — Onboarding\nEpic 2 — Alur task inti", multiline: true },
    ],
    build: (a, name) => {
      const epics = (a.epics || "").split("\n").filter(Boolean);
      const epicBlocks = epics
        .map((line, i) => {
          const title = line.replace(/^Epic\s*\d+\s*[—-]\s*/i, "").trim() || line;
          return `  epic-${i + 1}:\n    title: "${title}"\n    status: backlog\n    stories: []`;
        })
        .join("\n");
      return md([
        `# Sprint Planning — ${name}`,
        `## Readiness Notes\n${orDash(a.readiness)}`,
        `## Development Status\n\`\`\`yaml\ndevelopment_status:\n${epicBlocks || "  # (no epics defined yet)"}\n\`\`\``,
        `## Machine Data (JANGAN DIHAPUS — dibaca papan Eksekusi)\n\`\`\`json sprint\n{"name": "", "goal": "", "taskTitles": []}\n\`\`\``,
      ]);
    },
  },
  build: {
    questions: [
      { id: "story", label: "Story / perubahan yang dibangun", placeholder: "cth. Story 1.2 — User bisa membuat task", multiline: true },
      { id: "scope", label: "File yang disentuh & cakupan", placeholder: "Daftar file / modul yang diubah", multiline: true },
      { id: "approach", label: "Pendekatan implementasi", placeholder: "Logika kunci...", multiline: true },
      { id: "tests", label: "Test yang ditulis & hasilnya", placeholder: "Nama test + pass/fail", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Build Log — ${name}`,
        `## Story / Perubahan\n${orDash(a.story)}`,
        `## Cakupan\n${orDash(a.scope)}`,
        `## Pendekatan\n${orDash(a.approach)}`,
        `## Test\n${orDash(a.tests)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "code-review": {
    questions: [
      { id: "scope", label: "Apa yang di-review (file / PR)", placeholder: "cth. src/tasks/*.ts, PR #42", multiline: true },
      { id: "findings", label: "Temuan per severity", placeholder: "Blocker: ...\nMajor: ...\nMinor: ...", multiline: true },
      { id: "verdict", label: "Verdict", placeholder: "Approve / Request changes" },
    ],
    build: (a, name) =>
      md([
        `# Code Review — ${name}`,
        `**Scope:** ${orDash(a.scope)}\n\n**Verdict:** ${orDash(a.verdict)}`,
        `## Temuan\n${orDash(a.findings)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "qa-tests": {
    questions: [
      { id: "coverage", label: "Apa yang di-cover test", placeholder: "API endpoint, alur E2E kunci...", multiline: true },
      { id: "cases", label: "Kasus test (satu per baris)", placeholder: "E2E: signup → create task → lihat di list", multiline: true },
      { id: "results", label: "Hasil eksekusi", placeholder: "Pass/fail + catatan", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# QA Test Suite — ${name}`,
        `## Coverage\n${orDash(a.coverage)}`,
        `## Kasus\n${list(a.cases) || "—"}`,
        `## Hasil\n${orDash(a.results)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  retrospective: {
    questions: [
      { id: "wentWell", label: "Apa yang berjalan baik?", placeholder: "Satu per baris", multiline: true },
      { id: "improve", label: "Apa yang diperbaiki di epic berikutnya?", placeholder: "Satu per baris", multiline: true },
      { id: "actions", label: "Action item", placeholder: "Owner — action", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Retrospective — ${name}`,
        `## Berjalan Baik\n${list(a.wentWell) || "—"}`,
        `## Diperbaiki Berikutnya\n${list(a.improve) || "—"}`,
        `## Action Items\n${orDash(a.actions)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "party-mode": {
    questions: [
      { id: "topic", label: "Topik diskusi multi-agent", placeholder: "cth. Mobile-first atau desktop-first?", multiline: true },
      { id: "views", label: "Perspektif tiap agent", placeholder: "Mary (Analyst): ...\nWinston (Architect): ...", multiline: true },
      { id: "consensus", label: "Hasil akhir", placeholder: "Konsensus / pertanyaan terbuka", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Party Mode — ${name}`,
        `**Topik:** ${orDash(a.topic)}`,
        `## Perspektif\n${orDash(a.views)}`,
        `## Hasil\n${orDash(a.consensus)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "advanced-elicitation": {
    questions: [
      { id: "method", label: "Metode elisitasi", placeholder: "pre-mortem / first principles / red team / socratic" },
      { id: "subject", label: "Draft / bagian yang di-push", placeholder: "Apa yang diperbaiki?", multiline: true },
      { id: "improvements", label: "Improvement yang muncul", placeholder: "Satu per baris", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Advanced Elicitation — ${name}`,
        `**Metode:** ${orDash(a.method)}`,
        `## Subjek\n${orDash(a.subject)}`,
        `## Improvement\n${list(a.improvements) || "—"}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  review: {
    questions: [
      { id: "subject", label: "Apa yang di-review", placeholder: "cth. prd.md / branch feature-x", multiline: true },
      { id: "lens", label: "Lensa yang dipakai", placeholder: "adversarial / edge-case / verification-gap" },
      { id: "findings", label: "Temuan", placeholder: "Satu per baris + severity", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Review — ${name}`,
        `**Subjek:** ${orDash(a.subject)}\n\n**Lensa:** ${orDash(a.lens)}`,
        `## Temuan\n${list(a.findings) || "—"}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
  "correct-course": {
    questions: [
      { id: "change", label: "Perubahan / masalah signifikan", placeholder: "Apa yang berubah atau salah?", multiline: true },
      { id: "impact", label: "Dampak ke plan & artefak", placeholder: "Apa yang harus berubah downstream?", multiline: true },
      { id: "recommendation", label: "Rekomendasi", placeholder: "Restart / update PRD / redo arsitektur / sesuaikan story", multiline: true },
    ],
    build: (a, name) =>
      md([
        `# Correct Course — ${name}`,
        `## Perubahan / Masalah\n${orDash(a.change)}`,
        `## Dampak\n${orDash(a.impact)}`,
        `## Rekomendasi\n${orDash(a.recommendation)}`,
        `_Generated with BMAD Studio · ${now()}_`,
      ]),
  },
};
