import { ShopifyUnavailableError } from "./contract.mjs";
import { ShopDomain, ShopGid } from "./domain.mjs";
import { PartnerConfig } from "./bindings.mjs";
import * as DateTime from "effect/DateTime";
import "effect/Duration";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "effect/http/HttpClient";
/**
 * The shop's app subscription as the Partner API reports it: every item's handle, the plan's and
 * the meters' alike, and its billing cycle. Which handle is the plan is the catalog's question,
 * so the allowlist lives in one place, the plan check.
 */
export interface PartnerSubscription {
  /** Each item's handle, in Shopify's order; an item without one is left out. */
  readonly handles: readonly string[];
  /**
   * The next instant the subscription may change unannounced: `currentBillingCycle.endTime`,
   * or `trialEndsAt` during a trial, when there is no cycle. Null when neither reads.
   */
  readonly boundaryAt: DateTime.Utc | null;
  /** `currentBillingCycle.startTime`; null during a trial. */
  readonly cycleStartAt: DateTime.Utc | null;
}
export interface PartnerApiShape {
  /**
   * The shop's app subscription in force now (Shopify's `activeSubscription`). `None` is a
   * verified absence. A request that could not be answered, retries spent, is
   * `ShopifyUnavailableError`, never `None`: callers gate access on this, and "could not ask"
   * must never read as "has not paid". An answer that does not decode, carries GraphQL errors,
   * or a status that is not transient (a bad token) is a defect.
   */
  readonly activeSubscription: (shop: ShopDomain, shopGid: ShopGid) => Effect.Effect<Option.Option<PartnerSubscription>, ShopifyUnavailableError>;
  /** The shop's plan selection page on `admin.shopify.com`. */
  readonly planSelectionUrl: (shop: ShopDomain) => string;
}
/** What {@link PartnerApi.layer} takes: the app's handle and its Partner credentials. */
export interface PartnerApiOptions {
  /** The app's URL handle, which its plan selection page names. */
  readonly handle: string;
  readonly partner: PartnerConfig;
}
declare const PartnerApi_base: Context.ServiceClass<PartnerApi, "app/PartnerApi", PartnerApiShape>;
/** The Partner API. `/test`'s `PartnerFake` provides it in tests. */
export declare class PartnerApi extends PartnerApi_base {
  /** Over `options`, with `fetch`. */
  static readonly layer: (options: PartnerApiOptions) => Layer.Layer<PartnerApi, never, never>;
  /**
   * Over `SHOPIFY_APP_HANDLE`, which the stack binds with the app, and `SHOPIFY_PARTNER_ORG_ID`,
   * `SHOPIFY_PARTNER_APP_ID` and `SHOPIFY_PARTNER_API_TOKEN`, which it binds when the stage has
   * them, with `fetch`. All are absent while the stack is planned, when nothing calls the Partner
   * API. A running Worker without the credentials gets {@link PartnerApi.layerUnbound}.
   */
  static readonly layerConfig: Layer.Layer<PartnerApi, never, never>;
  /**
   * The Partner API of a running Worker the stack bound no Partner credentials to (a dev stage
   * before the owner adds them to `.env`): `activeSubscription` is a defect that says why, so a
   * plan is never guessed from a missing credential. The plan selection page needs only the
   * app's `handle`, which is public, so a shop whose plan is cached still passes the gate; it too
   * is a defect when the handle is unbound. The Backend still boots, so webhooks and the grantor
   * work.
   */
  static readonly layerUnbound: (handle: Option.Option<string>) => Layer.Layer<PartnerApi, never, never>;
}
export {};