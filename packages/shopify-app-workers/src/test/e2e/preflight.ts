/**
 * The run's `globalSetup`, before any project: a run that cannot work fails here in one sentence
 * naming its fix, instead of in a spec with every other test skipped. In order: the e2e server's
 * tunnel serves (public DNS first, see `tunnelReady`), the store has its store auth, the server
 * answers its status route on its local port, and the agent Chrome answers on CDP. The agent
 * Chrome's Shopify login is checked by the `shopify-admin` project's export.
 *
 * @module
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import { AGENT_CDP } from "@mw10013/devkit/shopify/agent-chrome";
import { tunnelReady } from "@mw10013/devkit/shopify/server";
import * as Array from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { FullConfig } from "playwright/test";

import { E2eShopStatus } from "#internal/e2e-status.ts";

import { E2eApp, shopOf } from "./app.ts";
import { storeAuthMissing } from "./store-auth.ts";

class PreflightError extends Schema.TaggedError<PreflightError>()("PreflightError", {
  message: Schema.String,
}) {}

const RESTART = "vp run e2e:stop && vp run e2e:start";

const fail = (message: string) => new PreflightError({ message });

const get = (url: string, headers: Readonly<Record<string, string>> = {}) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      return { status: response.status, body: await response.text() };
    },
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });

/** Every pack project carries the same app; the first one names it. */
const appOf = (config: FullConfig) =>
  Option.match(
    Array.findFirst(config.projects, (project) =>
      "e2eApp" in project.use ? Option.some(project.use.e2eApp) : Option.none(),
    ),
    {
      onNone: () =>
        Effect.fail(fail("no project carries an e2eApp: register e2eProjects(app, root)")),
      onSome: (app) =>
        Schema.decodeUnknownEffect(E2eApp)(app).pipe(
          Effect.mapError((error) => fail(`the e2eApp does not decode: ${error.message}`)),
        ),
    },
  );

const checkTunnel = (app: E2eApp) =>
  tunnelReady(app.server.tunnel).pipe(
    Effect.map(
      (took) => `${app.server.tunnel} ready in ${(Duration.toMillis(took) / 1000).toFixed(1)}s`,
    ),
    Effect.mapError((error) => fail(`${error.message}; read vp run e2e:logs, then ${RESTART}`)),
  );

const checkStoreAuth = (app: E2eApp, shop: string) =>
  app.storeScopes.length === 0
    ? Effect.succeed(`${shop} needs no store auth`)
    : storeAuthMissing(shop, app.storeScopes).pipe(
        Effect.mapError((error) => fail(error.message)),
        Effect.flatMap((missing) =>
          missing.length === 0
            ? Effect.succeed(`${shop} has store auth`)
            : Effect.fail(
                fail(
                  `${shop}'s store auth lacks ${missing.join(", ")}: vp run e2e:start grants it`,
                ),
              ),
        ),
      );

const checkServer = (app: E2eApp, shop: string) =>
  Effect.gen(function* () {
    const url = new URL(app.status.url);
    url.searchParams.set("shop", shop);
    const { status, body } = yield* get(url.href, app.status.headers).pipe(
      Effect.mapError((cause) =>
        fail(
          `the e2e server does not answer on port ${String(app.server.port)} (${cause}): ${RESTART}`,
        ),
      ),
    );
    if (status !== 200)
      return yield* fail(
        `the e2e status route answered HTTP ${String(status)} for ${shop}; a server started before its session, or for another store: ${RESTART}`,
      );
    yield* Schema.decodeUnknownEffect(Schema.fromJsonString(E2eShopStatus))(body).pipe(
      Effect.mapError((error) =>
        fail(`the e2e status route's answer does not decode: ${error.message}`),
      ),
    );
    return `the e2e server answers on port ${String(app.server.port)}`;
  });

const checkAgentChrome = get(`${AGENT_CDP}/json/version`).pipe(
  Effect.filterOrFail(
    ({ status }) => status === 200,
    ({ status }) => `HTTP ${String(status)}`,
  ),
  Effect.as(`the agent Chrome answers on ${AGENT_CDP}`),
  Effect.mapError((cause) =>
    fail(
      `the agent Chrome does not answer on ${AGENT_CDP} (${cause}): start it headless on port 9333`,
    ),
  ),
);

export default async function preflight(config: FullConfig): Promise<void> {
  const program = Effect.gen(function* () {
    const app = yield* appOf(config);
    const shop = shopOf(app);
    return [
      yield* checkTunnel(app),
      yield* checkStoreAuth(app, shop),
      yield* checkServer(app, shop),
      yield* checkAgentChrome,
    ].join(", ");
  });
  const result = await Effect.runPromise(
    program.pipe(Effect.result, Effect.provide(NodeServices.layer)),
  );
  if (Result.isFailure(result)) throw new Error(`e2e preflight: ${result.failure.message}`);
  console.log(`e2e preflight: ${result.success}`);
}
