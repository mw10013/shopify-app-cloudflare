/**
 * The e2e webhook record: each request the `e2e` stage's Backend answered under `/webhooks/`, so
 * the end-to-end suite can tell that a webhook Shopify delivered through the tunnel passed its HMAC
 * check and its handler, which `shopify app webhook trigger` reports only as enqueued. Gated like
 * the status route by the session's token, but for no shop: Shopify's sample deliveries name
 * `shop.myshopify.com`, not the leased store.
 *
 * The record lives in the Backend's isolate, so it starts empty with each server, and keeps the
 * {@link RECORD_LIMIT} latest requests.
 *
 * @module
 */

import {
  E2eWebhookDeliveries,
  type E2eWebhookDelivery,
} from "@mw10013/shopify-app-workers/contract";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { E2E_TOKEN_HEADER, type E2eAccess } from "./session.ts";
import { tokenMatches } from "./status.ts";

/** `GET /api/e2e/webhooks`, which the Website forwards to the Backend. */
export const E2E_WEBHOOKS_PATH = "/api/e2e/webhooks";

const RECORD_LIMIT = 100;

const encodeDeliveries = Schema.encodeEffect(E2eWebhookDeliveries);

/**
 * The record and its route. `record` notes one `/webhooks/*` request and the response it got;
 * `route` answers `401` without the session's token in {@link E2E_TOKEN_HEADER} (every request
 * when `access` is `None`), `405` for anything but GET, else the {@link E2eWebhookDeliveries}.
 */
export const e2eWebhooks = Effect.fn("E2eWebhooks.make")(function* (
  access: Option.Option<E2eAccess>,
) {
  const deliveries = yield* Ref.make<readonly E2eWebhookDelivery[]>([]);

  const record = (
    request: HttpServerRequest.HttpServerRequest,
    response: HttpServerResponse.HttpServerResponse,
  ) =>
    Effect.gen(function* () {
      const delivery: E2eWebhookDelivery = {
        topic: request.headers["x-shopify-topic"] ?? null,
        webhookId: request.headers["x-shopify-webhook-id"] ?? null,
        status: response.status,
        receivedAt: yield* DateTime.now,
      };
      yield* Ref.update(deliveries, (all) => [...all, delivery].slice(-RECORD_LIMIT));
    });

  const route = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (
        Option.isNone(access) ||
        !tokenMatches(access.value.token, request.headers[E2E_TOKEN_HEADER])
      )
        return HttpServerResponse.empty({ status: 401 });
      if (request.method !== "GET") return HttpServerResponse.empty({ status: 405 });
      const body = yield* encodeDeliveries({ deliveries: yield* Ref.get(deliveries) }).pipe(
        Effect.orDie,
      );
      return HttpServerResponse.jsonUnsafe(body);
    });

  return { record, route };
});
