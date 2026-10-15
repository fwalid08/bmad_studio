// Server-only access to the local OpenCode v2 server.
//
// The app talks to OpenCode via `@opencode/client` (v2 API):
//   OpenCode.make({ baseUrl, headers: { Authorization } })
// Every `/api/*` endpoint needs HTTP Basic auth:
//   `Basic base64("opencode:<server-password>")`.
//
// Credentials are server-side only and never sent to the browser:
//   1. OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD env
//   2. BMAD Studio Settings in ~/.config/bmad-studio/opencode.json
//   3. ~/.config/opencode/service.json { "password" } (background service)
//   4. Generated password for a server we spawn ourselves.
//
// When no usable server answers at OPENCODE_SERVER_URL (default
// http://127.0.0.1:4096), we spawn `opencode serve` with our own password.
// An orphan server whose password is lost can never be used, so we never
// adopt one blindly. Requests scope to a folder via `location: { directory }`.

import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { OpenCode } from "@opencode/client";

export type OpenCodeClient = ReturnType<typeof OpenCode.make>;

export const OPENCODE_PORT = 4096;
const DEFAULT_BASE = `http://127.0.0.1:${OPENCODE_PORT}`;
const DEFAULT_USERNAME = "opencode";
const CONFIG_DIR = join(homedir(), ".config", "bmad-studio");
const CONFIG_FILE = join(CONFIG_DIR, "opencode.json");
const PROJECTS_FILE = join(CONFIG_DIR, "projects.json");

interface PersistedServerSettings {
  opencodeServerUrl?: string;
  username?: string;
  password?: string;
  autoStart?: boolean;
  defaultModel?: string;
  defaultAgent?: string;
  buildAgent?: string;
  guidanceMode?: string;
}

function readConfig(): PersistedServerSettings {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as PersistedServerSettings;
  } catch {
    return {};
  }
}

function writeConfig(patch: Partial<PersistedServerSettings>): PersistedServerSettings {
  const settings = { ...readConfig(), ...patch };
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
  return settings;
}

export interface ProjectsFile {
  /** Raw parsed value; callers validate/normalize the shape. */
  projects: unknown;
  /** False when no file exists yet (first run). */
  persisted: boolean;
}

/** Read the server-side projects file (`~/.config/bmad-studio/projects.json`). */
export function readProjectsFile(): ProjectsFile {
  try {
    if (!existsSync(PROJECTS_FILE)) return { projects: [], persisted: false };
    const parsed: unknown = JSON.parse(readFileSync(PROJECTS_FILE, "utf8"));
    const projects = (parsed as { projects?: unknown })?.projects ?? parsed;
    return { projects, persisted: true };
  } catch {
    return { projects: [], persisted: false };
  }
}

/**
 * Atomically replace the server-side projects file (write temp + rename).
 * Expects an array; minimal shape validation happens here, full
 * normalization happens on the client.
 */
export function writeProjectsFile(projects: unknown): { count: number } {
  if (!Array.isArray(projects)) throw new Error("Projects payload must be an array.");
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${PROJECTS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ projects }, null, 2), { mode: 0o600 });
  renameSync(tmp, PROJECTS_FILE);
  chmodSync(PROJECTS_FILE, 0o600);
  return { count: projects.length };
}

export function readPersistedBaseUrl(): string | undefined {
  const value = readConfig().opencodeServerUrl;
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export function persistConfiguredBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("OpenCode server URL cannot be empty.");
  writeConfig({ opencodeServerUrl: trimmed });
  return trimmed;
}

export function readServerSettings() {
  const config = readConfig();
  return {
    opencodeServerUrl:
      process.env.OPENCODE_SERVER_URL?.trim() || config.opencodeServerUrl || DEFAULT_BASE,
    username: configuredUsername(),
    passwordConfigured: Boolean(envPassword() || config.password),
    autoStart: config.autoStart !== false,
    defaultModel: config.defaultModel,
    defaultAgent: config.defaultAgent,
    buildAgent: config.buildAgent,
    guidanceMode: config.guidanceMode,
  };
}

export async function hasConfiguredPassword(): Promise<boolean> {
  return Boolean(envPassword() || readConfig().password || (await servicePassword()));
}

export function persistServerSettings(input: {
  opencodeServerUrl?: string;
  username?: string;
  password?: string;
  defaultModel?: string;
  defaultAgent?: string;
  buildAgent?: string;
  guidanceMode?: string;
}): { opencodeServerUrl: string; username: string } {
  const patch: Partial<PersistedServerSettings> = {};
  if (input.opencodeServerUrl !== undefined) {
    const value = input.opencodeServerUrl.trim().replace(/\/+$/, "");
    if (!value) throw new Error("OpenCode server URL cannot be empty.");
    patch.opencodeServerUrl = value;
  }
  if (input.username !== undefined) {
    const value = input.username.trim();
    if (!value) throw new Error("OpenCode server username cannot be empty.");
    patch.username = value;
  }
  if (input.password) patch.password = input.password;
  const studioKeys = ["defaultModel", "defaultAgent", "buildAgent", "guidanceMode"] as const;
  const hasStudioPatch = studioKeys.some((key) => input[key] !== undefined);
  if (hasStudioPatch) {
    // Studio defaults share the same JSON file. Apply them directly to the
    // stored config so an empty string clears the override (client falls back
    // to its built-in default) instead of persisting an empty value.
    const current = readConfig();
    for (const key of studioKeys) {
      if (input[key] === undefined) continue;
      const value = input[key]?.trim();
      if (key === "guidanceMode") {
        if (value !== "opencode" && value !== "direct") {
          throw new Error('Guidance mode must be "opencode" or "direct".');
        }
        current[key] = value;
        continue;
      }
      if (value) current[key] = value;
      else delete current[key];
    }
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...patch }, null, 2), {
      mode: 0o600,
    });
    chmodSync(CONFIG_FILE, 0o600);
    const config = readConfig();
    return {
      opencodeServerUrl: config.opencodeServerUrl || configuredBaseUrl(),
      username: configuredUsername(),
    };
  }
  const config = writeConfig(patch);
  return {
    opencodeServerUrl: config.opencodeServerUrl || configuredBaseUrl(),
    username: configuredUsername(),
  };
}

let handle: { baseUrl: string; password: string } | undefined;
let starting: Promise<{ baseUrl: string; password: string }> | undefined;
let ownedProc: ChildProcess | undefined;

function autoStartEnabled(): boolean {
  return readConfig().autoStart !== false;
}

function persistAutoStart(enabled: boolean): void {
  writeConfig({ autoStart: enabled });
}

async function knownPasswords(): Promise<string[]> {
  const values = [envPassword(), readConfig().password, await servicePassword()];
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function findReachableServer(): Promise<{ baseUrl: string; password: string } | undefined> {
  const base = configuredBaseUrl();
  const username = configuredUsername();
  if (handle && (await probe(handle.baseUrl, username, handle.password))) return handle;
  for (const password of await knownPasswords()) {
    if (await probe(base, username, password)) {
      handle = { baseUrl: base, password };
      return handle;
    }
  }
  return undefined;
}

async function stopOwnedServer(): Promise<boolean> {
  const proc = ownedProc;
  if (!proc) return false;
  ownedProc = undefined;
  handle = undefined;
  if (proc.exitCode !== null || proc.signalCode !== null) return true;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 5000);
    proc.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    proc.kill("SIGTERM");
  });
  return true;
}

/** Resolve the configured base URL (env override, then persisted config, else default). */
export function configuredBaseUrl(): string {
  return (
    process.env.OPENCODE_SERVER_URL?.trim() ||
    readPersistedBaseUrl() ||
    DEFAULT_BASE
  ).replace(/\/+$/, "");
}

/** Basic auth header for the v2 API. */
export function basicAuthHeader(password: string, username = configuredUsername()): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function configuredUsername(): string {
  return process.env.OPENCODE_SERVER_USERNAME?.trim() || readConfig().username?.trim() || DEFAULT_USERNAME;
}

function envPassword(): string | undefined {
  return (
    process.env.OPENCODE_SERVER_PASSWORD?.trim() ||
    process.env.OPENCODE_PASSWORD?.trim() ||
    undefined
  );
}

async function servicePassword(): Promise<string | undefined> {
  try {
    const raw = await readFile(join(homedir(), ".config", "opencode", "service.json"), "utf8");
    const parsed = JSON.parse(raw) as { password?: unknown };
    return typeof parsed.password === "string" && parsed.password ? parsed.password : undefined;
  } catch {
    return undefined;
  }
}

async function authedFetch(
  base: string,
  username: string,
  password: string,
  path: string,
  timeoutMs = 3000
) {
  return fetch(`${base}${path}`, {
    headers: { Authorization: basicAuthHeader(password, username) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** True when the server answers JSON (not SPA html) with this password. */
async function probe(base: string, username: string, password: string): Promise<boolean> {
  try {
    const res = await authedFetch(base, username, password, "/api/info");
    if (!res.ok) return false;
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return false;
    const body = (await res.json().catch(() => null)) as { version?: unknown } | null;
    return !!body && typeof body.version === "string";
  } catch {
    return false;
  }
}

async function waitForServer(
  base: string,
  username: string,
  password: string,
  timeoutMs = 25_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      if (await probe(base, username, password)) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `OpenCode server did not become ready at ${base}${lastErr ? `: ${String(lastErr)}` : ""}`
  );
}

function spawnOwnedServer(
  base: string,
  username: string,
  password: string
): Promise<{ baseUrl: string; password: string }> {
  const url = new URL(base);
  const hostname = url.hostname || "127.0.0.1";
  const port = url.port || String(OPENCODE_PORT);
  const proc = spawn("opencode", ["serve", `--hostname=${hostname}`, `--port=${port}`], {
    env: {
      ...process.env,
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  ownedProc = proc;
  void ownedProc;
  let spawnError: Error | undefined;
  proc.on("error", (err) => {
    spawnError = new Error(
      `Failed to start "opencode" (${err.message}). Is the OpenCode CLI installed? ` +
        `Install: curl -fsSL https://opencode.ai/install | bash`
    );
  });
  proc.stderr?.on("data", () => {});
  return (async () => {
    await waitForServer(base, username, password);
    if (spawnError) throw spawnError;
    return { baseUrl: base, password };
  })();
}

/** Ensure a server we can authenticate to (adopt or spawn owned). */
async function ensureHandle(): Promise<{ baseUrl: string; password: string }> {
  const existing = await findReachableServer();
  if (existing) return existing;
  if (!autoStartEnabled()) {
    throw new Error("OpenCode server is stopped. Start it from Settings to reconnect.");
  }
  const base = configuredBaseUrl();
  if (starting) return starting;
  const username = configuredUsername();
  const password = (await knownPasswords())[0] ?? randomBytes(24).toString("base64url");
  if (!envPassword() && !readConfig().password && !(await servicePassword())) {
    writeConfig({ username, password });
  }
  starting = spawnOwnedServer(base, username, password).finally(() => {
    starting = undefined;
  });
  handle = await starting;
  return handle;
}

/** Authenticated v2 client for the shared server. */
export async function clientFor(): Promise<OpenCodeClient> {
  const h = await ensureHandle();
  return OpenCode.make({
    baseUrl: h.baseUrl,
    headers: { Authorization: basicAuthHeader(h.password) },
  });
}

/** Low-level handle (base URL + password) for raw fetch calls (e.g. SSE). */
export async function serverHandle(): Promise<{ baseUrl: string; password: string }> {
  return ensureHandle();
}

/** Server info for Settings (never exposes the password). */
export async function serverInfo(): Promise<{
  healthy: boolean;
  baseUrl: string;
  version?: string;
  error?: string;
  username: string;
  managed: boolean;
  canStop: boolean;
  autoStart: boolean;
}> {
  const base = configuredBaseUrl();
  const username = configuredUsername();
  const autoStart = autoStartEnabled();
  try {
    const h = autoStart ? await ensureHandle() : await findReachableServer();
    if (!h) {
      return {
        healthy: false,
        baseUrl: base,
        error: "OpenCode server is stopped. Start it from Settings to reconnect.",
        username,
        managed: false,
        canStop: false,
        autoStart,
      };
    }
    const res = await authedFetch(h.baseUrl, username, h.password, "/api/info");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = (await res.json()) as { version?: string };
    const managed = Boolean(ownedProc && ownedProc.exitCode === null && ownedProc.signalCode === null);
    return { healthy: true, baseUrl: h.baseUrl, version: info.version, username, managed, canStop: managed, autoStart };
  } catch (e) {
    return {
      healthy: false,
      baseUrl: base,
      error: e instanceof Error ? e.message : "Unreachable",
      username,
      managed: false,
      canStop: false,
      autoStart,
    };
  }
}

export async function startServer() {
  persistAutoStart(true);
  handle = undefined;
  try {
    await ensureHandle();
    return serverInfo();
  } catch (error) {
    persistAutoStart(false);
    handle = undefined;
    throw error;
  }
}

export async function stopServer() {
  if (!ownedProc) {
    if (await findReachableServer()) {
      throw new Error("This OpenCode server is managed outside BMAD Studio and cannot be stopped here.");
    }
    persistAutoStart(false);
    handle = undefined;
    return serverInfo();
  }
  persistAutoStart(false);
  await stopOwnedServer();
  return serverInfo();
}

export async function saveServerSettings(input: {
  opencodeServerUrl?: string;
  username?: string;
  password?: string;
  defaultModel?: string;
  defaultAgent?: string;
  buildAgent?: string;
  guidanceMode?: string;
}) {
  const saved = persistServerSettings(input);
  // Studio default changes don't affect the running server connection, so only
  // restart the owned server when connection settings changed.
  if (input.opencodeServerUrl !== undefined || input.username !== undefined || input.password) {
    await stopOwnedServer();
    handle = undefined;
  }
  return saved;
}
