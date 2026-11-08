import { ShopDomain, ShopGid } from "../internal/domain.mjs";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
// src/test/shopify-harness.ts
/**
* `ShopifyHarness`: what a required-behavior case drives. One interface, so the same cases run
* in process (`/test/node`'s `inProcessHarness`) and inside a test Backend in workerd
* (`ShopifyTestDoor`).
*
* @module
*/
const Instant = Schema.optional(Schema.NullOr(Schema.DateTimeUtcFromMillis));
/**
* A stored installation as a case seeds it: the grant columns, each unset one null. A schema,
* so a test seeds a test Backend's database through `ShopifyTestDoor`.
*/
const SeedInstallation = Schema.Struct({
	shop: ShopDomain,
	shopGid: ShopGid,
	scope: Schema.optional(Schema.NullOr(Schema.String)),
	accessToken: Schema.optional(Schema.NullOr(Schema.String)),
	accessTokenExpiresAt: Instant,
	refreshToken: Schema.optional(Schema.NullOr(Schema.String)),
	refreshTokenExpiresAt: Instant,
	/** The plan cache, as a revalidation wrote it; unset, the plan was never fetched. */
	planHandle: Schema.optional(Schema.NullOr(Schema.String)),
	planHandleExpiresAt: Instant,
	planBoundaryAt: Instant,
	/**
	* Whether the fake's ledger knows the seeded refresh token as one Shopify issued (by default
	* it does); `false` seeds the repair state, a token Shopify has retired.
	*/
	recognized: Schema.optional(Schema.Boolean)
});
var ShopifyHarness = class extends Context.Service()("app/ShopifyHarness") {};
export { SeedInstallation, ShopifyHarness };
