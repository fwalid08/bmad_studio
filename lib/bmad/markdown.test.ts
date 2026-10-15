import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMarkdown } from "./markdown";

test("normalizeMarkdown: unwraps a full-document markdown fence", () => {
  const out = normalizeMarkdown("```markdown\n# Title\n\nBody\n```");
  assert.equal(out, "# Title\n\nBody\n");
});

test("normalizeMarkdown: strips YAML frontmatter", () => {
  const out = normalizeMarkdown("---\ntitle: x\n---\n\n# Title\n");
  assert.equal(out, "# Title\n");
});

test("normalizeMarkdown: inserts blank line before heading/list/fence", () => {
  const out = normalizeMarkdown("# T\nBody\n## Sub\n- a\n- b\n```bash\necho hi\n```");
  assert.match(out, /Body\n\n## Sub/);
  assert.match(out, /## Sub\n\n- a/);
  assert.match(out, /- b\n\n```bash/);
});

test("normalizeMarkdown: keeps GFM table rows together", () => {
  const out = normalizeMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
  assert.equal(out, "| a | b |\n|---|---|\n| 1 | 2 |\n");
});

test("normalizeMarkdown: collapses excess blank lines and empty input", () => {
  assert.equal(normalizeMarkdown("a\n\n\n\nb"), "a\n\nb\n");
  assert.equal(normalizeMarkdown("   \n  "), "");
});
