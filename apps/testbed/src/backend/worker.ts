import * as Cloudflare from "@alchemy.run/cloudflare";
import { workerNameOf } from "@mw10013/rigging/cloudflare/stage";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import { backendBody, backendProps, productionShopifyApp, provideBackend } from "./backend.ts";

export default class Backend extends Cloudflare.Worker<Backend>()(
  "Backend",
  {
    name: Output.fromEffect(
      Effect.map(Alchemy.Stage, (stage) => workerNameOf("testbed", stage, "backend")),
    ),
    ...backendProps,
    main: import.meta.filename,
    workersDev: false,
  },
  provideBackend(backendBody, productionShopifyApp),
) {}
