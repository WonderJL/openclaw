import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { makePrompter } from "./onboarding/__tests__/test-utils.js";

const mocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(() => ({
    version: 1,
    profiles: {},
  })),
  promptAuthChoiceGrouped: vi.fn(async () => "openai-codex"),
  applyAuthChoice: vi.fn(async ({ config }) => ({ config })),
  resolvePreferredProviderForAuthChoice: vi.fn(() => "openai-codex"),
  promptDefaultModel: vi.fn(async () => ({})),
  promptModelAllowlist: vi.fn(async () => ({})),
  applyModelAllowlist: vi.fn((cfg) => cfg),
  applyModelFallbacksFromSelection: vi.fn((cfg) => cfg),
  applyPrimaryModel: vi.fn((cfg) => cfg),
  probeSelectedModels: vi.fn(async () => []),
}));

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: mocks.ensureAuthProfileStore,
}));

vi.mock("./auth-choice-prompt.js", () => ({
  promptAuthChoiceGrouped: mocks.promptAuthChoiceGrouped,
}));

vi.mock("./auth-choice.js", () => ({
  applyAuthChoice: mocks.applyAuthChoice,
  resolvePreferredProviderForAuthChoice: mocks.resolvePreferredProviderForAuthChoice,
}));

vi.mock("./model-picker.js", () => ({
  promptDefaultModel: mocks.promptDefaultModel,
  promptModelAllowlist: mocks.promptModelAllowlist,
  applyModelAllowlist: mocks.applyModelAllowlist,
  applyModelFallbacksFromSelection: mocks.applyModelFallbacksFromSelection,
  applyPrimaryModel: mocks.applyPrimaryModel,
}));

vi.mock("./model-picker.probe.js", () => ({
  probeSelectedModels: mocks.probeSelectedModels,
}));

import { buildGatewayAuthConfig, promptAuthConfig } from "./configure.gateway-auth.js";

describe("buildGatewayAuthConfig", () => {
  it("preserves allowTailscale when switching to token", () => {
    const result = buildGatewayAuthConfig({
      existing: {
        mode: "password",
        password: "secret",
        allowTailscale: true,
      },
      mode: "token",
      token: "abc",
    });

    expect(result).toEqual({ mode: "token", token: "abc", allowTailscale: true });
  });

  it("drops password when switching to token", () => {
    const result = buildGatewayAuthConfig({
      existing: {
        mode: "password",
        password: "secret",
        allowTailscale: false,
      },
      mode: "token",
      token: "abc",
    });

    expect(result).toEqual({
      mode: "token",
      token: "abc",
      allowTailscale: false,
    });
  });

  it("drops token when switching to password", () => {
    const result = buildGatewayAuthConfig({
      existing: { mode: "token", token: "abc" },
      mode: "password",
      password: "secret",
    });

    expect(result).toEqual({ mode: "password", password: "secret" });
  });
});

describe("promptAuthConfig", () => {
  const runtime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {},
    });
    mocks.promptAuthChoiceGrouped.mockResolvedValue("openai-codex");
    mocks.applyAuthChoice.mockImplementation(async ({ config }) => ({ config }));
    mocks.resolvePreferredProviderForAuthChoice.mockReturnValue("openai-codex");
    mocks.promptDefaultModel.mockResolvedValue({});
    mocks.promptModelAllowlist.mockResolvedValue({});
    mocks.applyModelAllowlist.mockImplementation((cfg) => cfg);
    mocks.applyModelFallbacksFromSelection.mockImplementation((cfg) => cfg);
    mocks.applyPrimaryModel.mockImplementation((cfg) => cfg);
    mocks.probeSelectedModels.mockResolvedValue([]);
  });

  it("passes preferred provider + usable-only flags to model allowlist picker", async () => {
    const cfg = {} as OpenClawConfig;
    const prompter = makePrompter({
      confirm: vi.fn(async () => true),
    });

    await promptAuthConfig(cfg, runtime, prompter);

    expect(mocks.promptModelAllowlist).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredProvider: "openai-codex",
        onlyUsable: true,
      }),
    );
  });

  it("applies selected models directly when probe is skipped", async () => {
    const cfg = {} as OpenClawConfig;
    mocks.promptModelAllowlist.mockResolvedValue({
      models: ["openai-codex/gpt-5.3-codex"],
    });
    const prompter = makePrompter({
      confirm: vi.fn(async () => false),
    });

    await promptAuthConfig(cfg, runtime, prompter);

    expect(mocks.probeSelectedModels).not.toHaveBeenCalled();
    expect(mocks.applyModelAllowlist).toHaveBeenCalledWith(cfg, ["openai-codex/gpt-5.3-codex"]);
    expect(mocks.applyModelFallbacksFromSelection).toHaveBeenCalledWith(cfg, [
      "openai-codex/gpt-5.3-codex",
    ]);
  });

  it("drops failed models after probe and keeps passing ones", async () => {
    const cfg = {} as OpenClawConfig;
    mocks.promptModelAllowlist.mockResolvedValue({
      models: ["openai-codex/gpt-5.3-codex", "openai-codex/gpt-5.2-codex"],
    });
    mocks.probeSelectedModels.mockResolvedValue([
      { model: "openai-codex/gpt-5.3-codex", ok: true },
      { model: "openai-codex/gpt-5.2-codex", ok: false, error: "unauthorized" },
    ]);
    const prompter = makePrompter({
      confirm: vi.fn(async () => true),
    });

    await promptAuthConfig(cfg, runtime, prompter);

    expect(mocks.applyModelAllowlist).toHaveBeenCalledWith(cfg, ["openai-codex/gpt-5.3-codex"]);
    expect(mocks.applyModelFallbacksFromSelection).toHaveBeenCalledWith(cfg, [
      "openai-codex/gpt-5.3-codex",
    ]);
  });

  it("re-prompts allowlist selection when all probed models fail", async () => {
    const cfg = {} as OpenClawConfig;
    mocks.promptModelAllowlist
      .mockResolvedValueOnce({
        models: ["openai-codex/gpt-5.3-codex"],
      })
      .mockResolvedValueOnce({});
    mocks.probeSelectedModels.mockResolvedValue([
      { model: "openai-codex/gpt-5.3-codex", ok: false, error: "unauthorized" },
    ]);
    const prompter = makePrompter({
      confirm: vi.fn(async () => true),
    });

    await promptAuthConfig(cfg, runtime, prompter);

    expect(mocks.promptModelAllowlist).toHaveBeenCalledTimes(2);
    expect(mocks.applyModelAllowlist).not.toHaveBeenCalled();
  });
});
