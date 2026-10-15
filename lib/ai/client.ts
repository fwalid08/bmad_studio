// Browser-side helpers for the app's Direct AI routes (OpenAI-compatible
// providers called from our own server, never via OpenCode). Pure fetch.
"use client";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export interface StoredDirectProvider {
  id: string;
  baseUrl?: string;
  model?: string;
  configured: boolean;
}

export const directAI = {
  /** Configured Direct AI providers (never includes API keys). */
  providers: () =>
    json<{ defaultProvider?: string; providers: StoredDirectProvider[] }>(
      "/api/ai/providers"
    ),

  /** Save a provider's key/base URL/model on this machine's server. */
  saveProvider: (input: {
    providerId: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    makeDefault?: boolean;
  }) =>
    json<{ ok: true } & StoredDirectProvider & { defaultProvider?: string }>(
      "/api/ai/providers",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }
    ),

  /** One guidance/draft turn with a fully caller-controlled prompt. */
  chat: (input: {
    providerId?: string;
    model?: string;
    system?: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
  }) =>
    json<{ text: string; providerId: string; model: string }>("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
};
