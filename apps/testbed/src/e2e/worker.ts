import * as Cloudflare from "@alchemy.run/cloudflare";
import { workerNameOf } from "@mw10013/rigging/cloudflare/stage";
import { withE2eRoutes } from "@mw10013/shopify-app-workers/test/e2e/backend";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import {
  backendBody,
  backendProps,
  productionShopifyApp,
  provideBackend,
} from "#backend/backend.ts";

/**
 * The Backend as the `e2e` stage deploys it in place of `Backend`: the production body and
 * services, with the package's e2e routes in front of its `fetch` ({@link withE2eRoutes}). Only
 * `alchemy.run.ts` imports it, and only for `e2e`, so the Backend every other stage deploys never
 * carries the routes; lint keeps `src/backend` and `src/web` from importing `src/e2e`.
 */
export default class E2eBackend extends Cloudflare.Worker<E2eBackend>()(
  "E2eBackend",
  {
    name: Output.fromEffect(
      Effect.map(Alchemy.Stage, (stage) => workerNameOf("testbed", stage, "backend")),
    ),
    ...backendProps,
    main: import.meta.filename,
    workersDev: false,
  },
  provideBackend(withE2eRoutes(backendBody), productionShopifyApp),
) {}
