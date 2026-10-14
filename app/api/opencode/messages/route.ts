import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import { toUiMessages } from "@/lib/opencode/messages";

// GET ?directory=<abs>&sessionId=<id> — load a session's chat history as UI turns.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const directory = url.searchParams.get("directory") ?? undefined;
  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  if (!directory || !sessionId) {
    return NextResponse.json({ error: "Missing directory or sessionId" }, { status: 400 });
  }
  void directory;
  try {
    const client = await clientFor();
    const messages = await client.session.context({ sessionID: sessionId });
    return NextResponse.json({ messages: toUiMessages(messages) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load messages";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
