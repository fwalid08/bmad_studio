import "server-only";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Server-only storage + caller for "Direct AI": OpenAI-compatible providers
// called straight from this Next.js server, never via OpenCode.
//
// Keys live in ~/.config/bmad-studio/direct.json (mode 600) and are never
// sent to the browser. Shape:
//   { "defaultProvider": "deepseek",
//     "providers": { "deepseek": { "apiKey": "...", "baseUrl": "...", "model": "..." } } }

const CONFIG_DIR = join(homedir(), ".config", "bmad-studio");
const CONFIG_FILE = join(CONFIG_DIR, "direct.json");

export interface DirectProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface DirectConfig {
  defaultProvider?: string;
  providers?: Record<string, DirectProviderConfig>;
}

export interface ResolvedDirectProvider {
  id: string;
  apiKey: string;
  baseUrl: string;
  model?: string;
}

function readConfig(): DirectConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as unknown as DirectConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: DirectConfig): DirectConfig {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
  return config;
}

/** Stored entries only (never API keys). */
export function listDirectProviders(): {
  defaultProvider?: string;
  providers: Array<{ id: string; baseUrl?: string; model?: string; configured: boolean }>;
} {
  const config = readConfig();
  const entries = Object.entries(config.providers ?? {});
  return {
    defaultProvider: config.defaultProvider,
    providers: entries.map(([id, p]) => ({
      id,
      baseUrl: p.baseUrl,
      model: p.model,
      configured: Boolean(p.apiKey),
    })),
  };
}

export function saveDirectProvider(input: {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  makeDefault?: boolean;
}): { id: string; baseUrl?: string; model?: string; configured: boolean; defaultProvider?: string } {
  const providerId = input.providerId.trim();
  if (!providerId) throw new Error("Provider ID cannot be empty.");
  const config = readConfig();
  const current: DirectProviderConfig = { ...(config.providers?.[providerId] ?? {}) };
  if (input.apiKey !== undefined) {
    const key = input.apiKey.trim();
    if (key) current.apiKey = key;
    else delete current.apiKey;
  }
  if (input.baseUrl !== undefined) {
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
    if (baseUrl) current.baseUrl = baseUrl;
    else delete current.baseUrl;
  }
  if (input.model !== undefined) {
    const model = input.model.trim();
    if (model) current.model = model;
    else delete current.model;
  }
  if (!current.apiKey && !current.baseUrl && !current.model) {
    throw new Error("Nothing to save: provide an API key, base URL, or model.");
  }
  if (input.baseUrl !== undefined && !current.baseUrl && !current.apiKey) {
    throw new Error("Base URL cannot be empty.");
  }
  const next: DirectConfig = {
    ...config,
    providers: { ...(config.providers ?? {}), [providerId]: current },
  };
  if (input.makeDefault || !next.defaultProvider) next.defaultProvider = providerId;
  writeConfig(next);
  return {
    id: providerId,
    baseUrl: current.baseUrl,
    model: current.model,
    configured: Boolean(current.apiKey),
    defaultProvider: next.defaultProvider,
  };
}

/** Resolve credentials for a chat call. Throws a user-facing message when unusable. */
export function resolveDirectProvider(providerId?: string): ResolvedDirectProvider {
  const config = readConfig();
  const ids = Object.keys(config.providers ?? {});
  if (ids.length === 0) {
    throw new Error("No Direct AI provider configured yet. Add one in Settings → Direct AI.");
  }
  const id = providerId?.trim() || config.defaultProvider || (ids.length === 1 ? ids[0] : "");
  if (!id) {
    throw new Error("Multiple Direct AI providers configured but none is the default. Pick one in Settings → Direct AI.");
  }
  const entry = config.providers?.[id];
  if (!entry) {
    throw new Error(`Direct AI provider "${id}" is not configured. Add it in Settings → Direct AI.`);
  }
  if (!entry.baseUrl) {
    throw new Error(`Direct AI provider "${id}" has no base URL saved. Add it in Settings → Direct AI.`);
  }
  // An API key is optional: local runners (e.g. Ollama) need none.
  return { id, apiKey: entry.apiKey ?? "", baseUrl: entry.baseUrl, model: entry.model };
}

export interface DirectMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * One OpenAI-compatible chat completion (non-streaming). Used for BMAD
 * guidance/draft turns where the caller fully controls the system prompt —
 * unlike OpenCode agent turns, nothing is added or reformatted in between.
 */
export async function directChatCompletion(input: {
  baseUrl: string;
  /** Empty for local runners that need no auth (e.g. Ollama). */
  apiKey: string;
  model: string;
  system?: string;
  messages: DirectMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const model = input.model.trim();
  if (!model) throw new Error("No model selected for this Direct AI provider.");
  const messages: DirectMessage[] = [
    ...(input.system?.trim() ? [{ role: "system" as const, content: input.system.trim() }] : []),
    ...input.messages.filter((m) => m.content.trim()),
  ];
  if (messages.length === 0) throw new Error("Missing message.");
  const url = `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Local runners (Ollama) accept any key, but sending none is cleaner.
        ...(input.apiKey.trim() ? { authorization: `Bearer ${input.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
        stream: false,
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
    });
  } catch (e) {
    throw new Error(
      `Direct AI request failed: ${e instanceof Error ? e.message : "network error"}`
    );
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: unknown } | string } | null;
    const providerMessage =
      (typeof detail?.error === "string" ? detail.error : detail?.error?.message) ?? res.statusText;
    throw new Error(`Provider error (HTTP ${res.status}): ${String(providerMessage).slice(0, 300)}`);
  }
  const body = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  const content = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content
        .map((p) => (typeof p === "string" ? p : (p as { text?: unknown }).text))
        .filter((t): t is string => typeof t === "string")
        .join("")
    : typeof content === "string"
      ? content
      : "";
  if (!text.trim()) throw new Error("Empty response from provider.");
  return text;
}
