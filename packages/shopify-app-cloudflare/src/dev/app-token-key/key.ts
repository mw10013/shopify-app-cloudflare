/**
 * An app's token signing key: its `kid`, and a fresh P-256 pair as the env file holds the private
 * half and the Dev Dashboard the public JWK.
 *
 * @module
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** The env file's variable for the private key: PKCS #8, its base64 body on one line. */
export const KEY_VARIABLE = "SHOPIFY_APP_TOKEN_KEY";

export const KID_VARIABLE = "SHOPIFY_APP_TOKEN_KID";

/**
 * The `kid` for a key made on `today`: `<handle>-<YYYYMMDD>` in UTC. The Dev Dashboard lists an
 * app's keys side by side during a rotation, so the date tells them apart, and the handle names
 * the app and stage wherever the `kid` shows up. When `current`, the kid it replaces, already took
 * today's name, a suffix counts on from it: `-2`, `-3`.
 */
export const kidFor = (handle: string, today: DateTime.Utc, current: Option.Option<string>) => {
  const base = `${handle}-${DateTime.formatIsoDateUtc(today).replaceAll("-", "")}`;
  return Option.match(current, {
    onNone: () => base,
    onSome: (kid) => {
      if (kid === base) return `${base}-2`;
      const suffix = kid.startsWith(`${base}-`) ? kid.slice(base.length + 1) : "";
      return /^\d+$/u.test(suffix) ? `${base}-${String(Number(suffix) + 1)}` : base;
    },
  });
};

export interface PublicJwk {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
  readonly kid: string;
  readonly alg: "ES256";
  readonly use: "sig";
}

const ExportedJwk = Schema.Struct({
  kty: Schema.Literal("EC"),
  crv: Schema.Literal("P-256"),
  x: Schema.NonEmptyString,
  y: Schema.NonEmptyString,
});
const decodeExportedJwk = Schema.decodeUnknownEffect(ExportedJwk);

/** A new key pair registered as `kid`: the private key as the env file holds it, and its JWK. */
export const generateKey = Effect.fnUntraced(function* (kid: string) {
  const pair = yield* Effect.promise(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
  );
  const pkcs8 = yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const { kty, crv, x, y } = yield* decodeExportedJwk(
    yield* Effect.promise(() => crypto.subtle.exportKey("jwk", pair.publicKey)),
  ).pipe(Effect.orDie);
  return {
    key: Redacted.make(Base64.encode(new Uint8Array(pkcs8))),
    jwk: { kty, crv, x, y, kid, alg: "ES256", use: "sig" } satisfies PublicJwk,
  };
});
