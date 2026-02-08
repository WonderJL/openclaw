import type { Api, Model } from "@mariozechner/pi-ai";
import type { ThinkLevel } from "../../auto-reply/thinking.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { ModelRow } from "./list.types.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
import { parseModelRef } from "../../agents/model-selection.js";
import { normalizeThinkLevel } from "../../auto-reply/thinking.js";
import { loadConfig } from "../../config/config.js";
import { resolveConfiguredEntries } from "./list.configured.js";
import { loadModelRegistry, toModelRow } from "./list.registry.js";
import { DEFAULT_PROVIDER, modelKey } from "./shared.js";

export type ModelsListQuery = {
  all?: boolean;
  local?: boolean;
  provider?: string;
  cfg?: OpenClawConfig;
};

export type ModelsListServiceRow = ModelRow & {
  provider: string;
  id: string;
  inputModes?: Array<"text" | "image">;
  thinkingLevels?: ThinkLevel[];
  thinkingLevelsExplicit: boolean;
};

export type ModelsListChoice = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  thinkingLevels?: ThinkLevel[];
  thinkingLevelsExplicit?: boolean;
  key?: string;
  input?: Array<"text" | "image">;
  thinking?: string;
  local?: boolean;
  available?: boolean;
  tags?: string[];
  missing?: boolean;
};

export type ModelsListServiceResult = {
  rows: ModelsListServiceRow[];
  models: ModelsListChoice[];
  registryError?: string;
};

function normalizeProviderFilter(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = parseModelRef(`${trimmed}/_`, DEFAULT_PROVIDER);
  return parsed?.provider ?? trimmed.toLowerCase();
}

function isLocalBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function resolveExplicitThinkingLevels(model?: Model<Api>): ThinkLevel[] | undefined {
  const explicitLevels = (model as { thinkingLevels?: unknown } | undefined)?.thinkingLevels;
  if (!Array.isArray(explicitLevels)) {
    return undefined;
  }
  const normalized: ThinkLevel[] = [];
  const seen = new Set<string>();
  for (const raw of explicitLevels) {
    const level = normalizeThinkLevel(String(raw ?? ""));
    if (!level || seen.has(level)) {
      continue;
    }
    seen.add(level);
    normalized.push(level);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function resolveInputModes(model?: Model<Api>): Array<"text" | "image"> | undefined {
  const raw = model?.input;
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const next: Array<"text" | "image"> = [];
  for (const value of raw) {
    if (value === "text" || value === "image") {
      next.push(value);
    }
  }
  return next.length > 0 ? next : undefined;
}

function enrichRow(params: { row: ModelRow; provider: string; id: string; model?: Model<Api> }) {
  const thinkingLevels = resolveExplicitThinkingLevels(params.model);
  const inputModes = resolveInputModes(params.model);
  const entry: ModelsListServiceRow = {
    ...params.row,
    provider: params.provider,
    id: params.id,
    inputModes,
    thinkingLevels,
    thinkingLevelsExplicit: Boolean(thinkingLevels?.length),
  };
  return entry;
}

export async function queryModelsList(
  opts: ModelsListQuery = {},
): Promise<ModelsListServiceResult> {
  const cfg = opts.cfg ?? loadConfig();
  const authStore = ensureAuthProfileStore();
  const providerFilter = normalizeProviderFilter(opts.provider);
  const includeAll = opts.all === true;

  let models: Model<Api>[] = [];
  let availableKeys: Set<string> | undefined;
  let registryError: string | undefined;

  try {
    const loaded = await loadModelRegistry(cfg);
    models = loaded.models;
    availableKeys = loaded.availableKeys;
  } catch (err) {
    registryError = String(err);
  }

  const modelByKey = new Map(models.map((model) => [modelKey(model.provider, model.id), model]));
  const { entries } = resolveConfiguredEntries(cfg);
  const configuredByKey = new Map(entries.map((entry) => [entry.key, entry]));

  const rows: ModelsListServiceRow[] = [];

  if (includeAll) {
    const sorted = [...models].toSorted((a, b) => {
      const p = a.provider.localeCompare(b.provider);
      if (p !== 0) {
        return p;
      }
      return a.id.localeCompare(b.id);
    });

    for (const model of sorted) {
      if (providerFilter && model.provider.toLowerCase() !== providerFilter) {
        continue;
      }
      if (opts.local && !isLocalBaseUrl(model.baseUrl)) {
        continue;
      }
      const key = modelKey(model.provider, model.id);
      const configured = configuredByKey.get(key);
      const row = toModelRow({
        model,
        key,
        tags: configured ? Array.from(configured.tags) : [],
        aliases: configured?.aliases ?? [],
        availableKeys,
        cfg,
        authStore,
      });
      rows.push(
        enrichRow({
          row,
          provider: model.provider,
          id: model.id,
          model,
        }),
      );
    }
  } else {
    for (const entry of entries) {
      if (providerFilter && entry.ref.provider.toLowerCase() !== providerFilter) {
        continue;
      }
      const model = modelByKey.get(entry.key);
      if (opts.local && model && !isLocalBaseUrl(model.baseUrl)) {
        continue;
      }
      if (opts.local && !model) {
        continue;
      }
      const row = toModelRow({
        model,
        key: entry.key,
        tags: Array.from(entry.tags),
        aliases: entry.aliases,
        availableKeys,
        cfg,
        authStore,
      });
      rows.push(
        enrichRow({
          row,
          provider: entry.ref.provider,
          id: entry.ref.model,
          model,
        }),
      );
    }
  }

  const choices: ModelsListChoice[] = rows
    .filter((row) => !row.missing)
    .map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      contextWindow: row.contextWindow ?? undefined,
      reasoning: row.thinkingLevels
        ? row.thinkingLevels.some((level) => level !== "off")
        : undefined,
      thinkingLevels: row.thinkingLevels,
      thinkingLevelsExplicit: row.thinkingLevelsExplicit,
      key: row.key,
      input: row.inputModes,
      thinking: row.thinking,
      local: row.local === null ? undefined : row.local,
      available: row.available === null ? undefined : row.available,
      tags: row.tags.length > 0 ? row.tags : undefined,
      missing: row.missing || undefined,
    }));

  return {
    rows,
    models: choices,
    registryError,
  };
}
