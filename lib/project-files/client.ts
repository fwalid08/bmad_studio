// Browser-side helpers untuk sync artefak ke folder project (docs/bmad/).
// Pure fetch — penulisan file dikerjakan server Next (punya akses fs).
"use client";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const projectFiles = {
  /** Tulis artefak ke <directory>/docs/bmad (AGENTS.md ke root). */
  sync: (directory: string, files: Array<{ filename: string; content: string }>) =>
    json<{ written: string[]; skipped: string[]; dir: string }>("/api/project-files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory, files }),
    }),

  /** Baca artefak yang ada di folder (key = output filename). */
  read: (directory: string) =>
    json<{ files: Record<string, string>; dir: string }>(
      `/api/project-files?directory=${encodeURIComponent(directory)}`
    ),
};
