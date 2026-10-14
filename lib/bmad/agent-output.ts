import type { StepId } from "./types";

export function guidanceOutputRequirements(stepId: StepId): string {
  const shared =
    "Stay practical and specific to this step. You are not writing the final artifact for the user automatically; you are making it easy to turn into a draft. Do not mention internal tool limitations. Do not write files. Do not omit the actual content the user needs to create.";

  if (stepId === "brainstorming") {
    return [
      "Output requirements: respond in Markdown and start the actual user-facing brainstorming session, not advice about how to run one.",
      "Use a concise heading equivalent to 'Brainstorming Session' in the user's language, a brief focus summary based only on known context, then one compound opening question about the topic or problem, the goal or why, and any inputs or constraints.",
      "If the project context already makes the topic and goal clear, confirm them briefly and ask only for missing information.",
      "Never narrate internal reasoning, skill or tool loading, or actions you intend to take. Do not include a numbered process checklist or generic guidance sections, and do not generate ideas unless the user explicitly requested autonomous ideation.",
      shared,
    ].join(" ");
  }

  return [
    `Output requirements: respond in Markdown, with clear sections, not vague rambling. Use short headings like "## Goal", "## Key questions", "## Recommended structure", and "## Draft outline".`,
    shared,
  ].join(" ");
}

export function normalizeAgentGuidance(stepName: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return `## Guidance for ${stepName}\n\n- No guidance returned yet.`;
  }

  if (/^#{1,6}\s/m.test(trimmed)) {
    return trimmed;
  }

  return `## Guidance for ${stepName}\n\n${trimmed}`;
}
