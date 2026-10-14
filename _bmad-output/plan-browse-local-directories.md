---
title: 'Browse Local Directories in Project Picker'
type: 'feature'
ticket: ''
created: '2026-10-14'
status: 'built'
baseline_revision: '2b310af6ad13dcd41dd88f325314981951074720'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The project directory picker only lists folders already known to OpenCode, so a valid local folder cannot be selected unless it has already been opened there.

**Approach:** Add read-only local directory browsing to the picker, starting in the user's home directory and allowing navigation to select a folder. Keep OpenCode-known projects as quick picks and preserve the absolute-path input.

</frozen-after-approval>

## Tasks & Acceptance

**Execution:**
- [x] `app/api/opencode/directories/route.ts` -- list child directories for a requested path, defaulting to the user's home -- provide local filesystem data without exposing file contents.
- [x] `lib/opencode/client.ts` -- add the typed directories fetch helper -- keep API calls behind the existing client abstraction.
- [x] `components/bmad/directory-picker.tsx` -- add parent/child navigation and a way to select the displayed folder -- make local folders selectable without removing OpenCode project shortcuts or path entry.

**Acceptance Criteria:**
- Given a local directory not known to OpenCode, when the user browses to it and selects it, then its absolute path becomes the project working directory.
- Given a directory containing subdirectories, when the user opens it in the picker, then only child directories are listed and the user can navigate to the parent.
- Given an invalid or unreadable path, when the picker requests its contents, then it displays a useful error and remains usable.

## Implementation Notes

One-shot is appropriate: the behavior is isolated to one API route, the existing typed fetch client, and the directory picker, with no expected data-model or persistence changes.

Implemented a read-only route defaulting to `homedir()`, with child-directory paths and a parent path. The picker can browse, move up, and select the current folder; existing OpenCode project shortcuts and manual path entry remain available.

Quick review identified directory symlinks being omitted. The route now follows symlinks when checking whether their targets are directories; temporary endpoint checks confirmed directory links are included and file links are excluded.

## Review Triage Log

- medium, patched -- the original directory-only filter hid symlinks to directories; verified the updated route includes a directory symlink and excludes a file symlink.

## Verification

**Commands:**
- `bun run lint` -- expected: ESLint completes without errors.
- `bun run build` -- expected: Next.js production build completes.
- `curl` against `/api/opencode/directories?path=...` -- returned local child directories including the workspace.

**Manual checks:**
- Open the project picker, browse to a local folder that is not an OpenCode project, select it, and confirm its absolute path is used.
- Navigate into a child and back to its parent; verify OpenCode project shortcuts and manual path entry still work.
- Browser verification confirmed local folder navigation and selection updated the working-directory input without saving a project.