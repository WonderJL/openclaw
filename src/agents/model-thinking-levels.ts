import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { OpenClawConfig } from "../config/config.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import {
  formatThinkingLevels,
  isBinaryThinkingProvider,
  listThinkingLevels,
  normalizeThinkLevel,
  supportsXHighThinking,
} from "../auto-reply/thinking.js";
import { normalizeProviderId } from "./model-selection.js";

const THINK_LEVEL_PREFERENCE: ThinkLevel[] = ["low", "minimal", "medium", "high", "xhigh", "off"];

function normalizeConfiguredThinkingLevels(
  levels?: readonly string[] | null,
  provider?: string,
  model?: string,
): ThinkLevel[] {
  if (!Array.isArray(levels) || levels.length === 0) {
    return [];
  }
  const allowed: ThinkLevel[] = [];
  const seen = new Set<string>();
  for (const raw of levels) {
    const normalized = normalizeThinkLevel(String(raw ?? ""));
    if (!normalized) {
      continue;
    }
    if (normalized === "xhigh" && !supportsXHighThinking(provider, model)) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    allowed.push(normalized);
  }
  if (!seen.has("off")) {
    allowed.unshift("off");
  }
  return allowed;
}

function findProviderConfigById(cfg: OpenClawConfig | undefined, provider: string) {
  const providers = cfg?.models?.providers;
  if (!providers) {
    return undefined;
  }
  const normalizedTarget = normalizeProviderId(provider);
  for (const [key, value] of Object.entries(providers)) {
    if (normalizeProviderId(key) === normalizedTarget) {
      return value;
    }
  }
  return undefined;
}

function resolveConfiguredModelThinkingLevels(params: {
  cfg?: OpenClawConfig;
  provider: string;
  model: string;
}): ThinkLevel[] {
  const providerConfig = findProviderConfigById(params.cfg, params.provider);
  if (!providerConfig || !Array.isArray(providerConfig.models)) {
    return [];
  }
  const normalizedModel = params.model.trim().toLowerCase();
  const modelConfig = providerConfig.models.find(
    (entry) =>
      String(entry.id ?? "")
        .trim()
        .toLowerCase() === normalizedModel,
  );
  if (!modelConfig || !Array.isArray(modelConfig.thinkingLevels)) {
    return [];
  }
  return normalizeConfiguredThinkingLevels(
    modelConfig.thinkingLevels,
    params.provider,
    params.model,
  );
}

function resolveCatalogModelThinkingLevels(params: {
  catalog?: ModelCatalogEntry[];
  provider: string;
  model: string;
}): ThinkLevel[] {
  if (!Array.isArray(params.catalog) || params.catalog.length === 0) {
    return [];
  }
  const normalizedProvider = normalizeProviderId(params.provider);
  const normalizedModel = params.model.trim().toLowerCase();
  const entry = params.catalog.find(
    (candidate) =>
      normalizeProviderId(candidate.provider) === normalizedProvider &&
      candidate.id.trim().toLowerCase() === normalizedModel,
  );
  if (!entry || !Array.isArray(entry.thinkingLevels)) {
    return [];
  }
  return normalizeConfiguredThinkingLevels(entry.thinkingLevels, params.provider, params.model);
}

export function resolveAllowedThinkingLevelsForModel(params: {
  cfg?: OpenClawConfig;
  provider: string;
  model: string;
  catalog?: ModelCatalogEntry[];
}): ThinkLevel[] {
  const fromCatalog = resolveCatalogModelThinkingLevels({
    catalog: params.catalog,
    provider: params.provider,
    model: params.model,
  });
  if (fromCatalog.length > 0) {
    return fromCatalog;
  }

  const fromConfig = resolveConfiguredModelThinkingLevels({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
  });
  if (fromConfig.length > 0) {
    return fromConfig;
  }

  return listThinkingLevels(params.provider, params.model);
}

export function isThinkingLevelAllowedForModel(params: {
  cfg?: OpenClawConfig;
  provider: string;
  model: string;
  thinkingLevel?: ThinkLevel | null;
  catalog?: ModelCatalogEntry[];
}) {
  const level = params.thinkingLevel;
  if (!level || level === "off") {
    return true;
  }
  const allowed = resolveAllowedThinkingLevelsForModel(params);
  return allowed.includes(level);
}

export function resolveDefaultThinkingLevelForModel(params: {
  cfg?: OpenClawConfig;
  provider: string;
  model: string;
  catalog?: ModelCatalogEntry[];
}): ThinkLevel {
  const allowed = resolveAllowedThinkingLevelsForModel(params);
  for (const candidate of THINK_LEVEL_PREFERENCE) {
    if (allowed.includes(candidate)) {
      return candidate;
    }
  }
  return allowed[0] ?? "off";
}

export function formatAllowedThinkingLevelsForModel(params: {
  cfg?: OpenClawConfig;
  provider: string;
  model: string;
  catalog?: ModelCatalogEntry[];
  separator?: string;
}): string {
  const allowed = resolveAllowedThinkingLevelsForModel(params);
  if (allowed.length === 0) {
    return formatThinkingLevels(params.provider, params.model, params.separator);
  }
  if (!isBinaryThinkingProvider(params.provider)) {
    return allowed.join(params.separator ?? ", ");
  }
  const hasOn = allowed.some((level) => level !== "off");
  return hasOn ? `off${params.separator ?? ", "}on` : "off";
}
