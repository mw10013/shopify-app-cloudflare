import { ShopDomain } from "../internal/domain.mjs";
import * as Effect from "effect/Effect";
/**
 * A merchant's Shopify ID token for `shop`, signed as Shopify signs one: HS256 under the app's
 * secret, with the app's key as `aud`. The app is the fake one ({@link FAKE_SHOPIFY_API_KEY},
 * {@link FAKE_SHOPIFY_API_SECRET}); a test that proves a refusal passes another key or secret.
 * `expiresIn`, in seconds, defaults to a day; a negative one makes a token that has already
 * expired. `iss` overrides the issuer, for a token whose `iss` and `dest` disagree. Its times
 * are the wall clock's, as the library checks them against `Date.now()`.
 */
export declare const mintIdToken: (input: {
  readonly shop: ShopDomain;
  readonly expiresIn?: number | undefined;
  readonly apiKey?: string | undefined;
  readonly apiSecret?: string | undefined;
  readonly iss?: string | undefined;
  readonly sub?: string | undefined;
}) => Effect.Effect<string, never, never>;