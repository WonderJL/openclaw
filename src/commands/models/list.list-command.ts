import type { RuntimeEnv } from "../../runtime.js";
import { queryModelsList } from "./list.service.js";
import { printModelTable } from "./list.table.js";
import { ensureFlagCompatibility } from "./shared.js";

export async function modelsListCommand(
  opts: {
    all?: boolean;
    local?: boolean;
    provider?: string;
    json?: boolean;
    plain?: boolean;
  },
  runtime: RuntimeEnv,
) {
  ensureFlagCompatibility(opts);
  const result = await queryModelsList({
    all: opts.all === true,
    local: opts.local === true,
    provider: opts.provider,
  });
  if (result.registryError) {
    runtime.error(`Model registry unavailable: ${result.registryError}`);
  }
  const rows = result.rows;

  if (rows.length === 0) {
    runtime.log("No models found.");
    return;
  }

  printModelTable(rows, runtime, opts);
}
