/**
 * `ShopActorObjects`: the orphan sweep's Backend half. It lists the stage's `ShopActor` objects
 * through Cloudflare's REST API, rules which no installation accounts for, and destroys one by id.
 *
 * @module
 */

import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { SHOP_ACTOR_OBJECTS_ENV } from "./bindings.ts";
import {
  DestroyOrphanRequest,
  OrphanInstalledError,
  OrphanShopActorObjectsData,
  SHOP_ACTOR_OBJECTS_LIMIT,
  ShopActorObject,
  ShopActorObjectsData,
  ShopActorObjectsRequest,
} from "./shop-actor-objects-contract.ts";
import { ShopActors } from "./shop-actors.ts";
import { AppInstallations } from "./shopify-access.ts";

const NamespacesResponse = Schema.Struct({
  result: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      class: Schema.optional(Schema.String),
      script: Schema.optional(Schema.String),
    }),
  ),
});

const ObjectsResponse = Schema.Struct({
  result: Schema.Array(ShopActorObject),
  result_info: Schema.optional(Schema.Struct({ cursor: Schema.optional(Schema.String) })),
});

interface CloudflareApi {
  readonly accountId: string;
  readonly apiToken: Redacted.Redacted;
  readonly script: string;
}

const NOT_ON_THIS_STAGE =
  "Listing ShopActor objects needs Cloudflare's API: it works on staging and production, not on this stage";

const dieLogged =
  (span: string) =>
  <A, R>(
    effect: Effect.Effect<A, HttpClientError.HttpClientError | Schema.SchemaError, R>,
  ): Effect.Effect<A, never, R> =>
    effect.pipe(
      Effect.tapErrorTag("HttpClientError", (cause) =>
        cause.response
          ? cause.response.text.pipe(
              Effect.catch(() => Effect.succeed("")),
              Effect.flatMap((body) =>
                Effect.logError(
                  `${span}: status=${String(cause.response?.status ?? "unknown")}: Cloudflare API failed`,
                ).pipe(
                  Effect.annotateLogs({
                    status: cause.response?.status,
                    body: body.slice(0, 4000),
                    requestUrl: cause.request.url,
                    urlParams: [...cause.request.urlParams],
                  }),
                ),
              ),
            )
          : Effect.void,
      ),
      Effect.orDie,
    );

const listBatch = Effect.fn("ShopActorObjects.listBatch")(function* (
  api: CloudflareApi,
  cursor: string | undefined,
) {
  yield* Effect.annotateCurrentSpan({ cursor: cursor ?? "" });
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      Function.flow(
        HttpClientRequest.prependUrl(
          `https://api.cloudflare.com/client/v4/accounts/${api.accountId}`,
        ),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(api.apiToken),
      ),
    ),
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ times: 3 }),
  );
  const namespaces = yield* client
    .get("/workers/durable_objects/namespaces")
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(NamespacesResponse)),
      dieLogged("ShopActorObjects.listBatch"),
    );
  const namespace = namespaces.result.find(
    (entry) => entry.class === "ShopActor" && entry.script === api.script,
  );
  if (namespace === undefined)
    return yield* Effect.die(
      new Error("ShopActor namespace not found", { cause: namespaces.result }),
    );
  const { result, result_info } = yield* client
    .get(`/workers/durable_objects/namespaces/${namespace.id}/objects`, {
      urlParams:
        cursor === undefined
          ? { limit: String(SHOP_ACTOR_OBJECTS_LIMIT) }
          : { limit: String(SHOP_ACTOR_OBJECTS_LIMIT), cursor },
    })
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ObjectsResponse)),
      dieLogged("ShopActorObjects.listBatch"),
    );
  const next = result_info?.cursor;
  return {
    objects: result,
    cursor:
      result.length >= SHOP_ACTOR_OBJECTS_LIMIT && next !== undefined && next !== ""
        ? next
        : undefined,
  };
});

const cloudflareApi = Config.all({
  accountId: Config.NonEmptyString(SHOP_ACTOR_OBJECTS_ENV.accountId),
  script: Config.NonEmptyString(SHOP_ACTOR_OBJECTS_ENV.script),
});

/**
 * {@link listBatch} over the stage's bound values, read at each call so a stage whose bindings
 * are absent while the stack is planned still builds its layer.
 */
const listConfigured = Effect.fnUntraced(function* (cursor: string | undefined) {
  const apiToken = yield* Config.option(Config.Redacted(SHOP_ACTOR_OBJECTS_ENV.apiToken)).pipe(
    Effect.orDie,
  );
  if (Option.isNone(apiToken)) return yield* Effect.die(new Error(NOT_ON_THIS_STAGE));
  const { accountId, script } = yield* cloudflareApi.pipe(Effect.orDie);
  return yield* listBatch({ accountId, apiToken: apiToken.value, script }, cursor);
});

export interface ShopActorObjectsShape {
  /** One batch of the stage's `ShopActor` objects, as Cloudflare lists them. */
  readonly list: (cursor?: string) => Effect.Effect<ShopActorObjectsData>;
  /**
   * The orphans of one batch: each object whose id no installed shop derives (`ShopActors.idOf`),
   * and each tombstone (`hasStoredData: false`), an installed shop's included.
   */
  readonly orphans: (cursor?: string) => Effect.Effect<OrphanShopActorObjectsData>;
  /**
   * Destroys the object `id` names (`ShopActors.destroyById`), or fails
   * {@link OrphanInstalledError} when it is an installed shop's.
   */
  readonly destroyOrphan: (id: string) => Effect.Effect<void, OrphanInstalledError>;
}

const make = Effect.fnUntraced(function* (
  listPage: (cursor: string | undefined) => Effect.Effect<ShopActorObjectsData>,
) {
  const actors = yield* ShopActors;
  const installations = yield* AppInstallations;
  const installedIds = Effect.map(
    installations.shops(),
    (shops) => new Set(shops.map(actors.idOf)),
  );
  return {
    list: Effect.fn("ShopActorObjects.list")(function* (cursor?: string) {
      return yield* listPage(cursor);
    }),
    orphans: Effect.fn("ShopActorObjects.orphans")(function* (cursor?: string) {
      const page = yield* listPage(cursor);
      const installed = yield* installedIds;
      return {
        orphans: page.objects.filter(
          (object) => object.hasStoredData === false || !installed.has(object.id),
        ),
        cursor: page.cursor,
      };
    }),
    destroyOrphan: Effect.fn("ShopActorObjects.destroyOrphan")(function* (id: string) {
      if ((yield* installedIds).has(id)) return yield* new OrphanInstalledError();
      yield* actors.destroyById(id);
    }),
  } satisfies ShopActorObjectsShape;
});

/**
 * The stage's `ShopActor` objects and the orphan sweep over them, for an admin page. It needs
 * `ShopActors` and `AppInstallations`; apps provide it in the Backend's init beside them.
 */
export class ShopActorObjects extends Context.Service<ShopActorObjects, ShopActorObjectsShape>()(
  "app/ShopActorObjects",
) {
  /**
   * Lists through Cloudflare's REST API with the `HttpClient` in context, which a test scripts,
   * over the values `bindShopActorObjects` binds. An HTTP failure is logged with its status and
   * body, then is a defect, as is an answer that does not decode or a namespace list without the
   * stage's `ShopActor`. Without `CLOUDFLARE_WORKERS_API_TOKEN` (every stage but staging and
   * production binds none, and `alchemy dev` serves no listing API) `list` and `orphans` die
   * saying so; `destroyOrphan` needs no Cloudflare.
   */
  static readonly layerHttpClient = Layer.effect(
    ShopActorObjects,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      return yield* make((cursor) =>
        listConfigured(cursor).pipe(Effect.provideService(HttpClient.HttpClient, http)),
      );
    }),
  );

  /** {@link ShopActorObjects.layerHttpClient} over `fetch`. */
  static readonly layerConfig = ShopActorObjects.layerHttpClient.pipe(
    Layer.provide(FetchHttpClient.layer),
  );

  /**
   * Over a fixed listing: `pages[0]` is the first batch, and each batch's cursor names the next,
   * absent on the last. Destroys reach `ShopActors`, so a test records them with
   * `ShopActors.layerTest`.
   */
  static readonly layerTest = (pages: readonly (readonly ShopActorObject[])[]) =>
    Layer.effect(
      ShopActorObjects,
      make(
        Effect.fnUntraced(function* (cursor: string | undefined) {
          const index = cursor === undefined ? 0 : Number(cursor);
          const objects = pages[index];
          if (objects === undefined)
            return yield* Effect.die(
              new Error(`ShopActorObjects.layerTest: no batch ${String(cursor)}`),
            );
          return index + 1 < pages.length
            ? { objects, cursor: String(index + 1) }
            : { objects, cursor: undefined };
        }),
      ),
    );
}

const decodeShopActorObjectsRequest = Schema.decodeUnknownEffect(ShopActorObjectsRequest);
const decodeDestroyOrphanRequest = Schema.decodeUnknownEffect(DestroyOrphanRequest);
const encodeShopActorObjectsData = Schema.encodeEffect(ShopActorObjectsData);
const encodeOrphanShopActorObjectsData = Schema.encodeEffect(OrphanShopActorObjectsData);

/**
 * The three as the Backend's binding methods, each taking the page's plain payload and answering
 * plain data: a payload that does not decode is a defect, as the Website's server function
 * already validated it. They guard nothing: an app guards before calling them, in its Website's
 * middleware or in its own methods around these. Serve them with {@link shopActorObjectFailures}.
 *
 * @example
 * ```ts
 * serveAll(yield* shopActorObjectMethods, shopActorObjectFailures);
 * ```
 */
export const shopActorObjectMethods = Effect.gen(function* () {
  const objects = yield* ShopActorObjects;
  return {
    shopActorObjects: Effect.fn("Backend.shopActorObjects")(function* (
      payload: ShopActorObjectsRequest,
    ) {
      const { cursor } = yield* decodeShopActorObjectsRequest(payload).pipe(Effect.orDie);
      return yield* objects
        .list(cursor)
        .pipe(Effect.flatMap((page) => encodeShopActorObjectsData(page).pipe(Effect.orDie)));
    }),
    orphanShopActorObjects: Effect.fn("Backend.orphanShopActorObjects")(function* (
      payload: ShopActorObjectsRequest,
    ) {
      const { cursor } = yield* decodeShopActorObjectsRequest(payload).pipe(Effect.orDie);
      return yield* objects
        .orphans(cursor)
        .pipe(Effect.flatMap((page) => encodeOrphanShopActorObjectsData(page).pipe(Effect.orDie)));
    }),
    destroyOrphan: Effect.fn("Backend.destroyOrphan")(function* (payload: DestroyOrphanRequest) {
      const { id } = yield* decodeDestroyOrphanRequest(payload).pipe(Effect.orDie);
      yield* objects.destroyOrphan(id);
    }),
  };
});

/** The failures {@link shopActorObjectMethods} declares, for `serveAll`'s table. */
export const shopActorObjectFailures = {
  shopActorObjects: Schema.Never,
  orphanShopActorObjects: Schema.Never,
  destroyOrphan: OrphanInstalledError,
};
