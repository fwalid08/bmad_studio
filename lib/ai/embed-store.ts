import "server-only";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cosine } from "@/lib/bmad/chunking";

// Server-side embedding index for draft context retrieval.
//
// ~/.config/bmad-studio/embeddings.json (mode 600), shape:
// {
//   "version": 1,
//   "providerId": "ollama",
//   "model": "bge-m3",
//   "chunks": {
//     "<projectId>:<stepId>:<index>": {
//       projectId, stepId, index, hash, heading, text, dim, vector, updatedAt
//     }
//   }
// }
//
// Storing the next step index (bge-m3 = 1024 dims) is ~8KB of JSON per chunk,
// which is fine for a local file and keeps retrieval instant without a daemon.

const CONFIG_DIR = join(homedir(), ".config", "bmad-studio");
const INDEX_FILE = join(CONFIG_DIR, "embeddings.json");

export interface StoredChunk {
  projectId: string;
  stepId: string;
  index: number;
  /** Hash of the artifact content this chunk came from. */
  hash: string;
  heading: string;
  text: string;
  dim: number;
  vector: number[];
  updatedAt: string;
}

export interface EmbedIndex {
  version: number;
  providerId?: string;
  model?: string;
  chunks: Record<string, StoredChunk>;
}

const EMPTY: EmbedIndex = { version: 1, chunks: {} };

export function chunkKey(projectId: string, stepId: string, index: number): string {
  return `${projectId}:${stepId}:${index}`;
}

function loadRaw(): EmbedIndex {
  try {
    if (!existsSync(INDEX_FILE)) return { ...EMPTY, chunks: {} };
    const parsed = JSON.parse(readFileSync(INDEX_FILE, "utf8")) as Partial<EmbedIndex>;
    const chunks = (parsed.chunks ?? {}) as Record<string, StoredChunk>;
    return { version: 1, providerId: parsed.providerId, model: parsed.model, chunks };
  } catch {
    return { ...EMPTY, chunks: {} };
  }
}

function saveRaw(index: EmbedIndex): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${INDEX_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(index), { mode: 0o600 });
  renameSync(tmp, INDEX_FILE);
  chmodSync(INDEX_FILE, 0o600);
}

export function loadEmbedIndex(): EmbedIndex {
  return loadRaw();
}

/** All stored chunks for one project step, in order. */
export function chunksForStep(index: EmbedIndex, projectId: string, stepId: string): StoredChunk[] {
  return Object.values(index.chunks)
    .filter((c) => c.projectId === projectId && c.stepId === stepId)
    .sort((a, b) => a.index - b.index);
}

/**
 * Replace one project step's chunks and return the index plus how many
 * embeddings are actually needed (unchanged chunks are reused).
 */
export function planStepChunks(
  index: EmbedIndex,
  input: {
    projectId: string;
    stepId: string;
    hash: string;
    prepared: Array<{ index: number; heading: string; text: string }>;
  }
): { index: EmbedIndex; toEmbed: typeof input.prepared; reused: number } {
  const next: EmbedIndex = { ...index, chunks: { ...index.chunks } };
  const prefix = `${input.projectId}:${input.stepId}:`;
  for (const key of Object.keys(next.chunks)) {
    if (key.startsWith(prefix)) delete next.chunks[key];
  }

  const existing = chunksForStep(index, input.projectId, input.stepId);
  const byIndex = new Map(existing.filter((c) => c.hash === input.hash).map((c) => [c.index, c]));
  const toEmbed: typeof input.prepared = [];
  const now = new Date().toISOString();

  for (const piece of input.prepared) {
    const reused = byIndex.get(piece.index);
    if (reused && reused.text === piece.text) {
      next.chunks[chunkKey(input.projectId, input.stepId, piece.index)] = reused;
      continue;
    }
    toEmbed.push(piece);
    // Vector filled in by the caller after the embedding call.
    next.chunks[chunkKey(input.projectId, input.stepId, piece.index)] = {
      projectId: input.projectId,
      stepId: input.stepId,
      index: piece.index,
      hash: input.hash,
      heading: piece.heading,
      text: piece.text,
      dim: 0,
      vector: [],
      updatedAt: now,
    };
  }

  return { index: next, toEmbed, reused: input.prepared.length - toEmbed.length };
}

/** Fill in vectors for chunks this run just embedded. */
export function commitVectors(
  index: EmbedIndex,
  projectId: string,
  stepId: string,
  vectors: number[][]
): void {
  let cursor = 0;
  for (const item of Object.values(index.chunks)) {
    if (item.projectId === projectId && item.stepId === stepId && item.vector.length === 0) {
      const v = vectors[cursor++];
      if (!v) continue;
      item.vector = v;
      item.dim = v.length;
      item.updatedAt = new Date().toISOString();
    }
  }
}

export function saveEmbedIndex(index: EmbedIndex): void {
  saveRaw(index);
}

/** Drop every chunk of one project (after delete or a full re-index). */
export function dropProject(index: EmbedIndex, projectId: string): EmbedIndex {
  const chunks: Record<string, StoredChunk> = {};
  for (const [key, chunk] of Object.entries(index.chunks)) {
    if (chunk.projectId !== projectId) chunks[key] = chunk;
  }
  return { ...index, chunks };
}

export interface IndexStats {
  chunks: number;
  projects: number;
  /** Chunks currently holding a usable vector. */
  embedded: number;
  dim: number;
}

export function indexStats(index: EmbedIndex = loadRaw()): IndexStats {
  const chunks = Object.values(index.chunks);
  const projects = new Set(chunks.map((c) => c.projectId));
  const embedded = chunks.filter((c) => c.vector.length > 0).length;
  return {
    chunks: chunks.length,
    projects: projects.size,
    embedded,
    dim: chunks.find((c) => c.vector.length > 0)?.dim ?? 0,
  };
}

export interface ScoredChunk {
  projectId: string;
  stepId: string;
  index: number;
  heading: string;
  text: string;
  score: number;
}

/**
 * Nearest chunks to a query vector, with a per-step cap so one huge artifact
 * cannot flood the prompt. Pass `projectId` to scope the search to one project
 * (recommended: chunks live in a shared index file).
 */
export function searchChunks(
  index: EmbedIndex,
  queryVector: number[],
  opts: {
    projectId?: string;
    topK?: number;
    maxPerStep?: number;
    allowedStepIds?: string[];
  } = {}
): ScoredChunk[] {
  const topK = opts.topK ?? 5;
  const maxPerStep = opts.maxPerStep ?? 2;
  const allowed = opts.allowedStepIds ? new Set(opts.allowedStepIds) : null;
  const scored: ScoredChunk[] = [];

  for (const c of Object.values(index.chunks)) {
    if (opts.projectId && c.projectId !== opts.projectId) continue;
    if (allowed && !allowed.has(c.stepId)) continue;
    if (c.vector.length === 0 || c.vector.length !== queryVector.length) continue;
    scored.push({
      projectId: c.projectId,
      stepId: c.stepId,
      index: c.index,
      heading: c.heading,
      text: c.text,
      score: cosine(queryVector, c.vector),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const perStep = new Map<string, number>();
  const picked: ScoredChunk[] = [];
  for (const candidate of scored) {
    const used = perStep.get(candidate.stepId) ?? 0;
    if (used >= maxPerStep) continue;
    perStep.set(candidate.stepId, used + 1);
    picked.push(candidate);
    if (picked.length >= topK) break;
  }
  return picked;
}
