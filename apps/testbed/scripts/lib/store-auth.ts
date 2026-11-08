/**
 * The testbed's store auth: the Shopify CLI's online token that `shopify store execute` uses, so
 * scripts and the e2e suite can read the store's Admin API. `vp run e2e:start` grants it and the
 * e2e preflight checks it.
 *
 * @module
 */

/**
 * The scopes store auth asks for. The testbed's app asks for none, and the CLI requires at least
 * one; `read_products` is the narrowest that lets the e2e suite read the store.
 */
export const STORE_SCOPES = ["read_products"] as const;
