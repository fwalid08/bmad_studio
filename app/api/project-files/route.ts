import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { STEPS } from "@/lib/bmad/roadmap";

const SUBDIR = "docs/bmad";

/** Filename yang boleh ditulis/dibaca — persis output tiap step + AGENTS.md di root. */
const ALLOWED = new Set(STEPS.map((s) => s.output));

function targetFor(directory: string, filename: string): string | null {
  if (!ALLOWED.has(filename) || filename.includes("/") || filename.includes("\\") || filename.includes("..")) return null;
  if (filename === "AGENTS.md") return path.join(directory, filename);
  return path.join(directory, SUBDIR, filename);
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

// Tulis artefak ke folder project: docs/bmad/<output> (AGENTS.md ke root).
export async function POST(req: Request) {
  let body: { directory?: unknown; files?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Invalid JSON body");
  }
  const directory = typeof body.directory === "string" ? body.directory.trim() : "";
  if (!directory || !path.isAbsolute(directory)) return bad("Missing or invalid directory");
  if (!Array.isArray(body.files)) return bad("Missing files");

  const written: string[] = [];
  const skipped: string[] = [];
  try {
    await mkdir(path.join(directory, SUBDIR), { recursive: true });
    for (const f of body.files as Array<{ filename?: unknown; content?: unknown }>) {
      const filename = typeof f?.filename === "string" ? f.filename : "";
      const content = typeof f?.content === "string" ? f.content : "";
      const target = targetFor(directory, filename);
      if (!target || !content.trim()) {
        skipped.push(filename || "(tanpa nama)");
        continue;
      }
      await writeFile(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
      written.push(filename);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Write failed", written, skipped },
      { status: 502 }
    );
  }
  return NextResponse.json({ written, skipped, dir: SUBDIR });
}

// Baca kembali artefak dari folder project (untuk impor).
export async function GET(req: Request) {
  const directory = new URL(req.url).searchParams.get("directory")?.trim() ?? "";
  if (!directory || !path.isAbsolute(directory)) return bad("Missing or invalid directory");
  const files: Record<string, string> = {};
  for (const s of STEPS) {
    const target = targetFor(directory, s.output);
    if (!target) continue;
    try {
      const content = await readFile(target, "utf8");
      if (content.trim()) files[s.output] = content;
    } catch {
      /* file belum ada — lewati */
    }
  }
  return NextResponse.json({ files, dir: SUBDIR });
}
