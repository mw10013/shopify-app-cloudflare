import * as Cloudflare from "@alchemy.run/cloudflare";
import { workerNameOf } from "@mw10013/rigging/cloudflare/stage";
import { withE2eRoutes } from "@mw10013/shopify-app-cloudflare/test/e2e/backend";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import {
  backendBody,
  backendProps,
  productionShopifyApp,
  provideBackend,
} from "#backend/backend.ts";

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
