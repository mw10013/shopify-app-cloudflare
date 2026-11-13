/**
 * The scopes store auth asks for. The testbed's app asks for none, and the CLI requires at least
 * one; `read_products` is the narrowest that lets the e2e suite read the store.
 */
export const STORE_SCOPES = ["read_products"] as const;
