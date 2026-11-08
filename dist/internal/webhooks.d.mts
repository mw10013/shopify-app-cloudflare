import { ShopifyAccessFailure } from "./contract.mjs";
import { ShopDomain } from "./domain.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { ShopifyHooks } from "./hooks.mjs";
import { ShopifyClient } from "./shopify-client.mjs";
import { ShopGrantors } from "./shop-grantor.mjs";
import { BuiltInTopic } from "./webhook-topics.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
/** A delivery that passed its HMAC check, its body parsed as JSON. */
export interface WebhookDelivery {
  readonly shop: ShopDomain;
  /** The `X-Shopify-Topic` header: `orders/create`. */
  readonly topic: string;
  readonly payload: unknown;
  readonly webhookId: string;
}
declare const MalformedWebhookError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
  readonly _tag: "MalformedWebhookError";
} & Readonly<A>;
/**
 * A verified delivery's payload did not decode. Answered 400 at Warning: a malformed payload does
 * not improve on redelivery, so a 5xx would only burn Shopify's retries.
 */
export declare class MalformedWebhookError extends MalformedWebhookError_base<{
  readonly topic: string;
}> {
  get message(): string;
}
/**
 * The app's handler for one extra topic. It fails only with what the package knows how to
 * answer; anything else it handles or dies on, so a new error does not compile until someone
 * decides which it is. Succeeding answers 200, and the handler logs its own state change.
 */
export type TopicHandler<R = never> = (delivery: WebhookDelivery) => Effect.Effect<void, ShopifyAccessFailure | MalformedWebhookError, R>;
/** An app's extra topics, keyed by the header's form. A built-in topic as a key is a type error. */
export type ExtraTopics<R = never> = Readonly<Record<string, TopicHandler<R>>> & Readonly<Partial<Record<BuiltInTopic, never>>>;
/** Decodes a delivery's payload with `schema`, failing {@link MalformedWebhookError}. */
export declare const decodePayload: <S extends Schema.Top & {
  readonly DecodingServices: never;
}>(schema: S) => (delivery: WebhookDelivery) => Effect.Effect<S["Type"], MalformedWebhookError>;
export interface WebhooksShape {
  /**
   * The Backend's `/webhooks/*` branch; dispatch is by header, so any path under it will do.
   *
   * | Outcome                                                        | Answer | Log                   |
   * | -------------------------------------------------------------- | ------ | --------------------- |
   * | Not a POST; a missing header or an empty body                  | 405, 400 | Debug               |
   * | HMAC failed                                                    | 401    | Error                 |
   * | HMAC passed, the shop domain or the body does not decode       | 400    | Warning               |
   * | HMAC passed, no handler for the topic                          | 404    | Error                 |
   * | Receipt, before the handler                                    |        | Debug                 |
   * | Handled                                                        | 200    | the handler's own     |
   * | `MalformedWebhookError`                                        | 400    | Warning               |
   * | `ShopifyUnavailableError`                                      | 503    | Warning               |
   * | `ReauthenticationRequiredError`, `AccessDeniedError`, `ShopInaccessibleError` | 200 | Warning, with the error's fields |
   * | `AppNotInstalledError`                                         | 200    | Debug                 |
   * | A defect, an `afterUninstall` defect included                  | 500    | Error                 |
   *
   * An unknown topic is an Error, not a Warning: a subscription nobody handles loses every
   * delivery silently, as a wrong secret does.
   */
  readonly serve: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
}
declare const Webhooks_base: Context.ServiceClass<Webhooks, "app/Webhooks", WebhooksShape>;
/** Shopify's webhooks, served by the Backend under `/webhooks/`. The HMAC is the only credential. */
export declare class Webhooks extends Webhooks_base {
  /** Over the built-in topics and the app's `extra` ones. */
  static readonly layer: <R>(extra: ExtraTopics<R>) => Layer.Layer<Webhooks, never, AppInstallationStore | ShopGrantors | ShopifyClient | ShopifyHooks | Exclude<R, import("effect/Scope").Scope>>;
}
export {};