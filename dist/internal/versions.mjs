// src/internal/versions.ts
/**
* The Shopify API versions the package pins. Each is the one source: a unit test holds
* {@link ADMIN_API_VERSION} to the library's `ApiVersion.October26`, and each app's test holds its
* `shopify.app.toml` `[webhooks] api_version` to it.
*
* @module
*/
/** The Admin API version every Admin call and webhook subscription uses. */
const ADMIN_API_VERSION = "2026-10";
/** The Partner API version the plan check reads app subscriptions with. */
const PARTNER_API_VERSION = "2026-10";
export { ADMIN_API_VERSION, PARTNER_API_VERSION };
