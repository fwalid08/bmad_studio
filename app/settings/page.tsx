"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  KeyRound,
  Check,
  Loader2,
  Play,
  RefreshCw,
  Server,
  ServerCrash,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStudio } from "@/lib/store";
import { opencode, flattenModels } from "@/lib/opencode/client";
import type { ProviderInfo, ModelOption, OpenCodeAgent } from "@/lib/opencode/types";

interface Status {
  healthy: boolean;
  baseUrl: string;
  error?: string;
  username: string;
  managed: boolean;
  canStop: boolean;
  autoStart: boolean;
}

export default function SettingsPage() {
  const settings = useStudio((s) => s.settings);
  const updateSettings = useStudio((s) => s.updateSettings);
  const settingsRef = useRef(settings);

  const [status, setStatus] = useState<Status | null>(null);
  const [serverUrlDraft, setServerUrlDraft] = useState(() => settings.opencodeServerUrl);
  const [serverUsernameDraft, setServerUsernameDraft] = useState("opencode");
  const [serverPasswordDraft, setServerPasswordDraft] = useState("");
  const [serverPasswordConfigured, setServerPasswordConfigured] = useState(false);
  const [serverSettingsSaving, setServerSettingsSaving] = useState(false);
  const [serverUrlError, setServerUrlError] = useState<string | null>(null);
  const [serverControlBusy, setServerControlBusy] = useState(false);
  const [serverControlError, setServerControlError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agents, setAgents] = useState<OpenCodeAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Agent ids are case-insensitive on the server but we normalize them to
  // lowercase everywhere. If a persisted setting still holds an older
  // capitalized form (e.g. "Plan"), fold it back to lowercase so the Select
  // options match the stored value.
  const syncAgentCase = useCallback(
    (list: OpenCodeAgent[]) => {
      const s = settingsRef.current;
      const names = new Set(list.map((a) => a.name));
      const patch: { defaultAgent?: string; buildAgent?: string } = {};
      if (s.defaultAgent && !names.has(s.defaultAgent)) {
        const lower = s.defaultAgent.toLowerCase();
        if (names.has(lower)) patch.defaultAgent = lower;
      }
      if (s.buildAgent && !names.has(s.buildAgent)) {
        const lower = s.buildAgent.toLowerCase();
        if (names.has(lower)) patch.buildAgent = lower;
      }
      if (patch.defaultAgent || patch.buildAgent) updateSettings(patch);
    },
    [updateSettings]
  );

  const fetchData = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      const settingsRes = await fetch("/api/opencode/settings");
      const serverSettings = (await settingsRes.json()) as {
        opencodeServerUrl: string;
        username: string;
        passwordConfigured: boolean;
      };
      if (!settingsRes.ok) throw new Error("Failed to load OpenCode settings");
      if (!isCurrent()) return;
      setServerUrlDraft(serverSettings.opencodeServerUrl);
      setServerUsernameDraft(serverSettings.username);
      setServerPasswordConfigured(serverSettings.passwordConfigured);

      const statusRes = await fetch("/api/opencode/status");
      const statusData = (await statusRes.json()) as Status;
      if (!isCurrent()) return;
      setStatus(statusData);
      if (!statusData.healthy) {
        setProviders([]);
        setAgents([]);
        setError(null);
        return;
      }

      const [providersRes, agentsRes] = await Promise.all([
        opencode.providers(),
        opencode.agents().catch(() => ({ agents: [] as OpenCodeAgent[] })),
      ]);
      if (!isCurrent()) return;
      setProviders(providersRes.providers);
      setAgents(agentsRes.agents);
      syncAgentCase(agentsRes.agents);
      setError(null);
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : "Failed to load OpenCode info");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [syncAgentCase]);

  async function handleSaveServerSettings() {
    const value = serverUrlDraft.trim();
    if (!value) {
      setServerUrlError("Server URL cannot be empty.");
      return;
    }
    if (!serverUsernameDraft.trim()) {
      setServerUrlError("Server username cannot be empty.");
      return;
    }

    setServerSettingsSaving(true);
    setServerUrlError(null);

    try {
      const res = await fetch("/api/opencode/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          opencodeServerUrl: value,
          username: serverUsernameDraft,
          ...(serverPasswordDraft ? { password: serverPasswordDraft } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        opencodeServerUrl?: string;
        username?: string;
        passwordConfigured?: boolean;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to save server URL");
      }
      const savedUrl = json.opencodeServerUrl ?? value;
      setServerUrlDraft(savedUrl);
      setServerUsernameDraft(json.username ?? serverUsernameDraft.trim());
      setServerPasswordDraft("");
      setServerPasswordConfigured(Boolean(json.passwordConfigured));
      updateSettings({ opencodeServerUrl: savedUrl });
      await fetchData();
    } catch (e) {
      setServerUrlError(e instanceof Error ? e.message : "Failed to save server URL");
    } finally {
      setServerSettingsSaving(false);
    }
  }

  async function handleServerControl(action: "start" | "stop") {
    setServerControlBusy(true);
    setServerControlError(null);
    try {
      const res = await fetch("/api/opencode/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const nextStatus = (await res.json()) as Status;
      setStatus(nextStatus);
      if (!res.ok) throw new Error(nextStatus.error ?? `Failed to ${action} server`);
      if (action === "start") {
        await fetchData();
      } else {
        setProviders([]);
        setAgents([]);
        setError(null);
      }
    } catch (e) {
      setServerControlError(e instanceof Error ? e.message : `Failed to ${action} server`);
    } finally {
      setServerControlBusy(false);
    }
  }

  function refresh() {
    setLoading(true);
    void fetchData();
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchData(() => !cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  async function handleSaveKey(providerID: string) {
    const key = keyDrafts[providerID]?.trim();
    if (!key) return;
    setSaving((s) => ({ ...s, [providerID]: true }));
    setError(null);
    try {
      await opencode.setAuth(providerID, key);
      setKeyDrafts((d) => ({ ...d, [providerID]: "" }));
      setSaved((s) => ({ ...s, [providerID]: true }));
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save key");
    } finally {
      setSaving((s) => ({ ...s, [providerID]: false }));
    }
  }

  const models: ModelOption[] = flattenModels(providers);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
        </Link>
        <h1 className="text-xl font-bold">OpenCode Settings</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="ml-1 text-xs">Refresh</span>
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">OpenCode server connection</CardTitle>
          <CardDescription>
            BMAD Studio and its managed OpenCode server use these same Basic Auth credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="opencode-server-url">Server URL</Label>
            <Input
              id="opencode-server-url"
              value={serverUrlDraft}
              onChange={(e) => setServerUrlDraft(e.target.value)}
              placeholder="http://127.0.0.1:4096"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opencode-server-username">Username</Label>
              <Input
                id="opencode-server-username"
                value={serverUsernameDraft}
                onChange={(e) => setServerUsernameDraft(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opencode-server-password">Password</Label>
              <Input
                id="opencode-server-password"
                type="password"
                value={serverPasswordDraft}
                onChange={(e) => setServerPasswordDraft(e.target.value)}
                placeholder={serverPasswordConfigured ? "Configured; blank keeps current" : "Set server password"}
                autoComplete="new-password"
              />
            </div>
          </div>
          {serverUrlError && <p className="text-destructive text-xs">{serverUrlError}</p>}
          <p className="text-muted-foreground text-xs">
            Password is stored only on this machine. Environment variables override saved credentials.
          </p>
          <Button size="sm" onClick={handleSaveServerSettings} disabled={serverSettingsSaving}>
            {serverSettingsSaving ? <Loader2 className="size-4 animate-spin" /> : "Save connection"}
          </Button>
        </CardContent>
      </Card>

      {/* Server status */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4" /> Local OpenCode server
          </CardTitle>
          <CardDescription>
            Start or stop the server managed by BMAD Studio. Externally managed servers must be
            controlled by their own process manager.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {status?.healthy ? (
                <Badge variant="default" className="gap-1">
                  <span className="text-emerald-300">●</span>
                  {status.managed ? "Connected · BMAD Studio" : "Connected · external"}
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <ServerCrash className="size-3" /> {loading ? "Checking…" : "Not reachable"}
                </Badge>
              )}
              <code className="text-muted-foreground text-xs">{status?.baseUrl ?? "—"}</code>
              {status?.username && <span className="text-muted-foreground text-xs">User: {status.username}</span>}
            </div>
            <Button
              size="sm"
              variant={status?.healthy ? "outline" : "default"}
              onClick={() => void handleServerControl(status?.healthy ? "stop" : "start")}
              disabled={!status || loading || serverControlBusy || (status.healthy && !status.canStop)}
            >
              {serverControlBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : status?.healthy ? (
                <Square className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {status?.healthy ? (status.canStop ? "Stop server" : "External server") : "Start server"}
            </Button>
          </div>
          {status && !status.healthy && status.error && (
            <p className="text-muted-foreground text-xs">{status.error}</p>
          )}
          {serverControlError && <p className="text-destructive text-xs">{serverControlError}</p>}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Defaults</CardTitle>
          <CardDescription>
            The model and agents used for guidance and builds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="model">Default model</Label>
            <Select
              value={settings.defaultModel ?? ""}
              onValueChange={(v) => updateSettings({ defaultModel: v })}
            >
              <SelectTrigger id="model"><SelectValue placeholder="Select a model" /></SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} — {m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {models.length === 0 && !loading && !error && (
              <p className="text-muted-foreground text-xs">
                No models listed. Connect a provider below to see its models.
              </p>
            )}
            {models.length === 0 && !loading && error && (
              <p className="text-destructive text-xs">
                Couldn&apos;t load models: {error}
              </p>
            )}
            {models.length > 0 && (
              <p className="text-muted-foreground text-xs">
                {models.length} model(s) from {providers.length} provider(s).
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent">Guidance agent</Label>
              <Select
                value={settings.defaultAgent ?? ""}
                onValueChange={(v) => updateSettings({ defaultAgent: v })}
              >
                <SelectTrigger id="agent"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="buildAgent">Build agent</Label>
              <Select
                value={settings.buildAgent ?? ""}
                onValueChange={(v) => updateSettings({ buildAgent: v })}
              >
                <SelectTrigger id="buildAgent"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Providers — set API keys directly on the OpenCode server */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> Providers &amp; API keys
          </CardTitle>
          <CardDescription>
            Set a provider&apos;s API key here and it&apos;s stored by OpenCode on the server
            (not in this app&apos;s browser storage). Connected providers surface their models
            in the model picker above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && providers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Loading providers…</p>
          ) : providers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No providers found on the server.</p>
          ) : (
            providers.map((p) => (
              <div key={p.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <code className="text-muted-foreground text-xs">{p.id}</code>
                  </div>
                  {p.connected ? (
                    <Badge variant="default" className="gap-1">
                      <Check className="size-3" /> connected
                    </Badge>
                  ) : (
                    <Badge variant="outline">no key</Badge>
                  )}
                </div>
                {p.models.length > 0 && (
                  <p className="text-muted-foreground mb-2 text-xs">
                    {p.models.length} model(s): {p.models.slice(0, 4).map((m) => m.id).join(", ")}
                    {p.models.length > 4 ? ", …" : ""}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder={p.connected ? "Replace API key" : `${p.id} API key`}
                    value={keyDrafts[p.id] ?? ""}
                    onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSaveKey(p.id)}
                    disabled={saving[p.id] || !keyDrafts[p.id]?.trim()}
                  >
                    {saving[p.id] ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
                {saved[p.id] && !keyDrafts[p.id] && (
                  <p className="pt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Key saved to OpenCode.
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
