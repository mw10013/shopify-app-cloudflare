/**
 * `Shopify`, the background path and Admin API calls by shop, and `ShopifyMerchant`, the merchant
 * path the merchant gate builds on. Each answers from the stored `AppInstallation` row when its
 * token will do, and otherwise asks the shop's grantor.
 *
 * @module
 */

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  type AdminToken,
  BACKGROUND_ACCESS_TOKEN_BUFFER,
  freshToken,
  MERCHANT_ACCESS_TOKEN_BUFFER,
} from "./admin-token.ts";
import { AppInstallationStore } from "./app-installation-store.ts";
import type { AppInstallation } from "./app-installation.ts";
import {
  type AccessDeniedError,
  AppNotInstalledError,
  type InvalidIdTokenError,
  type ReauthenticationRequiredError,
  type ShopifyAccessFailure,
  type ShopifyUnavailableError,
  type ShopInaccessibleError,
} from "./contract.ts";
import type { ShopDomain, ShopGid } from "./domain.ts";
import { ShopGrantors } from "./shop-grantor.ts";
import { ShopifyClient, unavailable } from "./shopify-client.ts";

/** Every way `ensureSession` fails; anything else is a defect. */
export type EnsureSessionFailure =
  | AppNotInstalledError
  | ReauthenticationRequiredError
  | ShopifyUnavailableError;

/** Every way `adminGraphql` fails: {@link ShopifyAccessFailure}. Anything else is a defect. */
export type AdminGraphqlFailure = EnsureSessionFailure | AccessDeniedError | ShopInaccessibleError;

export interface ShopifyShape {
  /**
   * An access token fresh for `BACKGROUND_ACCESS_TOKEN_BUFFER`, with no merchant present: the
   * stored one with no hop, or one the shop's grantor refreshed. A caller never keeps it across
   * calls: the next refresh retires it.
   */
  readonly ensureSession: (shop: ShopDomain) => Effect.Effect<AdminToken, EnsureSessionFailure>;
  /**
   * An Admin GraphQL call by shop, never by token: ensures the shop's token, calls, and decodes
   * `data` with `schema`; `data` that does not decode is a defect. A 401 asks the grantor once
   * for a token other than the one that got it and calls again; a second 401 is
   * `ShopifyUnavailableError`: Shopify rejected a token it had just issued. Nothing else is
   * retried: after a transient failure a mutation may or may not have applied, so retrying is
   * the caller's call.
   */
  readonly adminGraphql: <S extends Schema.Top>(
    shop: ShopDomain,
    schema: S & { readonly DecodingServices: never },
    query: string,
    variables?: Record<string, unknown>,
  ) => Effect.Effect<S["Type"], ShopifyAccessFailure>;
}

/** What the merchant path answers. */
export interface AuthenticateMerchantAnswer {
  readonly shop: ShopDomain;
  readonly shopGid: ShopGid;
  /**
   * The row as read before any exchange, none on a first install, so the gate resolves the
   * plan from it without a second read: an exchange rewrites only the grant columns.
   */
  readonly stored: Option.Option<AppInstallation>;
}

export interface ShopifyMerchantShape {
  /**
   * The merchant path, the package's counterpart of Shopify's `authenticate.admin`: an ID token
   * to the shop, answered from a stored token fresh for `MERCHANT_ACCESS_TOKEN_BUFFER` with no
   * hop, or else by the shop's grantor, which exchanges the ID token for an expiring offline
   * token (creating the row on a first install) or answers from a grant already in flight. Scope
   * is not compared: a fresh token stays usable across a scope change until it expires.
   */
  readonly authenticateMerchant: (
    idToken: string,
  ) => Effect.Effect<AuthenticateMerchantAnswer, InvalidIdTokenError | ShopifyUnavailableError>;
}

const make = Effect.gen(function* () {
  const client = yield* ShopifyClient;
  const grantors = yield* ShopGrantors;
  const installations = yield* AppInstallationStore;

  const authenticateMerchant = Effect.fn("ShopifyMerchant.authenticateMerchant")(function* (
    idToken: string,
  ) {
    const { shop, sub } = yield* client.decodeIdToken(idToken);
    const stored = yield* installations.find(shop);
    const now = yield* DateTime.now;
    if (
      Option.isSome(stored) &&
      Option.isSome(freshToken(stored.value, now, MERCHANT_ACCESS_TOKEN_BUFFER))
    )
      return { shop, shopGid: stored.value.shopGid, stored } satisfies AuthenticateMerchantAnswer;
    const shopGid = yield* grantors.exchange(shop, idToken, sub ?? null);
    return { shop, shopGid, stored } satisfies AuthenticateMerchantAnswer;
  });

  /** `ensureSession`, passing over `rejected`, the token an Admin API call got 401 with. */
  const ensureWith = Effect.fn("Shopify.ensureSession")(function* (
    shop: ShopDomain,
    rejected: string | null,
  ) {
    const row = yield* installations.find(shop);
    if (Option.isNone(row)) return yield* new AppNotInstalledError({ shop });
    const stored = freshToken(row.value, yield* DateTime.now, BACKGROUND_ACCESS_TOKEN_BUFFER);
    if (Option.isSome(stored) && stored.value.accessToken !== rejected) return stored.value;
    return yield* grantors.ensure(shop, rejected);
  });

  const ensureSession = (shop: ShopDomain) => ensureWith(shop, null);

  const adminGraphql = Effect.fn("Shopify.adminGraphql")(function* <S extends Schema.Top>(
    shop: ShopDomain,
    schema: S & { readonly DecodingServices: never },
    query: string,
    variables?: Record<string, unknown>,
  ) {
    const call = (accessToken: string) =>
      client.adminCall("Shopify.adminGraphql", shop, accessToken, query, variables);
    const first = yield* ensureSession(shop);
    const data = yield* call(first.accessToken).pipe(
      Effect.catchTag("AdminUnauthorizedError", () =>
        Effect.flatMap(ensureWith(shop, first.accessToken), (second) => call(second.accessToken)),
      ),
      Effect.catchTag("AdminUnauthorizedError", () =>
        unavailable("Shopify.adminGraphql", shop, "unauthorized-after-refresh"),
      ),
    );
    return yield* Schema.decodeUnknownEffect(schema)(data).pipe(Effect.orDie);
  });

  return {
    shopify: { ensureSession, adminGraphql } satisfies ShopifyShape,
    merchant: { authenticateMerchant } satisfies ShopifyMerchantShape,
  };
});

/**
 * The shop's Shopify Admin API without a merchant: `ensureSession` for a token and `adminGraphql`
 * for a call by shop. What an app's background work and webhook handlers use.
 */
export class Shopify extends Context.Service<Shopify, ShopifyShape>()("app/Shopify") {}

/** The merchant path. Not exported from the package: the merchant gate is its one caller. */
export class ShopifyMerchant extends Context.Service<ShopifyMerchant, ShopifyMerchantShape>()(
  "app/ShopifyMerchant",
) {}

/**
 * {@link Shopify} and {@link ShopifyMerchant} over the {@link ShopifyClient}, {@link ShopGrantors}
 * and {@link AppInstallationStore} in context.
 */
export const layerShopify = Layer.effectContext(
  Effect.map(make, ({ shopify, merchant }) =>
    Context.make(Shopify, shopify).pipe(Context.add(ShopifyMerchant, merchant)),
  ),
);
