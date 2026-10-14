// Maps OpenCode v2 server events → neutral activity-log events for build stream.
//
// Type-only on `@opencode/client` (no runtime import). v2 streams deltas
// (session.text.delta, session.reasoning.delta, session.tool.*), so we track
// how much of each message we've emitted + throttle to avoid flooding the log.

import type { EventSubscribeOutput } from "@opencode/client";
import type { ActivityEvent } from "./types";

type V2Event = EventSubscribeOutput;

/** Emit a text/reasoning part once it has grown by this many chars (throttle). */
const TEXT_EMIT_THRESHOLD = 400;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `…[+${s.length - max}]` : s;
}

function shortTitle(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

export class ActivityMapper {
  /** messageID → chars already emitted. */
  private emitted = new Map<string, number>();
  /** tool call id → whether we've logged it as "running". */
  private runningTools = new Set<string>();

  /** Map one OpenCode event to zero or more activity events. */
  map(event: V2Event): ActivityEvent[] {
    switch (event.type) {
      case "session.text.delta": {
        const d = event.data as { sessionID?: string; messageID?: string; delta?: string };
        return this.mapDelta(d.messageID ?? "", d.delta ?? "");
      }
      case "session.text.ended":
      case "session.reasoning.ended": {
        const d = event.data as { messageID?: string; text?: string };
        return this.mapFinal(d.messageID ?? "", d.text ?? "");
      }
      case "session.reasoning.delta": {
        const d = event.data as { messageID?: string; delta?: string };
        return this.mapDelta(d.messageID ?? "", d.delta ?? "");
      }
      case "session.tool.called":
      case "session.tool.input.started": {
        const d = event.data as { callID?: string; name?: string; title?: string };
        if (!d.callID || this.runningTools.has(d.callID)) return [];
        this.runningTools.add(d.callID);
        return [{ kind: "tool_call", title: `▶ ${d.name ?? "tool"}`, detail: d.title }];
      }
      case "session.tool.success": {
        const d = event.data as { callID?: string; name?: string; title?: string };
        if (d.callID) this.runningTools.delete(d.callID);
        return [{ kind: "tool_result", title: `✔ ${d.name ?? "tool"}`, detail: d.title }];
      }
      case "session.tool.failed": {
        const d = event.data as unknown as { callID?: string; name?: string; error?: unknown };
        if (d.callID) this.runningTools.delete(d.callID);
        const detail = typeof d.error === "string" ? d.error : JSON.stringify(d.error ?? "");
        return [{ kind: "error", title: `✖ ${d.name ?? "tool"}`, detail: detail || undefined }];
      }
      case "session.execution.failed": {
        const d = event.data as { error?: { message?: string } | string };
        const msg = typeof d.error === "string" ? d.error : (d.error?.message ?? "failed");
        return [{ kind: "error", title: "OpenCode error", detail: msg }];
      }
      case "session.idle":
        return [];
      default:
        return [];
    }
  }

  /** True when this event should terminate the streaming loop. */
  isTerminal(event: V2Event, sessionId: string): boolean {
    const d = event.data as { sessionID?: string } | undefined;
    if (event.type === "session.idle") return d?.sessionID === sessionId;
    if (event.type === "session.execution.failed" || event.type === "session.execution.succeeded") {
      return !d?.sessionID || d.sessionID === sessionId;
    }
    return false;
  }

  private mapDelta(id: string, delta: string): ActivityEvent[] {
    if (!id || !delta) return [];
    const prev = this.emitted.get(id) ?? 0;
    const next = prev + delta.length;
    this.emitted.set(id, next);
    if (next - prev < TEXT_EMIT_THRESHOLD && prev > 0) return [];
    return [{ kind: "thought", title: shortTitle(delta), detail: truncate(delta, 4000) }];
  }

  private mapFinal(id: string, text: string): ActivityEvent[] {
    if (!text) return [];
    this.emitted.set(id, text.length);
    return [{ kind: "thought", title: shortTitle(text), detail: truncate(text, 4000) }];
  }
}
