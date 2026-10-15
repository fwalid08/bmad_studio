import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import { splitModel } from "@/lib/opencode/messages";
import { aggregateTokenUsage } from "@/lib/opencode/messages";
import { ActivityMapper } from "@/lib/opencode/events";
import { ensureSession } from "@/lib/opencode/session";
import type { ActivityEvent, HaltRequest } from "@/lib/opencode/types";
import type { EventSubscribeOutput } from "@opencode/client";

interface StreamBody {
  directory: string;
  sessionId?: string;
  /** The high-level goal/instructions for the build. */
  prompt: string;
  /** Model id in "providerID/modelID" form. */
  model?: string;
  /** Build agent name (e.g. "build"). */
  agent?: string;
  title?: string;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Auto-approve tool permissions (default on). Set OPENCODE_AUTO_APPROVE_PERMISSIONS=false to ask. */
function autoApprovePermissions(): boolean {
  return process.env.OPENCODE_AUTO_APPROVE_PERMISSIONS !== "false";
}

/** How long a pending human decision may block the build before we give up. */
function haltTimeoutMs(): number {
  const raw = Number(process.env.OPENCODE_HALT_TIMEOUT_MS ?? 900000);
  return Number.isFinite(raw) && raw > 0 ? raw : 900000;
}

type TerminalOutcome =
  | { kind: "success" }
  | { kind: "error"; message: string }
  | { kind: "interrupted"; reason: string };

// Streams a build turn on the project's OpenCode session back to the browser as
// SSE. The whole lifecycle (ensure session → subscribe → prompt → stream → end)
// lives here.
//
// Halt handling: when the agent pauses for a human decision (`permission.asked`
// or `form.created`) the session stays "busy" and never emits a terminal event,
// so the stream would otherwise hang forever. We therefore:
//   - auto-approve tool permissions by default (configurable), and
//   - forward any remaining halt to the UI as a `halt` event so it can answer,
//     with a watchdog that ends the stream if it waits too long.
export async function POST(req: Request) {
  let body: StreamBody;
  try {
    body = (await req.json()) as StreamBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.directory || !body.prompt?.trim()) {
    return NextResponse.json({ error: "Missing directory or prompt" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const mapper = new ActivityMapper();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          /* controller may be closed */
        }
      };
      const emit = (e: ActivityEvent) => send("log", e);

      const client = await clientFor();

      const sm = body.model ? splitModel(body.model) : undefined;
      const sessionId = await ensureSession(client.session, {
        directory: body.directory,
        sessionId: body.sessionId,
        title: body.title ?? "BMAD Build",
        agent: body.agent,
        model: sm ? { id: sm.modelID, providerID: sm.providerID } : undefined,
      });
      send("session", { sessionId });
      let previousMessageIds: Set<string> | undefined;
      try {
        const previousMessages = await client.session.context({ sessionID: sessionId });
        previousMessageIds = new Set(previousMessages.map((message) => message.id));
      } catch {
        // Keep the build running if usage history is unavailable.
      }

      // Tear down the event loop when the client disconnects (user clicked Stop)
      // or when the halt watchdog fires.
      const loopAbort = new AbortController();
      let haltTimer: ReturnType<typeof setTimeout> | undefined;
      let terminalOutcome: TerminalOutcome | undefined;
      const clearHaltTimer = () => {
        if (haltTimer) {
          clearTimeout(haltTimer);
          haltTimer = undefined;
        }
      };
      const armHaltTimer = (halt: HaltRequest) => {
        clearHaltTimer();
        haltTimer = setTimeout(() => {
          const message = `Halt tidak dijawab (${halt.kind}). Build dihentikan.`;
          terminalOutcome = { kind: "error", message };
          emit({
            kind: "error",
            title: "Build menunggu keputusan terlalu lama",
            detail: `Halt "${halt.title}" tidak dijawab dalam ${Math.round(
              haltTimeoutMs() / 1000
            )}s — stream dihentikan agar tidak menggantung.`,
          });
          // Unblock the session so it doesn't stay "busy" waiting forever.
          client.session.interrupt({ sessionID: sessionId }).catch(() => {});
          loopAbort.abort();
        }, haltTimeoutMs());
      };

      req.signal.addEventListener("abort", () => {
        clearHaltTimer();
        // Interrupt the running OpenCode session, then stop the event loop.
        client.session.interrupt({ sessionID: sessionId }).catch(() => {});
        loopAbort.abort();
      });

      // Subscribe BEFORE prompting so we don't miss early events.
      const eventStream = client.event.subscribe({ signal: loopAbort.signal });

      // Fire the prompt asynchronously; completion is driven by the event loop.
      // Agent/model switch first when provided (session may pre-exist).
      if (body.agent) {
        await client.session.switchAgent({ sessionID: sessionId, agent: body.agent }).catch(() => {});
      }
      if (body.model) {
        const m = splitModel(body.model);
        await client.session
          .switchModel({ sessionID: sessionId, model: { id: m.modelID, providerID: m.providerID } })
          .catch(() => {});
      }
      void client.session
        .prompt({ sessionID: sessionId, text: body.prompt })
        .catch((err: unknown) => {
          terminalOutcome = { kind: "error", message: err instanceof Error ? err.message : String(err) };
          loopAbort.abort();
        });

      try {
        try {
          for await (const event of eventStream as AsyncIterable<EventSubscribeOutput>) {
            // Only react to events for our session (shared global stream).
            const sid = mapper.sessionIdOf(event);
            if (sid && sid !== sessionId) continue;

            // Human-decision halts: surface to the UI (and auto-approve permissions).
            const halt = mapper.haltRequest(event, sessionId);
            if (halt) {
              if (halt.kind === "permission" && autoApprovePermissions()) {
                await client.permission
                  .reply({ sessionID: sessionId, requestID: halt.id, decision: "once" })
                  .catch(() => {});
                emit({ kind: "info", title: `✔ Izin disetujui otomatis: ${halt.title}` });
              } else {
                emit({
                  kind: "halt",
                  title: halt.title,
                  detail: halt.message ?? halt.resources?.join("\n"),
                });
                send("halt", halt);
                armHaltTimer(halt);
              }
              continue;
            }

            // A reply from the user (via /api/opencode/halt) resolves the wait.
            if (event.type === "permission.replied" || event.type === "form.replied" || event.type === "form.cancelled") {
              clearHaltTimer();
              send("halt_resolved", { id: (event.data as { requestID?: string; id?: string }).requestID ?? (event.data as { id?: string }).id ?? "" });
            }

            if (mapper.isTerminal(event, sessionId)) {
              if (event.type === "session.execution.failed") {
                const d = event.data as { error?: { message?: string } | string };
                terminalOutcome = {
                  kind: "error",
                  message: (typeof d.error === "string" ? d.error : d.error?.message) || "OpenCode session error",
                };
              } else if (event.type === "session.execution.interrupted") {
                const d = event.data as { reason?: string };
                terminalOutcome = { kind: "interrupted", reason: d.reason ?? "unknown" };
              } else {
                terminalOutcome = { kind: "success" };
              }
              break;
            }
            for (const e of mapper.map(event)) emit(e);
          }
        } catch (e) {
          if ((e as Error)?.name !== "AbortError") {
            terminalOutcome = { kind: "error", message: e instanceof Error ? e.message : String(e) };
          }
        }

        if (!req.signal.aborted) {
          if (!terminalOutcome) {
            terminalOutcome = { kind: "error", message: "OpenCode run berakhir tanpa status terminal." };
          }
          let usage;
          if (previousMessageIds) {
            try {
              const messages = await client.session.context({ sessionID: sessionId });
              usage = aggregateTokenUsage(messages, previousMessageIds);
            } catch {
              // Usage is optional; a context read failure must not fail the run.
            }
          }
          if (terminalOutcome.kind === "success") {
            send("done", { ok: true, summary: mapper.summary(), usage });
          } else if (terminalOutcome.kind === "error") {
            send("error", { message: terminalOutcome.message, usage });
          } else {
            send("interrupted", { reason: terminalOutcome.reason, usage });
          }
        }
      } finally {
        clearHaltTimer();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
