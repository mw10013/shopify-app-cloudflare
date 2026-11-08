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
  PlanHandle,
  serveAll,
  ShopDomain,
} from "@mw10013/shopify-app-workers/backend";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** What the App Home's screen read sends the Backend: the ID token alone. */
export const AppHomeInput = Schema.Struct({ idToken: Schema.NonEmptyString });
export type AppHomeInput = typeof AppHomeInput.Type;

/**
 * What the App Home renders, from the shop's `AppInstallation` row: the shop, the plan's handle
 * and when the app was installed, null on a row inserted before the package stamped it. Unlike
 * the guard's answer it names the plan: the testbed shows it so its end-to-end suite can read it.
 */
export const AppHome = Schema.Struct({
  shop: ShopDomain,
  planHandle: PlanHandle,
  installedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AppHome = typeof AppHome.Type;

/**
 * The binding carries plain data and the Website's server function, which already validated it,
 * is the only caller, so an input that does not decode is a defect.
 */
const decodeAuthenticateMerchantInput = Schema.decodeUnknownEffect(AuthenticateMerchantInput);
const encodeMerchantAuthenticated = Schema.encodeEffect(MerchantAuthenticated);
const decodeAppHomeInput = Schema.decodeUnknownEffect(AppHomeInput);
const encodeAppHome = Schema.encodeEffect(AppHome);

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

  /**
   * The App Home's screen read: `MerchantGate.subscribedShop`, which verifies the ID token,
   * reads the row and resolves the plan from it without an exchange. The install instant comes
   * from that same row, so the answer never mixes two installations.
   */
  const appHome = Effect.fn("Backend.appHome")(function* (payload: AppHomeInput) {
    const { idToken } = yield* decodeAppHomeInput(payload).pipe(Effect.orDie);
    const { shop, handle, installedAt } = yield* gate.subscribedShop(idToken);
    return yield* encodeAppHome({ shop, planHandle: handle, installedAt }).pipe(Effect.orDie);
  });

  return serveAll(
    { authenticateMerchant, appHome },
    { authenticateMerchant: AuthenticateMerchantFailure, appHome: AuthenticateMerchantFailure },
  );
});
