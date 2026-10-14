import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestedPath = new URL(request.url).searchParams.get("path");
  const directory = resolve(requestedPath || homedir());

  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = (
      await Promise.all(
        entries.map(async (entry) => {
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) return { name: entry.name, path };
          if (!entry.isSymbolicLink()) return null;

          try {
            return (await stat(path)).isDirectory() ? { name: entry.name, path } : null;
          } catch {
            return null;
          }
        })
      )
    )
      .filter((entry): entry is { name: string; path: string } => entry !== null)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }));

    return NextResponse.json({ directory, parent: dirname(directory), directories });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read directory";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}