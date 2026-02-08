# MUTLI_GATEWAY

## 0) Context

This document defines how OpenClaw supports multi AI provider gateway usage across:

1. Runtime configuration (`models.providers.*`)
2. Session switching (`sessions.patch`, skill commands)
3. User surfaces (CLI + Web UI chat controls)
4. Interactive configure model picker behavior (provider-scoped + usable-only + optional access probe)

The target is consistent provider/model/reasoning behavior across all entry points.

## 1) How To Use (Commands, Docs, Comments)

### 1.1 CLI / Config Commands

Use config to define multiple providers and per-model reasoning policy:

```bash
openclaw config set models.providers.openai.baseUrl "https://api.openai.com/v1"
openclaw config set models.providers.openai.models '[{"id":"gpt-5.2","name":"GPT-5.2","thinkingLevels":["off","low","high"]}]'

openclaw config set models.providers.anthropic.baseUrl "https://api.anthropic.com/v1"
openclaw config set models.providers.anthropic.api "anthropic-messages"
openclaw config set models.providers.anthropic.models '[{"id":"claude-sonnet-4-5","name":"Claude Sonnet 4.5","thinkingLevels":["off","minimal","low"]}]'
```

Validate available models/providers:

```bash
openclaw models list
openclaw models status
```

Set global or per-model thinking defaults:

```bash
# Global default when no per-model override exists
openclaw config set agents.defaults.thinkingDefault "low"

# Per-model defaults (replace/update the full models map)
openclaw config set agents.defaults.models '{"openai-codex/gpt-5.2-codex":{"thinkingDefault":"high"},"openai-codex/gpt-5.3-codex":{"thinkingDefault":"medium"}}'
```

### 1.1.1 List all available providers/gateways/models

Use these commands:

```bash
# Runtime-available catalog (provider/model)
openclaw models list

# Resolved defaults + auth/provider status
openclaw models status

# Raw configured provider map
openclaw config get models.providers
```

Also available by surface:

1. UI: Chat header provider/model dropdowns (loaded from `models.list`)
2. Skill commands: `/gateway-<provider>` commands are generated from `models.providers`

`openclaw models list` includes a `Think` column that shows the allowed thinking levels per model (for example `off|low|medium|high|xhigh`).

### 1.1.2 Add / Update / Delete provider-gateway-model

Add provider:

```bash
openclaw config set models.providers.openai.baseUrl "https://api.openai.com/v1"
openclaw config set models.providers.openai.apiKey "<OPENAI_API_KEY>"
```

Add model under provider (replace full provider models array):

```bash
openclaw config set models.providers.openai.models '[{"id":"gpt-5.2","name":"GPT-5.2","thinkingLevels":["off","low","high"]}]'
```

Update provider field:

```bash
openclaw config set models.providers.openai.baseUrl "https://your-gateway.example/v1"
```

Update models list (recommended: write the full array explicitly):

```bash
openclaw config set models.providers.openai.models '[{"id":"gpt-5.2","name":"GPT-5.2","thinkingLevels":["off","minimal","low","high"]},{"id":"gpt-4.1","name":"GPT-4.1","thinkingLevels":["off","low"]}]'
```

Delete provider:

```bash
openclaw config unset models.providers.openai
```

Delete model:

1. Read current models array for the provider
2. Remove the target model entry
3. Set the filtered array back via `openclaw config set models.providers.<provider>.models '<json-array>'`

Example:

```bash
openclaw config set models.providers.openai.models '[{"id":"gpt-4.1","name":"GPT-4.1","thinkingLevels":["off","low"]}]'
```

Notes:

1. `openclaw models list` shows runtime availability; `openclaw config get models.providers` shows configured source.
2. After add/update/delete, rerun `openclaw models list` and `openclaw models status` to verify.
3. Deleting a provider removes its generated `/gateway-<provider>` skill command.

### 1.1.3 Configure model picker (provider-scoped usable-only + access probe)

When you run `openclaw configure --section model` and choose a provider auth path:

1. The model multi-select is filtered to the selected provider (`preferredProvider`).
2. In provider-scoped mode, unusable models are hidden (`onlyUsable=true`) instead of shown with `auth missing`.
3. After selecting one or more models, OpenClaw asks `Test selected models now?` (default: `Yes`).
4. If `Yes`, each selected model is probed individually with a short no-tools prompt.
5. Failed models are removed from the saved selection; passing models are kept.
6. If all selected models fail, configure returns to the picker and asks you to select again.
7. If `No`, selection is saved unchanged.

Probe defaults:

1. Prompt: `Reply with OK. Do not use tools.`
2. Timeout: `8000ms`
3. Concurrency: `2`
4. Max tokens: `8`

Scope note:

1. This filtering/probe behavior applies to interactive configure flows.
2. Non-configure listing surfaces (`openclaw models list`, `openclaw models status`, chat `/models`) keep their existing behavior.

### 1.1.4 Change thinking per model

Use per-model defaults in `agents.defaults.models`:

```json5
{
  agents: {
    defaults: {
      thinkingDefault: "low", // global fallback
      models: {
        "openai-codex/gpt-5.2-codex": { thinkingDefault: "high" },
        "openai-codex/gpt-5.3-codex": { thinkingDefault: "medium" },
      },
    },
  },
}
```

Thinking default precedence:

1. Per-model `agents.defaults.models["provider/model"].thinkingDefault`
2. Global `agents.defaults.thinkingDefault`
3. Built-in fallback (`low` for reasoning-capable models, otherwise `off`)

### 1.2 Session Command Usage (Skill Commands)

Gateway skill commands are auto-generated from configured providers:

1. `/gateway-<provider>` uses provider defaults
2. `/gateway-<provider> <model> <reasoning>`
3. `/gateway-<provider> model=<model> reasoning=<level>`

Examples:

```text
/gateway-openai
/gateway-openai gpt-5.2 high
/gateway-openai model=gpt-5.2 thinking=low
/gateway-anthropic claude-sonnet-4-5 minimal
```

### 1.3 Web UI Usage

In Chat header controls:

1. Select provider
2. Select model
3. Select reasoning level

The UI persists selection through `sessions.patch` (`model`, `thinkingLevel`).

### 1.4 Docs To Reference

1. `docs/concepts/model-providers.md`
2. `docs/tools/slash-commands.md`
3. `src/agents/tools/gateway-switch-tool.ts`
4. `ui/src/ui/app-render.helpers.ts`

### 1.5 Comment Template (Issue/PR/Review)

Use this short format in comments:

```text
Gateway: <provider>
Model: <provider/model>
Reasoning: <off|minimal|low|medium|high|xhigh|on(for binary UI)>
Surface: <CLI|UI|skill-command|RPC>
Expected: <what should happen>
Actual: <what happened>
```

## 2) Structure

### 2.1 Config + Policy Layer

1. `src/config/types.models.ts`
2. `src/config/types.agent-defaults.ts`
3. `src/config/zod-schema.agent-defaults.ts`
4. `src/agents/model-thinking-levels.ts`
5. `src/agents/model-selection.ts`

Responsibilities:

1. Define `thinkingLevels` per model
2. Validate allowed reasoning values
3. Resolve default reasoning precedence (per-model override first, then global default, then capability fallback)

### 2.2 Catalog + Protocol Layer

1. `src/agents/model-catalog.ts`
2. `src/gateway/protocol/schema/agents-models-skills.ts`
3. `apps/macos/Sources/OpenClawProtocol/GatewayModels.swift`
4. `apps/shared/OpenClawKit/Sources/OpenClawProtocol/GatewayModels.swift`

Responsibilities:

1. Expose provider/model metadata and `thinkingLevels`
2. Keep Gateway schema and typed clients aligned

### 2.3 Session + Runtime Enforcement

1. `src/gateway/sessions-patch.ts`
2. `src/auto-reply/reply/get-reply-run.ts`
3. `src/auto-reply/reply/directive-handling.impl.ts`

Responsibilities:

1. Reject invalid explicit reasoning levels
2. Auto-fallback stale reasoning levels after model switch
3. Keep directive behavior and runtime behavior consistent

### 2.4 Skill Command + Tool Dispatch

1. `src/auto-reply/skill-commands.ts`
2. `src/agents/tools/gateway-switch-tool.ts`
3. `src/agents/openclaw-tools.ts`
4. `src/agents/tool-policy.ts`
5. `src/agents/tool-display.json`
6. `src/agents/system-prompt.ts`

Responsibilities:

1. Generate `gateway-<provider>` commands
2. Parse hybrid args (positional and key=value)
3. Enforce provider lock for command target
4. Write session model/reasoning state through Gateway

### 2.5 UI Layer

1. `ui/src/ui/controllers/models.ts`
2. `ui/src/ui/app-chat.ts`
3. `ui/src/ui/app-render.helpers.ts`
4. `ui/src/ui/controllers/sessions.ts`
5. `ui/src/ui/types.ts`

Responsibilities:

1. Load model catalog from `models.list`
2. Render provider/model/reasoning selectors
3. Patch session on selection changes
4. Handle binary provider display (`off/on`)

### 2.6 Configure Picker + Access Probe Layer

1. `src/commands/model-picker.ts`
2. `src/commands/configure.gateway-auth.ts`
3. `src/commands/model-picker.probe.ts`

Responsibilities:

1. Filter interactive picker options by selected provider
2. Hide auth-missing entries in usable-only mode
3. Prompt to test selected models before save
4. Probe each selected model, keep passing models, and re-prompt when all fail

## 3) Examples And Samples

### 3.1 Sample Config (JSON5)

```json5
{
  agents: {
    defaults: {
      thinkingDefault: "low",
      models: {
        "openai/gpt-5.2": { thinkingDefault: "high" },
        "anthropic/claude-sonnet-4-5": { thinkingDefault: "minimal" },
      },
    },
  },
  models: {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        models: [
          {
            id: "gpt-5.2",
            name: "GPT-5.2",
            thinkingLevels: ["off", "low", "high"],
          },
        ],
      },
      anthropic: {
        baseUrl: "https://api.anthropic.com/v1",
        api: "anthropic-messages",
        models: [
          {
            id: "claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            thinkingLevels: ["off", "minimal", "low"],
          },
        ],
      },
    },
  },
}
```

### 3.2 Sample RPC Patch

```json
{
  "method": "sessions.patch",
  "params": {
    "key": "agent:main:main",
    "model": "openai/gpt-5.2",
    "thinkingLevel": "high"
  }
}
```

Reasoning off:

```json
{
  "method": "sessions.patch",
  "params": {
    "key": "agent:main:main",
    "model": "openai/gpt-5.2",
    "thinkingLevel": null
  }
}
```

### 3.3 Sample Skill Dispatch

```text
/gateway-openai gpt-5.2 high
```

Internally routes to `gateway_switch` tool and applies:

1. Provider = openai
2. Model = gpt-5.2
3. Reasoning = high

## 4) High-Level Design

### 4.1 Core Flow

1. Config declares providers/models and optional `thinkingLevels`
2. Catalog exposes model metadata through `models.list`
3. UI and skill-command surfaces select provider/model/reasoning
4. Selection writes through `sessions.patch`
5. Runtime validates reasoning against model policy
6. Invalid explicit values are rejected; stale implicit values are auto-corrected

### 4.2 Design Rules

1. One session has one active provider/model at a time
2. Provider-specific command must not switch into another provider
3. Reasoning policy is model-scoped, not global
4. UI and command flows must share the same backend validation
5. `off` is represented as `thinkingLevel: null` in patch operations
6. In configure model picker flows, provider selection narrows choices to that provider and usable models
7. Access probe is opt-in (default yes) and prunes failed models before save

## 5) CLI + UI Coverage Checklist

### 5.1 CLI Coverage

1. Configure multiple providers
2. Verify model list and defaults
3. Use gateway skill commands with and without args
4. Validate rejection for disallowed reasoning level
5. Verify `Think` column in `openclaw models list`
6. Verify configure picker only shows provider-scoped usable models after auth choice
7. Verify `Test selected models now?` probe keeps passing models and drops failing models
8. Verify all-fail probe path re-prompts and does not save unusable-only selection

### 5.2 UI Coverage

1. Provider selector switches model set
2. Model selector updates session model
3. Reasoning selector respects `thinkingLevels`
4. Binary providers map `on` to an allowed enabled level
5. UI refresh does not reset selected session values unexpectedly

### 5.3 Regression Tests

1. `src/gateway/sessions-patch.test.ts`
2. `src/auto-reply/skill-commands.test.ts`
3. `src/agents/tools/gateway-switch-tool.test.ts`
4. `src/commands/model-picker.test.ts`
5. `src/commands/configure.gateway-auth.test.ts`
6. `src/commands/model-picker.probe.test.ts`
7. `src/commands/models.list.test.ts`
8. `ui/src/ui/navigation.browser.test.ts`
