// Maps OpenCode v2 server events → neutral activity-log events for build stream.
//
// Type-only on `@opencode/client` (no runtime import). v2 streams deltas
// (session.text.delta, session.reasoning.delta, session.tool.*), so we track
// how much of each message we've emitted + throttle to avoid flooding the log.

import type { EventSubscribeOutput } from "@opencode/client";
import type { ActivityEvent, HaltField, HaltRequest } from "./types";

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

/** Normalize a form's fields (raw server shape) into the client-safe shape. */
function normalizeFields(raw: unknown): HaltField[] {
  if (!Array.isArray(raw)) return [];
  const out: HaltField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const key = typeof f.key === "string" ? f.key : undefined;
    if (!key) continue;
    const options = Array.isArray(f.options)
      ? (f.options as Array<Record<string, unknown>>)
          .map((o) => ({
            value: String(o.value ?? ""),
            label: String(o.label ?? o.value ?? ""),
          }))
          .filter((o) => o.value !== "")
      : undefined;
    out.push({
      key,
      type: typeof f.type === "string" ? f.type : "string",
      title: typeof f.title === "string" ? f.title : undefined,
      description: typeof f.description === "string" ? f.description : undefined,
      required: f.required === true,
      options,
    });
  }
  return out;
}

export class ActivityMapper {
  /** messageID → text accumulated from deltas. */
  private accumulated = new Map<string, string>();
  /** messageID → chars already shown in the activity log. */
  private emitted = new Map<string, number>();
  private latestSummary?: string;
  /** Tool call id → tool name from the input-started event. */
  private toolNames = new Map<string, string>();
  /** tool call id → whether we've logged it as "running". */
  private runningTools = new Set<string>();

  /** Map one OpenCode event to zero or more activity events. */
  map(event: V2Event): ActivityEvent[] {
    switch (event.type) {
      case "session.text.delta": {
        const d = event.data as { sessionID?: string; messageID?: string; delta?: string };
        return this.mapDelta(d.messageID ?? "", d.delta ?? "");
      }
      case "session.text.ended": {
        const d = event.data as { messageID?: string; text?: string };
        this.latestSummary = d.text?.trim() ? d.text : undefined;
        return this.mapFinal(d.messageID ?? "", d.text ?? "");
      }
      case "session.reasoning.ended": {
        const d = event.data as { messageID?: string; text?: string };
        return this.mapFinal(d.messageID ?? "", d.text ?? "");
      }
      case "session.reasoning.delta": {
        const d = event.data as { messageID?: string; delta?: string };
        return this.mapDelta(d.messageID ?? "", d.delta ?? "");
      }
      case "session.tool.input.started": {
        const d = event.data as { id?: string; name?: string };
        if (d.id && d.name) this.toolNames.set(d.id, d.name);
        return [];
      }
      case "session.tool.called": {
        const d = event.data as { id?: string; input?: Record<string, unknown> };
        if (!d.id || this.runningTools.has(d.id)) return [];
        this.runningTools.add(d.id);
        const name = this.toolNames.get(d.id);
        const detail = d.input && Object.keys(d.input).length ? JSON.stringify(d.input, null, 2) : undefined;
        return [{ kind: "tool_call", title: `▶ ${name ?? "Pemanggilan"}`, detail }];
      }
      case "session.tool.success": {
        const d = event.data as {
          id?: string;
          content?: Array<{ type?: string; text?: string; name?: string; uri?: string }>;
        };
        const name = d.id ? this.toolNames.get(d.id) : undefined;
        if (d.id) {
          this.runningTools.delete(d.id);
          this.toolNames.delete(d.id);
        }
        const detail = d.content
          ?.map((item) =>
            item.type === "text" ? item.text : item.type === "file" ? `File: ${item.name ?? item.uri ?? "output"}` : ""
          )
          .filter(Boolean)
          .join("\n");
        return [{ kind: "tool_result", title: `✔ ${name ?? "Hasil"}`, detail: detail || undefined }];
      }
      case "session.tool.failed": {
        const d = event.data as { id?: string; error?: { message?: string } | string };
        const name = d.id ? this.toolNames.get(d.id) : undefined;
        if (d.id) {
          this.runningTools.delete(d.id);
          this.toolNames.delete(d.id);
        }
        const detail = typeof d.error === "string" ? d.error : d.error?.message;
        return [{ kind: "error", title: `✖ ${name ?? "Gagal"}`, detail }];
      }
      case "session.execution.failed": {
        const d = event.data as { error?: { message?: string } | string };
        const msg = typeof d.error === "string" ? d.error : (d.error?.message ?? "failed");
        return [{ kind: "error", title: "OpenCode error", detail: msg }];
      }
      case "permission.asked": {
        const d = event.data as { id?: string; action?: string; resources?: string[]; message?: string };
        return [
          {
            kind: "halt",
            title: d.action ? `⏸ Menunggu izin: ${d.action}` : "⏸ Menunggu persetujuan",
            detail: [d.message, ...(d.resources ?? [])].filter(Boolean).join("\n") || undefined,
          },
        ];
      }
      case "permission.replied": {
        const d = event.data as { reply?: string };
        return [{ kind: "info", title: `▶ Izin dijawab: ${d.reply ?? "ok"}` }];
      }
      case "form.created": {
        const d = event.data as { form?: { title?: string } };
        return [{ kind: "halt", title: `⏸ Agen bertanya: ${d.form?.title ?? "butuh jawaban"}` }];
      }
      case "form.replied":
      case "form.cancelled":
        return [{ kind: "info", title: "▶ Pertanyaan dijawab" }];
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
    if (
      event.type === "session.execution.failed" ||
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.interrupted"
    ) {
      return !d?.sessionID || d.sessionID === sessionId;
    }
    return false;
  }

  /**
   * The session this event belongs to. Most events carry `data.sessionID`, but
   * `form.*` events nest it under `data.form.sessionID`.
   */
  sessionIdOf(event: V2Event): string | undefined {
    const d = event.data as { sessionID?: string; form?: { sessionID?: string } } | undefined;
    return d?.sessionID ?? d?.form?.sessionID;
  }

  summary(): string | undefined {
    return this.latestSummary;
  }

  /**
   * Extract a human-decision request from a halt event, or null when the event
   * is not a halt. Permission asks and agent questions keep the session busy
   * until answered, so callers must surface these to the user.
   */
  haltRequest(event: V2Event, sessionId: string): HaltRequest | null {
    if (event.type === "permission.asked") {
      const d = event.data as {
        id?: string;
        sessionID?: string;
        action?: string;
        resources?: string[];
        message?: string;
      };
      if (d.sessionID && d.sessionID !== sessionId) return null;
      return {
        id: d.id ?? "",
        kind: "permission",
        title: `Menunggu izin: ${d.action ?? "tool"}`,
        message: d.message,
        resources: d.resources ?? [],
      };
    }
    if (event.type === "form.created") {
      const d = event.data as {
        form?: {
          id?: string;
          sessionID?: string;
          title?: string;
          fields?: unknown;
        };
      };
      const form = d.form;
      if (!form || (form.sessionID && form.sessionID !== sessionId)) return null;
      return {
        id: form.id ?? "",
        kind: "form",
        title: form.title ?? "Agen butuh jawaban",
        fields: normalizeFields(form.fields),
      };
    }
    return null;
  }

  private mapDelta(id: string, delta: string): ActivityEvent[] {
    if (!id || !delta) return [];
    const text = (this.accumulated.get(id) ?? "") + delta;
    this.accumulated.set(id, text);
    const emitted = this.emitted.get(id) ?? 0;
    if (text.length - emitted < TEXT_EMIT_THRESHOLD && emitted > 0) return [];
    const content = text.slice(emitted);
    this.emitted.set(id, text.length);
    return [{ kind: "thought", title: shortTitle(content), detail: truncate(content, 4000) }];
  }

  private mapFinal(id: string, text: string): ActivityEvent[] {
    if (!text) return [];
    const accumulated = this.accumulated.get(id) ?? "";
    const emitted = this.emitted.get(id) ?? 0;
    const shownText = accumulated.slice(0, emitted);
    const remaining = shownText && text.startsWith(shownText) ? text.slice(emitted) : text;
    this.accumulated.delete(id);
    this.emitted.delete(id);
    if (!remaining) return [];
    return [{ kind: "thought", title: shortTitle(remaining), detail: truncate(remaining, 4000) }];
  }
}
