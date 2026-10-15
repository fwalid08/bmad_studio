import { NextResponse } from "next/server";
import { chunkMarkdown, markdownOutline, textHash } from "@/lib/bmad/chunking";
import { stepById, STEPS } from "@/lib/bmad/roadmap";
import {
  commitVectors,
  loadEmbedIndex,
  planStepChunks,
  saveEmbedIndex,
  searchChunks,
  type EmbedIndex,
} from "@/lib/ai/embed-store";
import { embedTexts } from "@/lib/ai/embeddings";

interface StepInput {
  stepId: string;
  name: string;
  content: string;
}

interface ContextBody {
  projectId: string;
  projectName?: string;
  projectDescription?: string;
  /** "full" ships every artifact; "retrieval" ships outline + top-k chunks. */
  mode?: "full" | "retrieval";
  model?: string;
  providerId?: string;
  topK?: number;
  query?: string;
  steps?: StepInput[];
}

/** Artifacts in roadmap order — keeps the context chain deterministic. */
function ordered(steps: StepInput[]): StepInput[] {
  const order = STEPS.map((s) => s.id);
  return steps
    .filter((s) => s.content && s.content.trim().length > 0)
    .sort((a, b) => order.indexOf(a.stepId as never) - order.indexOf(b.stepId as never));
}

function fullContext(body: ContextBody): string {
  const steps = ordered(body.steps ?? []);
  if (steps.length === 0) {
    return `Project: ${body.projectName ?? "this project"}. ${body.projectDescription ?? ""}`;
  }
  const chain = steps
    .map((s) => `### ${stepById(s.stepId)?.name ?? s.name ?? s.stepId}\n${s.content.trim()}`)
    .join("\n\n");
  return `Project: ${body.projectName ?? "this project"}. ${body.projectDescription ?? ""}\n\nContext (prior BMAD artifacts, in order):\n${chain}`;
}

/** Embed anything not yet indexed, then return the nearest chunks. */
async function retrieve(body: ContextBody) {
  const steps = ordered(body.steps ?? []);
  const model = body.model?.trim() || "bge-m3";
  if (steps.length === 0) {
    return { outline: [], chunks: [], stats: { indexedChunks: 0, retrieved: 0, embedded: 0 } };
  }

  let index: EmbedIndex = loadEmbedIndex();
  index = { ...index, providerId: body.providerId, model };

  let embeddedThisRun = 0;

  for (const step of steps) {
    const hash = textHash(step.content.trim());
    const prepared = chunkMarkdown(step.content.trim()).map((c) => ({
      index: c.index,
      heading: c.heading,
      text: c.text,
    }));
    const plan = planStepChunks(index, {
      projectId: body.projectId,
      stepId: step.stepId,
      hash,
      prepared,
    });
    index = plan.index;

    if (plan.toEmbed.length > 0) {
      const { vectors } = await embedTexts({
        providerId: body.providerId,
        model,
        texts: plan.toEmbed.map((c) => c.text),
      });
      commitVectors(index, body.projectId, step.stepId, vectors);
      embeddedThisRun += plan.toEmbed.length;
    }
  }

  saveEmbedIndex(index);

  // Remove artifacts that vanished (empty content or deleted project steps).
  for (const stale of Object.values({ ...index.chunks })) {
    if (
      stale.projectId === body.projectId &&
      !steps.some((s) => s.stepId === stale.stepId)
    ) {
      delete index.chunks[chunkKeyOf(stale)];
    }
  }
  saveEmbedIndex(index);

  const outline = steps.map((s) => {
    const o = markdownOutline(s.content);
    return {
      stepId: s.stepId,
      name: stepById(s.stepId)?.name ?? s.name ?? s.stepId,
      headings: o.headings.slice(0, 8),
      summary: o.summary,
    };
  });

  const query = body.query?.trim() || steps.map((s) => s.name).join(". ");
  let chunks: ReturnType<typeof searchChunks> = [];
  try {
    const { vectors } = await embedTexts({
      providerId: body.providerId,
      model,
      texts: [query],
    });
    if (vectors[0]?.length) {
      chunks = searchChunks(index, vectors[0], {
        projectId: body.projectId,
        topK: body.topK ?? 5,
        maxPerStep: 2,
        allowedStepIds: steps.map((s) => s.stepId),
      });
    }
  } catch {
    // Query embedding failed: outline alone is still useful context.
  }

  return {
    outline,
    chunks: chunks.map((c) => ({ ...c, name: stepById(c.stepId)?.name ?? c.stepId })),
    stats: {
      indexedChunks: Object.keys(index.chunks).length,
      retrieved: chunks.length,
      embedded: embeddedThisRun,
    },
  };
}

function chunkKeyOf(chunk: { projectId: string; stepId: string; index: number }): string {
  return `${chunk.projectId}:${chunk.stepId}:${chunk.index}`;
}

// POST /api/ai/context — build the prior-phase context block for a draft turn.
// mode "full" keeps the old behaviour (ship every artifact); "retrieval"
// embeds artifacts incrementally (cached by content hash) and ships only the
// always-on outline plus the top-k most relevant chunks.
export async function POST(request: Request) {
  let body: ContextBody;
  try {
    body = (await request.json()) as ContextBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.projectId?.trim()) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  try {
    if ((body.mode ?? "full") === "full") {
      return NextResponse.json({ ok: true, mode: "full", full: fullContext(body) });
    }
    const result = await retrieve(body);
    return NextResponse.json({ ok: true, mode: "retrieval", ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build context";
    // 400 for local misconfiguration, 502 for provider failures.
    const status = /^(No Direct|Multiple Direct|Direct AI provider)/.test(message) ? 400 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
