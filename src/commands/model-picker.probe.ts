import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { OpenClawConfig } from "../config/config.js";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { describeFailoverError } from "../agents/failover-error.js";
import { parseModelRef } from "../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import {
  resolveSessionTranscriptPath,
  resolveSessionTranscriptsDirForAgent,
} from "../config/sessions/paths.js";
import { redactSecrets } from "./status-all/format.js";

const MODEL_PICKER_PROBE_PROMPT = "Reply with OK. Do not use tools.";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_TOKENS = 8;

export type ModelPickerProbeResult = {
  model: string;
  ok: boolean;
  error?: string;
  reason?: string;
  latencyMs?: number;
};

type ProbeTarget = {
  model: string;
  provider: string;
  modelId: string;
};

async function probeTarget(params: {
  cfg: OpenClawConfig;
  target: ProbeTarget;
  agentId: string;
  agentDir: string;
  workspaceDir: string;
  sessionDir: string;
  timeoutMs: number;
  maxTokens: number;
}): Promise<ModelPickerProbeResult> {
  const start = Date.now();
  const sessionId = `picker-probe-${params.target.provider}-${crypto.randomUUID()}`;
  const sessionFile = resolveSessionTranscriptPath(sessionId, params.agentId);
  await fs.mkdir(params.sessionDir, { recursive: true });
  try {
    await runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
      config: params.cfg,
      prompt: MODEL_PICKER_PROBE_PROMPT,
      provider: params.target.provider,
      model: params.target.modelId,
      timeoutMs: params.timeoutMs,
      runId: `picker-probe-${crypto.randomUUID()}`,
      lane: `model-picker-probe:${params.target.provider}:${params.target.modelId}`,
      thinkLevel: "off",
      reasoningLevel: "off",
      verboseLevel: "off",
      streamParams: { maxTokens: params.maxTokens },
    });
    return {
      model: params.target.model,
      ok: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    const described = describeFailoverError(error);
    return {
      model: params.target.model,
      ok: false,
      error: redactSecrets(described.message),
      reason: described.reason,
      latencyMs: Date.now() - start,
    };
  }
}

export async function probeSelectedModels(params: {
  cfg: OpenClawConfig;
  models: string[];
  agentDir?: string;
  timeoutMs?: number;
  concurrency?: number;
  maxTokens?: number;
  onProgress?: (update: { completed: number; total: number; label?: string }) => void;
}): Promise<ModelPickerProbeResult[]> {
  const normalizedModels = Array.from(
    new Set(
      params.models.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0),
    ),
  );
  if (normalizedModels.length === 0) {
    return [];
  }

  const invalidResults: ModelPickerProbeResult[] = [];
  const targets: ProbeTarget[] = [];
  for (const model of normalizedModels) {
    const parsed = parseModelRef(model, DEFAULT_PROVIDER);
    if (!parsed) {
      invalidResults.push({
        model,
        ok: false,
        reason: "format",
        error: "Invalid model reference.",
      });
      continue;
    }
    targets.push({
      model,
      provider: parsed.provider,
      modelId: parsed.model,
    });
  }

  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const concurrency = Math.max(
    1,
    Math.min(targets.length || 1, params.concurrency ?? DEFAULT_CONCURRENCY),
  );

  const agentId = resolveDefaultAgentId(params.cfg);
  const agentDir = params.agentDir ?? resolveOpenClawAgentDir();
  const workspaceDir =
    resolveAgentWorkspaceDir(params.cfg, agentId) ?? resolveDefaultAgentWorkspaceDir();
  const sessionDir = resolveSessionTranscriptsDirForAgent(agentId);
  await fs.mkdir(workspaceDir, { recursive: true });

  const total = normalizedModels.length;
  let completed = invalidResults.length;
  params.onProgress?.({ completed, total });

  const resultsByModel = new Map<string, ModelPickerProbeResult>();
  for (const entry of invalidResults) {
    resultsByModel.set(entry.model, entry);
  }

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= targets.length) {
        return;
      }
      const target = targets[index];
      params.onProgress?.({
        completed,
        total,
        label: `Probing ${target.model}`,
      });
      const result = await probeTarget({
        cfg: params.cfg,
        target,
        agentId,
        agentDir,
        workspaceDir,
        sessionDir,
        timeoutMs,
        maxTokens,
      });
      resultsByModel.set(target.model, result);
      completed += 1;
      params.onProgress?.({ completed, total });
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return normalizedModels.map((model) => {
    const result = resultsByModel.get(model);
    if (result) {
      return result;
    }
    return {
      model,
      ok: false,
      reason: "unknown",
      error: "Model probe did not run.",
    };
  });
}
