// Browser-side helpers for the app's OpenCode API routes. Pure fetch — no SDK.
"use client";

import type {
  ActivityEvent,
  ChatMessage,
  ModelOption,
  OpenCodeAgent,
  OpenCodeProject,
  ProviderInfo,
} from "./types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const post = <T,>(url: string, body: unknown) =>
  json<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const opencode = {
  /** All providers with their models and connection status. */
  providers: () => json<{ providers: ProviderInfo[] }>("/api/opencode/providers"),

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
  }) =>
    post<{ text: string; sessionId: string }>("/api/opencode/chat", input),

  /** Create a fresh session for a project directory (title optional). */
  createSession: (directory: string, title?: string) =>
    post<{ id: string; title: string }>("/api/opencode/sessions", { directory, title }),
};

/** Flatten providers into a single list of selectable model options. */
export function flattenModels(providers: ProviderInfo[]): ModelOption[] {
  return providers.flatMap((p) => p.models.map((m) => ({ ...m, providerID: p.id })));
}

export type { ActivityEvent, ChatMessage, ModelOption, OpenCodeAgent, OpenCodeProject, ProviderInfo };
