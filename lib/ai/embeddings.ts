import "server-only";
import { resolveDirectProvider } from "./server";

// Embedding calls go to the SAME Direct AI provider already configured in
// Settings (OpenAI-compatible /embeddings). bge-m3 via Ollama
// (http://127.0.0.1:11434/v1) is the intended target: 1024 dims, 8192-token
// context, no API key needed for a local Ollama.

export interface EmbeddingResult {
  vectors: number[][];
  dim: number;
  providerId: string;
  model: string;
}

function parseEmbeddingPayload(body: unknown): number[][] {
  const b = body as { data?: unknown[]; embedding?: unknown } | null;
  if (Array.isArray(b?.data)) {
    const rows = b.data.map((d) => (d as { embedding?: unknown })?.embedding);
    if (rows.every((r) => Array.isArray(r))) return rows as number[][];
  }
  if (Array.isArray(b?.embedding)) return [b.embedding as number[]];
  throw new Error("Provider returned an unexpected embeddings payload.");
}

async function oneCall(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: string[],
  timeoutMs: number
): Promise<number[][]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/embeddings`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey.trim() ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input, encoding_format: "float" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(`Embedding request failed: ${e instanceof Error ? e.message : "network error"}`);
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      error?: { message?: unknown } | string;
    } | null;
    const message =
      (typeof detail?.error === "string" ? detail.error : detail?.error?.message) ?? res.statusText;
    throw new Error(`Embedding provider error (HTTP ${res.status}): ${String(message).slice(0, 300)}`);
  }
  return parseEmbeddingPayload(await res.json().catch(null) as never);
}

/** Embed texts with the configured Direct AI provider. */
export async function embedTexts(input: {
  providerId?: string;
  model?: string;
  texts: string[];
  timeoutMs?: number;
}): Promise<EmbeddingResult> {
  const texts = input.texts.filter((t) => t.trim().length > 0);
  if (texts.length === 0) return { vectors: [], dim: 0, providerId: "", model: "" };

  const provider = resolveDirectProvider(input.providerId);
  const model = input.model?.trim() || provider.model || "bge-m3";
  const timeoutMs = input.timeoutMs ?? 60_000;

  let vectors: number[][];
  try {
    vectors = await oneCall(provider.baseUrl, provider.apiKey, model, texts, timeoutMs);
  } catch (e) {
    // Some providers reject batched input; fall back to one call per text.
    const message = e instanceof Error ? e.message : "";
    if (!/batch|input|400|422/.test(message)) throw e;
    vectors = [];
    for (const text of texts) {
      const single = await oneCall(provider.baseUrl, provider.apiKey, model, [text], timeoutMs);
      vectors.push(single[0]);
    }
  }

  if (vectors.length !== texts.length) {
    throw new Error("Embedding provider returned the wrong number of vectors.");
  }
  return { vectors, dim: vectors[0]?.length ?? 0, providerId: provider.id, model };
}
