/**
 * Normalizer Markdown untuk artefak BMAD Studio.
 *
 * Masalah yang sering bikin preview "tidak ter-render":
 * - agent membungkus seluruh draft dengan ```markdown ... ``` fence
 * - frontmatter `--- ... ---` ikut ke-render sebagai hr + teks
 * - heading / list / table / fence / blockquote menempel tanpa baris kosong
 * - single newline yang dimaksud sebagai baris baru hilang di preview
 * - 3+ baris kosong beruntun / trailing whitespace
 *
 * Fungsi ini ringan (tanpa dependency) supaya bisa dipakai di browser
 * saat preview dan saat tombol "Format" ditekan.
 */

export function stripCodeFenceWrapper(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/^```(?:markdown|md|yaml|yml)?\s*\n([\s\S]*?)\n```\s*$/i);
  return m ? m[1].trim() : input;
}

export function stripFrontmatter(input: string): string {
  if (!input.startsWith("---")) return input;
  const lines = input.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") {
      return lines.slice(i + 1).join("\n").replace(/^\n+/, "");
    }
  }
  return input;
}

const BLOCK_START =
  /^(#{1,6}\s|>\s?|\|.*\||\s*([-+*]|\d+[.)])\s+|\s*```|---\s*$|\*\*\*\s*$|___\s*$)/;

export function normalizeMarkdown(input: string): string {
  if (!input.trim()) return "";

  let text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = stripCodeFenceWrapper(text.trim());
  text = stripFrontmatter(text);

  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");

    if (/^\s*```/.test(line)) {
      if (!inFence && out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
      }
      out.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (BLOCK_START.test(line.trimStart() ? line : line.trim())) {
      const prev = out[out.length - 1];
      if (prev !== undefined && prev !== "" && prev.trim() !== "") {
        // Jangan sisipkan baris kosong di dalam tabel GFM yang berurutan.
        const prevIsTable = /^\|.*\|/.test(prev.trim());
        const curIsTable = /^\|.*\|/.test(line.trim());
        if (!(prevIsTable && curIsTable)) {
          out.push("");
        }
      }
    }
    out.push(line);
  }

  return (
    out
      .join("\n")
      // collapse 3+ blank lines -> 2 newlines (1 empty line)
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
