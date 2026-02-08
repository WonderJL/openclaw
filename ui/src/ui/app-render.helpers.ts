import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { AppViewState } from "./app-view-state.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ThemeMode } from "./theme.ts";
import type { SessionsListResult } from "./types.ts";
import { refreshChat } from "./app-chat.ts";
import { syncUrlWithSessionKey } from "./app-settings.ts";
import { OpenClawApp } from "./app.ts";
import { ChatState, loadChatHistory } from "./controllers/chat.ts";
import { patchSession } from "./controllers/sessions.ts";
import { icons } from "./icons.ts";
import { iconForTab, pathForTab, titleForTab, type Tab } from "./navigation.ts";

export function renderTab(state: AppViewState, tab: Tab) {
  const href = pathForTab(tab, state.basePath);
  return html`
    <a
      href=${href}
      class="nav-item ${state.tab === tab ? "active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__text">${titleForTab(tab)}</span>
    </a>
  `;
}

export function renderChatControls(state: AppViewState) {
  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const sessionOptions = resolveSessionOptions(
    state.sessionKey,
    state.sessionsResult,
    mainSessionKey,
  );
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const activeSession = state.sessionsResult?.sessions?.find((row) => row.key === state.sessionKey);
  const providerMap = new Map<string, { label: string; models: AppViewState["chatModels"] }>();
  for (const entry of state.chatModels) {
    const key = normalizeProviderIdForThinking(entry.provider);
    const existing = providerMap.get(key);
    if (existing) {
      existing.models.push(entry);
    } else {
      providerMap.set(key, { label: entry.provider, models: [entry] });
    }
  }
  const providerKeys = [...providerMap.keys()].toSorted((a, b) => a.localeCompare(b));
  const activeProviderKey = normalizeProviderIdForThinking(activeSession?.modelProvider);
  const selectedProviderKey =
    providerKeys.includes(activeProviderKey) && activeProviderKey
      ? activeProviderKey
      : (providerKeys[0] ?? "");
  const selectedProvider = selectedProviderKey ? providerMap.get(selectedProviderKey) : undefined;
  const modelsForProvider = (selectedProvider?.models ?? []).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
  const sessionModelId =
    activeSession?.model &&
    normalizeProviderIdForThinking(activeSession?.modelProvider) === selectedProviderKey
      ? activeSession.model
      : "";
  const selectedModel =
    modelsForProvider.find((entry) => entry.id === sessionModelId) ?? modelsForProvider[0];
  const selectedModelRef = selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : "";
  const isBinaryProvider = isBinaryThinkingProviderForUi(selectedProvider?.label);
  const thinkingOptions = resolveThinkingOptionList({
    provider: selectedProvider?.label,
    thinkingLevels: selectedModel?.thinkingLevels,
  });
  const hasExplicitThinkingLevels = thinkingOptions.length > 0;
  const thinkingDisplay = hasExplicitThinkingLevels
    ? resolveThinkingDisplay(activeSession?.thinkingLevel, isBinaryProvider)
    : "";
  const displayedThinkingOptions = hasExplicitThinkingLevels
    ? withCurrentThinkingOption(thinkingOptions, thinkingDisplay)
    : [];
  const canSelectModel = state.connected && !state.chatModelsLoading && Boolean(selectedProvider);
  const canSelectThinking = canSelectModel && Boolean(selectedModel) && hasExplicitThinkingLevels;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  // Refresh icon
  const refreshIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  return html`
    <div class="chat-controls">
      <label class="field chat-controls__session">
        <select
          .value=${state.sessionKey}
          ?disabled=${!state.connected}
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            state.sessionKey = next;
            state.chatMessage = "";
            state.chatStream = null;
            (state as unknown as OpenClawApp).chatStreamStartedAt = null;
            state.chatRunId = null;
            (state as unknown as OpenClawApp).resetToolStream();
            (state as unknown as OpenClawApp).resetChatScroll();
            state.applySettings({
              ...state.settings,
              sessionKey: next,
              lastActiveSessionKey: next,
            });
            void state.loadAssistantIdentity();
            syncUrlWithSessionKey(
              state as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
              next,
              true,
            );
            void loadChatHistory(state as unknown as ChatState);
          }}
        >
          ${repeat(
            sessionOptions,
            (entry) => entry.key,
            (entry) =>
              html`<option value=${entry.key}>
                ${entry.displayName ?? entry.key}
              </option>`,
          )}
        </select>
      </label>
      <label class="field chat-controls__provider">
        <select
          .value=${selectedProviderKey}
          ?disabled=${!state.connected || state.chatModelsLoading || providerKeys.length === 0}
          @change=${(e: Event) => {
            const nextProviderKey = (e.target as HTMLSelectElement).value;
            const nextProvider = providerMap.get(nextProviderKey);
            const nextModel = nextProvider?.models?.[0];
            if (!nextProvider || !nextModel) {
              return;
            }
            const options = resolveThinkingOptionList({
              provider: nextProvider.label,
              thinkingLevels: nextModel.thinkingLevels,
            });
            const nextThinking = resolveDefaultThinkingOption(options);
            const nextModelRef = `${nextModel.provider}/${nextModel.id}`;
            const nextThinkingPatch = resolveThinkingPatchValue(
              nextThinking,
              isBinaryThinkingProviderForUi(nextProvider.label),
              nextModel.thinkingLevels,
            );
            applyLocalChatSessionPatch(state, {
              model: nextModelRef,
              thinkingLevel: nextThinkingPatch,
            });
            void patchSession(
              state as unknown as Parameters<typeof patchSession>[0],
              state.sessionKey,
              {
                model: nextModelRef,
                thinkingLevel: nextThinkingPatch,
              },
            );
          }}
        >
          ${
            providerKeys.length === 0
              ? html`
                  <option value="">Gateway</option>
                `
              : repeat(
                  providerKeys,
                  (entry) => entry,
                  (entry) =>
                    html`<option value=${entry}>${providerMap.get(entry)?.label ?? entry}</option>`,
                )
          }
        </select>
      </label>
      <label class="field chat-controls__model">
        <select
          .value=${selectedModelRef}
          ?disabled=${!canSelectModel}
          @change=${(e: Event) => {
            const rawRef = (e.target as HTMLSelectElement).value.trim();
            if (!rawRef) {
              return;
            }
            const [provider, model] = rawRef.split("/", 2);
            if (!provider || !model) {
              return;
            }
            const match = state.chatModels.find(
              (entry) =>
                normalizeProviderIdForThinking(entry.provider) ===
                  normalizeProviderIdForThinking(provider) && entry.id === model,
            );
            const options = resolveThinkingOptionList({
              provider,
              thinkingLevels: match?.thinkingLevels,
            });
            const nextThinking = resolveDefaultThinkingOption(options);
            const nextThinkingPatch = resolveThinkingPatchValue(
              nextThinking,
              isBinaryThinkingProviderForUi(provider),
              match?.thinkingLevels,
            );
            applyLocalChatSessionPatch(state, {
              model: rawRef,
              thinkingLevel: nextThinkingPatch,
            });
            void patchSession(
              state as unknown as Parameters<typeof patchSession>[0],
              state.sessionKey,
              {
                model: rawRef,
                thinkingLevel: nextThinkingPatch,
              },
            );
          }}
        >
          ${
            modelsForProvider.length === 0
              ? html`
                  <option value="">Model</option>
                `
              : repeat(
                  modelsForProvider,
                  (entry) => `${entry.provider}/${entry.id}`,
                  (entry) =>
                    html`<option value=${`${entry.provider}/${entry.id}`}>
                      ${entry.name}
                    </option>`,
                )
          }
        </select>
      </label>
      <label class="field chat-controls__reasoning">
        <select
          .value=${thinkingDisplay}
          ?disabled=${!canSelectThinking}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            const nextThinkingPatch = resolveThinkingPatchValue(
              value,
              isBinaryProvider,
              selectedModel?.thinkingLevels,
            );
            applyLocalChatSessionPatch(state, { thinkingLevel: nextThinkingPatch });
            void patchSession(
              state as unknown as Parameters<typeof patchSession>[0],
              state.sessionKey,
              {
                thinkingLevel: nextThinkingPatch,
              },
            );
          }}
        >
          ${
            displayedThinkingOptions.length === 0
              ? html`
                  <option value="">thinking unavailable</option>
                `
              : repeat(
                  displayedThinkingOptions,
                  (entry) => entry,
                  (entry) => html`<option value=${entry}>${entry}</option>`,
                )
          }
        </select>
      </label>
      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${async () => {
          const app = state as unknown as OpenClawApp;
          app.chatManualRefreshInFlight = true;
          app.chatNewMessagesBelow = false;
          await app.updateComplete;
          app.resetToolStream();
          try {
            await refreshChat(state as unknown as Parameters<typeof refreshChat>[0], {
              scheduleScroll: false,
            });
            app.scrollToBottom({ smooth: true });
          } finally {
            requestAnimationFrame(() => {
              app.chatManualRefreshInFlight = false;
              app.chatNewMessagesBelow = false;
            });
          }
        }}
        title="Refresh chat data"
      >
        ${refreshIcon}
      </button>
      ${
        state.chatModelsError
          ? html`<span class="muted" title=${state.chatModelsError}>model catalog unavailable</span>`
          : null
      }
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatShowThinking: !state.settings.chatShowThinking,
          });
        }}
        aria-pressed=${showThinking}
        title=${
          disableThinkingToggle
            ? "Disabled during onboarding"
            : "Toggle assistant thinking/working output"
        }
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${
          disableFocusToggle
            ? "Disabled during onboarding"
            : "Toggle focus mode (hide sidebar + page header)"
        }
      >
        ${focusIcon}
      </button>
    </div>
  `;
}

function applyLocalChatSessionPatch(
  state: AppViewState,
  patch: { model?: string | null; thinkingLevel?: string | null },
) {
  const result = state.sessionsResult;
  if (!result?.sessions?.length) {
    return;
  }
  const nextSessions = result.sessions.map((row) => {
    if (row.key !== state.sessionKey) {
      return row;
    }
    const next = { ...row };
    if ("model" in patch) {
      const raw = String(patch.model ?? "").trim();
      if (!raw) {
        next.model = undefined;
        next.modelProvider = undefined;
      } else {
        const [provider, model] = raw.split("/", 2);
        if (provider && model) {
          next.modelProvider = provider;
          next.model = model;
        }
      }
    }
    if ("thinkingLevel" in patch) {
      next.thinkingLevel = patch.thinkingLevel ?? undefined;
    }
    return next;
  });
  state.sessionsResult = {
    ...result,
    sessions: nextSessions,
  };
}

function normalizeProviderIdForThinking(provider?: string | null): string {
  if (!provider) {
    return "";
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  return normalized;
}

function isBinaryThinkingProviderForUi(provider?: string | null): boolean {
  return normalizeProviderIdForThinking(provider) === "zai";
}

function resolveThinkingOptionList(params: {
  provider?: string;
  thinkingLevels?: ReadonlyArray<string>;
}): string[] {
  const levels =
    Array.isArray(params.thinkingLevels) && params.thinkingLevels.length > 0
      ? [...new Set(params.thinkingLevels.map((entry) => String(entry).trim()).filter(Boolean))]
      : [];
  if (levels.length === 0) {
    return [];
  }
  if (!isBinaryThinkingProviderForUi(params.provider)) {
    return levels;
  }
  const hasEnabled = levels.some((entry) => entry !== "off");
  return hasEnabled ? ["off", "on"] : ["off"];
}

function resolveThinkingDisplay(value: string | null | undefined, isBinary: boolean): string {
  const level = String(value ?? "").trim();
  if (!isBinary) {
    return level || "off";
  }
  if (!level || level === "off") {
    return "off";
  }
  return "on";
}

function resolveThinkingPatchValue(
  value: string,
  isBinary: boolean,
  thinkingLevels?: ReadonlyArray<string>,
): string | null {
  const level = value.trim();
  if (!level || level === "off") {
    return null;
  }
  if (!isBinary) {
    return level;
  }
  return resolveBinaryEnabledThinkingLevel(thinkingLevels);
}

function resolveBinaryEnabledThinkingLevel(thinkingLevels?: ReadonlyArray<string>): string {
  if (!Array.isArray(thinkingLevels) || thinkingLevels.length === 0) {
    return "low";
  }
  const normalized = [
    ...new Set(thinkingLevels.map((entry) => String(entry).trim()).filter(Boolean)),
  ];
  if (normalized.includes("low")) {
    return "low";
  }
  const enabled = normalized.find((entry) => entry !== "off");
  return enabled ?? "low";
}

function resolveDefaultThinkingOption(options: ReadonlyArray<string>): string {
  if (options.includes("low")) {
    return "low";
  }
  const enabled = options.find((entry) => entry !== "off");
  return enabled ?? "off";
}

function withCurrentThinkingOption(options: ReadonlyArray<string>, current: string): string[] {
  if (!current || options.includes(current)) {
    return [...options];
  }
  return [...options, current];
}

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

function resolveMainSessionKey(
  hello: AppViewState["hello"],
  sessions: SessionsListResult | null,
): string | null {
  const snapshot = hello?.snapshot as { sessionDefaults?: SessionDefaultsSnapshot } | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  if (sessions?.sessions?.some((row) => row.key === "main")) {
    return "main";
  }
  return null;
}

function resolveSessionDisplayName(key: string, row?: SessionsListResult["sessions"][number]) {
  const label = row?.label?.trim() || "";
  const displayName = row?.displayName?.trim() || "";
  if (label && label !== key) {
    return `${label} (${key})`;
  }
  if (displayName && displayName !== key) {
    return `${key} (${displayName})`;
  }
  return key;
}

function resolveSessionOptions(
  sessionKey: string,
  sessions: SessionsListResult | null,
  mainSessionKey?: string | null,
) {
  const seen = new Set<string>();
  const options: Array<{ key: string; displayName?: string }> = [];

  const resolvedMain = mainSessionKey && sessions?.sessions?.find((s) => s.key === mainSessionKey);
  const resolvedCurrent = sessions?.sessions?.find((s) => s.key === sessionKey);

  // Add main session key first
  if (mainSessionKey) {
    seen.add(mainSessionKey);
    options.push({
      key: mainSessionKey,
      displayName: resolveSessionDisplayName(mainSessionKey, resolvedMain || undefined),
    });
  }

  // Add current session key next
  if (!seen.has(sessionKey)) {
    seen.add(sessionKey);
    options.push({
      key: sessionKey,
      displayName: resolveSessionDisplayName(sessionKey, resolvedCurrent),
    });
  }

  // Add sessions from the result
  if (sessions?.sessions) {
    for (const s of sessions.sessions) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        options.push({
          key: s.key,
          displayName: resolveSessionDisplayName(s.key, s),
        });
      }
    }
  }

  return options;
}

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

export function renderThemeToggle(state: AppViewState) {
  const index = Math.max(0, THEME_ORDER.indexOf(state.theme));
  const applyTheme = (next: ThemeMode) => (event: MouseEvent) => {
    const element = event.currentTarget as HTMLElement;
    const context: ThemeTransitionContext = { element };
    if (event.clientX || event.clientY) {
      context.pointerClientX = event.clientX;
      context.pointerClientY = event.clientY;
    }
    state.setTheme(next, context);
  };

  return html`
    <div class="theme-toggle" style="--theme-index: ${index};">
      <div class="theme-toggle__track" role="group" aria-label="Theme">
        <span class="theme-toggle__indicator"></span>
        <button
          class="theme-toggle__button ${state.theme === "system" ? "active" : ""}"
          @click=${applyTheme("system")}
          aria-pressed=${state.theme === "system"}
          aria-label="System theme"
          title="System"
        >
          ${renderMonitorIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "light" ? "active" : ""}"
          @click=${applyTheme("light")}
          aria-pressed=${state.theme === "light"}
          aria-label="Light theme"
          title="Light"
        >
          ${renderSunIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "dark" ? "active" : ""}"
          @click=${applyTheme("dark")}
          aria-pressed=${state.theme === "dark"}
          aria-label="Dark theme"
          title="Dark"
        >
          ${renderMoonIcon()}
        </button>
      </div>
    </div>
  `;
}

function renderSunIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path>
      <path d="M12 20v2"></path>
      <path d="m4.93 4.93 1.41 1.41"></path>
      <path d="m17.66 17.66 1.41 1.41"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="m6.34 17.66-1.41 1.41"></path>
      <path d="m19.07 4.93-1.41 1.41"></path>
    </svg>
  `;
}

function renderMoonIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      ></path>
    </svg>
  `;
}

function renderMonitorIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <line x1="8" x2="16" y1="21" y2="21"></line>
      <line x1="12" x2="12" y1="17" y2="21"></line>
    </svg>
  `;
}
