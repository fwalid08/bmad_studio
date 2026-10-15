import { NextResponse } from "next/server";
import {
  directChatCompletion,
  resolveDirectProvider,
  type DirectMessage,
} from "@/lib/ai/server";

interface ChatBody {
  /** Defaults to the configured default provider. */
  providerId?: string;
  /** Defaults to the provider's saved model. */
  model?: string;
  system?: string;
  messages: Array<{ role?: unknown; content?: unknown }>;
  temperature?: unknown;
  maxTokens?: unknown;
}

// Direct guidance/draft turn: the caller's system prompt + messages go to the
// provider untouched (no agent loop, no reformatting) and plain text comes back.
export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const messages: DirectMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (m): m is { role: string; content: string } =>
            !!m &&
            (m.role === "system" || m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim().length > 0
        )
        .map((m) => ({ role: m.role as DirectMessage["role"], content: m.content }))
    : [];
  if (messages.length === 0 && !body.system?.trim()) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  try {
    const provider = resolveDirectProvider(
      typeof body.providerId === "string" ? body.providerId : undefined
    );
    const model =
      (typeof body.model === "string" && body.model.trim()) || provider.model || "";
    const text = await directChatCompletion({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model,
      system: typeof body.system === "string" ? body.system : undefined,
      messages,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
    });
    return NextResponse.json({ text, providerId: provider.id, model });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Direct AI request failed";
    // 400 for local misconfiguration (no key/model/message), 502 for provider failures.
    const status = /^(No Direct|Multiple Direct|Direct AI provider|Missing message|No model|Empty response)/.test(message)
      ? 400
      : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
