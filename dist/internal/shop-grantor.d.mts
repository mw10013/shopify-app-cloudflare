import { AppNotInstalledError, InvalidIdTokenError, ReauthenticationRequiredError, ShopifyUnavailableError } from "./contract.mjs";
import { ShopDomain, ShopGid } from "./domain.mjs";
import { AdminToken } from "./admin-token.mjs";
import { AppInstallationStore } from "./app-installation-store.mjs";
import { ShopifyClient } from "./shopify-client.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import "effect/DateTime";
import "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cloudflare from "@alchemy.run/cloudflare";
/** Every way `ShopGrantors.ensure` fails; anything else is a defect. */
export type EnsureSessionError = AppNotInstalledError | ReauthenticationRequiredError | ShopifyUnavailableError;
/** Every way `ShopGrantors.exchange` fails; anything else is a defect. */
export type ExchangeError = InvalidIdTokenError | ShopifyUnavailableError;
/**
 * What the grantor's `exchange` answers across its stub: the shop's id, or the merchant path's
 * failure. During a gradual deploy one version of the object serves the old and the new Worker,
 * so this shape only gains optional fields; a unit test pins its encoding.
 */
export declare const ExchangeAnswer: Schema.Union<readonly [Schema.TaggedStruct<"Exchanged", {
  readonly shopGid: Schema.brand<Schema.NonEmptyString, "ShopGid">;
}>, Schema.TaggedStruct<"Refused", {
  readonly error: Schema.Union<readonly [typeof InvalidIdTokenError, typeof ShopifyUnavailableError]>;
}>]>;
/** What the grantor's `ensure` answers across its stub: a token, or the background path's failure. Pinned as {@link ExchangeAnswer} is. */
export declare const EnsureAnswer: Schema.Union<readonly [Schema.TaggedStruct<"Ensured", {
  readonly token: Schema.Struct<{
    readonly accessToken: Schema.NonEmptyString;
    readonly accessTokenExpiresAt: Schema.DateTimeUtcFromMillis;
  }>;
}>, Schema.TaggedStruct<"Refused", {
  readonly error: Schema.Union<readonly [typeof AppNotInstalledError, typeof ReauthenticationRequiredError, typeof ShopifyUnavailableError]>;
}>]>;
/**
 * The grantor's stub surface: plain data each way, each failure an encoded answer, since the stub
 * types its methods' errors as `never`. Nothing but the Backend's {@link ShopGrantors} calls it.
 */
export interface ShopGrantorShape {
  readonly exchange: (input: {
    readonly idToken: string;
    readonly sub: string | null;
  }) => Effect.Effect<typeof ExchangeAnswer.Encoded>;
  readonly ensure: (input: {
    readonly rejected: string | null;
  }) => Effect.Effect<typeof EnsureAnswer.Encoded>;
  readonly uninstall: () => Effect.Effect<void>;
}
declare const ShopGrantor_base: Effect.Effect<Cloudflare.DurableObject<ShopGrantor>, never, ShopGrantor | Cloudflare.Worker> & {
  new (_: never): ShopGrantorShape & {
    "~alchemy/name": "ShopGrantor";
  };
  from(scriptName: import("alchemy").Input<string>): Effect.Effect<Cloudflare.DurableObject<ShopGrantor>, never, Cloudflare.Worker>;
  from<Req = never>(worker: import("alchemy").Dependencies<ShopGrantor> | Effect.Effect<import("alchemy").Dependencies<ShopGrantor>, never, Req>): Effect.Effect<Cloudflare.DurableObject<ShopGrantor>, never, Req | Cloudflare.Worker>;
  make<Req = never>(impl: Effect.Effect<Effect.Effect<ShopGrantorShape, never, Cloudflare.DurableObjectState | import("alchemy").RuntimeContext | import("effect/Scope").Scope>, never, Req>): Layer.Layer<ShopGrantor, never, Exclude<Req, Cloudflare.DurableObjectServices> | Cloudflare.Worker>;
};
/**
 * One shop's grantor as a Durable Object, named by its `ShopDomain`: {@link makeGrantor} in a
 * single-threaded home every runtime can reach (the Backend and the shop's actor). It keeps no
 * Durable Object storage, so a stray `getByName` creates nothing billed: it needs no activation
 * guard, no migrations and no destroy. Declared once, here: an app binds it by building
 * `ShopifyAccess.layer` and never names it.
 */
export declare class ShopGrantor extends ShopGrantor_base {}
/** The shop's grantor as its callers reach it, by shop. */
interface ShopGrantorsShape {
  /** The merchant path; see `exchange` in {@link makeGrantor}. */
  readonly exchange: (shop: ShopDomain, idToken: string, sub: string | null) => Effect.Effect<ShopGid, ExchangeError>;
  /** The background path; see `ensure` in {@link makeGrantor}. */
  readonly ensure: (shop: ShopDomain, rejected: string | null) => Effect.Effect<AdminToken, EnsureSessionError>;
  /** `app/uninstalled`; see `uninstall` in {@link makeGrantor}. */
  readonly uninstall: (shop: ShopDomain) => Effect.Effect<void>;
}
declare const ShopGrantors_base: Context.ServiceClass<ShopGrantors, "app/ShopGrantors", ShopGrantorsShape>;
/**
 * Every shop's grantor, by shop: the only way to a grant. `Shopify` calls it only when the stored
 * token will not do, so a call that finds one fresh in D1 makes no hop.
 */
export declare class ShopGrantors extends ShopGrantors_base {
  /** Over the {@link ShopGrantor} namespace, which needs {@link ShopGrantorLive}. */
  static readonly layer: Layer.Layer<ShopGrantors, never, ShopGrantor | Cloudflare.Worker>;
  /**
   * The same grantors held in memory in this process, one per shop for the layer's life, over the
   * {@link ShopifyClient} and {@link AppInstallationStore} in context: what in-process tests run.
   */
  static readonly layerMemory: Layer.Layer<ShopGrantors, never, AppInstallationStore | ShopifyClient>;
}
export {};