/**
 * `Shopify`, the background path and Admin API calls by shop, and `ShopifyMerchant`, the merchant
 * path the merchant gate builds on. Each answers from the stored `AppInstallation` row when its
 * token will do, and otherwise mints one with `AppTokens`.
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
import { type AppToken, AppTokens, MINT_ATTEMPT_DEADLINE } from "./app-tokens.ts";
import {
  type AccessDeniedError,
  AppNotInstalledError,
  type InvalidIdTokenError,
  type ShopifyAccessFailure,
  type ShopifyUnavailableError,
  type ShopInaccessibleError,
} from "./contract.ts";
import { type ShopDomain, ShopGid } from "./domain.ts";
import { ShopifyClient, unavailable } from "./shopify-client.ts";

/** Every way `ensureSession` fails; anything else is a defect. */
export type EnsureSessionFailure = AppNotInstalledError | ShopifyUnavailableError;

/** Every way `adminGraphql` fails: {@link ShopifyAccessFailure}. Anything else is a defect. */
export type AdminGraphqlFailure = EnsureSessionFailure | AccessDeniedError | ShopInaccessibleError;

export interface ShopifyShape {
  /**
   * An access token fresh for `BACKGROUND_ACCESS_TOKEN_BUFFER`, with no merchant present: the
   * stored one, or a new mint. A caller never keeps it across calls.
   */
  readonly ensureSession: (shop: ShopDomain) => Effect.Effect<AdminToken, EnsureSessionFailure>;
  /**
   * An Admin GraphQL call by shop, never by token: ensures the shop's token, calls, and decodes
   * `data` with `schema`; `data` that does not decode is a defect. A 401 ensures a token other
   * than the one that got it and calls again, since a token ends early when its key is revoked;
   * a second 401 is `ShopifyUnavailableError`. Nothing else is retried: after a transient
   * failure a mutation may or may not have applied, so retrying is the caller's call.
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
   * The row as read before any mint, none on a first install, so the gate resolves the plan from
   * it without a second read: a mint rewrites only the token columns.
   */
  readonly stored: Option.Option<AppInstallation>;
}

export interface ShopifyMerchantShape {
  /**
   * The merchant path, the package's counterpart of Shopify's `authenticate.admin`: an ID token
   * to the shop, answered from a stored token fresh for `MERCHANT_ACCESS_TOKEN_BUFFER`, or else
   * by a mint, which inserts the row on a first install. Scope is not compared: a fresh token
   * stays usable across a scope change until it expires.
   */
  readonly authenticateMerchant: (
    idToken: string,
  ) => Effect.Effect<AuthenticateMerchantAnswer, InvalidIdTokenError | ShopifyUnavailableError>;
}

/** The query whose answer {@link ShopGidResponse} decodes. */
const SHOP_GID_QUERY = `#graphql
  query ShopGid {
    shop {
      id
    }
  }`;

const ShopGidResponse = Schema.Struct({ shop: Schema.Struct({ id: ShopGid }) });

/** What `updateToken` writes for a minted token. */
const tokenColumns = (minted: AppToken) => ({
  scope: minted.scope,
  accessToken: minted.accessToken,
  accessTokenExpiresAt: minted.expires,
});

const make = Effect.gen(function* () {
  const client = yield* ShopifyClient;
  const tokens = yield* AppTokens;
  const installations = yield* AppInstallationStore;

  /**
   * The shop's Admin API id, asked once, on the first mint, bounded by `MINT_ATTEMPT_DEADLINE`.
   * A 401 is an outage, since the token was just issued; a refusal of the shop itself a merchant
   * cannot act on here is a defect.
   */
  const fetchShopGid = Effect.fnUntraced(function* (shop: ShopDomain, accessToken: string) {
    const data = yield* client
      .adminCall("Shopify.authenticateMerchant", shop, accessToken, SHOP_GID_QUERY, undefined)
      .pipe(
        Effect.timeoutOrElse({
          duration: MINT_ATTEMPT_DEADLINE,
          orElse: () => unavailable("Shopify.authenticateMerchant", shop, "shop-gid-deadline"),
        }),
        Effect.catchTag("AdminUnauthorizedError", () =>
          unavailable("Shopify.authenticateMerchant", shop, "shop-gid-unauthorized"),
        ),
        Effect.catchTags({ AccessDeniedError: Effect.die, ShopInaccessibleError: Effect.die }),
      );
    return (yield* Schema.decodeUnknownEffect(ShopGidResponse)(data).pipe(Effect.orDie)).shop.id;
  });

  const authenticateMerchant = Effect.fn("Shopify.authenticateMerchant")(function* (
    idToken: string,
  ) {
    const { shop, sub } = yield* client.decodeIdToken(idToken);
    const stored = yield* installations.find(shop);
    if (
      Option.isSome(stored) &&
      Option.isSome(freshToken(stored.value, yield* DateTime.now, MERCHANT_ACCESS_TOKEN_BUFFER))
    )
      return { shop, shopGid: stored.value.shopGid, stored } satisfies AuthenticateMerchantAnswer;
    // A merchant with a valid ID token for an app Shopify says is not installed is mid-install
    // or mid-uninstall: nothing in the app's frame can act on it, and a retry settles it.
    const minted = yield* tokens
      .mint(shop)
      .pipe(
        Effect.catchTag("AppNotInstalledError", () =>
          unavailable("Shopify.authenticateMerchant", shop, "app-not-installed"),
        ),
      );
    const written = (status: "installed" | "minted") =>
      Effect.logInfo(`Shopify.authenticateMerchant: shop=${shop} status=${status}`).pipe(
        Effect.annotateLogs({ shop, status, sub: sub ?? "none" }),
      );
    if (Option.isSome(stored)) {
      yield* installations.updateToken(shop, tokenColumns(minted));
      yield* written("minted");
      return { shop, shopGid: stored.value.shopGid, stored } satisfies AuthenticateMerchantAnswer;
    }
    const shopGid = yield* fetchShopGid(shop, minted.accessToken);
    const inserted = yield* installations.insert({ shop, shopGid, ...tokenColumns(minted) });
    yield* written(inserted ? "installed" : "minted");
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
    const minted = yield* tokens
      .mint(shop)
      .pipe(
        Effect.tapErrorTag("AppNotInstalledError", () =>
          Effect.logWarning(`Shopify.ensureSession: shop=${shop} status=orphaned`).pipe(
            Effect.annotateLogs({ shop, status: "orphaned" }),
          ),
        ),
      );
    const written = yield* installations.updateToken(shop, tokenColumns(minted));
    if (!written && Option.isNone(yield* installations.find(shop)))
      return yield* new AppNotInstalledError({ shop });
    yield* Effect.logInfo(`Shopify.ensureSession: shop=${shop} status=minted`).pipe(
      Effect.annotateLogs({ shop, status: "minted" }),
    );
    return {
      accessToken: minted.accessToken,
      accessTokenExpiresAt: minted.expires,
    } satisfies AdminToken;
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
        unavailable("Shopify.adminGraphql", shop, "unauthorized-twice"),
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
 * {@link Shopify} and {@link ShopifyMerchant} over the {@link ShopifyClient}, {@link AppTokens}
 * and {@link AppInstallationStore} in context.
 */
export const layerShopify = Layer.effectContext(
  Effect.map(make, ({ shopify, merchant }) =>
    Context.make(Shopify, shopify).pipe(Context.add(ShopifyMerchant, merchant)),
  ),
);
