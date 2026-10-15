import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import { splitModel } from "@/lib/opencode/messages";
import { aggregateTokenUsage } from "@/lib/opencode/messages";
import { waitForAssistantReply } from "@/lib/opencode/chat-wait";
import { ensureSession } from "@/lib/opencode/session";

interface ChatBody {
  directory: string;
  /** Existing session id; if omitted a new session is created. */
  sessionId?: string;
  message: string;
  /** System/persona instructions for this turn (agent voice + step context). */
  system?: string;
  /** Default model id in "providerID/modelID" form. */
  model?: string;
  /** Agent name to use (e.g. "plan"). */
  agent?: string;
  /** Session title when creating a new one. */
  title?: string;
}

// Guidance / draft endpoint: sends one message to the project's OpenCode session
// and waits for the reply. NOTE: OpenCode's prompt `metadata` is inert passthrough
// data — it is NOT applied as a system prompt. So caller-provided `system`
// instructions are prepended to the message text to guarantee the model sees them.
export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.directory || !body.message?.trim()) {
    return NextResponse.json({ error: "Missing directory or message" }, { status: 400 });
  }

  try {
    const client = await clientFor();

    const sm = body.model ? splitModel(body.model) : undefined;
    const sessionId = await ensureSession(client.session, {
      directory: body.directory,
      sessionId: body.sessionId,
      title: body.title ?? "BMAD Studio",
      agent: body.agent,
      model: sm ? { id: sm.modelID, providerID: sm.providerID } : undefined,
    });

    // Ensure the chosen agent/model is active on this session before prompting,
    // then wait for a new assistant reply with a hard timeout instead of hanging.
    if (body.agent) {
      await client.session.switchAgent({ sessionID: sessionId, agent: body.agent }).catch(() => {});
    }
    if (body.model) {
      const m = splitModel(body.model);
      await client.session
        .switchModel({ sessionID: sessionId, model: { id: m.modelID, providerID: m.providerID } })
        .catch(() => {});
    }

    let previousMessageIds: Set<string> | undefined;
    try {
      const previousMessages = await client.session.context({ sessionID: sessionId });
      previousMessageIds = new Set(previousMessages.map((message) => message.id));
    } catch {
      // Keep the chat request working if usage history is unavailable.
    }

    await client.session.prompt({
      sessionID: sessionId,
      text: body.system ? `${body.system}\n\n---\n\n${body.message}` : body.message,
    });

    const text = await waitForAssistantReply(
      () => client.session.context({ sessionID: sessionId }),
      Number(process.env.OPENCODE_RESPONSE_TIMEOUT_MS ?? 120000),
      250
    );

    let usage;
    if (previousMessageIds) {
      try {
        const messages = await client.session.context({ sessionID: sessionId });
        usage = aggregateTokenUsage(messages, previousMessageIds);
      } catch {
        // Usage is optional; a context read failure must not fail a completed review.
      }
    }

    return NextResponse.json({ text, sessionId, usage });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
