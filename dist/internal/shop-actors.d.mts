import { ShopDomain } from "./domain.mjs";
import { ShopifyHooksShape } from "./hooks.mjs";
import { ShopActorLifecycle } from "./shop-actor-kit.mjs";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Cloudflare from "@alchemy.run/cloudflare";
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
export declare const settleDestroy: (actor: Record<string, string>, call: Effect.Effect<void>) => Effect.Effect<void, never, never>;
export interface ShopActorsShape {
  /** Destroys the shop's actor; see `destroy` on the kit and {@link settleDestroy}. */
  readonly destroy: (shop: ShopDomain) => Effect.Effect<void>;
  /**
   * Destroys an actor by its object id, as a REST inventory lists it. Never by name: `getByName`
   * of an arbitrary name could create a new object, where an id from the inventory already
   * exists, so `destroy` can only empty it.
   */
  readonly destroyById: (id: string) => Effect.Effect<void>;
  /**
   * Closes every socket of the shop; see `revoke` on the kit. Best effort: a failure is logged and
   * counts as nothing closed, since the plan answer that called for it is already written.
   */
  readonly revoke: (shop: ShopDomain) => Effect.Effect<{
    readonly closed: number;
  }>;
  /** The shop's object id, derived from its domain: the one id its actor ever has. */
  readonly idOf: (shop: ShopDomain) => string;
}
declare const ShopActors_base: Context.ServiceClass<ShopActors, "app/ShopActors", ShopActorsShape>;
/**
 * The Backend's lifecycle calls on its shop actors: schemaless methods on the stub, which only the
 * Backend holds. An app's own reads on its actor go through its own service over the same binding.
 */
export declare class ShopActors extends ShopActors_base {
  /** Over the app's `ShopActor` binding: `ShopActors.layer(ShopActor)`. */
  static readonly layer: <Shape extends ShopActorLifecycle, R>(actor: Effect.Effect<Cloudflare.DurableObject<Shape>, never, R>) => Layer.Layer<ShopActors, never, Exclude<R, import("effect/Scope").Scope>>;
  /**
   * Records each destroy in `destroyed`, each destroy by id in `destroyedIds` and each revoke in
   * `revoked`, closing nothing, and derives each shop's id as `id:<shop>`.
   */
  static readonly layerTest: (destroyed?: ShopDomain[], destroyedIds?: string[], revoked?: ShopDomain[]) => Layer.Layer<ShopActors, never, never>;
}
/**
 * The hooks that reach the shop actors; spread them to add the app's own:
 *
 * - `afterUninstall` destroys the shop's actor, so its storage stops being billed and its sockets
 *   close with `CONNECTION_CLOSE_UNINSTALLED`. A failed destroy fails the webhook, so Shopify
 *   redelivers; a redelivery finds no row and still destroys.
 * - `afterPlanRevalidated` closes the shop's sockets when the plan changed, so each reconnect meets
 *   the gate's new answer. A first read is no change.
 */
export declare const shopActorHooks: (actors: ShopActorsShape) => ShopifyHooksShape;
export {};