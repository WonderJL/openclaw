import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewaySwitchTool } from "./gateway-switch-tool.js";

const { callGatewayMock, loadModelCatalogMock, loadConfigMock } = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  loadModelCatalogMock: vi.fn(),
  loadConfigMock: vi.fn(),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: callGatewayMock,
}));

vi.mock("../model-catalog.js", () => ({
  loadModelCatalog: loadModelCatalogMock,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

describe("gateway_switch tool", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    loadModelCatalogMock.mockReset();
    loadConfigMock.mockReset();

    loadConfigMock.mockReturnValue({
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            models: [{ id: "gpt-5.2", name: "GPT-5.2", thinkingLevels: ["off", "low", "high"] }],
          },
          anthropic: {
            baseUrl: "https://api.anthropic.com/v1",
            models: [
              { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", thinkingLevels: ["off"] },
            ],
          },
        },
      },
    });
    loadModelCatalogMock.mockResolvedValue([
      {
        provider: "openai",
        id: "gpt-5.2",
        name: "GPT-5.2",
        thinkingLevels: ["off", "low", "high"],
      },
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        thinkingLevels: ["off"],
      },
    ]);
    callGatewayMock.mockResolvedValue({ ok: true });
  });

  it("applies provider defaults when command args are empty", async () => {
    const tool = createGatewaySwitchTool({ agentSessionKey: "agent:main:main" });
    await tool.execute("tool-1", {
      skillName: "gateway-openai",
      command: "",
    });

    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "sessions.patch",
      params: {
        key: "agent:main:main",
        model: "openai/gpt-5.2",
        thinkingLevel: "low",
      },
    });
  });

  it("applies explicit model and reasoning args", async () => {
    const tool = createGatewaySwitchTool({ agentSessionKey: "agent:main:main" });
    await tool.execute("tool-2", {
      skillName: "gateway-openai",
      command: "gpt-5.2 high",
    });

    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "sessions.patch",
      params: {
        key: "agent:main:main",
        model: "openai/gpt-5.2",
        thinkingLevel: "high",
      },
    });
  });

  it("rejects explicit args that point to a different provider", async () => {
    const tool = createGatewaySwitchTool({ agentSessionKey: "agent:main:main" });
    await expect(
      tool.execute("tool-3", {
        skillName: "gateway-openai",
        command: "anthropic/claude-sonnet-4-5",
      }),
    ).rejects.toThrow("model anthropic/claude-sonnet-4-5 is not in gateway openai");
    expect(callGatewayMock).not.toHaveBeenCalled();
  });
});
