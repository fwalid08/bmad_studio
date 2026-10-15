// Splitting long artifacts into overlapping chunks for embedding-based
// retrieval, plus a cheap "outline" (headings + one-line summary) so prompts
// keep the shape of every prior phase without shipping the full text.

export interface Chunk {
  index: number;
  /** Nearest heading above this chunk ("" when none). */
  heading: string;
  text: string;
}

export interface ArtifactOutline {
  /** Markdown headings in document order (max ~30). */
  headings: string[];
  /** First meaningful non-heading line, truncated. */
  summary: string;
}

/** Rough token estimate (~4 chars/token is close enough for chunk sizing). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitBlocks(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function headingOf(block: string): string | null {
  const m = /^#{1,6}\s+(.+)$/.exec(block);
  return m ? m[1].trim() : null;
}

/**
 * Chunk markdown into ~maxTokens blocks with ~overlapTokens of carry-over from
 * the previous chunk. Section headings are tracked so each chunk stays
 * self-describing after retrieval.
 */
/**
 * Chunk markdown into roughly `maxTokens` blocks with ~`overlapTokens` of
 * carry-over from the previous chunk, so context is not lost at the seam.
 *
 * Sections (markdown headings) are the primary unit: greedy-merging whole
 * sections keeps every chunk self-describing. Oversized content is hard-split
 * on line, then sentence, then word boundaries.
 */
export function chunkMarkdown(
  text: string,
  opts: { maxTokens?: number; overlapTokens?: number } = {}
): Chunk[] {
  const maxTokens = opts.maxTokens ?? 800;
  const overlapTokens = opts.overlapTokens ?? 200;
  const blocks = splitBlocks(text);
  if (blocks.length === 0) return [];

  type Section = { heading: string; body: string[] };
  const sections: Section[] = [];
  // A heading starts a new section; leading prose before the first heading is
  // kept as an untitled section so nothing is dropped.
  for (const block of blocks) {
    const heading = headingOf(block);
    if (heading !== null) {
      sections.push({ heading, body: [block] });
      continue;
    }
    const last = sections[sections.length - 1];
    if (last) last.body.push(block);
    else sections.push({ heading: "", body: [block] });
  }

  const chunks: Omit<Chunk, "index">[] = [];
  const push = (heading: string, text: string) => {
    const trimmed = text.trim();
    if (trimmed) chunks.push({ heading, text: trimmed });
  };

  let buffer: string[] = [];
  let bufferTokens = 0;
  let bufferHeading = "";

  const flush = () => {
    if (buffer.length === 0) return;
    push(bufferHeading, buffer.join("\n\n"));
    // Carry the tail over so the next chunk keeps context across the seam.
    const tail: string[] = [];
    let tailTokens = 0;
    for (let i = buffer.length - 1; i >= 0; i--) {
      const t = estimateTokens(buffer[i]);
      if (tailTokens + t > overlapTokens) break;
      tail.unshift(buffer[i]);
      tailTokens += t;
    }
    buffer = tail;
    bufferTokens = tailTokens;
  };

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.body.join("\n\n"));

    if (sectionTokens > maxTokens) {
      // Big section: walk its blocks individually so overlap + heading carry
      // still apply. Only a single oversized block gets hard-split.
      if (buffer.length > 0) flush();
      for (const block of section.body) {
        const blockTokens = estimateTokens(block);
        if (blockTokens > maxTokens) {
          if (buffer.length > 0) flush();
          for (const part of splitTextByTokens(block, maxTokens)) {
            push(section.heading, part);
          }
          continue;
        }
        if (buffer.length > 0 && bufferTokens + blockTokens > maxTokens) flush();
        if (buffer.length === 0) bufferHeading = section.heading;
        buffer.push(block);
        bufferTokens += blockTokens;
      }
      continue;
    }

    if (buffer.length > 0 && bufferTokens + sectionTokens > maxTokens) flush();
    if (buffer.length === 0) bufferHeading = section.heading;
    buffer.push(...section.body);
    bufferTokens += sectionTokens;
  }
  flush();

  return chunks.map((c, i) => ({ ...c, index: i }));
}

/** Hard-split free-form text into token-bounded parts. */
function splitTextByTokens(text: string, maxTokens: number): string[] {
  const out: string[] = [];
  let bucket = "";
  for (const unit of text.split(/(?<=\n)|(?<=\. )/)) {
    if (bucket && estimateTokens(bucket) + estimateTokens(unit) > maxTokens) {
      out.push(bucket.trim());
      bucket = "";
    }
    bucket += unit;
    // A single unit bigger than the budget: fall back to word-level slicing.
    while (estimateTokens(bucket) > maxTokens) {
      const words = bucket.split(" ");
      let acc = "";
      for (const w of words) {
        if (acc && estimateTokens(`${acc} ${w}`) > maxTokens) {
          out.push(acc.trim());
          acc = w;
        } else {
          acc += acc ? ` ${w}` : w;
        }
      }
      bucket = acc;
    }
  }
  if (bucket.trim()) out.push(bucket.trim());
  return out.filter(Boolean);
}

/** Headings + first meaningful line, for the always-present phase outline. */
export function markdownOutline(text: string, maxHeadings = 30): ArtifactOutline {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headings: string[] = [];
  let summary = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    if (h) {
      if (headings.length < maxHeadings) headings.push(h[1].trim());
      continue;
    }
    if (!summary && !/^[-*>\s|`_]/.test(line) && line.length > 12) {
      summary = line.length > 180 ? `${line.slice(0, 177)}…` : line;
    }
  }
  return { headings, summary };
}

/** Stable short hash used to detect whether a chunk needs re-embedding. */
export function textHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 ^ c) * 0x01000193;
    h2 = (h2 + c * (i + 1)) * 0x85ebca6b;
  }
  const a = (h1 >>> 0).toString(36);
  const b = (h2 >>> 0).toString(36);
  return `${a}${b}`;
}

/** Cosine similarity; 0 for degenerate vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
