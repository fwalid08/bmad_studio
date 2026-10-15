---
title: "Fix New BMAD Project modal overflow"
type: "bugfix"
ticket: ""
created: "2026-10-14"
status: "done"
baseline_revision: "2b310af6ad13dcd41dd88f325314981951074720"
route: "oneshot"
route_source: "auto"
risk: "low"
review: ""
review_source: ""
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The New BMAD Project form content extends horizontally beyond its dialog, making fields and controls appear outside the modal boundary.

**Approach:** Constrain the modal content to one flexible grid column and allow its contents to shrink, scoped only to this project-creation dialog.

</frozen-after-approval>

## Implementation Notes

Oneshot is appropriate because the expected source change is one className edit in one file. The shared DialogContent primitive remains unchanged unless verification disproves the local fix.

## Verification

**Commands:**

- `bun run lint` -- expected: ESLint completes without errors.

**Manual checks:**

- Open `/projects` at desktop and mobile widths; confirm all form content stays inside the dialog and no horizontal overflow appears.
