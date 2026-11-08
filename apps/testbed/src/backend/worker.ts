import * as Cloudflare from "@alchemy.run/cloudflare";
import { workerNameOf } from "@mw10013/devkit/cloudflare/stage";
import { GrantorProbe } from "@mw10013/shopify-app-workers/backend";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** The spike's probe path: a call through the package's `ShopGrantor` binding. */
const GRANTOR_PROBE_PATH = "/api/spike/grantor";

/**
 * The private Effect Worker. It has no public URL: the browser reaches it only through the
 * Website, which calls it over the `BACKEND` service binding. It serves the step 2 spike's
 * grantor probe on {@link GRANTOR_PROBE_PATH}; every other request is 404.
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
  Effect.gen(function* () {
    const probe = yield* GrantorProbe;
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (new URL(request.url, "http://backend").pathname !== GRANTOR_PROBE_PATH)
          return HttpServerResponse.empty({ status: 404 });
        return HttpServerResponse.text(yield* probe.ping("spike.myshopify.com"));
      }),
    };
  }).pipe(Effect.provide(GrantorProbe.layer)),
) {}
