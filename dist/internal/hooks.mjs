import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
// src/internal/hooks.ts
/**
* The app's lifecycle hooks: behavior the package runs at fixed points of an uninstall and a plan
* check. A service, not layer options, because a hook needs the app's own services (its shop
* actors), which exist only above the layer that provides `Shopify`.
*
* @module
*/
/** Every hook doing nothing; spread it to override one. */
const noop = {
	beforeUninstall: () => Effect.void,
	afterUninstall: () => Effect.void,
	beforePlanChange: () => Effect.void,
	afterPlanRevalidated: () => Effect.void
};
/**
* A hook whose policy is best-effort: a failure or defect is logged at Warning, with `shop`, and
* swallowed. An interruption is not a hook's failure, so it propagates.
*/
const bestEffort = (hook, shop, run) => run.pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(`ShopifyHooks.${hook}: shop=${shop} status=failed`, cause).pipe(Effect.annotateLogs({
	shop,
	hook,
	status: "failed"
}))));
/** The app's hooks. An app with none provides {@link ShopifyHooks.layerNoop}. */
var ShopifyHooks = class ShopifyHooks extends Context.Service()("app/ShopifyHooks") {
	static noop = noop;
	static layerNoop = Layer.succeed(ShopifyHooks, noop);
};
export { ShopifyHooks, bestEffort };
