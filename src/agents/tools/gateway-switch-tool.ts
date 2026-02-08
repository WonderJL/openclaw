import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { normalizeThinkLevel, type ThinkLevel } from "../../auto-reply/thinking.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { loadModelCatalog } from "../model-catalog.js";
import {
  normalizeProviderId,
  resolveAllowedModelRef,
  resolveDefaultModelForAgent,
} from "../model-selection.js";
import {
  formatAllowedThinkingLevelsForModel,
  isThinkingLevelAllowedForModel,
  resolveDefaultThinkingLevelForModel,
} from "../model-thinking-levels.js";

const GATEWAY_COMMAND_PREFIX = "gateway-";

const GatewaySwitchToolSchema = Type.Object({
  command: Type.Optional(Type.String()),
  commandName: Type.Optional(Type.String()),
  skillName: Type.Optional(Type.String()),
});

function resolveProviderKeyFromSkillName(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith(GATEWAY_COMMAND_PREFIX)) {
    return undefined;
  }
  const provider = trimmed.slice(GATEWAY_COMMAND_PREFIX.length).trim();
  return provider || undefined;
}

function resolveConfiguredProviderKey(params: {
  providerHint: string;
  cfg: ReturnType<typeof loadConfig>;
}) {
  const normalized = normalizeProviderId(params.providerHint);
  const providers = Object.keys(params.cfg.models?.providers ?? {});
  return providers.find((entry) => normalizeProviderId(entry) === normalized);
}

function parseGatewayCommandArgs(raw: string): { modelArg?: string; thinkingArg?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const positional: string[] = [];
  let modelArg: string | undefined;
  let thinkingArg: string | undefined;
  for (const token of tokens) {
    const equals = token.indexOf("=");
    if (equals === -1) {
      positional.push(token);
      continue;
    }
    const key = token.slice(0, equals).trim().toLowerCase();
    const value = token.slice(equals + 1).trim();
    if (!value) {
      continue;
    }
    if (key === "model") {
      modelArg = value;
      continue;
    }
    if (key === "thinking" || key === "reasoning" || key === "level") {
      thinkingArg = value;
    }
  }
  if (!modelArg && positional[0]) {
    modelArg = positional[0];
  }
  if (!thinkingArg && positional[1]) {
    thinkingArg = positional[1];
  }
  return { modelArg, thinkingArg };
}

function resolveProviderDefaultModel(params: {
  cfg: ReturnType<typeof loadConfig>;
  providerKey: string;
  catalog: Awaited<ReturnType<typeof loadModelCatalog>>;
  agentId: string;
}): string | undefined {
  const configuredModels = params.cfg.models?.providers?.[params.providerKey]?.models;
  const firstConfigured = configuredModels?.[0]?.id?.trim();
  if (firstConfigured) {
    return firstConfigured;
  }

  const defaultForAgent = resolveDefaultModelForAgent({ cfg: params.cfg, agentId: params.agentId });
  if (normalizeProviderId(defaultForAgent.provider) === normalizeProviderId(params.providerKey)) {
    return defaultForAgent.model;
  }

  const firstCatalog = params.catalog.find(
    (entry) => normalizeProviderId(entry.provider) === normalizeProviderId(params.providerKey),
  );
  return firstCatalog?.id;
}

export function createGatewaySwitchTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Gateway Switch",
    name: "gateway_switch",
    description:
      "Switch the current session to a gateway provider with optional model and reasoning (thinking) overrides.",
    parameters: GatewaySwitchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sessionKey = opts?.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new Error("sessionKey required");
      }

      const skillNameRaw = typeof params.skillName === "string" ? params.skillName.trim() : "";
      const providerHint = resolveProviderKeyFromSkillName(skillNameRaw);
      if (!providerHint) {
        throw new Error("gateway skill name missing provider (expected gateway-<provider>)");
      }

      const cfg = loadConfig();
      const providerKey = resolveConfiguredProviderKey({ providerHint, cfg });
      if (!providerKey) {
        throw new Error(`unknown gateway provider: ${providerHint}`);
      }

      const command = typeof params.command === "string" ? params.command.trim() : "";
      const parsedArgs = parseGatewayCommandArgs(command);
      const catalog = await loadModelCatalog({ config: cfg });
      const agentId = resolveAgentIdFromSessionKey(sessionKey);
      const defaultModel = resolveProviderDefaultModel({
        cfg,
        providerKey,
        catalog,
        agentId,
      });
      if (!defaultModel) {
        throw new Error(`no models available for provider ${providerKey}`);
      }

      const modelRaw = parsedArgs.modelArg
        ? parsedArgs.modelArg.includes("/")
          ? parsedArgs.modelArg
          : `${providerKey}/${parsedArgs.modelArg}`
        : `${providerKey}/${defaultModel}`;

      const resolvedModel = resolveAllowedModelRef({
        cfg,
        catalog,
        raw: modelRaw,
        defaultProvider: providerKey,
        defaultModel,
      });
      if ("error" in resolvedModel) {
        throw new Error(resolvedModel.error);
      }

      const selectedProvider = resolvedModel.ref.provider;
      const selectedModel = resolvedModel.ref.model;
      if (normalizeProviderId(selectedProvider) !== normalizeProviderId(providerKey)) {
        throw new Error(
          `model ${selectedProvider}/${selectedModel} is not in gateway ${providerKey}`,
        );
      }
      const parsedThinking = parsedArgs.thinkingArg
        ? normalizeThinkLevel(parsedArgs.thinkingArg)
        : undefined;
      if (parsedArgs.thinkingArg && !parsedThinking) {
        const valid = formatAllowedThinkingLevelsForModel({
          cfg,
          catalog,
          provider: selectedProvider,
          model: selectedModel,
        });
        throw new Error(`invalid reasoning level "${parsedArgs.thinkingArg}" (use ${valid})`);
      }

      const thinkingLevel: ThinkLevel = parsedThinking
        ? parsedThinking
        : resolveDefaultThinkingLevelForModel({
            cfg,
            catalog,
            provider: selectedProvider,
            model: selectedModel,
          });

      if (
        thinkingLevel !== "off" &&
        !isThinkingLevelAllowedForModel({
          cfg,
          catalog,
          provider: selectedProvider,
          model: selectedModel,
          thinkingLevel,
        })
      ) {
        const valid = formatAllowedThinkingLevelsForModel({
          cfg,
          catalog,
          provider: selectedProvider,
          model: selectedModel,
        });
        throw new Error(
          `reasoning level "${thinkingLevel}" not allowed for ${selectedProvider}/${selectedModel} (use ${valid})`,
        );
      }

      await callGateway({
        method: "sessions.patch",
        params: {
          key: sessionKey,
          model: `${selectedProvider}/${selectedModel}`,
          thinkingLevel: thinkingLevel === "off" ? null : thinkingLevel,
        },
      });

      const mode = command ? "args" : "defaults";
      return {
        content: [
          {
            type: "text",
            text: `Switched gateway to ${selectedProvider} (${selectedProvider}/${selectedModel}, reasoning=${thinkingLevel}, mode=${mode}).`,
          },
        ],
        details: {
          ok: true,
          provider: selectedProvider,
          model: selectedModel,
          thinkingLevel,
          mode,
          sessionKey,
        },
      };
    },
  };
}
