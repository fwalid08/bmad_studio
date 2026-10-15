import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";

interface HaltBody {
  sessionId: string;
  /** "permission" (tool approval) or "form" (agent question). */
  kind: "permission" | "form";
  /** Permission request id, or form id. */
  id: string;
  /** Permission decision. */
  decision?: "once" | "always" | "reject";
  /** Form answers keyed by field key. */
  answer?: Record<string, string | number | boolean | string[]>;
  /** Optional message shown to the agent (permission reject). */
  message?: string;
}

// Resolves a halt raised by a build stream (see /api/opencode/stream): approves
// or rejects a tool permission, or answers an agent question. Without this the
// build session stays busy and the SSE stream hangs until its watchdog fires.
export async function POST(req: Request) {
  let body: HaltBody;
  try {
    body = (await req.json()) as HaltBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.sessionId || !body.id || !body.kind) {
    return NextResponse.json({ error: "Missing sessionId, id or kind" }, { status: 400 });
  }

  try {
    const client = await clientFor();
    if (body.kind === "permission") {
      await client.permission.reply({
        sessionID: body.sessionId,
        requestID: body.id,
        decision: body.decision ?? "once",
        ...(body.message ? { message: body.message } : {}),
      });
    } else {
      await client.session.form.reply({
        sessionID: body.sessionId,
        formID: body.id,
        answer: body.answer ?? {},
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to answer halt";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
