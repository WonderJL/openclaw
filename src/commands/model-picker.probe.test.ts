import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const mocks = vi.hoisted(() => ({
  resolveOpenClawAgentDir: vi.fn(() => "/tmp/openclaw-agent"),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/openclaw-workspace"),
  resolveDefaultAgentId: vi.fn(() => "default"),
  resolveDefaultAgentWorkspaceDir: vi.fn(() => "/tmp/openclaw-workspace"),
  resolveSessionTranscriptsDirForAgent: vi.fn(() => "/tmp/openclaw-sessions/default"),
  resolveSessionTranscriptPath: vi.fn(
    (sessionId: string) => `/tmp/openclaw-sessions/${sessionId}.jsonl`,
  ),
  runEmbeddedPiAgent: vi.fn(),
}));

vi.mock("../agents/agent-paths.js", () => ({
  resolveOpenClawAgentDir: mocks.resolveOpenClawAgentDir,
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../agents/workspace.js", () => ({
  resolveDefaultAgentWorkspaceDir: mocks.resolveDefaultAgentWorkspaceDir,
}));

vi.mock("../config/sessions/paths.js", () => ({
  resolveSessionTranscriptsDirForAgent: mocks.resolveSessionTranscriptsDirForAgent,
  resolveSessionTranscriptPath: mocks.resolveSessionTranscriptPath,
}));

vi.mock("../agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: mocks.runEmbeddedPiAgent,
}));

import { probeSelectedModels } from "./model-picker.probe.js";

describe("probeSelectedModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOpenClawAgentDir.mockReturnValue("/tmp/openclaw-agent");
    mocks.resolveAgentWorkspaceDir.mockReturnValue("/tmp/openclaw-workspace");
    mocks.resolveDefaultAgentId.mockReturnValue("default");
    mocks.resolveDefaultAgentWorkspaceDir.mockReturnValue("/tmp/openclaw-workspace");
    mocks.resolveSessionTranscriptsDirForAgent.mockReturnValue("/tmp/openclaw-sessions/default");
    mocks.resolveSessionTranscriptPath.mockImplementation(
      (sessionId: string) => `/tmp/openclaw-sessions/default/${sessionId}.jsonl`,
    );
    mocks.runEmbeddedPiAgent.mockResolvedValue({
      ok: true,
    });
  });

  it("probes each selected model and reports success", async () => {
    const cfg = {} as OpenClawConfig;
    const results = await probeSelectedModels({
      cfg,
      models: ["openai-codex/gpt-5.3-codex", "openai-codex/gpt-5.2-codex"],
    });

    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      expect.objectContaining({
        model: "openai-codex/gpt-5.3-codex",
        ok: true,
      }),
      expect.objectContaining({
        model: "openai-codex/gpt-5.2-codex",
        ok: true,
      }),
    ]);
  });

  it("returns redacted errors for probe failures", async () => {
    mocks.runEmbeddedPiAgent.mockRejectedValue(
      new Error("401 unauthorized token=abc123 sk-abcdefghijklmnopqrstuvwxyz0123456789"),
    );
    const cfg = {} as OpenClawConfig;
    const [result] = await probeSelectedModels({
      cfg,
      models: ["openai-codex/gpt-5.3-codex"],
    });

    expect(result.ok).toBe(false);
    expect(result.model).toBe("openai-codex/gpt-5.3-codex");
    expect(result.error).toContain("***");
    expect(result.error).not.toContain("abc123");
    expect(result.error).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("marks invalid model references as format failures", async () => {
    const cfg = {} as OpenClawConfig;
    const [result] = await probeSelectedModels({
      cfg,
      models: ["/broken-model-ref"],
    });

    expect(mocks.runEmbeddedPiAgent).not.toHaveBeenCalled();
    expect(result).toEqual({
      model: "/broken-model-ref",
      ok: false,
      reason: "format",
      error: "Invalid model reference.",
    });
  });
});
