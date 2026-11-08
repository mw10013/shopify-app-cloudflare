import { redirect } from "@tanstack/react-router";
import * as Option from "effect/Option";

import { appSearch, embeddedAppUrl, idTokenBounce } from "#web/server/shopify-urls.ts";

/** What the guard answers: the merchant's shop, the API key and the Manage plan URL. */
export interface AppGuardContext {
  readonly shop: string;
  readonly apiKey: string;
  readonly managePlanUrl: string;
}

/** The server functions the guard reads, passed in so a test can stand in for them. */
export interface AppGuardReads {
  readonly getShopifyApp: () => Promise<{ readonly apiKey: string; readonly appUrl: string }>;
  readonly authenticateApp: (input: {
    readonly data: { readonly idToken?: string; readonly billingRedirect: boolean };
  }) => Promise<AppGuardContext>;
  readonly documentHasBearer: () => boolean;
}

export interface GuardInput {
  readonly location: { readonly pathname: string; readonly searchStr: string };
}

/**
 * The App Home guard for a document: Shopify's `authenticate.admin`, ported
 * (`shopify-app-react-router` `src/server/authenticate/admin/authenticate.ts`). A document with
 * a bearer, as App Bridge's ID token bounce fetches the page it reloads, is authenticated with
 * that token alone. Otherwise the search must be an embedded launch: neither `shop` nor `host`
 * goes to the ID token bounce, one without the other is re-embedded, a launch outside the Shopify
 * admin goes into it, and a missing `id_token` is bounced. Shopify's billing redirect returns to
 * `/app?plan_handle=…`, so `plan_handle` re-reads the plan.
 */
export const documentGuard =
  (reads: AppGuardReads) =>
  async ({ location }: GuardInput): Promise<AppGuardContext> => {
    const search = appSearch(location.searchStr);
    const billingRedirect = search.plan_handle !== undefined;
    if (reads.documentHasBearer()) return reads.authenticateApp({ data: { billingRedirect } });
    const { apiKey, appUrl } = await reads.getShopifyApp();
    const bounce = idTokenBounce(appUrl, location.pathname, location.searchStr);
    if (search.shop === undefined && search.host === undefined) throw redirect({ href: bounce });
    const reEmbed = `/auth/session-token${location.searchStr}`;
    if (search.shop === undefined || search.host === undefined) throw redirect({ href: reEmbed });
    if (search.embedded !== "1")
      throw redirect({
        href: Option.getOrElse(embeddedAppUrl(search.host, apiKey), () => reEmbed),
      });
    if (search.id_token === undefined) throw redirect({ href: bounce });
    return reads.authenticateApp({ data: { idToken: search.id_token, billingRedirect } });
  };

/**
 * The guard in the browser, on a client navigation or an `invalidate`: App Bridge puts a fresh ID
 * token on the call as a bearer. The testbed's App Home is one page, so it asks every time
 * rather than keep the document's answer as baton does.
 */
export const navigationGuard = (reads: AppGuardReads) => () =>
  reads.authenticateApp({ data: { billingRedirect: false } });
