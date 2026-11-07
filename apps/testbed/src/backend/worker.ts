import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { workerNameOf } from "#devkit/cloudflare/stage.ts";

/**
 * The private Effect Worker. It has no public URL: the browser reaches it only through the
 * Website, which calls it over the `BACKEND` service binding. It serves nothing yet, so every
 * request is 404.
 */
export default class Backend extends Cloudflare.Worker<Backend>()(
  "Backend",
  {
    name: Output.fromEffect(
      Effect.map(Alchemy.Stage, (stage) => workerNameOf("testbed", stage, "backend")),
    ),
    main: import.meta.filename,
    workersDev: false,
    // Only reached through the service binding, so any free port will do.
    dev: { port: 0 },
    compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
  },
  Effect.succeed({ fetch: Effect.succeed(HttpServerResponse.empty({ status: 404 })) }),
) {}
