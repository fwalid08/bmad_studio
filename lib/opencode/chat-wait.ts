import type { SessionMessageInfo } from "@opencode/client";

import { textFromMessages } from "./messages";

function resolveTimeoutMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return fallback;
  return value;
}

export async function waitForAssistantReply(
  readContext: () => Promise<SessionMessageInfo[] | undefined>,
  timeoutMs = resolveTimeoutMs(
    Number(process.env.OPENCODE_RESPONSE_TIMEOUT_MS ?? 120000),
    120000
  ),
  pollMs = 250
): Promise<string> {
  const startedAt = Date.now();
  const baseline = await readContext();
  const lastAssistantId =
    [...(baseline ?? [])]
      .reverse()
      .find((m) => m.type === "assistant")?.id ?? null;

  while (Date.now() - startedAt < timeoutMs) {
    const messages = await readContext();
    const latestAssistant = [...(messages ?? [])].reverse().find((m) => m.type === "assistant");

    if (latestAssistant && latestAssistant.id !== lastAssistantId) {
      const text = textFromMessages(messages);
      if (text) return text;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`OpenCode response timed out after ${timeoutMs}ms`);
}
