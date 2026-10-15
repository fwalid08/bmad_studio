import { NextResponse } from "next/server";
import { listDirectProviders, saveDirectProvider } from "@/lib/ai/server";

// Direct AI providers (OpenAI-compatible, called straight from this server —
// never via OpenCode). API keys stay in ~/.config/bmad-studio/direct.json
// and are never returned to the browser.

export async function GET() {
  return NextResponse.json(listDirectProviders());
}

export async function PUT(request: Request) {
  let body: {
    providerId?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    model?: unknown;
    makeDefault?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.providerId !== "string" || !body.providerId.trim()) {
    return NextResponse.json({ error: "Missing provider ID" }, { status: 400 });
  }
  try {
    const saved = saveDirectProvider({
      providerId: body.providerId,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      makeDefault: body.makeDefault === true,
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to save provider" },
      { status: 400 }
    );
  }
}
