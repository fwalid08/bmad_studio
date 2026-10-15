// Shared helpers for turning OpenCode v2 message structures into plain text.
// Client-safe (type-only) so both server routes and, if needed, the UI can use it.

import type { SessionMessageInfo } from "@opencode/client";
import type { TokenUsage } from "./types";

type SessionMessage = SessionMessageInfo;
type AssistantContent = Extract<SessionMessage, { type: "assistant" }>["content"][number];

type MessageUsageSource = {
  id: string;
  type: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
};

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

/** Sum usage from assistant messages not present in the pre-run snapshot. */
export function aggregateTokenUsage(
  messages: readonly MessageUsageSource[] | undefined,
  previousMessageIds?: ReadonlySet<string>
): TokenUsage | undefined {
  if (!messages) return undefined;

  const usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let hasTokens = false;
  let costUsd = 0;
  let hasCost = false;
  const value = (amount: unknown) => typeof amount === "number" && Number.isFinite(amount) ? amount : 0;

  for (const message of messages) {
    if (message.type !== "assistant" || previousMessageIds?.has(message.id) || !message.tokens) continue;
    hasTokens = true;
    usage.input += value(message.tokens.input);
    usage.output += value(message.tokens.output);
    usage.reasoning += value(message.tokens.reasoning);
    usage.cacheRead += value(message.tokens.cache?.read);
    usage.cacheWrite += value(message.tokens.cache?.write);
    if (typeof message.cost === "number" && Number.isFinite(message.cost)) {
      costUsd += message.cost;
      hasCost = true;
    }
  }

  if (!hasTokens) return undefined;
  usage.total = usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;
  return { ...usage, costUsd: hasCost ? costUsd : undefined };
}

/** Extract display text from one v2 session message. */
function messageText(m: SessionMessage): string {
  if (m.type === "user") return m.text ?? "";
  if (m.type === "assistant") {
    return (m.content ?? [])
      .filter((c: AssistantContent) => c.type === "text" || c.type === "reasoning")
      .map((c: AssistantContent) => ((c as { text?: string }).text ?? ""))
      .join("\n")
      .trim();
  }
  return "";
}

/** Last assistant reply text in a context list (for chat route). */
export function textFromMessages(messages: SessionMessage[] | undefined): string {
  if (!messages) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === "assistant") {
      const t = messageText(m);
      if (t) return t;
    }
  }
  return "";
}

/** Convert a session's message list into ordered UI chat turns. */
export function toUiMessages(messages: SessionMessage[] | undefined): UiMessage[] {
  if (!messages) return [];
  const out: UiMessage[] = [];
  for (const m of messages) {
    const role = m.type === "user" ? "user" : m.type === "assistant" ? "assistant" : null;
    if (!role) continue;
    const text = messageText(m);
    if (!text) continue;
    out.push({ id: m.id, role, text, createdAt: m.time.created });
  }
  return out;
}

/** Split a "providerID/modelID" id into its two halves (modelID may contain "/"). */
export function splitModel(id: string): { providerID: string; modelID: string } {
  const idx = id.indexOf("/");
  if (idx === -1) return { providerID: "opencode", modelID: id };
  return { providerID: id.slice(0, idx), modelID: id.slice(idx + 1) };
}
