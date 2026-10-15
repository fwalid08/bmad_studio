/**
 * End-to-end probe for /api/ai/context.
 *
 * Runs in its OWN process (spawned by route.test.ts with a throwaway HOME) so
 * the real ~/.config/bmad-studio files are never touched — bun caches
 * homedir() at startup, so HOME must come from the environment, not from
 * process.env assignment inside a running test.
 *
 * Starts a stub OpenAI-compatible /embeddings endpoint, points a Direct AI
 * provider at it, then exercises the route and prints one JSON line.
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

// The spawning test passes a throwaway HOME; fall back to this dir if absent.
const home = process.env.HOME ?? require("node:os").tmpdir();
const configDir = join(home, ".config", "bmad-studio");
mkdirSync(configDir, { recursive: true });

let failure: { status: number; message: string } | null = null;
const embedCalls: string[] = [];

/** Deterministic keyword-bucket "embedding" (8 dims). */
function embed(text: string): number[] {
  const v = new Array(8).fill(0);
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!word) continue;
    let h = 0;
    for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) % 9973;
    v[h % 8] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}") as { model: string; input: string[] };
    embedCalls.push(...parsed.input);
    if (failure) {
      res.writeHead(failure.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: failure.message } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: parsed.input.map((t) => ({ embedding: embed(t) })) }));
  });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;

writeFileSync(
  join(configDir, "direct.json"),
  JSON.stringify({
    defaultProvider: "stub",
    providers: { stub: { baseUrl: `http://127.0.0.1:${port}/v1`, model: "bge-m3" } },
  }),
  { mode: 0o600 }
);

const { POST } = await import("@/app/api/ai/context/route");
const { loadEmbedIndex } = await import("@/lib/ai/embed-store");

const indexFile = join(configDir, "embeddings.json");

type Outcome = { status: number; body: Record<string, unknown> };

async function post(body: Record<string, unknown>): Promise<Outcome> {
  const res = await POST(
    new Request("http://localhost/api/ai/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const steps = [
  {
    stepId: "prd",
    name: "PRD",
    content:
      "# PRD\n\n## Goals & Success Metrics\n80% of users complete onboarding in under three minutes.\n\n## Functional Requirements\nFR1: Users can sign up with email\nFR2: Users can create a task",
  },
  {
    stepId: "architecture",
    name: "Architecture",
    content:
      "# Architecture\n\n## Stack\nNext.js 15, Postgres, deployed on Vercel.\n\n## Decisions\nPrefer boring technology for stability.",
  },
];

const results: Record<string, unknown> = {};
const stats: Record<string, number> = {};

// 1. full mode ships every artifact.
results.full = await post({ projectId: "p-full", projectName: "Demo", mode: "full", steps });

// 2. retrieval mode with a cold index → every chunk is embedded.
embedCalls.length = 0;
results.retrieval = await post({
  projectId: "p-r",
  projectName: "Demo",
  mode: "retrieval",
  query: "write functional requirements and onboarding goals",
  steps,
});
stats.coldEmbedCalls = embedCalls.length;
results.indexExists = existsSync(indexFile);
stats.indexChunks = Object.keys(loadEmbedIndex().chunks).length;
results.indexPerms = existsSync(indexFile)
  ? (statSync(indexFile).mode & 0o777).toString(8)
  : null;

// 3. Warm index → only the query gets embedded.
embedCalls.length = 0;
results.warm = await post({
  projectId: "p-r",
  mode: "retrieval",
  query: "something completely different",
  steps,
});
stats.warmEmbedCalls = embedCalls.length;

// 4. Edited artifact → its chunks are re-embedded.
embedCalls.length = 0;
results.edited = await post({
  projectId: "p-r",
  mode: "retrieval",
  query: "functional requirements",
  steps: steps.map((s) =>
    s.stepId === "prd"
      ? { ...s, content: s.content + "\n\n## New Section\nFreshly added requirement text." }
      : s
  ),
});
stats.editedEmbedCalls = embedCalls.length;

// 5. Only-empty artifacts.
results.empty = await post({
  projectId: "p-empty",
  mode: "retrieval",
  steps: [{ stepId: "prd", name: "PRD", content: "   " }],
});

// 6. Provider failure surfaces a readable 502.
failure = { status: 500, message: "model bge-m3 not found" };
results.failure = await post({ projectId: "p-fail", mode: "retrieval", steps });
failure = null;

// 7. Chunks of a removed artifact are dropped from the index.
results.stale = await post({
  projectId: "p-r",
  mode: "retrieval",
  query: "architecture decisions",
  steps: [steps[1]],
});
stats.staleAfter = Object.keys(loadEmbedIndex().chunks).filter((k) => k.startsWith("p-r:prd")).length;

// 8. Validation.
results.missingProjectId = await post({ mode: "full", steps });

server.close();
process.stdout.write(JSON.stringify({ ...results, stats }));
process.exit(0);
