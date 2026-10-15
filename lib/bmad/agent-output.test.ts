import test from "node:test";
import assert from "node:assert/strict";

import {
  guidanceOutputRequirements,
  guidanceRequestMessage,
  normalizeAgentGuidance,
} from "./agent-output";

test("puts Brainstorming format constraints in the actual user message", () => {
  const message = guidanceRequestMessage("brainstorming", "Brainstorming");

  assert.match(message, /live conversation, not an artifact-writing request/);
  assert.match(message, /exactly two short plain-text paragraphs/);
  assert.match(message, /one compound question/);
  assert.match(message, /Do not include a heading, list, explanation, process narration/);
});

test("uses a real session kickoff format for Brainstorming guidance", () => {
  const result = guidanceOutputRequirements("brainstorming");

  assert.match(result, /actual user-facing brainstorming session/);
  assert.match(result, /exactly two short plain-text paragraphs/);
  assert.match(result, /one compound opening question/);
  assert.match(result, /Do not use Markdown, headings, lists, emojis, preambles, generic guidance, or process narration/);
  assert.match(result, /user's language/);
  assert.doesNotMatch(result, /## Recommended structure/);
});

test("keeps generic guidance requirements for other steps", () => {
  const result = guidanceOutputRequirements("prd");

  assert.match(result, /## Recommended structure/);
  assert.doesNotMatch(result, /one compound opening question/);
});

test("wraps plain text guidance in a markdown heading", () => {
  const result = normalizeAgentGuidance("PRD", "Need to clarify user value\n\nThen define scope.");
  assert.match(result, /^## Guidance for PRD/);
  assert.match(result, /Need to clarify user value/);
});

test("keeps existing markdown output intact", () => {
  const input = "## Key questions\n\n- Who is the user?";
  assert.equal(normalizeAgentGuidance("UX", input), input);
});

test("keeps Brainstorming kickoff as plain text without adding a Markdown heading", () => {
  const input = "Kita akan merancang fitur untuk aplikasi ini.\n\nApa tujuan utamanya?";
  assert.equal(normalizeAgentGuidance("Brainstorming", input, true), input);
});
