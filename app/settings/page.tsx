"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  ExternalLink,
  Eye,
  EyeOff,
  Zap,
  DatabaseZap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStudio } from "@/lib/store";
import { opencode, flattenModels } from "@/lib/opencode/client";
import { directAI, type StoredDirectProvider } from "@/lib/ai/client";
import type { ProviderInfo, ModelOption, OpenCodeAgent } from "@/lib/opencode/types";

// Registered AI providers (id, name, baseUrl, websiteUrl, models) —
// sourced from the registry and editable via the form.
const AI_PROVIDERS = [
  {
    id: "aion-labs",
    name: "Aion Labs",
    baseUrl: "https://api.aionlabs.ai/v1",
    websiteUrl: "https://www.aionlabs.ai/app/api-keys/",
    models: [
      "aion-labs/aion-2.0",
      "aion-labs/aion-rp-llama-3.1-8b",
      "aion-labs/aion-3.0",
      "aion-labs/aion-3.0-mini",
      "aion-labs-aion-2-0",
      "aion-labs-aion-rp-llama-3-1-8b",
      "aion-labs-aion-3-0",
    ]
  },
  {
    id: "cohere",
    name: "Cohere",
    baseUrl: "https://api.cohere.com/v2",
    websiteUrl: "https://dashboard.cohere.com/api-keys",
    models: [
      "command-a-plus-05-2026",
      "command-a-03-2025",
      "command-r-plus-08-2024",
      "command-r-08-2024",
      "command-r7b-12-2024",
      "command-a-reasoning-08-2025",
      "command-a-translate-08-2025",
      "command-a-vision-07-2025",
      "command-r7b-arabic-02-2025",
      "c4ai-aya-expanse-32b",
      "c4ai-aya-vision-32b",
      "command-a-218b",
      "command-a-111b",
      "command-r",
    ]
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    websiteUrl: "https://aistudio.google.com/app/apikey",
    models: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemma-4-31b-it",
      "gemma-4-26b-a4b-it",
    ]
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    websiteUrl: "https://console.mistral.ai/api-keys",
    models: [
      "mistral-medium-3-5",
      "mistral-small-2603",
      "mistral-large-2512",
      "ministral-8b-2512",
      "codestral-2508",
      "ministral-3b-2512",
      "ministral-14b-2512",
      "open-mistral-7b",
      "open-mixtral-8x7b",
      "mistral-medium-3-5-128b",
    ]
  },
  {
    id: "zai",
    name: "Z AI (Zhipu AI)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    websiteUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    models: [
      "glm-4.7-flash",
      "glm-4.5-flash",
      "glm-4.6v-flash",
      "glm-4-5-flash-retirement-announced",
    ]
  },
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run",
    websiteUrl: "https://dash.cloudflare.com/profile/api-tokens",
    models: [
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/meta/llama-4-scout-17b-16e-instruct",
      "@cf/openai/gpt-oss-120b",
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/zai-org/glm-4.7-flash",
      "@cf/mistralai/mistral-small-3.1-24b-instruct",
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      "@cf/mistral/mistral-7b-instruct-v0.1",
      "@cf/qwen/qwen1.5-7b-chat",
    ]
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    websiteUrl: "https://console.groq.com/keys",
    models: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "moonshotai/kimi-k2-instruct",
      "moonshotai/kimi-k2-instruct-0905",
      "groq/compound",
    ]
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    websiteUrl: "https://huggingface.co/settings/tokens",
    models: [
      "meta-llama/Llama-3.1-8B-Instruct",
      "google/gemma-3-4b-it",
      "microsoft/phi-4",
      "Qwen/Qwen2.5-Coder-7B-Instruct",
      "Qwen/Qwen2.5-7B-Instruct",
      "meta-llama-3-1-8b-instruct",
      "phi-4",
    ]
  },
  {
    id: "kilo",
    name: "Kilo Code",
    baseUrl: "https://api.kilo.ai/api/gateway",
    websiteUrl: "https://app.kilo.ai/profile",
    models: [
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "stepfun/step-3.7-flash:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      "poolside/laguna-s-2.1:free",
      "poolside/laguna-xs-2.1:free",
      "cohere/north-mini-code:free",
      "openrouter/free",
      "tencent/hy3:free",
      "nvidia/nemotron-3.5-lightning:free",
      "liquid/lfm-2.5-2.6b:free",
      "kilo-auto/free",
      "inclusionai/ling-3.1-flash",
      "inclusionai/ling-3.0-flash-sante:free",
      "apodex/apodex-1.1-mini:free",
      "qwen/qwen3.8-27b:free",
      "dots-studio/dots-3-note-preview:free",
      "stepfun/step-3.7-flash",
    ]
  },
  {
    id: "llm7",
    name: "LLM7.io",
    baseUrl: "https://api.llm7.io/v1",
    websiteUrl: "https://token.llm7.io",
    models: [
      "gpt-oss:20b",
      "mistral-Nemo-Instruct-2407",
      "minimax-m2.7",
      "DeepSeek-V4-Flash-0731",
      "gpt-oss-20b",
    ]
  },
  {
    id: "modelscope",
    name: "ModelScope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    websiteUrl: "https://modelscope.cn/my/myaccesstoken",
    models: [
      "Qwen/Qwen3.5-35B-A3B",
      "Qwen/Qwen3.5-27B",
      "MiniMax/MiniMax-M2.5",
      "qwen-qwen3-5-35b-a3b",
      "qwen-qwen3-5-27b",
    ]
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    websiteUrl: "https://build.nvidia.com/settings/api-keys",
    models: [
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/llama-3.1-nemotron-ultra-253b-v1",
      "google/gemma-4-31b-it",
      "mistralai/mistral-large-2-instruct",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "openai/gpt-oss-20b",
      "z-ai/glm-5.3-flash",
      "z-ai/glm-5.2",
      "z-ai/glm-5.1",
    ]
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    baseUrl: "https://ollama.com/api",
    websiteUrl: "https://ollama.com/settings/keys",
    models: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "minimax-m3",
      "kimi-k3",
      "gpt-oss:120b",
      "gpt-oss:20b",
      "nemotron-3-ultra",
      "mistral-large-3:675b",
      "qwen3.5:397b",
    ]
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    websiteUrl: "https://openrouter.ai/workspaces/default/keys",
    models: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "cohere/north-mini-code:free",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-4-31b-it:free",
      "nvidia/nemotron-nano-9b-v2:free",
      "nvidia/nemotron-nano-12b-v2-vl:free",
      "poolside/laguna-s-2.1:free",
      "poolside/laguna-xs-2.1:free",
      "apodex/apodex-1.1-mini:free",
      "inclusionai/ling-3.0-flash-sante:free",
      "qwen/qwen3.8-27b:free",
      "dots-studio/dots-3-note-preview:free",
      "liquid/lfm-2.5-2.6b:free",
      "nvidia/nemotron-3.5-lightning:free",
      "thinkingmachines/inkling:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
    ]
  },
  {
    id: "ovhcloud",
    name: "OVHcloud AI Endpoints",
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    websiteUrl: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/",
    models: [
      "Qwen3.5-397B-A17B",
      "gpt-oss-120b",
      "gpt-oss-20b",
      "Meta-Llama-3_3-70B-Instruct",
      "Qwen3.8-27B",
      "Qwen3.6-27B",
      "Qwen3.5-9B",
      "Qwen3-32B",
      "Qwen2.5-VL-72B-Instruct",
      "Mistral-Small-3.2-24B-Instruct-2506",
      "Mistral-Nemo-Instruct-2407",
      "qwen3.5-397b-a17b",
      "meta-llama-3_3-70b-instruct",
      "qwen3.8-27b",
    ]
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    websiteUrl: "https://cloud.siliconflow.cn/account/ak",
    models: [
      "Qwen/Qwen3-8B",
      "deepseek-ai-deepseek-r1-distill-qwen-7b",
    ]
  },
  {
    id: "opencode",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    websiteUrl: "https://opencode.ai/auth",
    models: [
      "big-pickle",
      "deepseek-v4-flash-free",
      "mimo-v2.5-free",
    ]
  },
  {
    id: "cerebras",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    websiteUrl: "https://cloud.cerebras.ai/",
    models: [
      "llama3.1-70b",
      "zai-glm-4-7-deprecated-aug-2026",
      "zai-glm-4.7",
    ]
  },
  {
    id: "agnes",
    name: "Agnes AI",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    websiteUrl: "https://platform.agnes-ai.com/settings/apiKeys",
    models: [
      "agnes-1.5-flash",
      "agnes-2.0-flash",
      "agnes-image-2.0-flash",
    ]
  },
  {
    id: "alibaba",
    name: "Alibaba Cloud Model Studio",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    websiteUrl: "https://bailian.console.alibabacloud.com/?apiKey=1",
    models: [
      "qwen3-max",
      "qwen3-plus",
      "qwen3-vl-plus",
    ]
  },
  {
    id: "sambanova",
    name: "SambaNova",
    baseUrl: "https://api.sambanova.ai/v1",
    websiteUrl: "https://cloud.sambanova.ai/apis",
    models: [
      "deepseek-v3-1",
      "deepseek-v3-2-preview",
      "minimax-m2-7",
    ]
  },
  {
    id: "cline-pass",
    name: "Cline",
    baseUrl: "",
    websiteUrl: "",
    models: [
      "cline-free/muse-spark-1.3-contributor",
      "cline-free/mimo-v2.6-flash",
      "cline-free/solar-mini4",
    ]
  },
  {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    websiteUrl: "https://console.x.ai",
    models: [
      "grok-4-3",
      "grok-4-1-fast",
      "grok-3-mini",
      "grok-2",
      "grok-2-mini",
    ]
  },
  {
    id: "chutes",
    name: "Chutes.ai",
    baseUrl: "https://api.chutes.ai/v1",
    websiteUrl: "https://chutes.ai/",
    models: [
      "deepseek-ai/DeepSeek-R1",
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
    ]
  },
  {
    id: "glhf",
    name: "Glhf.chat",
    baseUrl: "https://glhf.chat/api/openai/v1",
    websiteUrl: "https://glhf.chat/",
    models: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
    ]
  },
  {
    id: "ai21",
    name: "AI21 Labs",
    baseUrl: "https://api.ai21.com/studio/v1",
    websiteUrl: "https://studio.ai21.com/account/api-key",
    models: [
      "jamba-large-1-7",
      "jamba-mini-2",
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    websiteUrl: "https://platform.deepseek.com/api_keys",
    models: [
      "deepseek-chat-v3-2",
      "deepseek-reasoner-r1",
    ]
  },
  {
    id: "nscale",
    name: "Nscale",
    baseUrl: "https://inference.api.nscale.com/v1",
    websiteUrl: "https://console.nscale.com/",
    models: [
      "llama-3-3-70b-instruct",
      "deepseek-r1-distill-llama-70b",
    ]
  },
  {
    id: "nebius",
    name: "Nebius",
    baseUrl: "https://api.studio.nebius.com/v1",
    websiteUrl: "https://studio.nebius.com/settings/api-keys",
    models: [
      "qwen3-235b-a22b",
    ]
  },
];

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
  const [knownIntegrationIds, setKnownIntegrationIds] = useState<string[]>([]);
  const [agents, setAgents] = useState<OpenCodeAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [showKeyDraft, setShowKeyDraft] = useState(false);
  const [showServerPassword, setShowServerPassword] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // ----------------------------------------------------------------------
  // AI Provider Settings state
  // ----------------------------------------------------------------------
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedBaseUrl, setSelectedBaseUrl] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savedKey, setSavedKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // ----------------------------------------------------------------------
  // Direct AI state (providers called straight from this server, no OpenCode)
  // ----------------------------------------------------------------------
  const [directProviders, setDirectProviders] = useState<StoredDirectProvider[]>([]);
  const [directDefault, setDirectDefault] = useState<string | undefined>(undefined);
  const [directLoading, setDirectLoading] = useState(true);
  const [directProviderId, setDirectProviderId] = useState("");
  const [directBaseUrl, setDirectBaseUrl] = useState("");
  const [directModel, setDirectModel] = useState("");
  const [directKeyDraft, setDirectKeyDraft] = useState("");
  const [showDirectKey, setShowDirectKey] = useState(false);
  const [savingDirect, setSavingDirect] = useState(false);
  const [savedDirect, setSavedDirect] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [settingDirectDefault, setSettingDirectDefault] = useState(false);

  // Embedding index status (chunk/vector count) for the retrieval context mode.
  const [indexStats, setIndexStats] = useState<{
    chunks: number;
    projects: number;
    embedded: number;
    dim: number;
  } | null>(null);
  const [retrievalNote, setRetrievalNote] = useState<string | null>(null);

  const loadIndexStats = useCallback(() => {
    void fetch("/api/ai/embeddings")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.ok) {
          setIndexStats(json.stats);
          setRetrievalNote(null);
        } else {
          setRetrievalNote(json?.error ?? "Gagal memuat statistik index.");
        }
      })
      .catch(() => setRetrievalNote("Gagal memuat statistik index."));
  }, []);

  useEffect(() => {
    if ((settings.contextMode ?? "full") === "retrieval") loadIndexStats();
  }, [settings.contextMode, loadIndexStats]);

  // Agent ids are case-insensitive on the server but we normalize them to
  // lowercase everywhere. If a persisted setting still holds an older
  // capitalized form (e.g. "Plan"), fold it back to lowercase so the Select
  // options match the stored value.
  const syncAgentCase = useCallback(
    (list: OpenCodeAgent[]) => {
      const s = useStudio.getState().settings;
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
        defaultModel?: string;
        defaultAgent?: string;
        buildAgent?: string;
        guidanceMode?: string;
      };
      if (!settingsRes.ok) throw new Error("Failed to load OpenCode settings");
      if (!isCurrent()) return;
      setServerUrlDraft(serverSettings.opencodeServerUrl);
      setServerUsernameDraft(serverSettings.username);
      setServerPasswordConfigured(serverSettings.passwordConfigured);
      // Studio defaults are JSON-backed on the server. Mirror them into the
      // store without triggering a write-back.
      updateSettings(
        {
          opencodeServerUrl: serverSettings.opencodeServerUrl,
          ...(serverSettings.defaultModel ? { defaultModel: serverSettings.defaultModel } : {}),
          ...(serverSettings.defaultAgent ? { defaultAgent: serverSettings.defaultAgent } : {}),
          ...(serverSettings.buildAgent ? { buildAgent: serverSettings.buildAgent } : {}),
          ...(serverSettings.guidanceMode === "direct" || serverSettings.guidanceMode === "opencode"
            ? { guidanceMode: serverSettings.guidanceMode as "opencode" | "direct" }
            : {}),
        },
        { persist: false }
      );

      const statusRes = await fetch("/api/opencode/status");
      const statusData = (await statusRes.json()) as Status;
      if (!isCurrent()) return;
      setStatus(statusData);
      if (!statusData.healthy) {
        setProviders([]);
        setKnownIntegrationIds([]);
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
      setKnownIntegrationIds(providersRes.integrationIds ?? []);
      setAgents(agentsRes.agents);
      syncAgentCase(agentsRes.agents);
      setError(null);
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : "Failed to load OpenCode info");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [syncAgentCase, updateSettings]);

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
      const json = (await res.json().catch(() => ({})) as {
        error?: string;
        opencodeServerUrl?: string;
        username?: string;
        passwordConfigured?: boolean;
      });
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to save server URL");
      }
      const savedUrl = json.opencodeServerUrl ?? value;
      setServerUrlDraft(savedUrl);
      setServerUsernameDraft(json.username ?? serverUsernameDraft.trim());
      setServerPasswordDraft("");
      setServerPasswordConfigured(Boolean(json.passwordConfigured));
      // Already persisted via the PUT above; only mirror into memory.
      updateSettings({ opencodeServerUrl: savedUrl }, { persist: false });
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
        setKnownIntegrationIds([]);
        setAgents([]);
        setError(null);
      }
    } catch (e) {
      setServerControlError(e instanceof Error ? e.message : `Failed to ${action} server`);
    } finally {
      setServerControlBusy(false);
    }
  }

  // ----------------------------------------------------------------------
  // Direct AI: providers called straight from this server (no OpenCode).
  // ----------------------------------------------------------------------
  const fetchDirect = useCallback(async () => {
    try {
      const d = await directAI.providers();
      setDirectProviders(d.providers);
      setDirectDefault(d.defaultProvider);
    } catch {
      // Leave the list empty; save attempts surface the error.
    } finally {
      setDirectLoading(false);
    }
  }, []);

  function refresh() {
    setLoading(true);
    setDirectLoading(true);
    void fetchData();
    void fetchDirect();
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchData(() => !cancelled);
      if (!cancelled) await fetchDirect();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchData, fetchDirect]);

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

  // Same models as `models` above (first occurrence wins on duplicate ids),
  // grouped by provider for the dropdown so long lists stay scannable.
  const groupedModels: Array<{ provider: ProviderInfo; models: ModelOption[] }> = (() => {
    const seen = new Set<string>();
    const groups: Array<{ provider: ProviderInfo; models: ModelOption[] }> = [];
    for (const p of providers) {
      const items: ModelOption[] = [];
      for (const m of p.models) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        items.push(m);
      }
      if (items.length > 0) groups.push({ provider: p, models: items });
    }
    return groups;
  })();

  // ----------------------------------------------------------------------
  // Handle saving the AI provider key + base URL to the OpenCode server.
  // ----------------------------------------------------------------------
  async function handleSaveProviderKey() {
    if (!selectedProviderId) return;
    const key = keyDraft.trim();
    if (!key) return;
    setSavingKey(true);
    setKeyError(null);
    try {
      await opencode.setAuth(selectedProviderId, key);
      setKeyDraft("");
      setSavedKey(true);
      await fetchData();
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : "Failed to save key");
    } finally {
      setSavingKey(false);
    }
  }

  // Merge AI_PROVIDERS models into server providers for the UI. Custom
  // providers missing from the server are appended so they stay selectable.
  const providersWithModels = (() => {
    const merged = providers.map((p) => {
      const custom = AI_PROVIDERS.find((cp) => cp.id === p.id);
      return {
        ...p,
        baseUrl: custom?.baseUrl ?? "",
        websiteUrl: custom?.websiteUrl ?? "",
        models: custom?.models ?? [],
      };
    });
    const serverIds = new Set(providers.map((p) => p.id));
    for (const cp of AI_PROVIDERS) {
      if (!serverIds.has(cp.id)) {
        merged.push({
          id: cp.id,
          name: cp.name,
          env: [] as string[],
          connected: false,
          authMethods: [] as Array<{ type: string; label: string }>,
          baseUrl: cp.baseUrl,
          websiteUrl: cp.websiteUrl,
          models: cp.models,
        });
      }
    }
    return merged;
  })();

  const selectedProvider = providersWithModels.find((p) => p.id === selectedProviderId);

  // Saving a key only works for integration IDs the OpenCode server knows.
  // When the integration list hasn't loaded yet we don't block (the server
  // returns a clear error instead).
  const selectedKnownToServer =
    !selectedProviderId ||
    knownIntegrationIds.length === 0 ||
    knownIntegrationIds.includes(selectedProviderId);

  // ----------------------------------------------------------------------
  // Direct AI: save + default handlers (fetchDirect is declared above).
  // ----------------------------------------------------------------------
  async function handleSaveDirect() {
    if (!directProviderId) return;
    setSavingDirect(true);
    setDirectError(null);
    try {
      await directAI.saveProvider({
        providerId: directProviderId,
        ...(directKeyDraft.trim() ? { apiKey: directKeyDraft.trim() } : {}),
        ...(directBaseUrl.trim() ? { baseUrl: directBaseUrl.trim() } : {}),
        ...(directModel.trim() ? { model: directModel.trim() } : {}),
      });
      setDirectKeyDraft("");
      setSavedDirect(true);
      await fetchDirect();
    } catch (e) {
      setDirectError(e instanceof Error ? e.message : "Failed to save provider");
    } finally {
      setSavingDirect(false);
    }
  }

  async function handleSetDirectDefault(id: string) {
    setSettingDirectDefault(true);
    setDirectError(null);
    try {
      await directAI.saveProvider({ providerId: id, makeDefault: true });
      await fetchDirect();
    } catch (e) {
      setDirectError(e instanceof Error ? e.message : "Failed to set default");
    } finally {
      setSettingDirectDefault(false);
    }
  }

  // Registry + already-stored custom ids, so a stored provider stays selectable.
  const directOptions = (() => {
    const ids = new Set(AI_PROVIDERS.map((p) => p.id));
    const extra = directProviders
      .filter((d) => !ids.has(d.id))
      .map((d) => ({ id: d.id, name: d.id, baseUrl: "", websiteUrl: "", models: [] as string[] }));
    return [...AI_PROVIDERS, ...extra];
  })();

  const directReg = directOptions.find((p) => p.id === directProviderId);
  const directStored = directProviders.find((d) => d.id === directProviderId);
  const directRegModels = directReg?.models ?? [];

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
              <div className="relative">
                <Input
                  id="opencode-server-password"
                  type={showServerPassword ? "text" : "password"}
                  value={serverPasswordDraft}
                  onChange={(e) => setServerPasswordDraft(e.target.value)}
                  placeholder={serverPasswordConfigured ? "Configured; blank keeps current" : "Set server password"}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={showServerPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowServerPassword((v) => !v)}
                  className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                >
                  {showServerPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
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
            The model and agents used for guidance and builds. Stored in
            <code className="mx-1">~/.config/bmad-studio/opencode.json</code>
            on this machine, not in browser storage.
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
                {groupedModels.map((g) => (
                  <SelectGroup key={g.provider.id}>
                    <SelectLabel>
                      {g.provider.name} ({g.models.length}){g.provider.connected ? " ✓" : ""}
                    </SelectLabel>
                    {g.models.map((m) => (
                      <SelectItem key={`${m.providerID}/${m.id}`} value={m.id}>
                        {m.name} — {m.id}
                      </SelectItem>
                    ))}
                  </SelectGroup>
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

          <div className="space-y-1.5">
            <Label htmlFor="guidanceMode">Guidance via</Label>
            <Select
              value={settings.guidanceMode ?? "opencode"}
              onValueChange={(v) => updateSettings({ guidanceMode: v as "opencode" | "direct" })}
            >
              <SelectTrigger id="guidanceMode"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="opencode">OpenCode server (agent + session)</SelectItem>
                <SelectItem value="direct">Direct AI (provider API, custom prompt)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Direct AI memanggil provider langsung dari server aplikasi ini tanpa lewat
              OpenCode — system prompt sepenuhnya milikmu. Build tetap selalu via OpenCode.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Konteks draft — full artifacts atau retrieval berbasis embedding */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseZap className="size-4" /> Konteks draft
          </CardTitle>
          <CardDescription>
            Menentukan apa yang dikirim ke AI untuk setiap draft fase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contextMode">Mode konteks</Label>
            <Select
              value={settings.contextMode ?? "full"}
              onValueChange={(v) =>
                updateSettings({ contextMode: v as "full" | "retrieval" })
              }
            >
              <SelectTrigger id="contextMode"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Penuh — kirim semua artefak fase sebelumnya</SelectItem>
                <SelectItem value="retrieval">Retrieval — outline + potongan relevan (embedding)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              <strong>Penuh</strong> paling lengkap, tapi prompt membengkak seiring bertambahnya fase.
              <strong> Retrieval</strong> memotong artefak jadi chunk ~800 token (overlap 200),
              lalu hanya mengirim outline semua fase + 5 potongan paling relevan — jauh lebih
              hemat token. Chunk hanya di-embed ulang saat isi artefak berubah.
            </p>
          </div>

          {(settings.contextMode ?? "full") === "retrieval" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="embeddingProvider">Provider embedding</Label>
                <Select
                  value={settings.embeddingProviderId ?? ""}
                  onValueChange={(v) => updateSettings({ embeddingProviderId: v })}
                >
                  <SelectTrigger id="embeddingProvider">
                    <SelectValue placeholder="Pilih provider Direct AI" />
                  </SelectTrigger>
                  <SelectContent>
                    {directProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.id}
                        {p.id === directDefault || (directProviders.length === 1 && !directDefault)
                          ? " (default)"
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {directProviders.length === 0
                    ? "Belum ada provider Direct AI — tambahkan di kartu Direct AI di bawah."
                    : "Memakai konfigurasi (base URL + key) dari kartu Direct AI di bawah — termasuk Ollama lokal untuk bge-m3 tanpa API key."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="embeddingModel">Model embedding</Label>
                <Input
                  id="embeddingModel"
                  value={settings.embeddingModel ?? ""}
                  onChange={(e) => updateSettings({ embeddingModel: e.target.value })}
                  placeholder="bge-m3"
                />
                <p className="text-muted-foreground text-xs">
                  Direkomendasikan <code>bge-m3</code> (1024 dimensi, konteks 8192 token) —
                  jalankan dengan <code>ollama pull bge-m3</code> dan base URL provider
                  <code> http://127.0.0.1:11434/v1</code>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-xs">
                <span className="text-muted-foreground">Index lokal:</span>
                {indexStats ? (
                  <>
                    <Badge variant="secondary">{indexStats.chunks} chunk</Badge>
                    <Badge variant="outline">{indexStats.projects} project</Badge>
                    {indexStats.dim > 0 && <Badge variant="outline">dim {indexStats.dim}</Badge>}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={loadIndexStats}
                >
                  <RefreshCw className="size-3.5" /> Muat ulang
                </Button>
              </div>

              {retrievalNote && (
                <p className="text-muted-foreground text-xs">{retrievalNote}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Direct AI — providers called straight from this server, no OpenCode */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="size-4" /> Direct AI
          </CardTitle>
          <CardDescription>
            Panggil API provider langsung dari server aplikasi ini tanpa lewat OpenCode —
            system prompt terkirim apa adanya sehingga jawaban bisa dicustom penuh.
            Key tersimpan di <code>~/.config/bmad-studio/direct.json</code> dan tidak
            pernah ditampilkan kembali.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {directLoading ? (
            <p className="text-muted-foreground text-sm">Loading Direct AI…</p>
          ) : (
            <div className="space-y-3">
              {directProviders.length > 0 && (
                <div className="space-y-2">
                  {directProviders.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm">
                      <span className="font-medium">{d.id}</span>
                      {d.id === directDefault ? (
                        <Badge variant="default" className="text-[10px]">default</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          disabled={settingDirectDefault}
                          onClick={() => void handleSetDirectDefault(d.id)}
                        >
                          Set default
                        </Button>
                      )}
                      {d.configured ? (
                        <Badge variant="default" className="gap-1 text-[10px]">
                          <Check className="size-3" /> key saved
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">no key</Badge>
                      )}
                      <span className="text-muted-foreground w-full truncate font-mono text-xs">
                        {d.baseUrl ?? "—"}{d.model ? ` · ${d.model}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="direct-provider">Provider</Label>
                <Select
                  value={directProviderId}
                  onValueChange={(v) => {
                    setDirectProviderId(v);
                    const stored = directProviders.find((d) => d.id === v);
                    const reg = AI_PROVIDERS.find((cp) => cp.id === v);
                    setDirectBaseUrl(stored?.baseUrl ?? reg?.baseUrl ?? "");
                    setDirectModel(stored?.model ?? "");
                    setDirectKeyDraft("");
                    setSavedDirect(false);
                    setDirectError(null);
                  }}
                >
                  <SelectTrigger id="direct-provider"><SelectValue placeholder="Select a provider" /></SelectTrigger>
                  <SelectContent>
                    {directOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {directReg?.websiteUrl && (
                  <a
                    href={directReg.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Dapatkan API key untuk {directReg.name} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="direct-base-url">Base URL (OpenAI-compatible)</Label>
                <Input
                  id="direct-base-url"
                  value={directBaseUrl}
                  onChange={(e) => setDirectBaseUrl(e.target.value)}
                  disabled={!directProviderId}
                  placeholder="https://api.provider.com/v1"
                  className="font-mono text-sm"
                />
                {!directProviderId && (
                  <p className="text-muted-foreground text-xs">Select a provider first</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="direct-model">Model</Label>
                {directRegModels.length > 0 ? (
                  <Select
                    value={directModel}
                    onValueChange={setDirectModel}
                    disabled={!directProviderId}
                  >
                    <SelectTrigger id="direct-model"><SelectValue placeholder="Select a model" /></SelectTrigger>
                    <SelectContent>
                      {directModel && !directRegModels.includes(directModel) && (
                        <SelectItem value={directModel}>{directModel}</SelectItem>
                      )}
                      {directRegModels.map((m: string) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="direct-model"
                    value={directModel}
                    onChange={(e) => setDirectModel(e.target.value)}
                    disabled={!directProviderId}
                    placeholder={directProviderId ? "model id" : "Select a provider first"}
                    className="font-mono text-sm"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="direct-api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="direct-api-key"
                    type={showDirectKey ? "text" : "password"}
                    placeholder={directStored?.configured ? "Saved — enter to replace" : "Provider API key"}
                    value={directKeyDraft}
                    onChange={(e) => setDirectKeyDraft(e.target.value)}
                    disabled={!directProviderId}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={showDirectKey ? "Hide API key" : "Show API key"}
                    onClick={() => setShowDirectKey((v) => !v)}
                    className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                  >
                    {showDirectKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                {directStored?.configured && !directKeyDraft && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Key tersimpan di server (tidak ditampilkan demi keamanan). Isi kolom untuk mengganti.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Button
                  size="sm"
                  onClick={() => void handleSaveDirect()}
                  disabled={savingDirect || !directProviderId}
                >
                  {savingDirect ? <Loader2 className="size-4 animate-spin" /> : "Save Direct provider"}
                </Button>
                {savedDirect && !directKeyDraft && (
                  <p className="pt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Provider tersimpan.
                  </p>
                )}
                {directError && <p className="text-destructive text-xs">{directError}</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> AI Provider Settings
          </CardTitle>
          <CardDescription>
            Select a provider, choose a model, edit its base URL, and save an API key. The key is stored
            by OpenCode on the server (not in this app&apos;s browser storage).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && providers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Loading providers…</p>
          ) : providers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No providers found on the server.</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ai-provider">Provider</Label>
                <Select
                  value={selectedProviderId}
                  onValueChange={(v) => {
                    setSelectedProviderId(v);
                    setSelectedBaseUrl("");
                    setSelectedModel("");
                    setKeyDraft("");
                    setSavedKey(false);
                    setKeyError(null);
                  }}
                >
                  <SelectTrigger id="ai-provider"><SelectValue placeholder="Select a provider" /></SelectTrigger>
                  <SelectContent>
                    {providersWithModels.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} {p.connected ? "✓" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProvider?.websiteUrl && (
                  <a
                    href={selectedProvider.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Dapatkan API key untuk {selectedProvider.name} <ExternalLink className="size-3" />
                  </a>
                )}
                {selectedProviderId && !selectedKnownToServer && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    The OpenCode server has no integration for “{selectedProviderId}”,
                    so saving a key here will fail. Set the key via its environment
                    variable or an opencode.json custom provider instead.
                  </p>
                )}
                {keyError && <p className="text-destructive text-xs">{keyError}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-base-url">Base URL</Label>
                <Input
                  id="ai-base-url"
                  value={selectedBaseUrl || selectedProvider?.baseUrl || ""}
                  onChange={(e) => setSelectedBaseUrl(e.target.value)}
                  disabled={!selectedProviderId}
                  className="rounded-md border p-2"
                />
                {!selectedProviderId && (
                  <p className="text-muted-foreground text-xs">Select a provider first</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-model">Model</Label>
                <Select
                  value={selectedModel}
                  onValueChange={(v) => setSelectedModel(v)}
                  disabled={!selectedProviderId || (selectedProvider?.models.length ?? 0) === 0}
                >
                  <SelectTrigger id="ai-model"><SelectValue placeholder="Select a model" /></SelectTrigger>
                  <SelectContent>
                    {selectedProvider?.models?.map((m: string) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!selectedProviderId && (
                  <p className="text-muted-foreground text-xs">Select a provider first</p>
                )}
                {selectedProviderId && selectedProvider?.models?.length === 0 && (
                  <p className="text-muted-foreground text-xs">No models available for this provider</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="ai-api-key"
                    type={showKeyDraft ? "text" : "password"}
                    placeholder={selectedProviderId ? `${selectedProviderId} API key` : "Select a provider"}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    className="rounded-md border p-2 pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={showKeyDraft ? "Hide API key" : "Show API key"}
                    onClick={() => setShowKeyDraft((v) => !v)}
                    className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                  >
                    {showKeyDraft ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
                {selectedProvider?.connected && !keyDraft && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    Key tersimpan di server (tidak ditampilkan demi keamanan). Isi kolom untuk mengganti.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Button
                  size="sm"
                  onClick={handleSaveProviderKey}
                  disabled={savingKey || !selectedProviderId || !keyDraft.trim() || !selectedKnownToServer}
                >
                  {savingKey ? <Loader2 className="size-4 animate-spin" /> : "Save to OpenCode"}
                </Button>
                {savedKey && !keyDraft && (
                  <p className="pt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Key saved to OpenCode.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Providers — set API keys directly on the OpenCode server */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> Providers & API keys
          </CardTitle>
          <CardDescription>
            Set a provider&apos;s API key here and it&apos;s stored by OpenCode on the server
            (not in this app&apos;s browser storage). Saved keys are never shown back —
            the badge tells you one is stored. Connected providers surface their models
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
                {AI_PROVIDERS.find((cp) => cp.id === p.id)?.websiteUrl && (
                  <a
                    href={AI_PROVIDERS.find((cp) => cp.id === p.id)?.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Dapatkan API key <ExternalLink className="size-3" />
                  </a>
                )}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKeys[p.id] ? "text" : "password"}
                      placeholder={p.connected ? "Replace API key" : `${p.id} API key`}
                      value={keyDrafts[p.id] ?? ""}
                      onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value}))}
                      className="pr-10 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={showKeys[p.id] ? `Hide ${p.id} API key` : `Show ${p.id} API key`}
                      onClick={() => setShowKeys((s) => ({ ...s, [p.id]: !s[p.id] }))}
                      className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                    >
                      {showKeys[p.id] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSaveKey(p.id)}
                    disabled={saving[p.id] || !keyDrafts[p.id]?.trim()}
                  >
                    {saving[p.id] ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
                {p.connected && !(keyDrafts[p.id] ?? "") && (
                  <p className="pt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Key tersimpan di server (tidak ditampilkan demi keamanan). Isi kolom untuk mengganti.
                  </p>
                )}
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