/**
 * What crosses between the Backend and an admin's pages for the orphan sweep: the actor namespace's
 * objects as Cloudflare lists them, the batches the pages show and the one refusal `destroyOrphan`
 * declares. Imports only `effect/Schema`, so the Website loads it without the library.
 *
 * @module
 */

import * as Schema from "effect/Schema";

/** Every listing asks for this many objects: Cloudflare rejects a limit below 100 (error 10077). */
export const SHOP_ACTOR_OBJECTS_LIMIT = 1000;

/**
 * One Durable Object of the actor namespace as Cloudflare's `list_objects` answers it. `id` is
 * required because the orphan rule matches it; Cloudflare's `workers_object` requires no field, so
 * `name` and `hasStoredData` stay optional, and an absent `hasStoredData` is a third state, never
 * `true` or `false`.
 *
 * @see https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/src/workers/local-explorer/openapi.local.json
 */
export const ShopActorObject = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  hasStoredData: Schema.optional(Schema.Boolean),
});
export type ShopActorObject = typeof ShopActorObject.Type;

/** `ShopActorObjects.list`'s and `orphans`' input: the previous batch's `cursor`, none for the first. */
export const ShopActorObjectsRequest = Schema.Struct({
  cursor: Schema.optional(Schema.NonEmptyString),
});
export type ShopActorObjectsRequest = typeof ShopActorObjectsRequest.Type;

/** One batch of the actor namespace's objects; `cursor` names the next batch, absent on the last. */
export const ShopActorObjectsData = Schema.Struct({
  objects: Schema.Array(ShopActorObject),
  cursor: Schema.optional(Schema.NonEmptyString),
});
export type ShopActorObjectsData = typeof ShopActorObjectsData.Type;

/** The orphans of one batch, as `ShopActorObjects.orphans` rules them, and the next batch's `cursor`. */
export const OrphanShopActorObjectsData = Schema.Struct({
  orphans: Schema.Array(ShopActorObject),
  cursor: Schema.optional(Schema.NonEmptyString),
});
export type OrphanShopActorObjectsData = typeof OrphanShopActorObjectsData.Type;

/** `ShopActorObjects.destroyOrphan`'s input: the object's id, as `list_objects` answered it. */
export const DestroyOrphanRequest = Schema.Struct({ id: Schema.NonEmptyString });
export type DestroyOrphanRequest = typeof DestroyOrphanRequest.Type;

/**
 * The shop was installed again after the orphan list rendered, so the object is no longer an
 * orphan and `destroyOrphan` left it. A caller tells the admin and reloads the list.
 */
export class OrphanInstalledError extends Schema.TaggedError<OrphanInstalledError>()(
  "OrphanInstalledError",
  {},
) {
  override get message() {
    return "The shop was installed again, so its object is no longer an orphan";
  }
}
