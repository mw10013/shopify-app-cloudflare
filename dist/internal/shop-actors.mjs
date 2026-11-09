import { ShopifyHooks } from "./hooks.mjs";
import "./shop-actor-kit.mjs";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Predicate from "effect/Predicate";
// src/internal/shop-actors.ts
/**
* `ShopActors`: the Backend's lifecycle calls on its shop actors, and the hooks that make the
* package's uninstall and plan check reach them.
*
* @module
*/
/** The `Error` a stub call was rejected with by the actor, if it was. */
const rejection = (error) => error instanceof Cloudflare.RpcCallError && error.cause instanceof Error ? error.cause : void 0;
/**
* Whether `error` is the stub call's rejection by the actor's `ctx.abort(reason)`: workerd's
* reset, an `Error` carrying only `durableObjectReset: true` and the reason as its message, the
* same for every reason, so the message is the one thing that tells which.
*/
const isAbort = (error, reason) => {
	const reset = rejection(error);
	return Predicate.hasProperty(reset, "durableObjectReset") && reset.durableObjectReset === true && reset.message === reason;
};
/** Whether a stub call failed with the actor's refusal to activate: an empty store, no row. */
const isRefusedNotInstalled = (cause) => Predicate.isTagged(rejection(Cause.squash(cause)), "ShopNotInstalledError");
/**
* `ShopActors.destroy`'s reading of the stub call. The actor's abort lands mid-call, so a
* successful destroy rejects: an `RpcCallError` whose cause is workerd's reset with message
* {@link ABORT_UNINSTALLED}. That rejection is success, since the abort comes after `deleteAll`.
* A call that answers before its abort lands is success too, and so is the actor's refusal to
* activate ({@link ShopNotInstalledError}), the state a destroy leaves, as on a repeated
* delivery. Anything else logs `status=failed` and propagates, so the uninstall answers non-2xx
* and Shopify retries.
*
* The stub types its methods' errors as `never`, but the rejection arrives as a typed failure, so
* this reads the cause.
*/
const settleDestroy = (actor, call) => {
	const target = Object.entries(actor).map(([key, value]) => `${key}=${value}`).join(" ");
	return call.pipe(Effect.catchCause((cause) => isAbort(Cause.squash(cause), "uninstalled") || isRefusedNotInstalled(cause) ? Effect.void : Effect.failCause(cause)), Effect.tap(() => Effect.logInfo(`ShopActors.destroy: ${target} status=destroyed`).pipe(Effect.annotateLogs({
		...actor,
		status: "destroyed"
	}))), Effect.tapCause((cause) => Effect.logError(`ShopActors.destroy: ${target} status=failed`, cause).pipe(Effect.annotateLogs({
		...actor,
		status: "failed"
	}))));
};
const make = (actor) => Effect.gen(function* () {
	const actors = yield* actor;
	return {
		destroy: Effect.fn("ShopActors.destroy")(function* (shop) {
			yield* settleDestroy({ shop }, actors.getByName(shop).destroy());
		}),
		destroyById: Effect.fn("ShopActors.destroyById")(function* (id) {
			yield* settleDestroy({ id }, actors.get(actors.idFromString(id)).destroy());
		}),
		revoke: Effect.fn("ShopActors.revoke")(function* (shop) {
			return yield* actors.getByName(shop).revoke().pipe(Effect.catchCause((cause) => Effect.logError(`ShopActors.revoke: shop=${shop}: revoke failed`, cause).pipe(Effect.annotateLogs({ shop }), Effect.as({ closed: 0 }))));
		}),
		idOf: (shop) => actors.idFromName(shop).toString()
	};
});
/**
* The Backend's lifecycle calls on its shop actors: schemaless methods on the stub, which only the
* Backend holds. An app's own reads on its actor go through its own service over the same binding.
*/
var ShopActors = class ShopActors extends Context.Service()("app/ShopActors") {
	/** Over the app's `ShopActor` binding: `ShopActors.layer(ShopActor)`. */
	static layer = (actor) => Layer.effect(ShopActors, make(actor));
	/**
	* Records each destroy in `destroyed`, each destroy by id in `destroyedIds` and each revoke in
	* `revoked`, closing nothing, and derives each shop's id as `id:<shop>`.
	*/
	static layerTest = (destroyed = [], destroyedIds = [], revoked = []) => Layer.succeed(ShopActors, {
		destroy: (shop) => Effect.sync(() => {
			destroyed.push(shop);
		}),
		destroyById: (id) => Effect.sync(() => {
			destroyedIds.push(id);
		}),
		revoke: (shop) => Effect.sync(() => {
			revoked.push(shop);
			return { closed: 0 };
		}),
		idOf: (shop) => `id:${shop}`
	});
};
/**
* The hooks that reach the shop actors; spread them to add the app's own:
*
* - `afterUninstall` destroys the shop's actor, so its storage stops being billed and its sockets
*   close with `CONNECTION_CLOSE_UNINSTALLED`. A failed destroy fails the webhook, so Shopify
*   redelivers; a redelivery finds no row and still destroys.
* - `afterPlanRevalidated` closes the shop's sockets when the plan changed, so each reconnect meets
*   the gate's new answer. A first read is no change.
*/
const shopActorHooks = (actors) => ({
	...ShopifyHooks.noop,
	afterUninstall: (shop) => actors.destroy(shop),
	afterPlanRevalidated: ({ shop, changed }) => changed ? Effect.asVoid(actors.revoke(shop)) : Effect.void
});
export { ShopActors, settleDestroy, shopActorHooks };
