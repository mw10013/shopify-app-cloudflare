/**
 * The embedded App Home's server functions and the middleware that finds the merchant's ID token
 * and answers the Backend's refusals, as `shopify-auth.md` gives them for a Website over a
 * Backend. Ported from baton's `src/web/server/shopify.ts`.
 *
 * @module
 */

import { MerchantRefusal, ShopifyUnavailableError } from "@mw10013/shopify-app-workers/contract";
import { redirect } from "@tanstack/react-router";
import { createIsomorphicFn, createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestHeader } from "@tanstack/react-start/server";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { backend } from "./backend.ts";
import { env } from "./env.server.ts";
import { rescue } from "./rescue.ts";
import { idTokenBounce } from "./shopify-urls.ts";

/** `Authorization: Bearer <token>`, the header App Bridge adds to the embedded page's fetches. */
const Bearer = Schema.TemplateLiteralParser(["Bearer ", Schema.String]);
const decodeBearer = Schema.decodeUnknownOption(Bearer);
const decodeToken = Schema.decodeUnknownOption(Schema.NonEmptyString);

const uncheckedBearer = () =>
  Option.flatMap(decodeBearer(getRequestHeader("authorization")), ([, token]) =>
    decodeToken(token),
  );

/** App Bridge's ID token bounce fetches the page it reloads with a bearer. */
export const documentHasBearer = createIsomorphicFn()
  .client(() => false)
  .server(() => Option.isSome(uncheckedBearer()));

/** A server function's data carrying the document's `id_token`. */
const IdTokenData = Schema.Struct({ idToken: Schema.NonEmptyString });
const decodeIdTokenData = Schema.decodeUnknownOption(IdTokenData);

/** The header App Bridge answers by retrying the request with a fresh ID token. */
const RETRY_INVALID_SESSION_HEADER = "X-Shopify-Retry-Invalid-Session-Request";

/** A browser's server-function call, which TanStack Start's client marks; never authentication. */
const isServerFnCall = () => getRequestHeader("x-tsr-serverFn") === "true";

/**
 * What an embedded request gets when its ID token is missing or refused: with a bearer, `401`
 * and {@link RETRY_INVALID_SESSION_HEADER}, so App Bridge retries with a fresh token; a browser's
 * server-function call without one, a bare `401`, since there is no document to bounce; a
 * document, the ID token bounce, which reloads the page with a new `id_token`.
 *
 * A document with a bearer gets its `401` as a redirect with that status: during SSR the guard
 * calls this in-process, and a redirect is the one non-render answer the router passes through
 * from `beforeLoad`; a thrown `Response` fails to dehydrate (`router-core`
 * `src/ssr/createRequestHandler.ts`).
 */
const refuse = (bearer: boolean): never => {
  const retry = { [RETRY_INVALID_SESSION_HEADER]: "1" };
  if (bearer && isServerFnCall()) throw new Response(null, { status: 401, headers: retry });
  const url = new URL(getRequest().url);
  if (bearer)
    throw redirect({ href: `${url.pathname}${url.search}`, statusCode: 401, headers: retry });
  if (isServerFnCall()) throw new Response(null, { status: 401 });
  throw redirect({ href: idTokenBounce(env.SHOPIFY_APP_URL, url.pathname, url.search) });
};

/**
 * The way to plan selection. The router follows a same-origin redirect client-side unless it
 * reloads the document, and `/auth/exit-iframe` is a server route (`router-core`
 * `src/router.ts`, `navigate` and `resolveRedirect`). A server function's redirect keeps its
 * options across the wire, so `reloadDocument` survives.
 */
const toPlanSelection = (href: string) => redirect({ href, reloadDocument: true });

/** `ShopifyUnavailableError` rethrown as its class, for the route's error page. */
const rethrowUnavailable = rescue(ShopifyUnavailableError, (unavailable): never => {
  throw unavailable;
});

/**
 * The embedded page's ID token, before anything checks it: the bearer App Bridge adds to every
 * same-origin `fetch`, else the `idToken` in the function's data, which is how the document's
 * `id_token` arrives when the guard or loader calls the function in-process during SSR. No token
 * is a refusal ({@link refuse}).
 *
 * `rescueRefusal` is the handler's catch for a Backend call's {@link MerchantRefusal}:
 * `InvalidIdTokenError` is the same refusal, for the way the token came, and
 * `PlanUnsubscribedError` the way to plan selection ({@link toPlanSelection}). A function in
 * context, not an export, so no client bundle reaches {@link refuse}'s server-only imports.
 */
const embeddedIdToken = createMiddleware({ type: "function" }).server(async ({ next, data }) => {
  const bearer = uncheckedBearer();
  const idToken = Option.orElse(bearer, () =>
    Option.map(decodeIdTokenData(data), ({ idToken }) => idToken),
  );
  if (Option.isNone(idToken)) return refuse(Option.isSome(bearer));
  const rescueRefusal: (error: unknown) => never = rescue(MerchantRefusal, (refusal) => {
    if (refusal._tag === "PlanUnsubscribedError") throw toPlanSelection(refusal.href);
    return refuse(Option.isSome(bearer));
  });
  return next({ context: { idToken: idToken.value, rescueRefusal } });
});

/**
 * `authenticateApp`'s input: the document's `id_token`, absent on a call App Bridge made, and
 * `billingRedirect` when the page is Shopify's billing redirect (its search carries
 * `plan_handle`).
 */
const AuthenticateAppInput = Schema.Struct({
  idToken: Schema.optional(Schema.NonEmptyString),
  billingRedirect: Schema.optional(Schema.Boolean),
});

/**
 * The App Home guard's read: `BACKEND.authenticateMerchant`, which exchanges the ID token when
 * the stored one is not fresh and checks the plan, re-read from the Partner API on the billing
 * redirect. Answers the shop, the API key for App Bridge's meta tag and the Manage plan URL; a
 * shop with no app subscription goes to plan selection instead.
 *
 * POST, though it writes nothing: with the ID token riding in the bearer every browser call has
 * the same URL, and Chrome holds a GET while another for the same URL is in flight.
 */
export const authenticateApp = createServerFn({ method: "POST" })
  .middleware([embeddedIdToken])
  .validator(Schema.toStandardSchemaV1(AuthenticateAppInput))
  .handler(async ({ context: { idToken, rescueRefusal }, data }) => {
    const merchant = await backend()
      .authenticateMerchant({ idToken, billingRedirect: data.billingRedirect === true })
      .catch(rescueRefusal)
      .catch(rethrowUnavailable);
    return {
      shop: merchant.shop,
      apiKey: env.SHOPIFY_API_KEY,
      managePlanUrl: merchant.managePlanUrl,
    };
  });

/**
 * The App Home's screen read (`BACKEND.appHome`): the shop, its plan's handle and when the app
 * was installed. Verifies the ID token and never exchanges; an unsubscribed shop goes to plan
 * selection.
 */
export const getAppHome = createServerFn({ method: "GET" })
  .middleware([embeddedIdToken])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ idToken: Schema.optional(Schema.NonEmptyString) })),
  )
  .handler(({ context: { idToken, rescueRefusal } }) =>
    backend().appHome({ idToken }).catch(rescueRefusal).catch(rethrowUnavailable),
  );

/** The App Home's count, from the shop's actor (`BACKEND.count`); refused as `getAppHome` is. */
export const getCount = createServerFn({ method: "GET" })
  .middleware([embeddedIdToken])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ idToken: Schema.optional(Schema.NonEmptyString) })),
  )
  .handler(({ context: { idToken, rescueRefusal } }) =>
    backend().count({ idToken }).catch(rescueRefusal).catch(rethrowUnavailable),
  );

/** The app's API key and public URL, from the Website's bindings. */
export const getShopifyApp = createServerFn({ method: "GET" }).handler(() => ({
  apiKey: env.SHOPIFY_API_KEY,
  appUrl: env.SHOPIFY_APP_URL,
}));
