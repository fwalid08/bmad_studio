import test from "node:test";
import assert from "node:assert/strict";

import { guidanceOutputRequirements, normalizeAgentGuidance } from "./agent-output";

test("uses a real session kickoff format for Brainstorming guidance", () => {
  const result = guidanceOutputRequirements("brainstorming");

  assert.match(result, /actual user-facing brainstorming session/);
  assert.match(result, /one compound opening question/);
  assert.match(result, /Never narrate internal reasoning/);
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
