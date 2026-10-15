import { NextResponse } from "next/server";
import { readProjectsFile, writeProjectsFile } from "@/lib/opencode/server";

export async function GET() {
  const { projects, persisted } = readProjectsFile();
  return NextResponse.json({ projects, persisted });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      projects?: unknown;
    };
    const { count } = writeProjectsFile(body.projects);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save projects",
      },
      { status: 400 }
    );
  }
}
