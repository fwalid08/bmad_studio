import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import { splitModel } from "@/lib/opencode/messages";
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
// and waits for the reply. Tools are disabled so the model answers with plain
// text (no file edits) — ideal for BMAD agent guidance and artifact drafting.
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

    await client.session.prompt({
      sessionID: sessionId,
      text: body.message,
      ...(body.system ? { metadata: { system: body.system } } : {}),
    });

    const text = await waitForAssistantReply(
      () => client.session.context({ sessionID: sessionId }),
      Number(process.env.OPENCODE_RESPONSE_TIMEOUT_MS ?? 120000),
      250
    );

    return NextResponse.json({ text, sessionId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
