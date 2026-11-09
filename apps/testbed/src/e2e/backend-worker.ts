/**
 * Which Backend Worker a stage deploys, apart from `alchemy.run.ts` so a test can pin the choice.
 *
 * @module
 */

import type { Environment } from "@mw10013/rigging/cloudflare/stage";

import Backend from "#backend/worker.ts";

import E2eBackend from "./worker.ts";

/**
 * {@link E2eBackend} on `e2e`, which adds the e2e status route, and {@link Backend} on every
 * other environment, so none of them can serve that route.
 */
export const backendWorkerFor = (environment: Environment) =>
  environment === "e2e" ? E2eBackend : Backend;
