/**
 * `ShopActors`: the Backend's lifecycle calls on its shop actors, and the hooks that make the
 * package's uninstall and plan check reach them.
 *
 * @module
 */

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";

import type { ShopDomain } from "./domain.ts";
import { ShopifyHooks, type ShopifyHooksShape } from "./hooks.ts";
import {
  ABORT_UNINSTALLED,
  type ShopActorLifecycle,
  type ShopNotInstalledError,
} from "./shop-actor-kit.ts";

/** The `Error` a stub call was rejected with by the actor, if it was. */
const rejection = (error: unknown) =>
  error instanceof Cloudflare.RpcCallError && error.cause instanceof Error
    ? error.cause
    : undefined;

/**
 * Whether `error` is the stub call's rejection by the actor's `ctx.abort(reason)`: workerd's
 * reset, an `Error` carrying only `durableObjectReset: true` and the reason as its message, the
 * same for every reason, so the message is the one thing that tells which.
 */
const isAbort = (error: unknown, reason: string) => {
  const reset = rejection(error);
  return (
    Predicate.hasProperty(reset, "durableObjectReset") &&
    reset.durableObjectReset === true &&
    reset.message === reason
  );
};

/** Whether a stub call failed with the actor's refusal to activate: an empty store, no row. */
const isRefusedNotInstalled = (cause: Cause.Cause<unknown>) =>
  Predicate.isTagged(
    rejection(Cause.squash(cause)),
    "ShopNotInstalledError" satisfies ShopNotInstalledError["_tag"],
  );

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
export const settleDestroy = (actor: Record<string, string>, call: Effect.Effect<void>) => {
  const target = Object.entries(actor)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return call.pipe(
    Effect.catchCause((cause) =>
      isAbort(Cause.squash(cause), ABORT_UNINSTALLED) || isRefusedNotInstalled(cause)
        ? Effect.void
        : Effect.failCause(cause),
    ),
    Effect.tap(() =>
      Effect.logInfo(`ShopActors.destroy: ${target} status=destroyed`).pipe(
        Effect.annotateLogs({ ...actor, status: "destroyed" }),
      ),
    ),
    Effect.tapCause((cause) =>
      Effect.logError(`ShopActors.destroy: ${target} status=failed`, cause).pipe(
        Effect.annotateLogs({ ...actor, status: "failed" }),
      ),
    ),
  );
};

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
  readonly revoke: (shop: ShopDomain) => Effect.Effect<{ readonly closed: number }>;
  /** The shop's object id, derived from its domain: the one id its actor ever has. */
  readonly idOf: (shop: ShopDomain) => string;
}

const make = <Shape extends ShopActorLifecycle, R>(
  actor: Effect.Effect<Cloudflare.DurableObject<Shape>, never, R>,
) =>
  Effect.gen(function* () {
    const actors = yield* actor;
    return {
      destroy: Effect.fn("ShopActors.destroy")(function* (shop: ShopDomain) {
        yield* settleDestroy({ shop }, actors.getByName(shop).destroy());
      }),
      destroyById: Effect.fn("ShopActors.destroyById")(function* (id: string) {
        yield* settleDestroy({ id }, actors.get(actors.idFromString(id)).destroy());
      }),
      revoke: Effect.fn("ShopActors.revoke")(function* (shop: ShopDomain) {
        return yield* actors
          .getByName(shop)
          .revoke()
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logError(`ShopActors.revoke: shop=${shop}: revoke failed`, cause).pipe(
                Effect.annotateLogs({ shop }),
                Effect.as({ closed: 0 }),
              ),
            ),
          );
      }),
      idOf: (shop: ShopDomain) => actors.idFromName(shop).toString(),
    } satisfies ShopActorsShape;
  });

/**
 * The Backend's lifecycle calls on its shop actors: schemaless methods on the stub, which only the
 * Backend holds. An app's own reads on its actor go through its own service over the same binding.
 */
export class ShopActors extends Context.Service<ShopActors, ShopActorsShape>()("app/ShopActors") {
  /** Over the app's `ShopActor` binding: `ShopActors.layer(ShopActor)`. */
  static readonly layer = <Shape extends ShopActorLifecycle, R>(
    actor: Effect.Effect<Cloudflare.DurableObject<Shape>, never, R>,
  ) => Layer.effect(ShopActors, make(actor));

  /**
   * Records each destroy in `destroyed`, each destroy by id in `destroyedIds` and each revoke in
   * `revoked`, closing nothing, and derives each shop's id as `id:<shop>`.
   */
  static readonly layerTest = (
    destroyed: ShopDomain[] = [],
    destroyedIds: string[] = [],
    revoked: ShopDomain[] = [],
  ) =>
    Layer.succeed(ShopActors, {
      destroy: (shop) =>
        Effect.sync(() => {
          destroyed.push(shop);
        }),
      destroyById: (id) =>
        Effect.sync(() => {
          destroyedIds.push(id);
        }),
      revoke: (shop) =>
        Effect.sync(() => {
          revoked.push(shop);
          return { closed: 0 };
        }),
      idOf: (shop) => `id:${shop}`,
    });
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
export const shopActorHooks = (actors: ShopActorsShape): ShopifyHooksShape => ({
  ...ShopifyHooks.noop,
  afterUninstall: (shop) => actors.destroy(shop),
  afterPlanRevalidated: ({ shop, changed }) =>
    changed ? Effect.asVoid(actors.revoke(shop)) : Effect.void,
});
