import { NextResponse } from "next/server";
import {
  hasConfiguredPassword,
  readServerSettings,
  saveServerSettings,
} from "@/lib/opencode/server";

export async function GET() {
  return NextResponse.json({
    ...readServerSettings(),
    passwordConfigured: await hasConfiguredPassword(),
  });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      opencodeServerUrl?: unknown;
      username?: unknown;
      password?: unknown;
    };
    const saved = await saveServerSettings({
      opencodeServerUrl: typeof body.opencodeServerUrl === "string" ? body.opencodeServerUrl : undefined,
      username: typeof body.username === "string" ? body.username : undefined,
      password: typeof body.password === "string" && body.password ? body.password : undefined,
    });
    return NextResponse.json({
      ok: true,
      ...saved,
      passwordConfigured: await hasConfiguredPassword(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save OpenCode settings",
      },
      { status: 400 }
    );
  }
}
