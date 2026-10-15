import { NextResponse } from "next/server";
import { indexStats } from "@/lib/ai/embed-store";

// GET /api/ai/embeddings — local embedding index stats (for Settings UI).
export async function GET() {
  try {
    const stats = indexStats();
    return NextResponse.json({
      ok: true,
      stats: { chunks: stats.chunks, projects: stats.projects, embedded: stats.embedded, dim: stats.dim },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read index" },
      { status: 500 }
    );
  }
}
