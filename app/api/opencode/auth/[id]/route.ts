import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";

// Sets a provider's API key ON THE OPENCODE SERVER (not the browser). The key
// is persisted by OpenCode in its own auth store and never kept in localStorage.
// v2 API: POST /api/integration/{integrationID}/connect/key { key, label? }.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { key?: unknown };
  try {
    body = (await req.json()) as { key?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json({ error: "Missing API key" }, { status: 400 });
  }

  try {
    const client = await clientFor();
    await client.integration.connect.key({ integrationID: id, key });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to set API key";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
