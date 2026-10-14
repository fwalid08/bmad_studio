import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import type { OpenCodeProject } from "@/lib/opencode/types";

// Lists the working directories (projects) known to the local OpenCode server.
// A BMAD project must point its `directory` at one of these so its chat session
// and build run in the same folder OpenCode uses.
export async function GET() {
  try {
    const client = await clientFor();
    const list = await client.project.list();
    const projects: OpenCodeProject[] = (list ?? []).map((p) => ({
      id: p.id,
      worktree: p.canonical,
    }));
    return NextResponse.json({ projects });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list projects";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
