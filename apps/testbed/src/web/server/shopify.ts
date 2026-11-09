/**
 * The App Home's server functions and middleware: TanStack Start's wrappers around the package's
 * merchant gate, which the compiler splits into a server half and a client stub only in the app's
 * own source.
 *
 * @module
 */

import { hasBearer, readEmbeddedIdToken } from "@mw10013/shopify-app-workers/website";
import { redirect } from "@tanstack/react-router";
import { createIsomorphicFn, createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import * as Schema from "effect/Schema";

import { backend } from "./backend.ts";
import { env } from "./env.server.ts";

/** App Bridge's ID token bounce fetches the page it reloads with a bearer. */
export const documentHasBearer = createIsomorphicFn()
  .client(() => false)
  .server(() => hasBearer(getRequest()));

/**
 * The merchant's ID token and the catch for the Backend's refusals, in context
 * (`readEmbeddedIdToken`). A function in context, not an export, so no client bundle reaches the
 * server-only request.
 */
const embeddedIdToken = createMiddleware({ type: "function" }).server(({ next, data }) =>
  next({
    context: readEmbeddedIdToken({
      request: getRequest(),
      data,
      appUrl: env.SHOPIFY_APP_URL,
      redirect,
    }),
  }),
);

/** The document's `id_token`, absent on a call App Bridge made. */
const IdTokenInput = Schema.Struct({ idToken: Schema.optional(Schema.NonEmptyString) });

/**
 * The App Home guard's read: `BACKEND.authenticateMerchant`, which exchanges the ID token when
 * the stored one is not fresh and checks the plan, re-read from the Partner API on the billing
 * redirect. Answers the shop, the API key for App Bridge's meta tag and the Manage plan URL.
 *
 * POST, though it writes nothing: with the ID token riding in the bearer every browser call has
 * the same URL, and Chrome holds a GET while another for the same URL is in flight.
 */
export const authenticateApp = createServerFn({ method: "POST" })
  .middleware([embeddedIdToken])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ ...IdTokenInput.fields, billingRedirect: Schema.optional(Schema.Boolean) }),
    ),
  )
  .handler(async ({ context: { idToken, rescueRefusal }, data }) => {
    const merchant = await backend()
      .authenticateMerchant({ idToken, billingRedirect: data.billingRedirect === true })
      .catch(rescueRefusal);
    return {
      shop: merchant.shop,
      apiKey: env.SHOPIFY_API_KEY,
      managePlanUrl: merchant.managePlanUrl,
    };
  });

/** The App Home's screen read (`BACKEND.appHome`): the shop, its plan's handle and install time. */
export const getAppHome = createServerFn({ method: "GET" })
  .middleware([embeddedIdToken])
  .validator(Schema.toStandardSchemaV1(IdTokenInput))
  .handler(({ context: { idToken, rescueRefusal } }) =>
    backend().appHome({ idToken }).catch(rescueRefusal),
  );

/** The App Home's count, from the shop's actor (`BACKEND.count`): its live read's server half. */
export const getCount = createServerFn({ method: "GET" })
  .middleware([embeddedIdToken])
  .validator(Schema.toStandardSchemaV1(IdTokenInput))
  .handler(({ context: { idToken, rescueRefusal } }) =>
    backend().count({ idToken }).catch(rescueRefusal),
  );

/** The app's API key and public URL, from the Website's bindings. */
export const getShopifyApp = createServerFn({ method: "GET" }).handler(() => ({
  apiKey: env.SHOPIFY_API_KEY,
  appUrl: env.SHOPIFY_APP_URL,
}));
