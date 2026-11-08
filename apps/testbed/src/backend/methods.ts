/**
 * The Backend's methods over the `BACKEND` service binding, each through `serveAll`, so only a
 * declared failure crosses typed. Apart from the Worker, so a unit test serves them over
 * `ShopifyAppTest`.
 *
 * @module
 */

import {
  AuthenticateMerchantFailure,
  AuthenticateMerchantInput,
  MerchantAuthenticated,
  MerchantGate,
  serveAll,
} from "@mw10013/shopify-app-workers/backend";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The binding carries plain data and the Website's server function, which already validated it,
 * is the only caller, so an input that does not decode is a defect.
 */
const decodeAuthenticateMerchantInput = Schema.decodeUnknownEffect(AuthenticateMerchantInput);
const encodeMerchantAuthenticated = Schema.encodeEffect(MerchantAuthenticated);

export const backendMethods = Effect.gen(function* () {
  const gate = yield* MerchantGate;

  /** The App Home guard: `MerchantGate.authenticateMerchant` over the binding. */
  const authenticateMerchant = Effect.fn("Backend.authenticateMerchant")(function* (
    payload: AuthenticateMerchantInput,
  ) {
    const { idToken, billingRedirect } = yield* decodeAuthenticateMerchantInput(payload).pipe(
      Effect.orDie,
    );
    return yield* gate
      .authenticateMerchant(idToken, { billingRedirect })
      .pipe(Effect.flatMap((answer) => encodeMerchantAuthenticated(answer).pipe(Effect.orDie)));
  });

  return serveAll({ authenticateMerchant }, { authenticateMerchant: AuthenticateMerchantFailure });
});
