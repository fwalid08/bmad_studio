// Client-safe types + helpers for talking to OpenCode through the app's own
// API routes. The OpenCode SDK is server-only (Node built-ins), so the browser
// never imports it directly — it calls these routes instead.

/** A provider + one of its models, as a selectable option. */
export interface ModelOption {
  /** Fully-qualified id, e.g. "opencode/big-pickle" or "aicoding/gpt-4o". */
  id: string;
  providerID: string;
  modelID: string;
  name: string;
  /** True when the provider has credentials configured on the server. */
  connected: boolean;
}

/** A provider known to the OpenCode server. */
export interface ProviderInfo {
  id: string;
  name: string;
  /** Environment variable names the provider reads for its key. */
  env: string[];
  /** Whether a key/credential is already set on the server. */
  connected: boolean;
  /** Auth methods available (e.g. "api", "oauth"). */
  authMethods: Array<{ type: string; label: string }>;
  models: ModelOption[];
}

/** Aggregated OpenCode token usage for one run. */
export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  costUsd?: number;
}

/** A project (working directory) known to OpenCode. */
export interface OpenCodeProject {
  id: string;
  /** Absolute path to the project working directory (worktree). */
  worktree: string;
}

/** An agent (e.g. "build", "plan") available on the server. */
export interface OpenCodeAgent {
  name: string;
  description?: string;
  mode: string;
}

/** One chat turn as shown in the UI. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

/** A neutral activity-log line streamed from a build session. */
export interface ActivityEvent {
  kind: "info" | "thought" | "tool_call" | "tool_result" | "error" | "done" | "halt";
  title: string;
  detail?: string;
}

/** A single field of a question form the agent may ask mid-build. */
export interface HaltField {
  key: string;
  /** "string" | "number" | "integer" | "boolean" | "multiselect" | "external" … */
  type: string;
  title?: string;
  description?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

/**
 * A point where the agent paused for a human decision:
 * - `permission` — a tool wants to run and the ruleset says "ask".
 * - `form` — the agent asked a question and is waiting for an answer.
 *
 * The build session stays busy until this is answered, so the stream must
 * surface it (instead of waiting forever for a terminal event).
 */
export interface HaltRequest {
  /** Permission request id, or form id. */
  id: string;
  kind: "permission" | "form";
  title: string;
  message?: string;
  /** Permission resources (permission halts only). */
  resources?: string[];
  /** Form fields (form halts only). */
  fields?: HaltField[];
}
