import * as Option from "effect/Option";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
/** What the router's `redirect` takes from here. */
export interface RedirectOptions {
  readonly href: string;
  readonly statusCode?: number;
  readonly headers?: Record<string, string>;
  readonly reloadDocument?: boolean;
}
/** TanStack's `redirect`, which the app passes in; its answer is what the gate throws. */
export type Redirect = (options: RedirectOptions) => unknown;
/** The request's bearer, before anything checks it. */
export declare const bearerToken: (request: Request) => Option.Option<string>;
/** App Bridge's ID token bounce fetches the page it reloads with a bearer. */
export declare const hasBearer: (request: Request) => boolean;
/** What {@link readEmbeddedIdToken} reads: the request, the server function's data, and the app. */
export interface EmbeddedRequest {
  readonly request: Request;
  readonly data: unknown;
  /** The app's public URL from the binding: behind the dev proxies the request's own differs. */
  readonly appUrl: string;
  readonly redirect: Redirect;
}
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
export declare const readEmbeddedIdToken: (input: EmbeddedRequest) => {
  readonly idToken: string;
  readonly rescueRefusal: (error: unknown) => never;
};
/** `authenticateApp`'s input as the guard calls it. */
export interface AuthenticateAppInput {
  readonly data: {
    readonly idToken?: string;
    readonly billingRedirect: boolean;
  };
}
/** The app's server functions the guard reads, and TanStack's `redirect`. */
export interface AppGuardReads<A> {
  readonly getShopifyApp: () => Promise<{
    readonly apiKey: string;
    readonly appUrl: string;
  }>;
  readonly authenticateApp: (input: AuthenticateAppInput) => Promise<A>;
  readonly documentHasBearer: () => boolean;
  readonly redirect: Redirect;
}
/** What the router hands the guard: the location, and the registry in the router's context. */
export interface AppGuardInput {
  readonly location: {
    readonly pathname: string;
    readonly searchStr: string;
  };
  readonly context: {
    readonly registry: AtomRegistry.AtomRegistry;
  };
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
export declare const documentGuard: <A>(reads: AppGuardReads<A>) => ({ location }: Pick<AppGuardInput, "location">) => Promise<A>;
/** A refused socket means the last answer may be stale, so the rerun that follows asks. */
export declare const forgetAppGuard: (registry: AtomRegistry.AtomRegistry) => void;
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
export declare const appGuard: <A>(reads: AppGuardReads<A>, options?: {
  readonly onServer?: boolean;
}) => AppGate<A>;