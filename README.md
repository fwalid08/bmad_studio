# BMAD Studio

A guided web studio for creating software with the **BMAD Method**
(*Agile AI-Driven Development*). Move a project through the method's phases —
**Clarify → Plan → Ship** — producing the same artifacts BMAD expects (Brief,
PRD, DESIGN/EXPERIENCE, Architecture, Epics & Stories, `sprint-status.yaml`),
with the five BMAD specialist agents guiding each step.

BMAD Studio is **powered by your local OpenCode server**. All AI reasoning and
building runs through OpenCode chat sessions — models, providers, and API keys
are managed straight from the app's Settings.

## What it does

- **Projects** — create projects right-sized to the work (Express / Light / Full),
  with per-phase progress and the recommended next step. Each project maps to a
  **working directory (folder)** that matches a project in OpenCode, and uses a
  **single OpenCode chat session** for both guidance and builds.
- **Workspace** — the full BMAD roadmap on the left, a guided **wizard** or
  **Markdown editor** in the middle, and your **BMAD agent** on the right.
- **Rencana & Eksekusi** — work the BMAD roadmap: the agent drafts the planning
  artifacts step by step (each chained from the artifacts already written), then
  **builds and verifies real code** in the project's folder via
  the OpenCode build agent — installing dependencies, running builds/tests, and
  fixing itself until done. Watch it work in a live activity log.
- **Agents** — Mary 📊 (Analyst), John 📋 (PM), Sally 🎨 (UX), Winston 🏗️
  (Architect), Amelia 💻 (Dev), each in their own voice.
- **Export** — download any artifact (`.md` / `.yaml`) to carry into your AI
  coding tool, exactly as BMAD intends.

## AI powered by local OpenCode

Every AI feature runs through a **local `opencode serve` instance**. The app talks
to it over HTTP via the official `@opencode-ai/sdk` (server-only) through the
app's own `/api/opencode/*` routes:

- **Model list** comes straight from the server (`provider.list()`), so you see
  every model your configured providers expose.
- **Provider API keys** are set via the server's `auth` endpoint and stored by
  OpenCode on disk — **never in your browser**. Set a key in Settings and the
  matching provider shows up as "connected".
- **Projects = folders.** Each BMAD project stores an absolute `directory`. All
  chat and build calls are scoped to that folder (OpenCode accepts a
  `?directory=` on every endpoint), so the app and OpenCode share the same view
  of your projects.
- **One chat session per project.** Guidance (agent panel), artifact drafting
  (plan workspace), and the build (execution) all reuse the same OpenCode session
  in that folder.

### Requirements

- The **OpenCode CLI** installed (`curl -fsSL https://opencode.ai/install | bash`).
  The app uses the server at `http://127.0.0.1:4096` by default and will try to
  start `opencode serve` on first use if nothing is listening (override with
  `OPENCODE_SERVER_URL`).
- A **provider + model** configured — add a provider API key in **Settings** and
  pick a default model.

Security note: builds run **on this server**, in the project's folder, via the
OpenCode build agent (which has file/bash tools and auto-approves permissions).
Use only for local/personal projects — **never on a public deployment**. (The
OpenCode SDK is server-only; externalized via `serverExternalPackages` and never
shipped to the browser.)

Routes: `/api/opencode/{providers,auth/[id],projects,agents,sessions,messages,chat,stream,status}`.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
shadcn/ui (Radix) · Zustand (persisted to `localStorage`) ·
OpenCode (agentic coding backend via its local server + official SDK) · bun.

## Getting started

```bash
bun install
bun dev        # http://localhost:3000
```

Make sure the OpenCode CLI is installed. On first use the app will start
`opencode serve` (or connect to one already running on port 4096).

Other scripts:

```bash
bun run build   # production build
bun run start   # serve the production build
bun run lint    # eslint
```

## Project layout

```
app/
  menu/                 landing / dashboard (nav)
  projects/             project list + creation (with directory picker)
  projects/[id]/        the BMAD workspace (roadmap + wizard + agent)
  settings/             OpenCode server status, providers, model + agent defaults
  api/opencode/         proxy routes to the local OpenCode server
    providers/          list providers + models (GET)
    auth/[id]/          set a provider API key (PUT)
    projects/           list OpenCode project folders (GET)
    agents/             list agents (GET)
    sessions/           list / create chat sessions (GET/POST)
    messages/           load a session's chat history (GET)
    chat/               one guidance/draft turn (POST, tools off)
    stream/             build turn streamed as SSE (POST, tools on)
    status/             server health + current path (GET)
components/
  ui/                   shadcn/ui primitives
  bmad/                 phase-stepper, agent-panel, artifact-editor,
                        plan-workspace, build-panel, activity-log,
                        directory-picker
  layout/               site-header
lib/
  bmad/                 roadmap, agents, templates, types (the BMAD model)
  opencode/             OpenCode integration (server, client, events, messages, types)
  store.ts              Zustand store (projects, artifacts, settings)
```

## Notes & next steps

- Project metadata + artifacts are stored locally in the browser. API keys and
  sessions live on the OpenCode server. The store is structured so it can be
  migrated to a backend (Postgres/Supabase) and multi-user auth later.
- The roadmap, agent roster, skill codes, and artifact names mirror the official
  `bmad-method` `module-help.csv`.
