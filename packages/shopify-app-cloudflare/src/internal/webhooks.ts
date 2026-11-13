import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { AppInstallationStore } from "./app-installation-store.ts";
import type { ShopifyAccessFailure } from "./contract.ts";
import type { ShopDomain } from "./domain.ts";
import { bestEffort, ShopifyHooks } from "./hooks.ts";
import { ShopifyClient } from "./shopify-client.ts";
import type { BuiltInTopic } from "./webhook-topics.ts";

/** A delivery that passed its HMAC check, its body parsed as JSON. */
export interface WebhookDelivery {
  readonly shop: ShopDomain;
  /** The `X-Shopify-Topic` header: `orders/create`. */
  readonly topic: string;
  readonly payload: unknown;
  readonly webhookId: string;
}

/**
 * A verified delivery's payload did not decode. Answered 400 at Warning: a malformed payload does
 * not improve on redelivery, so a 5xx would only burn Shopify's retries.
 */
export class MalformedWebhookError extends Data.TaggedError("MalformedWebhookError")<{
  readonly topic: string;
}> {
  override get message() {
    return `The ${this.topic} payload does not decode`;
  }
}

/**
 * The app's handler for one extra topic. It fails only with what the package knows how to
 * answer; anything else it handles or dies on, so a new error does not compile until someone
 * decides which it is. Succeeding answers 200, and the handler logs its own state change.
 */
export type TopicHandler<R = never> = (
  delivery: WebhookDelivery,
) => Effect.Effect<void, ShopifyAccessFailure | MalformedWebhookError, R>;

/** An app's extra topics, keyed by the header's form. A built-in topic as a key is a type error. */
export type ExtraTopics<R = never> = Readonly<Record<string, TopicHandler<R>>> &
  Readonly<Partial<Record<BuiltInTopic, never>>>;

/** Decodes a delivery's payload with `schema`, failing {@link MalformedWebhookError}. */
export const decodePayload =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  (delivery: WebhookDelivery): Effect.Effect<S["Type"], MalformedWebhookError> =>
    Schema.decodeUnknownEffect(schema)(delivery.payload).pipe(
      Effect.mapError(() => new MalformedWebhookError({ topic: delivery.topic })),
    );

const ScopesUpdatePayload = Schema.Struct({ current: Schema.Array(Schema.String) });

type AnsweredFailure = ShopifyAccessFailure | MalformedWebhookError;

/**
 * How a delivery whose handler failed is answered and logged. It is
 * answered non-2xx only when redelivery can succeed on its own: Shopify's retries end within
 * hours, and failures that persist can remove the subscription. One answered 200 without acting
 * relies on the app's reconciliation once access returns.
 */
const FAILURE_ANSWERS = {
  ShopifyUnavailableError: { status: 503, log: "Warn" },
  AccessDeniedError: { status: 200, log: "Warn" },
  ShopInaccessibleError: { status: 200, log: "Warn" },
  AppNotInstalledError: { status: 200, log: "Debug" },
  MalformedWebhookError: { status: 400, log: "Warn" },
} as const satisfies Record<
  AnsweredFailure["_tag"],
  { readonly status: 200 | 400 | 503; readonly log: "Debug" | "Warn" }
>;

const isAnsweredFailure = (error: unknown): error is AnsweredFailure =>
  Predicate.hasProperty(error, "_tag") &&
  typeof error._tag === "string" &&
  Object.hasOwn(FAILURE_ANSWERS, error._tag);

const failureFields = (failure: AnsweredFailure): Readonly<Record<string, string | number>> =>
  failure._tag === "ShopInaccessibleError" ? { status: failure.status } : {};

const answer = (status: number) => HttpServerResponse.empty({ status });

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
   * | `AccessDeniedError`, `ShopInaccessibleError`                  | 200    | Warning, with the error's fields |
   * | `AppNotInstalledError`                                         | 200    | Debug                 |
   * | A defect, an `afterUninstall` defect included                  | 500    | Error                 |
   *
   * An unknown topic is an Error, not a Warning: a subscription nobody handles loses every
   * delivery silently, as a wrong secret does.
   */
  readonly serve: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
}

const make = <R>(extra: ExtraTopics<R>) =>
  Effect.gen(function* () {
    const client = yield* ShopifyClient;
    const installations = yield* AppInstallationStore;
    const hooks = yield* ShopifyHooks;
    const context = yield* Effect.context<R>();

    /**
     * The GDPR/CPRA compliance topics, required for App Store review: verified no-ops. A bad HMAC
     * already answered 401, which is what the requirement asks of an invalid signature.
     * Uninstall erased the shop's data, and by the delayed `shop/redact` there is nothing left;
     * acting on a surviving row instead risks a shop reinstalled inside the 48-hour delay.
     * `customers/*` have nothing to act on while no app stores customer identity.
     */
    const compliance: TopicHandler = () => Effect.void;

    const scopesUpdate: TopicHandler = (delivery) =>
      decodePayload(ScopesUpdatePayload)(delivery).pipe(
        Effect.flatMap(({ current }) =>
          installations.updateScope(delivery.shop, current.join(",")),
        ),
      );

    const appUninstalled: TopicHandler = Effect.fn("Webhooks.appUninstalled")(function* ({
      shop,
    }: WebhookDelivery) {
      yield* bestEffort("beforeUninstall", shop, hooks.beforeUninstall(shop));
      // No fence: Shopify refuses this shop's mints from now on, and a mint never inserts.
      yield* installations.delete(shop);
      yield* hooks.afterUninstall(shop);
      yield* Effect.logInfo(`Webhooks.appUninstalled: shop=${shop} status=uninstalled`).pipe(
        Effect.annotateLogs({ shop, status: "uninstalled" }),
      );
    });

    const builtIn: Readonly<Record<BuiltInTopic, TopicHandler>> = {
      "customers/data_request": compliance,
      "customers/redact": compliance,
      "shop/redact": compliance,
      "app/scopes_update": scopesUpdate,
      "app/uninstalled": appUninstalled,
    };

    const handlerOf = (topic: string): TopicHandler | undefined => {
      if (Object.hasOwn(builtIn, topic)) return builtIn[topic as BuiltInTopic];
      if (!Object.hasOwn(extra, topic)) return undefined;
      const handler = extra[topic];
      return handler === undefined
        ? undefined
        : (delivery) => Effect.provideContext(handler(delivery), context);
    };

    const handle = Effect.fn("Webhooks.handle")(function* (delivery: WebhookDelivery) {
      const { shop, topic } = delivery;
      const handler = handlerOf(topic);
      if (handler === undefined) {
        yield* Effect.logError(`Webhooks.handle: shop=${shop} topic=${topic}: no handler`);
        return answer(404);
      }
      yield* Effect.logDebug(`Webhooks.handle: shop=${shop} topic=${topic}`);
      return yield* handler(delivery).pipe(
        Effect.as(answer(200)),
        Effect.catchIf(isAnsweredFailure, (failure) => {
          const { status, log } = FAILURE_ANSWERS[failure._tag];
          const fields = failureFields(failure);
          const pairs = Object.entries(fields)
            .map(([key, value]) => ` ${key}=${String(value)}`)
            .join("");
          return Effect.logWithLevel(log)(
            `Webhooks.handle: shop=${shop} topic=${topic} error=${failure._tag}${pairs}`,
          ).pipe(
            Effect.annotateLogs({ error: failure._tag, ...fields }),
            Effect.as(answer(status)),
          );
        }),
        Effect.catchCause((cause) =>
          Effect.logError(`Webhooks.handle: shop=${shop} topic=${topic} status=failed`, cause).pipe(
            Effect.annotateLogs({ status: "failed" }),
            Effect.as(answer(500)),
          ),
        ),
      );
    });

    const serve = Effect.fn("Webhooks.serve")(function* (
      request: HttpServerRequest.HttpServerRequest,
    ) {
      // The web `Request` it came from, its body unread: the HMAC is over the exact raw bytes.
      const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
      return yield* client.validateWebhook(web).pipe(
        Effect.flatMap((delivery) =>
          handle(delivery).pipe(
            Effect.annotateLogs({ shop: delivery.shop, topic: delivery.topic }),
          ),
        ),
        Effect.catchTag("WebhookRejectedError", ({ status }) => Effect.succeed(answer(status))),
        Effect.catchCause((cause) =>
          Effect.logError("Webhooks.serve: status=failed", cause).pipe(Effect.as(answer(500))),
        ),
      );
    });

    return { serve } satisfies WebhooksShape;
  });

/** Shopify's webhooks, served by the Backend under `/webhooks/`. The HMAC is the only credential. */
export class Webhooks extends Context.Service<Webhooks, WebhooksShape>()("app/Webhooks") {
  /** Over the built-in topics and the app's `extra` ones. */
  static readonly layer = <R>(extra: ExtraTopics<R>) => Layer.effect(Webhooks, make(extra));
}
