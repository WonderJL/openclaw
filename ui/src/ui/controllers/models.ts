import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelsListResult } from "../types.ts";

export type ModelsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  chatModelsLoading: boolean;
  chatModelsError: string | null;
  chatModels: ModelsListResult["models"];
};

export async function loadModels(state: ModelsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.chatModelsLoading) {
    return;
  }
  state.chatModelsLoading = true;
  state.chatModelsError = null;
  try {
    const res = await state.client.request<ModelsListResult | undefined>("models.list", {});
    state.chatModels = Array.isArray(res?.models) ? res.models : [];
  } catch (err) {
    state.chatModelsError = String(err);
  } finally {
    state.chatModelsLoading = false;
  }
}
