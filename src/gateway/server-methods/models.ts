import type { GatewayRequestHandlers } from "./types.js";
import { queryModelsList } from "../../commands/models/list.service.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as {
        all?: boolean;
        local?: boolean;
        provider?: string;
      };
      const result = await queryModelsList({
        // Preserve previous behavior for callers that pass no params: return full catalog.
        all: p.all ?? true,
        local: p.local === true,
        provider: p.provider,
      });
      if (result.registryError && result.models.length === 0) {
        throw new Error(result.registryError);
      }
      const models = result.models.map((entry) => {
        const payload: Record<string, unknown> = {
          id: entry.id,
          name: entry.name,
          provider: entry.provider,
        };
        if (typeof entry.contextWindow === "number" && entry.contextWindow > 0) {
          payload.contextWindow = entry.contextWindow;
        }
        if (typeof entry.reasoning === "boolean") {
          payload.reasoning = entry.reasoning;
        }
        if (Array.isArray(entry.thinkingLevels) && entry.thinkingLevels.length > 0) {
          payload.thinkingLevels = entry.thinkingLevels;
          payload.thinkingLevelsExplicit = entry.thinkingLevelsExplicit === true;
        }
        return payload;
      });
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
