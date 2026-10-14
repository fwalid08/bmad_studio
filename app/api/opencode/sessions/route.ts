import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";

// GET ?directory=<abs path> — list chat sessions for a project directory.
export async function GET(req: Request) {
  const directory = new URL(req.url).searchParams.get("directory") ?? undefined;
  if (!directory) {
    return NextResponse.json({ error: "Missing directory" }, { status: 400 });
  }
  try {
    const client = await clientFor();
    const out = await client.session.list({ directory });
    return NextResponse.json({
      sessions: (out.data ?? []).map((s) => ({ id: s.id, title: s.title ?? "" })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list sessions";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const directory = url.searchParams.get("directory") ?? undefined;
  const sessionId = url.searchParams.get("sessionId") ?? undefined;

  if (!directory || !sessionId) {
    return NextResponse.json({ error: "Missing directory or sessionId" }, { status: 400 });
  }

  try {
    const client = await clientFor();
    await client.session.remove({ sessionID: sessionId });
    return NextResponse.json({ ok: true, directory, sessionId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete session";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

interface CreateBody {
  directory: string;
  title?: string;
}

// POST { directory, title? } — create a new chat session scoped to the folder.
export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.directory) {
    return NextResponse.json({ error: "Missing directory" }, { status: 400 });
  }
  try {
    const client = await clientFor();
    const session = await client.session.create({
      title: body.title ?? "BMAD Studio",
      location: { directory: body.directory },
    });
    return NextResponse.json({ id: session.id, title: session.title ?? "" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create session";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
