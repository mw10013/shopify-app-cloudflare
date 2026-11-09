/**
 * The embedded App Home's merchant gate on the Website: where the merchant's ID token comes from,
 * what a request gets when the Backend refuses it, and the guard's decision for a document. Plain
 * functions over the request and the server functions' results: TanStack Start's compiler
 * rewrites `createServerFn`, `createMiddleware` and `createIsomorphicFn` only in the app's source,
 * so each app wraps these in its own few lines, and passes in TanStack's `redirect`.
 *
 * @module
 */

import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";

import { MerchantRefusal, ShopifyUnavailableError } from "./contract.ts";
import { rescue } from "./rescue.ts";
import { appSearch, embeddedAppUrl, idTokenBounce } from "./shopify-urls.ts";

/** What the router's `redirect` takes from here. */
export interface RedirectOptions {
  readonly href: string;
  readonly statusCode?: number;
  readonly headers?: Record<string, string>;
  readonly reloadDocument?: boolean;
}

/** TanStack's `redirect`, which the app passes in; its answer is what the gate throws. */
export type Redirect = (options: RedirectOptions) => unknown;

/** `Authorization: Bearer <token>`, the header App Bridge adds to the embedded page's fetches. */
const Bearer = Schema.TemplateLiteralParser(["Bearer ", Schema.String]);
const decodeBearer = Schema.decodeUnknownOption(Bearer);
const decodeToken = Schema.decodeUnknownOption(Schema.NonEmptyString);

/** The request's bearer, before anything checks it. */
export const bearerToken = (request: Request): Option.Option<string> =>
  Option.flatMap(decodeBearer(request.headers.get("authorization")), ([, token]) =>
    decodeToken(token),
  );

/** App Bridge's ID token bounce fetches the page it reloads with a bearer. */
export const hasBearer = (request: Request): boolean => Option.isSome(bearerToken(request));

/** A server function's data carrying the document's `id_token`. */
const IdTokenData = Schema.Struct({ idToken: Schema.NonEmptyString });
const decodeIdTokenData = Schema.decodeUnknownOption(IdTokenData);

/** The header App Bridge answers by retrying the request with a fresh ID token. */
const RETRY_INVALID_SESSION_HEADER = "X-Shopify-Retry-Invalid-Session-Request";

/** A browser's server-function call, which TanStack Start's client marks; never authentication. */
const isServerFnCall = (request: Request) => request.headers.get("x-tsr-serverFn") === "true";

/** What {@link readEmbeddedIdToken} reads: the request, the server function's data, and the app. */
export interface EmbeddedRequest {
  readonly request: Request;
  readonly data: unknown;
  /** The app's public URL from the binding: behind the dev proxies the request's own differs. */
  readonly appUrl: string;
  readonly redirect: Redirect;
}

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
const refuse = ({ request, appUrl, redirect }: EmbeddedRequest, bearer: boolean): never => {
  const retry = { [RETRY_INVALID_SESSION_HEADER]: "1" };
  if (bearer && isServerFnCall(request)) throw new Response(null, { status: 401, headers: retry });
  const url = new URL(request.url);
  if (bearer)
    throw redirect({ href: `${url.pathname}${url.search}`, statusCode: 401, headers: retry });
  if (isServerFnCall(request)) throw new Response(null, { status: 401 });
  throw redirect({ href: idTokenBounce(appUrl, url.pathname, url.search) });
};

const BackendRefusal = Schema.Union([MerchantRefusal, ShopifyUnavailableError]);

/**
 * The embedded page's ID token, before anything checks it: the bearer App Bridge adds to every
 * same-origin `fetch`, else the `idToken` in the function's data, which is how the document's
 * `id_token` arrives when the guard or loader calls the function in-process during SSR. No token
 * is a refusal ({@link refuse}). The app's middleware puts the answer in context.
 *
 * `rescueRefusal` is the handler's catch for a Backend call: `InvalidIdTokenError` is the same
 * refusal, for the way the token came; `PlanUnsubscribedError` goes to plan selection, as a
 * redirect that reloads the document, because the router follows a same-origin redirect
 * client-side and `/auth/exit-iframe` is a server route (`router-core` `src/router.ts`,
 * `resolveRedirect`); `ShopifyUnavailableError` is rethrown as its class, for the route's error
 * page; anything else is rethrown unchanged.
 */
export const readEmbeddedIdToken = (
  input: EmbeddedRequest,
): { readonly idToken: string; readonly rescueRefusal: (error: unknown) => never } => {
  const bearer = bearerToken(input.request);
  const idToken = Option.orElse(bearer, () =>
    Option.map(decodeIdTokenData(input.data), ({ idToken }) => idToken),
  );
  if (Option.isNone(idToken)) return refuse(input, Option.isSome(bearer));
  const rescueRefusal = rescue(BackendRefusal, (refusal): never => {
    if (refusal._tag === "ShopifyUnavailableError") throw refusal;
    if (refusal._tag === "PlanUnsubscribedError")
      throw input.redirect({ href: refusal.href, reloadDocument: true });
    return refuse(input, Option.isSome(bearer));
  });
  return { idToken: idToken.value, rescueRefusal };
};

/** `authenticateApp`'s input as the guard calls it. */
export interface AuthenticateAppInput {
  readonly data: { readonly idToken?: string; readonly billingRedirect: boolean };
}

/** The app's server functions the guard reads, and TanStack's `redirect`. */
export interface AppGuardReads<A> {
  readonly getShopifyApp: () => Promise<{ readonly apiKey: string; readonly appUrl: string }>;
  readonly authenticateApp: (input: AuthenticateAppInput) => Promise<A>;
  readonly documentHasBearer: () => boolean;
  readonly redirect: Redirect;
}

/** What the router hands the guard: the location, and the registry in the router's context. */
export interface AppGuardInput {
  readonly location: { readonly pathname: string; readonly searchStr: string };
  readonly context: { readonly registry: AtomRegistry.AtomRegistry };
}

/**
 * The guard for a document: Shopify's `authenticate.admin`, ported (`shopify-app-react-router`
 * `src/server/authenticate/admin/authenticate.ts`). A document with a bearer, as App Bridge's ID
 * token bounce fetches the page it reloads, is authenticated with that token alone. Otherwise the
 * search must be an embedded launch: neither `shop` nor `host` goes to the ID token bounce, one
 * without the other is re-embedded, a launch outside the Shopify admin goes into it, and a
 * missing `id_token` is bounced. Shopify's billing redirect returns with `plan_handle`, which
 * re-reads the plan.
 */
export const documentGuard =
  <A>(reads: AppGuardReads<A>) =>
  async ({ location }: Pick<AppGuardInput, "location">): Promise<A> => {
    const search = appSearch(location.searchStr);
    const billingRedirect = search.plan_handle !== undefined;
    if (reads.documentHasBearer()) return reads.authenticateApp({ data: { billingRedirect } });
    const { apiKey, appUrl } = await reads.getShopifyApp();
    const bounce = idTokenBounce(appUrl, location.pathname, location.searchStr);
    if (search.shop === undefined && search.host === undefined)
      throw reads.redirect({ href: bounce });
    const reEmbed = `/auth/session-token${location.searchStr}`;
    if (search.shop === undefined || search.host === undefined)
      throw reads.redirect({ href: reEmbed });
    if (search.embedded !== "1")
      throw reads.redirect({
        href: Option.getOrElse(embeddedAppUrl(search.host, apiKey), () => reEmbed),
      });
    if (search.id_token === undefined) throw reads.redirect({ href: bounce });
    return reads.authenticateApp({ data: { idToken: search.id_token, billingRedirect } });
  };

/** Bumped by {@link forgetAppGuard}; each guard's remembered answer is made anew after it. */
const forgotten = Atom.make(0).pipe(Atom.keepAlive);

/** A refused socket means the last answer may be stale, so the rerun that follows asks. */
export const forgetAppGuard = (registry: AtomRegistry.AtomRegistry) => {
  registry.update(forgotten, (n) => n + 1);
};

/** The `/app` guard, and how the page hands it the answer the document was rendered with. */
export interface AppGate<A> {
  readonly guard: (input: AppGuardInput) => Promise<A>;
  /** Hydration runs no `beforeLoad`, so the browser's guard starts from the server's answer. */
  readonly rememberHydrated: (registry: AtomRegistry.AtomRegistry, answer: A) => void;
}

/**
 * The `/app` guard. On the server it is {@link documentGuard}. In the browser the answer is the
 * document's: its shop and API key do not change while the document lives, so a navigation keeps
 * the last answer and asks, with the bearer App Bridge adds, only when it has none. A shop whose
 * plan lapsed meets plan selection at its next screen read through the Backend instead.
 * `onServer` defaults to there being no `document`.
 */
export const appGuard = <A>(
  reads: AppGuardReads<A>,
  options: { readonly onServer?: boolean } = {},
): AppGate<A> => {
  const onServer = options.onServer ?? typeof document === "undefined";
  const authenticateDocument = documentGuard(reads);
  const admitted = Atom.make((get): { last: Option.Option<A> } => {
    get(forgotten);
    return { last: Option.none() };
  }).pipe(Atom.keepAlive);
  return {
    guard: async (input) => {
      if (onServer) return authenticateDocument(input);
      const memo = input.context.registry.get(admitted);
      if (Option.isSome(memo.last)) return memo.last.value;
      const answer = await reads.authenticateApp({ data: { billingRedirect: false } });
      memo.last = Option.some(answer);
      return answer;
    },
    rememberHydrated: (registry, answer) => {
      const memo = registry.get(admitted);
      if (Option.isNone(memo.last)) memo.last = Option.some(answer);
    },
  };
};
