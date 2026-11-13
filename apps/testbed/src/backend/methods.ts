import {
  AuthenticateMerchantFailure,
  AuthenticateMerchantInput,
  MerchantAuthenticated,
  MerchantGate,
  PlanHandle,
  serveAll,
  ShopDomain,
  signInFailures,
  signInMethods,
} from "@mw10013/shopify-app-cloudflare/backend";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ShopActor } from "./shop-actor.ts";

export const AppHomeInput = Schema.Struct({ idToken: Schema.NonEmptyString });
export type AppHomeInput = typeof AppHomeInput.Type;

export const AppHome = Schema.Struct({
  shop: ShopDomain,
  planHandle: PlanHandle,
  installedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AppHome = typeof AppHome.Type;

const decodeAuthenticateMerchantInput = Schema.decodeUnknownEffect(AuthenticateMerchantInput);
const encodeMerchantAuthenticated = Schema.encodeEffect(MerchantAuthenticated);
const decodeAppHomeInput = Schema.decodeUnknownEffect(AppHomeInput);
const encodeAppHome = Schema.encodeEffect(AppHome);

export const backendMethods = Effect.gen(function* () {
  const gate = yield* MerchantGate;

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

export const counterMethods = Effect.gen(function* () {
  const gate = yield* MerchantGate;
  const actors = yield* ShopActor;

  const count = Effect.fn("Backend.count")(function* (payload: AppHomeInput) {
    const { idToken } = yield* decodeAppHomeInput(payload).pipe(Effect.orDie);
    const { shop } = yield* gate.subscribedShop(idToken);
    return yield* actors.getByName(shop).getCount();
  });

  return serveAll({ count }, { count: AuthenticateMerchantFailure });
});

export const siteMethods = Effect.gen(function* () {
  return serveAll(yield* signInMethods, signInFailures);
});
