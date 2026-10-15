import type { StepId } from "./types";

export function guidanceRequestMessage(stepId: StepId, stepName: string): string {
  const request = `Guide me through the "${stepName}" step.`;
  if (stepId !== "brainstorming") {
    return `${request} Ask the key questions and give me BMAD-style direction.`;
  }

  return [
    request,
    "This is a live conversation, not an artifact-writing request. Do not draft or format an artifact, and do not mention a filename.",
    "Reply directly to me in the language I used. Output exactly two short plain-text paragraphs: first, one warm sentence to open the session; second, one compound question asking what I want to brainstorm, why or what goal I have, and any useful context or constraints.",
    "Do not include a heading, list, explanation, process narration, emoji, or Markdown. Keep the entire reply under 60 words.",
  ].join("\n\n");
}

export function guidanceOutputRequirements(stepId: StepId): string {
  const shared =
    "Stay practical and specific to this step. Guide the user conversationally instead of writing the final artifact for them. Do not mention internal tool limitations or write files.";

  if (stepId === "brainstorming") {
    return [
      "Start the actual user-facing brainstorming session. Respond in the user's language as exactly two short plain-text paragraphs: first, one sentence reflecting the known topic or focus; second, one compound opening question asking what they want to brainstorm, why or what goal they have, and any useful context or constraints.",
      "If the project context already makes any of those clear, briefly confirm it and ask only for what's missing. Keep the whole response under 80 words.",
      "Do not use Markdown, headings, lists, emojis, preambles, generic guidance, or process narration. Do not mention internal reasoning, skills, tools, or future actions. Do not generate ideas unless the user explicitly requested autonomous ideation.",
      shared,
    ].join(" ");
  }

  return [
    `Output requirements: respond in Markdown, with clear sections, not vague rambling. Use short headings like "## Goal", "## Key questions", "## Recommended structure", and "## Draft outline".`,
    shared,
  ].join(" ");
}

export function normalizeAgentGuidance(
  stepName: string,
  raw: string,
  plainText = false
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return plainText ? "No guidance returned yet." : `## Guidance for ${stepName}\n\n- No guidance returned yet.`;
  }

  if (plainText) return trimmed;

  if (/^#{1,6}\s/m.test(trimmed)) {
    return trimmed;
  }

  return `## Guidance for ${stepName}\n\n${trimmed}`;
}
