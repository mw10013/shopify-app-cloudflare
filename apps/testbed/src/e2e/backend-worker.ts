import type { Environment } from "@mw10013/rigging/cloudflare/stage";

import Backend from "#backend/worker.ts";

import E2eBackend from "./worker.ts";

export const backendWorkerFor = (environment: Environment) =>
  environment === "e2e" ? E2eBackend : Backend;
