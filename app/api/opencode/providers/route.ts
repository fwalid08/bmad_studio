import { NextResponse } from "next/server";
import { clientFor } from "@/lib/opencode/server";
import type { ProviderInfo } from "@/lib/opencode/types";

// Lists every provider known to the local OpenCode server, with their models
// and whether credentials are already connected. Single source of truth for
// the model picker + "set API key" UI in Settings.
//
// v2 API: models come from GET /api/model (flat list w/ providerID), provider
// metadata from GET /api/provider, connection state from GET /api/integration
// (connections: [...]). `opencode/*` shared models count as always connected.
export async function GET() {
  try {
    const client = await clientFor();
    const [modelsOut, providersOut, integrationsOut] = await Promise.all([
      client.model.list(),
      client.provider.list(),
      client.integration.list().catch(() => ({ data: [] as never[] })),
    ]);

    const connected = new Set<string>();
    for (const integ of integrationsOut.data ?? []) {
      const conns = (integ as { connections?: unknown }).connections;
      if (Array.isArray(conns) && conns.length > 0) connected.add(integ.id);
    }

    const providersById = new Map((providersOut.data ?? []).map((p) => [p.id, p]));

    const modelsByProvider = new Map<string, ProviderInfo["models"]>();
    for (const m of modelsOut.data ?? []) {
      const list = modelsByProvider.get(m.providerID) ?? [];
      const isConnected = connected.has(m.providerID) || m.providerID === "opencode";
      list.push({
        id: m.id,
        providerID: m.providerID,
        modelID: m.modelID,
        name: m.name || m.modelID,
        connected: isConnected,
      });
      modelsByProvider.set(m.providerID, list);
    }

    const providers: ProviderInfo[] = (providersOut.data ?? []).map((p) => {
      const integ = (integrationsOut.data ?? []).find((i) => i.id === p.id) as
        | { methods?: Array<{ type: string; label?: string }> }
        | undefined;
      const isConnected = connected.has(p.id) || p.id === "opencode";
      return {
        id: p.id,
        name: p.name || p.id,
        env: [],
        connected: isConnected,
        authMethods: (integ?.methods ?? [{ type: "api" }]).map((m) => ({
          type: m.type,
          label: m.label ?? (m.type === "api" ? "API key" : m.type),
        })),
        models: modelsByProvider.get(p.id) ?? [],
      };
    });
    void providersById;

    // Connected providers first, then alphabetical.
    providers.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ providers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list providers";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
