import { AppInstallationStore } from "../internal/app-installation-store.mjs";
import { ShopifyHooks } from "../internal/hooks.mjs";
import { PartnerApi } from "../internal/partner-api.mjs";
import { ShopifyClient } from "../internal/shopify-client.mjs";
import { ShopGrantors } from "../internal/shop-grantor.mjs";
import { Shopify, ShopifyMerchant } from "../internal/shopify.mjs";
import { SubscriptionPlan } from "../internal/subscription-plan.mjs";
import { MerchantGate } from "../internal/merchant-gate.mjs";
import { Webhooks } from "../internal/webhooks.mjs";
import { ShopifyAppDefinition } from "../internal/shopify-app.mjs";
import "../backend.mjs";
import { PartnerFake } from "./partner-fake.mjs";
import { HarnessCapability, HookName } from "./shopify-harness.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Scope from "effect/Scope";
/** Where a test Backend serves the door: an Effect RPC endpoint, NDJSON. */
export declare const SHOPIFY_TEST_DOOR_PATH = "/api/test/shopify";
/**
 * What the door's harness can do. A case runs in the test Backend's isolate, which the grantor
 * Durable Object shares, so the fake's intercept gates the object's grant. Time is the runtime's,
 * and the store the object writes through is the production one, so `clock` and `holdWrite` are
 * in-process only.
 */
export declare const SHOPIFY_TEST_DOOR_CAN: ReadonlySet<HarnessCapability>;
/** How a required behavior ended in the test Backend: its cause, pretty-printed, when it failed. */
export declare const BehaviorOutcome: Schema.Union<readonly [Schema.TaggedStruct<"Passed", {}>, Schema.TaggedStruct<"Failed", {
  readonly cause: Schema.String;
}>]>;
export type BehaviorOutcome = typeof BehaviorOutcome.Type;
/**
 * The door's procedures.
 *
 * - `RunBehavior` resets the door's state (`Reset`), then runs `REQUIRED_BEHAVIORS[index]` in the
 *   test Backend; `name` is the runner's `<id>: <name>`, checked so the two lists cannot drift.
 * - `Reset` uninstalls every installed shop through its grantor, then forgets every script,
 *   call, issued token and hook call, as a fresh harness would start.
 * - `ScriptShopify` and `ShopifyCalls` are {@link ShopifyFake}'s `script` and `calls`;
 *   `ScriptPartner` and `PartnerAsked` are {@link PartnerFake}'s `script` and `asked`.
 * - `Seed` stores an installation as an exchange would; `Stored` reads one back, tokens
 *   included.
 */
export declare const ShopifyTestDoorRpcs: RpcGroup.RpcGroup<Rpc.Rpc<"PartnerAsked", Schema.Struct<{}>, Schema.$Array<Schema.brand<Schema.NonEmptyString, "ShopGid">>, Schema.Never, never, never> | Rpc.Rpc<"Reset", Schema.Struct<{}>, Schema.Struct<{}>, Schema.Never, never, never> | Rpc.Rpc<"RunBehavior", Schema.Struct<{
  index: Schema.Int;
  name: Schema.String;
}>, Schema.Union<readonly [Schema.TaggedStruct<"Passed", {}>, Schema.TaggedStruct<"Failed", {
  readonly cause: Schema.String;
}>]>, Schema.Never, never, never> | Rpc.Rpc<"ScriptPartner", Schema.Struct<{
  shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  answer: Schema.Union<readonly [Schema.TaggedStruct<"Subscribed", {
    readonly handle: Schema.String;
    readonly otherHandles: Schema.optional<Schema.$Array<Schema.String>>;
    readonly cycleStartAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
    readonly boundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  }>, Schema.TaggedStruct<"None", {}>, Schema.TaggedStruct<"Failure", {
    readonly reason: Schema.String;
  }>]>;
}>, Schema.Struct<{}>, Schema.Never, never, never> | Rpc.Rpc<"ScriptShopify", Schema.Struct<{
  replies: Schema.$Array<Schema.Struct<{
    readonly route: Schema.Literals<readonly ["token", "graphql"]>;
    readonly status: Schema.optional<Schema.Number>;
    readonly body: Schema.optional<Schema.Unknown>;
    readonly text: Schema.optional<Schema.String>;
    readonly networkError: Schema.optional<Schema.Boolean>;
    readonly delayMs: Schema.optional<Schema.Number>;
    readonly hang: Schema.optional<Schema.Boolean>;
  }>>;
}>, Schema.Struct<{}>, Schema.Never, never, never> | Rpc.Rpc<"Seed", Schema.Struct<{
  row: Schema.Struct<{
    readonly shop: Schema.brand<Schema.String, "ShopDomain">;
    readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
    readonly scope: Schema.optional<Schema.NullOr<Schema.String>>;
    readonly accessToken: Schema.optional<Schema.NullOr<Schema.String>>;
    readonly accessTokenExpiresAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
    readonly refreshToken: Schema.optional<Schema.NullOr<Schema.String>>;
    readonly refreshTokenExpiresAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
    readonly planHandle: Schema.optional<Schema.NullOr<Schema.String>>;
    readonly planHandleExpiresAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
    readonly planBoundaryAt: Schema.optional<Schema.NullOr<Schema.DateTimeUtcFromMillis>>;
    readonly recognized: Schema.optional<Schema.Boolean>;
  }>;
}>, Schema.Struct<{}>, Schema.Never, never, never> | Rpc.Rpc<"ShopifyCalls", Schema.Struct<{}>, Schema.$Array<Schema.Struct<{
  readonly route: Schema.Literals<readonly ["token", "graphql"]>;
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly grantType: Schema.optional<Schema.String>;
  readonly refreshToken: Schema.optional<Schema.String>;
}>>, Schema.Never, never, never> | Rpc.Rpc<"Stored", Schema.Struct<{
  shop: Schema.brand<Schema.String, "ShopDomain">;
}>, Schema.NullOr<Schema.Struct<{
  readonly shop: Schema.brand<Schema.String, "ShopDomain">;
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
  readonly scope: Schema.NullOr<Schema.String>;
  readonly accessToken: Schema.NullOr<Schema.String>;
  readonly accessTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly refreshToken: Schema.NullOr<Schema.String>;
  readonly refreshTokenExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly planHandle: Schema.NullOr<Schema.String>;
  readonly planHandleExpiresAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly planBoundaryAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
  readonly installedAt: Schema.NullOr<Schema.DateTimeUtcFromMillis>;
}>>, Schema.Never, never, never>>;
declare const DoorHooks_base: Context.ServiceClass<DoorHooks, "app/ShopifyTestDoorHooks", {
  layer: Layer.Layer<ShopifyHooks, never, never>;
  calls: Effect.Effect<readonly string[], never, never>;
  breakHook: (hook: HookName) => Effect.Effect<void, never, never>;
  reset: Effect.Effect<void, never, never>;
}>;
/** The hooks the door records, as {@link ShopifyTestDoor.shopifyApp} provides them. */
declare class DoorHooks extends DoorHooks_base {}
/**
 * Tier 2 as a test Backend provides it in place of `ShopifyApp.layerConfig(app)` and the app's
 * hooks: over `app` with the probe topic added, as `inProcessHarness` builds it, the
 * {@link PartnerFake} answering the catalog's first handle, and hooks that record each call.
 */
declare const shopifyApp: (app: ShopifyAppDefinition) => Layer.Layer<DoorHooks | MerchantGate | PartnerApi | PartnerFake | ShopifyHooks | SubscriptionPlan | Webhooks, never, AppInstallationStore | ShopGrantors | Shopify | ShopifyClient | ShopifyMerchant>;
export interface ShopifyTestDoorShape {
  /** The door's RPC endpoint, for the test Backend's `fetch` at {@link SHOPIFY_TEST_DOOR_PATH}. */
  readonly serve: Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest | Scope.Scope>;
}
declare const ShopifyTestDoor_base: Context.ServiceClass<ShopifyTestDoor, "app/ShopifyTestDoor", ShopifyTestDoorShape>;
/**
 * The door, as a test Backend builds it inside its init, under {@link ShopifyTestDoor.shopifyApp}
 * and the production tier 1:
 *
 * ```ts
 * backendBody.pipe(
 *   Effect.provide(ShopifyTestDoor.layer),
 *   Effect.provide(ShopifyTestDoor.shopifyApp(app)),
 *   Effect.provide(ShopifyAccess.layerConfig({ database })),
 * );
 * // and in fetch: if (pathname === SHOPIFY_TEST_DOOR_PATH) return yield* door.serve;
 * ```
 *
 * It installs {@link ShopifyFake} in place of the Shopify library's fetch for the isolate's life;
 * the grantor Durable Object runs in the same isolate, so its grants reach the fake too.
 */
export declare class ShopifyTestDoor extends ShopifyTestDoor_base {
  static readonly layer: Layer.Layer<ShopifyTestDoor, never, AppInstallationStore | DoorHooks | MerchantGate | PartnerFake | ShopGrantors | Shopify | SubscriptionPlan | Webhooks>;
  static readonly shopifyApp: typeof shopifyApp;
}
export {};