import * as Cloudflare from "@alchemy.run/cloudflare";
import { workerNameOf } from "@mw10013/devkit/cloudflare/stage";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import {
  backendBody,
  backendProps,
  productionShopifyApp,
  provideBackend,
} from "#backend/backend.ts";

import { e2eAccessConfig } from "./session.ts";
import { E2E_STATUS_PATH, e2eStatus } from "./status.ts";

/**
 * The Backend as the `e2e` stage deploys it in place of `Backend`: the production body and
 * services, with the e2e status route ({@link E2E_STATUS_PATH}) in front of its `fetch`, gated by
 * the session the stack binds ({@link e2eAccessConfig}). Only
 * `alchemy.run.ts` imports it, and only for `e2e`, so the Backend every other stage deploys never
 * carries the route; lint keeps `src/backend` and `src/web` from importing `src/e2e`.
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
  provideBackend(
    Effect.gen(function* () {
      const status = yield* e2eStatus(yield* e2eAccessConfig);
      const base = yield* backendBody;
      const fetch = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { pathname } = new URL(request.url, "http://backend");
        if (pathname === E2E_STATUS_PATH) return yield* status;
        return yield* base.fetch;
      });
      // Spread first, so the methods stay beside the new `fetch`.
      return { ...base, fetch };
    }),
    productionShopifyApp,
  ),
) {}
