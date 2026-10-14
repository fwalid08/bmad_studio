import type { PhaseId, StepId, ProjectScale } from "./types";

export interface RoadmapStep {
  id: StepId;
  name: string;
  code: string;
  skill: string;
  description: string;
  phase: PhaseId;
  precededBy: StepId[];
  required: boolean;
  output: string;
  leadAgent: string;
  minScale: ProjectScale;
}

export interface RoadmapPhase {
  id: PhaseId;
  name: string;
  tagline: string;
  icon: string;
  steps: StepId[];
}

export const STEPS: RoadmapStep[] = [
  {
    id: "brainstorming",
    name: "Brainstorming",
    code: "BSP",
    skill: "bmad-brainstorming",
    description:
      "Guided idea-generation session using one or more brainstorming techniques. Use early in ideation or when stuck.",
    phase: "clarify",
    precededBy: [],
    required: false,
    output: "brainstorming-session.md",
    leadAgent: "mary",
    minScale: "express",
  },
  {
    id: "forge-idea",
    name: "Forge Idea",
    code: "FI",
    skill: "bmad-forge-idea",
    description:
      "Pressure-test a half-formed idea through probing questions until you can act on it or drop it with confidence.",
    phase: "clarify",
    precededBy: ["brainstorming"],
    required: false,
    output: "forged-idea.md",
    leadAgent: "mary",
    minScale: "express",
  },
  {
    id: "deep-recon",
    name: "Deep Recon",
    code: "RS",
    skill: "bmad-deep-recon",
    description:
      "Research a topic to support a decision — market, domain, technical, competitive, or user-voice.",
    phase: "clarify",
    precededBy: [],
    required: false,
    output: "research-report.md",
    leadAgent: "mary",
    minScale: "light",
  },
  {
    id: "project-context",
    name: "Project Context",
    code: "PC",
    skill: "bmad-project-context",
    description:
      "Set up the repo's agent instructions (AGENTS.md) with verified commands, policy, and conventions. Best for existing codebases.",
    phase: "plan",
    precededBy: [],
    required: false,
    output: "AGENTS.md",
    leadAgent: "winston",
    minScale: "light",
  },
  {
    id: "product-brief",
    name: "Product Brief",
    code: "CB",
    skill: "bmad-product-brief",
    description:
      "A guided conversation that captures your product idea in a brief. A gentler alternative to the PRFAQ.",
    phase: "plan",
    precededBy: [],
    required: false,
    output: "product-brief.md",
    leadAgent: "mary",
    minScale: "express",
  },
  {
    id: "prfaq",
    name: "PRFAQ Challenge",
    code: "WB",
    skill: "bmad-prfaq",
    description:
      "Amazon's Working Backwards method: write the press release first, then answer hard questions to test the concept.",
    phase: "plan",
    precededBy: [],
    required: false,
    output: "prfaq.md",
    leadAgent: "john",
    minScale: "light",
  },
  {
    id: "prd",
    name: "PRD",
    code: "PRD",
    skill: "bmad-prd",
    description:
      "Create a PRD through guided discovery. Pins down what to build and why, at the right level of rigor.",
    phase: "plan",
    precededBy: ["product-brief", "prfaq"],
    required: true,
    output: "prd.md",
    leadAgent: "john",
    minScale: "light",
  },
  {
    id: "ux",
    name: "UX Design",
    code: "CU",
    skill: "bmad-ux",
    description:
      "Capture UX decisions into DESIGN.md (how it looks) and EXPERIENCE.md (how it works). Strongly recommended when a UI is central.",
    phase: "plan",
    precededBy: ["prd"],
    required: false,
    output: "design-experience.md",
    leadAgent: "sally",
    minScale: "light",
  },
  {
    id: "architecture",
    name: "Architecture",
    code: "CA",
    skill: "bmad-architecture",
    description:
      "Record the architecture decisions that keep features, epics, and stories consistent. Scales from a few decisions to a full design.",
    phase: "plan",
    precededBy: ["prd", "ux"],
    required: true,
    output: "architecture.md",
    leadAgent: "winston",
    minScale: "light",
  },
  {
    id: "epics-stories",
    name: "Epics & Stories",
    code: "CE",
    skill: "bmad-create-epics-and-stories",
    description:
      "Break the PRD and architecture into epics and user stories with complete acceptance criteria.",
    phase: "plan",
    precededBy: ["architecture"],
    required: true,
    output: "epics.md",
    leadAgent: "john",
    minScale: "light",
  },
  {
    id: "sprint-planning",
    name: "Sprint Planning",
    code: "SP",
    skill: "bmad-sprint-planning",
    description:
      "Check planning is complete enough to implement (PASS/CONCERNS/FAIL), then generate the sprint status file.",
    phase: "plan",
    precededBy: ["epics-stories"],
    required: true,
    output: "sprint-status.yaml",
    leadAgent: "winston",
    minScale: "light",
  },
  {
    id: "build",
    name: "Build",
    code: "BD",
    skill: "bmad-build",
    description:
      "The standard implementation flow: clarify intent, plan, implement, review, and present working code.",
    phase: "ship",
    precededBy: ["sprint-planning"],
    required: true,
    output: "build-log.md",
    leadAgent: "amelia",
    minScale: "express",
  },
  {
    id: "code-review",
    name: "Code Review",
    code: "CR",
    skill: "bmad-code-review",
    description:
      "Review code changes with several independent reviewers, then triage and present the findings.",
    phase: "ship",
    precededBy: ["build"],
    required: false,
    output: "code-review.md",
    leadAgent: "amelia",
    minScale: "express",
  },
  {
    id: "qa-tests",
    name: "QA E2E Tests",
    code: "QA",
    skill: "bmad-qa-generate-e2e-tests",
    description:
      "Generate automated API and end-to-end tests for implemented code.",
    phase: "ship",
    precededBy: ["build"],
    required: false,
    output: "test-suite.md",
    leadAgent: "amelia",
    minScale: "light",
  },
  {
    id: "retrospective",
    name: "Retrospective",
    code: "ER",
    skill: "bmad-retrospective",
    description:
      "Optional at the end of an epic: review completed work and lessons learned, and look ahead to the next epic.",
    phase: "ship",
    precededBy: ["code-review"],
    required: false,
    output: "retrospective.md",
    leadAgent: "john",
    minScale: "full",
  },
  {
    id: "party-mode",
    name: "Party Mode",
    code: "PM",
    skill: "bmad-party-mode",
    description:
      "Orchestrate multi-agent discussions when you need multiple perspectives or want agents to collaborate.",
    phase: "anytime",
    precededBy: [],
    required: false,
    output: "party-mode.md",
    leadAgent: "mary",
    minScale: "express",
  },
  {
    id: "advanced-elicitation",
    name: "Advanced Elicitation",
    code: "AE",
    skill: "bmad-advanced-elicitation",
    description:
      "Push a draft past its first version with methods like pre-mortem, first principles, red team, or socratic questioning.",
    phase: "anytime",
    precededBy: [],
    required: false,
    output: "elicitation-notes.md",
    leadAgent: "john",
    minScale: "express",
  },
  {
    id: "review",
    name: "Review",
    code: "RV",
    skill: "bmad-review",
    description:
      "Review anything before it ships — a document, diff, or branch — with adversarial, edge-case, and verification lenses.",
    phase: "anytime",
    precededBy: [],
    required: false,
    output: "review-findings.md",
    leadAgent: "amelia",
    minScale: "express",
  },
  {
    id: "correct-course",
    name: "Correct Course",
    code: "CC",
    skill: "bmad-correct-course",
    description:
      "Assess a significant mid-sprint change and recommend the right corrective action.",
    phase: "anytime",
    precededBy: [],
    required: false,
    output: "change-proposal.md",
    leadAgent: "john",
    minScale: "express",
  },
];

export const PHASES: RoadmapPhase[] = [
  {
    id: "clarify",
    name: "Clarify",
    tagline: "Optional core — sharpen the idea before committing.",
    icon: "🧭",
    steps: ["brainstorming", "forge-idea", "deep-recon"],
  },
  {
    id: "plan",
    name: "Plan",
    tagline: "Decide what to build and how it holds together.",
    icon: "📐",
    steps: [
      "project-context",
      "product-brief",
      "prfaq",
      "prd",
      "ux",
      "architecture",
      "epics-stories",
      "sprint-planning",
    ],
  },
  {
    id: "ship",
    name: "Ship",
    tagline: "Turn the plan into working, verified software.",
    icon: "🚀",
    steps: ["build", "code-review", "qa-tests", "retrospective"],
  },
  {
    id: "anytime",
    name: "Anytime",
    tagline: "Helpers available regardless of workflow state.",
    icon: "🧰",
    steps: ["party-mode", "advanced-elicitation", "review", "correct-course"],
  },
];

const SCALE_ORDER: Record<ProjectScale, number> = {
  express: 0,
  light: 1,
  full: 2,
};

export function stepsForScale(scale: ProjectScale): RoadmapStep[] {
  const max = SCALE_ORDER[scale];
  return STEPS.filter((s) => SCALE_ORDER[s.minScale] <= max);
}

export function requiredSteps(): RoadmapStep[] {
  return STEPS.filter((s) => s.required);
}

export function stepById(id: string): RoadmapStep | undefined {
  return STEPS.find((s) => s.id === id);
}

export function phaseOfStep(id: StepId): PhaseId {
  return stepById(id)?.phase ?? "anytime";
}
