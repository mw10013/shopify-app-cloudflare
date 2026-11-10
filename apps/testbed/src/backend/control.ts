/**
 * The testbed's control door: what a test runner calls on a stage to drive it.
 *
 * @module
 */

import { type Auth, siteAuthControlHandlers } from "@mw10013/shopify-app-cloudflare/backend";
import { SiteAuthControlRpcs } from "@mw10013/shopify-app-cloudflare/contract";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Schema from "effect/Schema";

export const CONTROL_PATH = "/api/control";

/**
 * Who may call the door: anyone (`open`) or a caller bearing `CONTROL_TOKEN` (`token`). With
 * neither bound, the door answers `404`.
 */
export const ControlAccess = Schema.Literals(["open", "token"]);
export type ControlAccess = typeof ControlAccess.Type;

const digest = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** `token` admits only `Bearer <token>`, compared by digest in constant time. */
export const controlAllows = Effect.fnUntraced(function* (
  access: ControlAccess,
  token: Option.Option<Redacted.Redacted>,
  authorization: string | undefined,
) {
  if (access === "open") return true;
  if (Option.isNone(token) || authorization === undefined) return false;
  const want = new Uint8Array(yield* digest(`Bearer ${Redacted.value(token.value)}`));
  const got = new Uint8Array(yield* digest(authorization));
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= (want[i] ?? 0) ^ (got[i] ?? 0);
  return diff === 0;
});

export const control = Effect.gen(function* () {
  const access = yield* Config.option(Config.schema(ControlAccess, "CONTROL_ACCESS")).pipe(
    Effect.orDie,
  );
  const token = yield* Config.option(Config.Redacted("CONTROL_TOKEN")).pipe(Effect.orDie);
  const handlers = siteAuthControlHandlers.pipe(
    Layer.provide(Layer.succeedContext(yield* Effect.context<Auth>())),
  );
  const rpc = Effect.flatten(
    RpcServer.toHttpEffect(SiteAuthControlRpcs).pipe(
      Effect.provide(Layer.merge(handlers, RpcSerialization.layerNdjson)),
    ),
  );
  return {
    // Effect's RPC client posts to the URL with a trailing slash.
    isPath: (pathname: string) => pathname === CONTROL_PATH || pathname === `${CONTROL_PATH}/`,
    serve: Effect.fn("Control.serve")(function* (request: HttpServerRequest.HttpServerRequest) {
      if (Option.isNone(access)) return HttpServerResponse.empty({ status: 404 });
      if (!(yield* controlAllows(access.value, token, request.headers.authorization)))
        return HttpServerResponse.empty({ status: 401 });
      return yield* rpc;
    }),
  };
});
