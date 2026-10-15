---
title: "Format Brainstorming Agent Guidance"
type: "bugfix"
ticket: ""
created: "2026-10-15"
status: "built"
baseline_revision: "2b310af6ad13dcd41dd88f325314981951074720"
route: "oneshot"
route_source: "auto"
risk: "low"
review: "quick"
review_source: "pinned"
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Brainstorming guidance can expose the model's process narration and a generic checklist instead of starting the user-facing BMAD brainstorming session.

**Approach:** Add a Brainstorming-specific prompt contract that tells the agent to respond in the user's language, begin the actual session with BMAD's compound topic-and-goal question, and omit internal process narration. Preserve the existing generic guidance behavior for every other step.

</frozen-after-approval>

## Implementation Notes

One-shot is appropriate because the change is isolated to the guidance prompt and its focused unit test, with no API, persistence, or UI behavior changes. Added a Brainstorming-only output contract; all other steps retain the prior generic format.

Focused tests and lint passed. An independent reviewer was not launched because this session cannot delegate; no issues were found in the local check.

## Verification

**Commands:**

- `bun test lib/bmad/agent-output.test.ts` -- expected: focused guidance contract tests pass.
- `bun run lint -- components/bmad/agent-panel.tsx lib/bmad/agent-output.ts lib/bmad/agent-output.test.ts` -- expected: ESLint completes without errors for touched files.
