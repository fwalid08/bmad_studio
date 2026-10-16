// Browser-side helpers for the app's OpenCode API routes. Pure fetch — no SDK.
"use client";

import type {
  ActivityEvent,
  ChatMessage,
  HaltRequest,
  ModelOption,
  OpenCodeAgent,
  OpenCodeProject,
  ProviderInfo,
  TokenUsage,
} from "./types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const post = <T,>(url: string, body: unknown, init?: RequestInit) =>
  json<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });

export const opencode = {
  /** All providers with their models and connection status. */
  providers: () =>
    json<{ providers: ProviderInfo[]; integrationIds?: string[] }>("/api/opencode/providers"),

  /** Set a provider API key on the OpenCode server. */
  setAuth: (providerID: string, key: string) =>
    json<{ ok: true }>(`/api/opencode/auth/${encodeURIComponent(providerID)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    }),

  /** Projects (working directories) known to OpenCode. */
  projects: () => json<{ projects: OpenCodeProject[] }>("/api/opencode/projects"),

  /** Child directories in the local filesystem. */
  directories: (path?: string) =>
    json<{
      directory: string;
      parent: string;
      directories: Array<{ name: string; path: string }>;
    }>(`/api/opencode/directories${path ? `?path=${encodeURIComponent(path)}` : ""}`),

  /** Available agents (build/plan/…). */
  agents: () => json<{ agents: OpenCodeAgent[] }>("/api/opencode/agents"),

  /** List chat sessions for a project directory. */
  sessions: (directory: string) =>
    json<{ sessions: Array<{ id: string; title: string }> }>(
      `/api/opencode/sessions?directory=${encodeURIComponent(directory)}`
    ),

  /** Check whether a session still has an active OpenCode run. */
  sessionActive: (directory: string, sessionId: string) =>
    json<{ active: boolean }>(
      `/api/opencode/sessions?directory=${encodeURIComponent(directory)}&sessionId=${encodeURIComponent(sessionId)}`
    ),

  /** List all session IDs currently running on the OpenCode server. */
  activeSessions: (directory: string) =>
    json<{ activeSessionIds: string[] }>(
      `/api/opencode/sessions?directory=${encodeURIComponent(directory)}&includeActive=true`
    ),

  /** Delete a session from the OpenCode project directory. */
  deleteSession: (directory: string, sessionId: string) =>
    json<{ ok: true }>(
      `/api/opencode/sessions?directory=${encodeURIComponent(directory)}&sessionId=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    ),

  /** Load a session's messages as UI chat turns. */
  messages: (directory: string, sessionId: string) =>
    json<{ messages: ChatMessage[] }>(
      `/api/opencode/messages?directory=${encodeURIComponent(directory)}&sessionId=${encodeURIComponent(sessionId)}`
    ),

  /**
   * Send a message to the project's session and wait for the reply (guidance /
   * draft). Tools are disabled so the model answers with plain text.
   */
  chat: (input: {
    directory: string;
    sessionId?: string;
    message: string;
    /** Agent persona / system instructions for this turn. */
    system?: string;
    /** Default model id (provider/model). */
    model?: string;
    agent?: string;
    /** Session title when creating a new one. */
    title?: string;
    signal?: AbortSignal;
  }) =>
    post<{ text: string; sessionId: string; usage?: TokenUsage }>("/api/opencode/chat", input, { signal: input.signal }),

  /** Create a fresh session for a project directory (title optional). */
  createSession: (directory: string, title?: string) =>
    post<{ id: string; title: string }>("/api/opencode/sessions", { directory, title }),

  /** Approve/reject a tool permission the build stream paused on. */
  replyPermission: (input: {
    sessionId: string;
    id: string;
    decision: "once" | "always" | "reject";
    message?: string;
  }) => post<{ ok: true }>("/api/opencode/halt", { ...input, kind: "permission" }),

  /** Answer a question the build agent paused on. */
  replyForm: (input: {
    sessionId: string;
    id: string;
    answer: Record<string, string | number | boolean | string[]>;
  }) => post<{ ok: true }>("/api/opencode/halt", { ...input, kind: "form" }),

  /** Interrupt an active build or review without closing its event stream. */
  interruptRun: (sessionId: string) =>
    post<{ ok: true }>("/api/opencode/halt", { sessionId, kind: "interrupt" }),
};

/** Flatten providers into a single list of selectable model options. */
export function flattenModels(providers: ProviderInfo[]): ModelOption[] {
  // The server can list the same model id under multiple providers (or even
  // twice for one provider). Duplicate ids break React keys *and* the Select
  // value, so keep the first occurrence of each id.
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      const id = m.id || `${p.id}/${m.modelID}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...m, id, providerID: m.providerID || p.id });
    }
  }
  return out;
}

export type { ActivityEvent, ChatMessage, HaltRequest, ModelOption, OpenCodeAgent, OpenCodeProject, ProviderInfo };
