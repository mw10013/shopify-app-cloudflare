/**
 * Whether Shopify accepts an app's signing key, from one application-only mint. Shopify checks
 * the client assertion before the installation, so a store without the app still answers it.
 *
 * @module
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type AssertionSigner, signAssertion } from "#internal/app-token-assertion.ts";
import type { ShopDomain } from "#internal/domain.ts";

const MINT_DEADLINE = Duration.seconds(10);

/**
 * What a mint says of the key. `Installed` and `NotInstalled` both mean registered: a 200 with a
 * token, and `400 app_not_installed`. `NotRegistered` is `401 invalid_client`: the key is not
 * registered, or the `kid` is wrong. Any other answer is `Refused`.
 */
export type Registration =
  | { readonly _tag: "Installed" }
  | { readonly _tag: "NotInstalled" }
  | { readonly _tag: "NotRegistered" }
  | { readonly _tag: "Refused"; readonly status: number; readonly error: string };

const decodeErrorField = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ error: Schema.String })),
);

/** Reads only the status and the `error` field, so a token in the body goes no further. */
export const classify = (status: number, body: string): Registration => {
  if (status >= 200 && status < 300) return { _tag: "Installed" };
  const error = Option.match(decodeErrorField(body), {
    onNone: () => "none",
    onSome: (field) => field.error,
  });
  if (status === 400 && error === "app_not_installed") return { _tag: "NotInstalled" };
  if (status === 401 && error === "invalid_client") return { _tag: "NotRegistered" };
  return { _tag: "Refused", status, error };
};

export const verify = Effect.fn("AppTokenKey.verify")(function* (
  signer: AssertionSigner,
  shop: ShopDomain,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http.execute(
    HttpClientRequest.post(`https://${shop}/admin/oauth/access_token`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyUrlParams({
        grant_type: "client_credentials",
        client_id: signer.clientId,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: yield* signAssertion(signer, shop),
      }),
    ),
  );
  return classify(response.status, yield* response.text);
}, Effect.timeout(MINT_DEADLINE));
