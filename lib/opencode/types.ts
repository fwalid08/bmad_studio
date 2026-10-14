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
  kind: "info" | "thought" | "tool_call" | "tool_result" | "error" | "done";
  title: string;
  detail?: string;
}
