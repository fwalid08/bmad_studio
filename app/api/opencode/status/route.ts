import { NextResponse } from "next/server";
import { serverInfo, startServer, stopServer } from "@/lib/opencode/server";

// Reports whether the local OpenCode server is reachable, plus version.
// Used by Settings to show connection status before the user configures anything.
export async function GET() {
  const info = await serverInfo();
  return NextResponse.json(info);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action !== "start" && body.action !== "stop") {
      return NextResponse.json({ error: "Action must be start or stop." }, { status: 400 });
    }
    const info = body.action === "start" ? await startServer() : await stopServer();
    return NextResponse.json(info);
  } catch (error) {
    const info = await serverInfo();
    return NextResponse.json(
      {
        ...info,
        error: error instanceof Error ? error.message : "Failed to control OpenCode server",
      },
      { status: 409 }
    );
  }
}
