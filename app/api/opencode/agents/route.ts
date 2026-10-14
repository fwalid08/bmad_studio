import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import type { OpenCodeAgent } from "@/lib/opencode/types";

// Lists agents available on the OpenCode server. Agent ids are matched
// case-insensitively by OpenCode, so we normalize names to lowercase here to
// keep the Settings dropdown consistent with the store's "plan"/"build"
// defaults (which are also what gets sent to session.create / switchAgent).
export async function GET() {
  try {
    const client = await clientFor();
    const out = await client.agent.list();
    const list: OpenCodeAgent[] = (out.data ?? []).map((a) => ({
      name: a.name.toLowerCase(),
      description: a.description,
      mode: a.mode,
    }));
    return NextResponse.json({ agents: list });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list agents";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
