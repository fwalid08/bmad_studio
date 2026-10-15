"use client";

import { STEPS, stepById } from "@/lib/bmad/roadmap";
import type { Project } from "@/lib/bmad/types";
import type { Settings } from "@/lib/bmad/types";

export type ContextMode = "full" | "retrieval";

export interface DraftContext {
  /** Ready-to-paste context block for the system prompt. */
  text: string;
  mode: ContextMode;
  stats?: { indexedChunks: number; retrieved: number; embedded: number };
  /** Set when retrieval was requested but fell back to the full context. */
  note?: string;
}

/** Old behaviour: ship every prior artifact, in roadmap order. */
export function fullContextText(project: Project): string {
  const order = STEPS.map((s) => s.id);
  const entries = Object.entries(project.artifacts)
    .filter(([, a]) => a.content.trim().length > 0)
    .sort(([a], [b]) => order.indexOf(a as never) - order.indexOf(b as never));

  if (!entries.length) {
    return `Project: ${project.name}. ${project.description}`;
  }
  const chain = entries
    .map(([stepId, a]) => `### ${stepById(stepId)?.name ?? stepId}\n${a.content.trim()}`)
    .join("\n\n");
  return `Project: ${project.name}. ${project.description}\n\nContext (prior BMAD artifacts, in order):\n${chain}`;
}

function retrievalText(
  project: Project,
  outline: Array<{ stepId: string; name: string; headings: string[]; summary: string }>,
  chunks: Array<{ stepId: string; name: string; heading: string; text: string; score: number }>
): string {
  const lines = [`Project: ${project.name}. ${project.description}`, ``];

  lines.push(`Prior BMAD artifacts (outline, in order):`);
  if (outline.length === 0) lines.push("- (none yet — this is the first draft)");
  for (const o of outline) {
    const head = o.headings.length ? o.headings.join(" › ") : "(untitled)";
    lines.push(`- ${o.name} — ${head}`);
    if (o.summary) lines.push(`  ${o.summary}`);
  }

  lines.push(``, `Most relevant excerpts for the step being drafted:`);
  if (chunks.length === 0) lines.push("- (no matching excerpts found)");
  for (const c of chunks) {
    const label = c.heading ? `${c.name} — ${c.heading}` : c.name;
    lines.push(`### ${label}\n${c.text}`);
  }
  return lines.join("\n");
}

/**
 * Build the prior-phase context for a draft turn.
 *
 * Retrieval mode embeds artifacts incrementally (server cache keyed by content
 * hash) and ships the outline + top-k chunks. Any failure — no provider,
 * embeddings endpoint unreachable, empty result — falls back to the full
 * context so drafting never breaks.
 */
export async function buildDraftContext(input: {
  project: Project;
  /** What we are drafting: used as the retrieval query. */
  query: string;
  settings: Settings;
}): Promise<DraftContext> {
  const { project, query, settings } = input;
  if ((settings.contextMode ?? "full") !== "retrieval") {
    return { text: fullContextText(project), mode: "full" };
  }

  const steps = Object.entries(project.artifacts)
    .filter(([, a]) => a.content.trim().length > 0)
    .map(([stepId, a]) => ({ stepId, name: stepById(stepId)?.name ?? stepId, content: a.content }));

  try {
    const res = await fetch("/api/ai/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        projectName: project.name,
        projectDescription: project.description,
        mode: "retrieval",
        model: settings.embeddingModel,
        providerId: settings.embeddingProviderId,
        query,
        steps,
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      outline?: Parameters<typeof retrievalText>[1];
      chunks?: Parameters<typeof retrievalText>[2];
      stats?: { indexedChunks: number; retrieved: number; embedded: number };
    };
    if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

    const text = retrievalText(project, json.outline ?? [], json.chunks ?? []);
    const empty = (json.chunks ?? []).length === 0 && steps.length > 0;
    return {
      text,
      mode: "retrieval",
      stats: json.stats,
      // First run has no index yet — the outline still lands, but nothing is
      // retrieved, so we also carry the full artifacts for this one turn.
      note: empty ? `Outline only (${steps.length} artifacts, no chunks matched yet)` : undefined,
    };
  } catch (e) {
    return {
      text: fullContextText(project),
      mode: "full",
      note: `Retrieval gagal (${e instanceof Error ? e.message : "unknown"}), pakai konteks penuh`,
    };
  }
}
