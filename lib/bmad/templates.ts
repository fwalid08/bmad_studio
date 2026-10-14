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

const list = (v?: string) => (v || "").split("\n").filter(Boolean).map((l) => `- ${l}`).join("\n");

export const TEMPLATES: Record<StepId, StepTemplate> = {
  brainstorming: {
    questions: [
      { id: "topic", label: "What topic or problem are we brainstorming?", placeholder: "e.g. A habit-tracking app for busy parents", multiline: true },
      { id: "constraints", label: "Any hard constraints? (time, budget, platform)", placeholder: "e.g. Must run on mobile web, 4-week timeline" },
      { id: "ideas", label: "Ideas generated (one per line)", placeholder: "Idea 1\nIdea 2\nIdea 3", multiline: true },
    ],
    build: (a, name) => md([`# Brainstorming Session — ${name}`, `**Topic:** ${a.topic || "—"}\n\n**Constraints:** ${a.constraints || "—"}`, `## Ideas`, list(a.ideas), `_Generated with BMAD Studio · ${now()}_`]),
  },
  "forge-idea": {
    questions: [
      { id: "idea", label: "State the idea in one sentence", placeholder: "e.g. An app that turns voice notes into structured tasks", multiline: true },
      { id: "assumptions", label: "Key assumptions you're making (one per line)", placeholder: "Users prefer voice over typing\nPeople will pay for organization", multiline: true },
      { id: "weakpoints", label: "Weak points the personas probed", placeholder: "What breaks if the assumption is wrong?", multiline: true },
      { id: "verdict", label: "Verdict", placeholder: "Act on it / Rework it / Drop it — and why", multiline: true },
    ],
    build: (a, name) => md([`# Forged Idea — ${name}`, `**Idea:** ${a.idea || "—"}`, `## Assumptions`, list(a.assumptions), `## Weak Points`, a.weakpoints || "—", `## Verdict`, a.verdict || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "deep-recon": {
    questions: [
      { id: "type", label: "Research type", placeholder: "market / domain / technical / competitive / user-voice" },
      { id: "question", label: "The decision this research supports", placeholder: "What are you trying to decide?", multiline: true },
      { id: "findings", label: "Findings (with sources)", placeholder: "Finding 1 — [source]\nFinding 2 — [source]", multiline: true },
    ],
    build: (a, name) => md([`# Research Report — ${name}`, `**Type:** ${a.type || "—"}\n\n**Decision supported:** ${a.question || "—"}`, `## Findings`, a.findings || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "project-context": {
    questions: [
      { id: "commands", label: "Verified commands (install/test/build)", placeholder: "bun install\nbun test\nbun run build", multiline: true },
      { id: "conventions", label: "Conventions that differ from defaults", placeholder: "e.g. Use bun not npm; tabs not spaces", multiline: true },
      { id: "pitfalls", label: "Known pitfalls", placeholder: "e.g. Never edit dist/ directly", multiline: true },
    ],
    build: (a, name) => md([`# Project Context — ${name}`, `## Verified Commands`, "```bash\n" + (a.commands || "—") + "\n```", `## Conventions`, a.conventions || "—", `## Pitfalls`, a.pitfalls || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "product-brief": {
    questions: [
      { id: "problem", label: "What problem are you solving?", placeholder: "Describe the pain in the user's words", multiline: true },
      { id: "audience", label: "Who feels this problem most?", placeholder: "Target users / early adopters", multiline: true },
      { id: "solution", label: "Your proposed solution (one paragraph)", placeholder: "What will you build?", multiline: true },
      { id: "differentiator", label: "Why now, and why you?", placeholder: "What makes this timely and yours?", multiline: true },
    ],
    build: (a, name) => md([`# Product Brief — ${name}`, `## Problem`, a.problem || "—", `## Audience`, a.audience || "—", `## Solution`, a.solution || "—", `## Why Now / Why Us`, a.differentiator || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  prfaq: {
    questions: [
      { id: "headline", label: "Press release headline", placeholder: "What would the announcement say?" },
      { id: "summary", label: "One-paragraph product summary", placeholder: "What it is, who it's for, the benefit", multiline: true },
      { id: "customerQuote", label: "Imagined customer quote", placeholder: "What would a happy user say?", multiline: true },
      { id: "faq", label: "Hard questions & answers (Q: ... / A: ...)", placeholder: "Q: Why is this hard to copy?\nA: ...", multiline: true },
    ],
    build: (a, name) => md([`# PRFAQ — ${name}`, `## Press Release`, `### ${a.headline || "—"}`, a.summary || "—", `> ${a.customerQuote || "—"}`, `## FAQ`, a.faq || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  prd: {
    questions: [
      { id: "goals", label: "Goals & success metrics", placeholder: "e.g. 80% of users complete onboarding in <3 min", multiline: true },
      { id: "personas", label: "User personas (brief)", placeholder: "Who are the primary users?", multiline: true },
      { id: "scope", label: "In scope / Out of scope", placeholder: "In: ...\nOut: ...", multiline: true },
      { id: "requirements", label: "Functional requirements (one per line)", placeholder: "FR1: Users can sign up with email\nFR2: ...", multiline: true },
      { id: "nfr", label: "Non-functional requirements", placeholder: "Performance, security, accessibility...", multiline: true },
    ],
    build: (a, name) => md([`# PRD — ${name}`, `## Goals & Success Metrics`, a.goals || "—", `## Personas`, a.personas || "—", `## Scope`, a.scope || "—", `## Functional Requirements`, list(a.requirements), `## Non-Functional Requirements`, a.nfr || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  ux: {
    questions: [
      { id: "formFactor", label: "Form factor & platform", placeholder: "e.g. Mobile-first responsive web" },
      { id: "uiSystem", label: "UI system (if any)", placeholder: "e.g. shadcn/ui, MUI, native" },
      { id: "design", label: "DESIGN.md — visual identity (colors, type, layout, do's & don'ts)", placeholder: "How it looks...", multiline: true },
      { id: "experience", label: "EXPERIENCE.md — IA, states, key flows, accessibility", placeholder: "How it works...", multiline: true },
    ],
    build: (a, name) => md([`# UX — ${name}`, `**Form factor:** ${a.formFactor || "—"}\n\n**UI system:** ${a.uiSystem || "—"}`, `## DESIGN.md — Visual Identity`, a.design || "—", `## EXPERIENCE.md — Behavior & Flows`, a.experience || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  architecture: {
    questions: [
      { id: "stack", label: "Tech stack & key choices", placeholder: "e.g. Next.js 15, Postgres, deployed on Vercel", multiline: true },
      { id: "decisions", label: "Key decisions & trade-offs (one per line)", placeholder: "Chose X over Y because...", multiline: true },
      { id: "structure", label: "High-level structure / data model", placeholder: "Main modules, services, data entities...", multiline: true },
      { id: "risks", label: "Risks & mitigations", placeholder: "Risk → mitigation", multiline: true },
    ],
    build: (a, name) => md([`# Architecture — ${name}`, `## Stack & Key Choices`, a.stack || "—", `## Decisions & Trade-offs`, list(a.decisions), `## Structure`, a.structure || "—", `## Risks & Mitigations`, a.risks || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "epics-stories": {
    questions: [
      { id: "epics", label: "Epics (one per line: Epic N — title)", placeholder: "Epic 1 — Onboarding\nEpic 2 — Core task flow", multiline: true },
      { id: "stories", label: "Stories with acceptance criteria", placeholder: "As a user, I can ... so that ...\n  AC1: ...\n  AC2: ...", multiline: true },
    ],
    build: (a, name) => md([`# Epics & Stories — ${name}`, `## Epics`, list(a.epics), `## Stories`, a.stories || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "sprint-planning": {
    questions: [
      { id: "readiness", label: "Readiness notes (is planning complete enough?)", placeholder: "Gaps found during the readiness gate...", multiline: true },
      { id: "epics", label: "Epics to track (one per line)", placeholder: "Epic 1 — Onboarding\nEpic 2 — Core task flow", multiline: true },
    ],
    build: (a, name) => {
      const epics = (a.epics || "").split("\n").filter(Boolean);
      const epicBlocks = epics.map((line, i) => {
        const title = line.replace(/^Epic\s*\d+\s*[—-]\s*/i, "").trim() || line;
        return `  epic-${i + 1}:\n    title: "${title}"\n    status: backlog\n    stories: []`;
      }).join("\n");
      return md([`# generated: ${now()}`, `# project: ${name}`, `# readiness: ${a.readiness ? "see notes" : "not assessed"}`, `development_status:`, epicBlocks || "  # (no epics defined yet)", a.readiness ? `## Readiness Notes\n${a.readiness}` : ""]);
    },
  },
  build: {
    questions: [
      { id: "story", label: "Story / change being built", placeholder: "e.g. Story 1.2 — User can create a task", multiline: true },
      { id: "approach", label: "Implementation approach", placeholder: "Files touched, key logic...", multiline: true },
      { id: "tests", label: "Tests written & results", placeholder: "Test names + pass/fail", multiline: true },
    ],
    build: (a, name) => md([`# Build Log — ${name}`, `## Story / Change`, a.story || "—", `## Approach`, a.approach || "—", `## Tests`, a.tests || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "code-review": {
    questions: [
      { id: "scope", label: "What was reviewed (files / PR)", placeholder: "e.g. src/tasks/*.ts, PR #42", multiline: true },
      { id: "findings", label: "Findings by severity", placeholder: "Blocker: ...\nMajor: ...\nMinor: ...", multiline: true },
      { id: "verdict", label: "Verdict", placeholder: "Approve / Request changes" },
    ],
    build: (a, name) => md([`# Code Review — ${name}`, `**Scope:** ${a.scope || "—"}\n\n**Verdict:** ${a.verdict || "—"}`, `## Findings`, a.findings || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "qa-tests": {
    questions: [
      { id: "coverage", label: "What the tests cover", placeholder: "API endpoints, key E2E flows...", multiline: true },
      { id: "cases", label: "Test cases (one per line)", placeholder: "E2E: signup → create task → see it in list", multiline: true },
    ],
    build: (a, name) => md([`# QA Test Suite — ${name}`, `## Coverage`, a.coverage || "—", `## Cases`, list(a.cases), `_Generated with BMAD Studio · ${now()}_`]),
  },
  retrospective: {
    questions: [
      { id: "wentWell", label: "What went well?", placeholder: "One per line", multiline: true },
      { id: "improve", label: "What to improve next epic?", placeholder: "One per line", multiline: true },
      { id: "actions", label: "Action items", placeholder: "Owner — action", multiline: true },
    ],
    build: (a, name) => md([`# Retrospective — ${name}`, `## Went Well`, list(a.wentWell), `## To Improve`, list(a.improve), `## Action Items`, a.actions || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "party-mode": {
    questions: [
      { id: "topic", label: "Topic for the multi-agent discussion", placeholder: "e.g. Should we build mobile-first or desktop-first?", multiline: true },
      { id: "views", label: "Each agent's perspective", placeholder: "Mary (Analyst): ...\nWinston (Architect): ...", multiline: true },
      { id: "consensus", label: "Where they landed", placeholder: "Consensus / open question", multiline: true },
    ],
    build: (a, name) => md([`# Party Mode — ${name}`, `**Topic:** ${a.topic || "—"}`, `## Perspectives`, a.views || "—", `## Outcome`, a.consensus || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
  "advanced-elicitation": {
    questions: [
      { id: "method", label: "Elicitation method", placeholder: "pre-mortem / first principles / red team / socratic" },
      { id: "subject", label: "Draft or section being pushed", placeholder: "What are we improving?", multiline: true },
      { id: "improvements", label: "Improvements surfaced", placeholder: "One per line", multiline: true },
    ],
    build: (a, name) => md([`# Advanced Elicitation — ${name}`, `**Method:** ${a.method || "—"}`, `## Subject`, a.subject || "—", `## Improvements`, list(a.improvements), `_Generated with BMAD Studio · ${now()}_`]),
  },
  review: {
    questions: [
      { id: "subject", label: "What is being reviewed", placeholder: "e.g. prd.md / branch feature-x", multiline: true },
      { id: "lens", label: "Lens(es) applied", placeholder: "adversarial / edge-case / verification-gap" },
      { id: "findings", label: "Findings", placeholder: "One per line with severity", multiline: true },
    ],
    build: (a, name) => md([`# Review — ${name}`, `**Subject:** ${a.subject || "—"}\n\n**Lens:** ${a.lens || "—"}`, `## Findings`, list(a.findings), `_Generated with BMAD Studio · ${now()}_`]),
  },
  "correct-course": {
    questions: [
      { id: "change", label: "The significant change / problem", placeholder: "What changed or went wrong?", multiline: true },
      { id: "impact", label: "Impact on plan & artifacts", placeholder: "What needs to change downstream?", multiline: true },
      { id: "recommendation", label: "Recommendation", placeholder: "Restart / update PRD / redo architecture / adjust stories", multiline: true },
    ],
    build: (a, name) => md([`# Correct Course — ${name}`, `## Change / Problem`, a.change || "—", `## Impact`, a.impact || "—", `## Recommendation`, a.recommendation || "—", `_Generated with BMAD Studio · ${now()}_`]),
  },
};
