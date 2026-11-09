import { AppInstallations } from "../internal/shopify-access.mjs";
import "./e2e-session.mjs";
import "effect/Option";
import * as Effect from "effect/Effect";
import "effect/Redacted";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
/**
 * An app's Backend body with the e2e routes in front of its `fetch`, gated by the session the
 * stack binds ({@link e2eAccessConfig}); each `/webhooks/*` answer is recorded on its way out. The
 * body's other members, its binding methods, are kept as they are.
 *
 * Only a Backend Worker that only the `e2e` stage deploys may serve this body: the app declares
 * that Worker apart from its production Backend, with the same props and layers, and its stack
 * picks it on `e2e` alone, so no other stage can answer the routes.
 *
 * @example
 * ```ts
 * export default class E2eBackend extends Cloudflare.Worker<E2eBackend>()(
 *   "E2eBackend",
 *   { ...backendProps, main: import.meta.filename },
 *   provideBackend(withE2eRoutes(backendBody), productionShopifyApp),
 * ) {}
 * ```
 */
export declare const withE2eRoutes: <FE, FR, Methods, E, R>(body: Effect.Effect<{
  readonly fetch: Effect.Effect<HttpServerResponse.HttpServerResponse, FE, FR>;
} & Methods, E, R>) => Effect.Effect<Omit<{
  readonly fetch: Effect.Effect<HttpServerResponse.HttpServerResponse, FE, FR>;
} & Methods, "fetch"> & {
  fetch: Effect.Effect<HttpServerResponse.HttpServerResponse, FE, FR | HttpServerRequest.HttpServerRequest>;
}, E | import("effect/Config").ConfigError, R | AppInstallations>;