import type { OpenClawConfig, GatewayAuthConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { promptAuthChoiceGrouped } from "./auth-choice-prompt.js";
import { applyAuthChoice, resolvePreferredProviderForAuthChoice } from "./auth-choice.js";
import {
  applyModelAllowlist,
  applyModelFallbacksFromSelection,
  applyPrimaryModel,
  promptDefaultModel,
  promptModelAllowlist,
} from "./model-picker.js";
import { probeSelectedModels } from "./model-picker.probe.js";

type GatewayAuthChoice = "token" | "password";

const ANTHROPIC_OAUTH_MODEL_KEYS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-opus-4-5",
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-haiku-4-5",
];

export function buildGatewayAuthConfig(params: {
  existing?: GatewayAuthConfig;
  mode: GatewayAuthChoice;
  token?: string;
  password?: string;
}): GatewayAuthConfig | undefined {
  const allowTailscale = params.existing?.allowTailscale;
  const base: GatewayAuthConfig = {};
  if (typeof allowTailscale === "boolean") {
    base.allowTailscale = allowTailscale;
  }

  if (params.mode === "token") {
    return { ...base, mode: "token", token: params.token };
  }
  return { ...base, mode: "password", password: params.password };
}

export async function promptAuthConfig(
  cfg: OpenClawConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const authChoice = await promptAuthChoiceGrouped({
    prompter,
    store: ensureAuthProfileStore(undefined, {
      allowKeychainPrompt: false,
    }),
    includeSkip: true,
  });

  let next = cfg;
  if (authChoice !== "skip") {
    const applied = await applyAuthChoice({
      authChoice,
      config: next,
      prompter,
      runtime,
      setDefaultModel: true,
    });
    next = applied.config;
  } else {
    const modelSelection = await promptDefaultModel({
      config: next,
      prompter,
      allowKeep: true,
      ignoreAllowlist: true,
      preferredProvider: resolvePreferredProviderForAuthChoice(authChoice),
    });
    if (modelSelection.model) {
      next = applyPrimaryModel(next, modelSelection.model);
    }
  }

  const preferredProvider = resolvePreferredProviderForAuthChoice(authChoice);
  const anthropicOAuth =
    authChoice === "setup-token" || authChoice === "token" || authChoice === "oauth";

  while (true) {
    const allowlistSelection = await promptModelAllowlist({
      config: next,
      prompter,
      allowedKeys: anthropicOAuth ? ANTHROPIC_OAUTH_MODEL_KEYS : undefined,
      initialSelections: anthropicOAuth ? ["anthropic/claude-opus-4-6"] : undefined,
      message: anthropicOAuth ? "Anthropic OAuth models" : undefined,
      preferredProvider,
      onlyUsable: Boolean(preferredProvider),
    });
    if (!allowlistSelection.models) {
      break;
    }

    let selectedModels = allowlistSelection.models;
    if (selectedModels.length > 0) {
      const shouldTest = await prompter.confirm({
        message: "Test selected models now?",
        initialValue: true,
      });
      if (shouldTest) {
        const spin = prompter.progress("Testing selected models...");
        const probeResults = await probeSelectedModels({
          cfg: next,
          models: selectedModels,
          onProgress: ({ completed, total, label }) => {
            const prefix = `Testing selected models (${completed}/${total})`;
            spin.update(label ? `${prefix} · ${label}` : prefix);
          },
        });
        spin.stop("Model access test complete");
        const passed = probeResults.filter((entry) => entry.ok).map((entry) => entry.model);
        const failed = probeResults.filter((entry) => !entry.ok);
        if (failed.length > 0) {
          const failedLines = failed
            .slice(0, 8)
            .map(
              (entry) =>
                `- ${entry.model}: ${entry.error || entry.reason || "probe failed (unknown)"}`,
            );
          if (failed.length > 8) {
            failedLines.push(`- ...and ${failed.length - 8} more`);
          }
          await prompter.note(
            [
              `Model access test: ${passed.length} passed, ${failed.length} failed.`,
              ...failedLines,
            ].join("\n"),
            "Model access test",
          );
        }
        if (passed.length === 0) {
          await prompter.note(
            "No selected models passed access test. Please select at least one working model.",
            "Model access test",
          );
          continue;
        }
        selectedModels = passed;
      }
    }

    next = applyModelAllowlist(next, selectedModels);
    next = applyModelFallbacksFromSelection(next, selectedModels);
    break;
  }

  return next;
}
