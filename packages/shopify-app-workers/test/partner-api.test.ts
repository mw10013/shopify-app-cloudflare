import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { layerHttpClient, PartnerApi, type PartnerConfig } from "#internal/partner-api.ts";
import { PARTNER_API_VERSION } from "#internal/versions.ts";

import { millisOf, SHOP, SHOP_GID } from "./fixtures.ts";

const CONFIG: PartnerConfig = {
  SHOPIFY_APP_HANDLE: "test-app",
  SHOPIFY_PARTNER_ORG_ID: "123",
  SHOPIFY_PARTNER_APP_ID: "456",
  SHOPIFY_PARTNER_API_TOKEN: Redacted.make("prtapi_test"),
};

interface Seen {
  readonly url: string;
  readonly token: string | undefined;
  readonly body: unknown;
}

/** `PartnerApi.layer` over an `HttpClient` that answers each request with the next of `replies`. */
const partnerOver = (replies: readonly (() => Response)[]) => {
  const seen: Seen[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const reply = replies[seen.length] ?? replies.at(-1);
      seen.push({
        url: request.url,
        token: request.headers["x-shopify-access-token"],
        body:
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : undefined,
      });
      if (reply === undefined) throw new Error("no reply scripted");
      return HttpClientResponse.fromWeb(request, reply());
    }),
  );
  return {
    seen,
    layer: layerHttpClient(CONFIG).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  };
};

const subscription = (activeSubscription: unknown) => () =>
  Response.json({ data: { activeSubscription } });

const activeSubscription = Effect.flatMap(PartnerApi, (partner) =>
  partner.activeSubscription(SHOP, SHOP_GID),
);

describe("PartnerApi.activeSubscription", () => {
  it.effect(
    "asks the org's endpoint at the pinned version with the token, and reads every item's handle and the cycle",
    () => {
      const { seen, layer } = partnerOver([
        subscription({
          items: [{ handle: "test-basic" }, { handle: null }, { handle: "usage-meter" }],
          currentBillingCycle: {
            startTime: "2026-11-01T00:00:00Z",
            endTime: "2026-12-01T00:00:00Z",
          },
          trialEndsAt: null,
        }),
      ]);
      return Effect.gen(function* () {
        const answer = Option.getOrThrow(yield* activeSubscription);
        assert.deepStrictEqual(answer.handles, ["test-basic", "usage-meter"]);
        assert.strictEqual(millisOf(answer.cycleStartAt), Date.parse("2026-11-01T00:00:00Z"));
        assert.strictEqual(millisOf(answer.boundaryAt), Date.parse("2026-12-01T00:00:00Z"));
        assert.strictEqual(
          seen[0]?.url,
          `https://partners.shopify.com/123/api/${PARTNER_API_VERSION}/graphql.json`,
        );
        assert.strictEqual(seen[0]?.token, "prtapi_test");
        assert.deepInclude(seen[0]?.body, {
          variables: { appId: "gid://shopify/App/456", shopId: SHOP_GID },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("during a trial the boundary is the trial's end and there is no cycle start", () => {
    const { layer } = partnerOver([
      subscription({
        items: [{ handle: "test-basic" }],
        currentBillingCycle: null,
        trialEndsAt: "2026-11-15T00:00:00Z",
      }),
    ]);
    return Effect.gen(function* () {
      const answer = Option.getOrThrow(yield* activeSubscription);
      assert.strictEqual(millisOf(answer.boundaryAt), Date.parse("2026-11-15T00:00:00Z"));
      assert.isNull(answer.cycleStartAt);
    }).pipe(Effect.provide(layer));
  });

  it.effect("no app subscription is a verified None", () =>
    Effect.gen(function* () {
      assert.isTrue(Option.isNone(yield* activeSubscription));
    }).pipe(Effect.provide(partnerOver([subscription(null)]).layer)),
  );

  it.effect(
    "N11: a transient failure, retries spent, is ShopifyUnavailableError, never None",
    () => {
      const { seen, layer } = partnerOver([() => new Response("down", { status: 503 })]);
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(Effect.exit(activeSubscription));
        yield* TestClock.adjust("10 seconds");
        const exit = yield* Fiber.join(fiber);
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          assert.strictEqual(Option.getOrThrow(error)._tag, "ShopifyUnavailableError");
        }
        assert.strictEqual(seen.length, 3, "the first attempt and two retries");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("a 401, a misconfigured token, is a defect after one call", () => {
    const { seen, layer } = partnerOver([() => new Response("no", { status: 401 })]);
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(activeSubscription);
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      assert.strictEqual(seen.length, 1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("GraphQL errors, and an answer that does not decode, are defects", () =>
    Effect.gen(function* () {
      for (const reply of [
        () => Response.json({ errors: [{ message: "Field 'x' doesn't exist" }] }),
        () => Response.json({ data: { activeSubscription: { items: "none" } } }),
      ]) {
        const exit = yield* Effect.exit(
          activeSubscription.pipe(Effect.provide(partnerOver([reply]).layer)),
        );
        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      }
    }),
  );
});

describe("PartnerApi.planSelectionUrl", () => {
  it.effect("is the shop's pricing page for the app's handle", () =>
    Effect.gen(function* () {
      const partner = yield* PartnerApi;
      assert.strictEqual(
        partner.planSelectionUrl(SHOP),
        "https://admin.shopify.com/store/seed-shop/charges/test-app/pricing_plans",
      );
    }).pipe(Effect.provide(partnerOver([]).layer)),
  );
});
