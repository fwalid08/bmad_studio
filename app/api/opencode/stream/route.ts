import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import { splitModel } from "@/lib/opencode/messages";
import { ActivityMapper } from "@/lib/opencode/events";
import { ensureSession } from "@/lib/opencode/session";
import type { ActivityEvent } from "@/lib/opencode/types";
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

// Streams a build turn on the project's OpenCode session back to the browser as
// SSE. The whole lifecycle (ensure session → subscribe → prompt → stream → end)
// lives here. Permissions are auto-approved so the build agent runs end-to-end.
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

      // When the client disconnects (user clicked Stop), interrupt the OpenCode session.
      req.signal.addEventListener("abort", () => {
        client.session.interrupt({ sessionID: sessionId }).catch(() => {});
      });

      // Subscribe BEFORE prompting so we don't miss early events.
      const eventStream = client.event.subscribe();

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
          send("error", { message: err instanceof Error ? err.message : String(err) });
        });

      try {
        for await (const event of eventStream as AsyncIterable<EventSubscribeOutput>) {
        // Only react to events for our session (shared global stream).
        const sid = (event.data as { sessionID?: string } | undefined)?.sessionID;
        if (sid && sid !== sessionId) continue;

        if (mapper.isTerminal(event, sessionId)) {
          if (event.type === "session.execution.failed") {
            const d = event.data as { error?: { message?: string } | string };
            const msg =
              (typeof d.error === "string" ? d.error : d.error?.message) ||
              "OpenCode session error";
            send("error", { message: msg });
          }
          break;
        }
        for (const e of mapper.map(event)) emit(e);
      }

      send("done", { ok: true });
    } catch (e) {
      send("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
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
