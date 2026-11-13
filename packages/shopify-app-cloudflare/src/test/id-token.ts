/**
 * `mintIdToken`: a merchant's ID token, signed as Shopify signs one.
 *
 * @module
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ShopDomain } from "#internal/domain.ts";

import { FAKE_SHOPIFY_API_KEY, FAKE_SHOPIFY_API_SECRET } from "./fake-app.ts";

const jsonSegment = <S extends Schema.Constraint>(schema: S) =>
  Schema.StringFromBase64Url.pipe(Schema.decodeTo(Schema.fromJsonString(schema)));

const encodeHeader = Schema.encodeSync(
  jsonSegment(Schema.Struct({ alg: Schema.Literal("HS256"), typ: Schema.String })),
);

/** The claims Shopify puts in an ID token. Times are UNIX seconds. */
const encodePayload = Schema.encodeSync(
  jsonSegment(
    Schema.Struct({
      iss: Schema.String,
      dest: Schema.String,
      aud: Schema.String,
      sub: Schema.String,
      exp: Schema.Number,
      nbf: Schema.Number,
      iat: Schema.Number,
      jti: Schema.String,
      sid: Schema.String,
    }),
  ),
);
const encodeSignature = Schema.encodeSync(Schema.Uint8ArrayFromBase64Url);

const encoder = new TextEncoder();

/**
 * A merchant's Shopify ID token for `shop`, signed as Shopify signs one: HS256 under the app's
 * secret, with the app's key as `aud`. The app is the fake one ({@link FAKE_SHOPIFY_API_KEY},
 * {@link FAKE_SHOPIFY_API_SECRET}); a test that proves a refusal passes another key or secret.
 * `expiresIn`, in seconds, defaults to a day; a negative one makes a token that has already
 * expired. `iss` overrides the issuer, for a token whose `iss` and `dest` disagree. Its times
 * are the wall clock's, as the library checks them against `Date.now()`.
 */
export const mintIdToken = Effect.fn("ShopifyIdToken.mintIdToken")(function* (input: {
  readonly shop: ShopDomain;
  readonly expiresIn?: number | undefined;
  readonly apiKey?: string | undefined;
  readonly apiSecret?: string | undefined;
  readonly iss?: string | undefined;
  readonly sub?: string | undefined;
}) {
  const now = Math.floor(Date.now() / 1000);
  const signed = `${encodeHeader({ alg: "HS256", typ: "JWT" })}.${encodePayload({
    iss: input.iss ?? `https://${input.shop}/admin`,
    dest: `https://${input.shop}`,
    aud: input.apiKey ?? FAKE_SHOPIFY_API_KEY,
    sub: input.sub ?? "1",
    exp: now + (input.expiresIn ?? 24 * 60 * 60),
    nbf: now,
    iat: now,
    jti: crypto.randomUUID(),
    sid: crypto.randomUUID(),
  })}`;
  const signature = yield* Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(input.apiSecret ?? FAKE_SHOPIFY_API_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", key, encoder.encode(signed));
  });
  return `${signed}.${encodeSignature(new Uint8Array(signature))}`;
});
