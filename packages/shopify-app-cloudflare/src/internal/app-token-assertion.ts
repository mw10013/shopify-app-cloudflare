import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import type { ShopDomain } from "./domain.ts";

/** How long an assertion is valid, well inside Shopify's 300 s limit. */
export const ASSERTION_LIFETIME = Duration.seconds(60);

const ASSERTION_CLOCK_SKEW = Duration.seconds(5);

const PEM_ARMOR = /-----(?:BEGIN|END) PRIVATE KEY-----/gu;

export const importAppTokenKey = (pem: Redacted.Redacted) =>
  Effect.gen(function* () {
    const der = Base64.decode(Redacted.value(pem).replaceAll(PEM_ARMOR, "").replaceAll(/\s/gu, ""));
    if (Result.isFailure(der))
      return yield* Effect.die(new Error("SHOPIFY_APP_TOKEN_KEY is not a PEM"));
    return yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey(
          "pkcs8",
          new Uint8Array(der.success),
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        ),
      catch: () => new Error("SHOPIFY_APP_TOKEN_KEY is not a PKCS #8 P-256 private key"),
    }).pipe(Effect.orDie);
  });

export interface AssertionSigner {
  readonly clientId: string;
  readonly kid: string;
  readonly key: CryptoKey;
}

const segment = (value: unknown) => Base64Url.encode(JSON.stringify(value));

/** A fresh assertion for `shop`'s token endpoint, with a new `jti`: Shopify accepts each once. */
export const signAssertion = Effect.fnUntraced(function* (
  signer: AssertionSigner,
  shop: ShopDomain,
) {
  const iat = Math.floor(
    DateTime.toEpochMillis(DateTime.subtractDuration(yield* DateTime.now, ASSERTION_CLOCK_SKEW)) /
      1000,
  );
  const signingInput = `${segment({ alg: "ES256", kid: signer.kid, typ: "JWT" })}.${segment({
    iss: signer.clientId,
    sub: signer.clientId,
    aud: `https://${shop}/admin/oauth/access_token`,
    iat,
    exp: iat + Duration.toSeconds(ASSERTION_LIFETIME),
    jti: crypto.randomUUID(),
  })}`;
  const signature = yield* Effect.promise(() =>
    crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signer.key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${Base64Url.encode(new Uint8Array(signature))}`;
});
