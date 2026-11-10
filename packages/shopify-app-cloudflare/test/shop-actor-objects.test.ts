import { assert, describe, it } from "@effect/vitest";
import {
  AppInstallations,
  OrphanInstalledError,
  SHOP_ACTOR_OBJECTS_LIMIT,
  type ShopActorObject,
  shopActorObjectMethods,
  ShopActorObjects,
  ShopActors,
  type ShopDomain,
} from "@mw10013/shopify-app-cloudflare/backend";
import { Email } from "@mw10013/shopify-app-cloudflare/contract";
import { SiteAuthTest } from "@mw10013/shopify-app-cloudflare/test/node";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { shopDomain } from "./fixtures.ts";
import { capturingLogs, type Logged } from "./logs.ts";

const SCRIPT = "testbed-backend-staging";
const NOT_ON_THIS_STAGE =
  "Listing ShopActor objects needs Cloudflare's API: it works on staging and production, not on this stage";

const LIVE = shopDomain("live.myshopify.com");
const EMPTIED = shopDomain("emptied.myshopify.com");
const GONE = shopDomain("gone.myshopify.com");

const idOf = (shop: ShopDomain) => `id:${shop}`;

const installed = (shops: readonly ShopDomain[]) =>
  Layer.mock(AppInstallations)({ shops: () => Effect.succeed(shops) });

const objects: readonly ShopActorObject[] = [
  { id: idOf(LIVE), name: LIVE, hasStoredData: true },
  { id: "unknown-with-data", hasStoredData: true },
  { id: "unknown-unreported" },
  { id: idOf(EMPTIED), name: EMPTIED, hasStoredData: false },
  { id: idOf(GONE), name: GONE, hasStoredData: true },
];

const services = (destroyedIds: string[] = []) =>
  Layer.mergeAll(ShopActors.layerTest([], destroyedIds), installed([LIVE, EMPTIED]));

const deployed = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_WORKERS_API_TOKEN: "cf_token",
    SHOP_ACTOR_SCRIPT: SCRIPT,
  }),
);

const unbound = ConfigProvider.layer(ConfigProvider.fromUnknown({}));

interface Asked {
  readonly path: string;
  readonly params: Record<string, unknown>;
  readonly authorization: string | undefined;
}

const cloudflareOver = (answer: {
  readonly namespaces?: () => Response;
  readonly batch?: () => Response;
}) => {
  const asked: Asked[] = [];
  const client = HttpClient.make((request) => {
    const url = new URL(request.url);
    asked.push({
      path: url.pathname,
      params: Object.fromEntries(request.urlParams),
      authorization: request.headers.authorization,
    });
    const reply = url.pathname.endsWith("/namespaces")
      ? (answer.namespaces?.() ??
        Response.json({
          result: [
            { id: "other", class: "ShopActor", script: "testbed-backend-production" },
            { id: "namespace", class: "ShopActor", script: SCRIPT },
          ],
        }))
      : (answer.batch?.() ?? Response.json({ result: objects, result_info: { cursor: "" } }));
    return Effect.succeed(HttpClientResponse.fromWeb(request, reply));
  });
  return {
    asked,
    layer: ShopActorObjects.layerHttpClient.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  };
};

const batchOf = (size: number): readonly ShopActorObject[] =>
  Array.from({ length: size }, (_, index) => ({
    id: `object-${String(index)}`,
    hasStoredData: true,
  }));

const defectOf = (exit: Exit.Exit<unknown, unknown>) => {
  assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
};

describe("ShopActorObjects.orphans", () => {
  it.effect(
    "an installed shop's object with data is no orphan; its tombstone is, and so is an uninstalled shop's object",
    () =>
      Effect.gen(function* () {
        const { orphans } = yield* Effect.flatMap(ShopActorObjects, (each) => each.orphans());
        assert.deepStrictEqual(
          orphans.map(({ id }) => id),
          ["unknown-with-data", "unknown-unreported", idOf(EMPTIED), idOf(GONE)],
        );
      }).pipe(Effect.provide(ShopActorObjects.layerTest([objects])), Effect.provide(services())),
  );

  it.effect("the cursor of a batch is the next batch's, and the last has none", () =>
    Effect.gen(function* () {
      const each = yield* ShopActorObjects;
      const first = yield* each.orphans();
      assert.strictEqual(first.cursor, "1");
      const last = yield* each.orphans(first.cursor);
      assert.strictEqual(last.cursor, undefined);
      assert.deepStrictEqual(
        last.orphans.map(({ id }) => id),
        ["later"],
      );
    }).pipe(
      Effect.provide(ShopActorObjects.layerTest([objects.slice(0, 1), [{ id: "later" }]])),
      Effect.provide(services()),
    ),
  );
});

describe("ShopActorObjects.layerHttpClient", () => {
  it.effect(
    "asks the stage's namespace for one batch of the contract's limit, and drops the cursor of a batch shorter than it",
    () => {
      const cloudflare = cloudflareOver({
        batch: () => Response.json({ result: objects, result_info: { cursor: "next" } }),
      });
      return Effect.gen(function* () {
        const { orphans, cursor } = yield* Effect.flatMap(ShopActorObjects, (each) =>
          each.orphans(),
        );
        assert.deepStrictEqual(
          orphans.map(({ id }) => id),
          ["unknown-with-data", "unknown-unreported", idOf(EMPTIED), idOf(GONE)],
        );
        assert.strictEqual(cursor, undefined);
        assert.deepStrictEqual(
          cloudflare.asked.map(({ path }) => path),
          [
            "/client/v4/accounts/account/workers/durable_objects/namespaces",
            "/client/v4/accounts/account/workers/durable_objects/namespaces/namespace/objects",
          ],
        );
        assert.deepStrictEqual(cloudflare.asked[1]?.params, {
          limit: String(SHOP_ACTOR_OBJECTS_LIMIT),
        });
        assert.strictEqual(cloudflare.asked[1]?.authorization, "Bearer cf_token");
      }).pipe(
        Effect.provide(cloudflare.layer),
        Effect.provide(services()),
        Effect.provide(deployed),
      );
    },
  );

  it.effect("keeps the cursor only of a full batch, and only when it is not empty", () =>
    Effect.gen(function* () {
      const answers = [
        { size: SHOP_ACTOR_OBJECTS_LIMIT, cursor: "next", kept: "next" },
        { size: SHOP_ACTOR_OBJECTS_LIMIT, cursor: "", kept: undefined },
        { size: SHOP_ACTOR_OBJECTS_LIMIT - 1, cursor: "next", kept: undefined },
      ] as const;
      for (const { size, cursor, kept } of answers) {
        const cloudflare = cloudflareOver({
          batch: () => Response.json({ result: batchOf(size), result_info: { cursor } }),
        });
        const page = yield* Effect.flatMap(ShopActorObjects, (each) => each.list("before")).pipe(
          Effect.provide(cloudflare.layer),
        );
        assert.strictEqual(page.cursor, kept, `${String(size)} objects, cursor "${cursor}"`);
        assert.strictEqual(cloudflare.asked[1]?.params.cursor, "before");
      }
    }).pipe(Effect.provide(services()), Effect.provide(deployed)),
  );

  it.effect("a stage with no token dies saying so, and asks Cloudflare nothing", () => {
    const cloudflare = cloudflareOver({});
    return Effect.gen(function* () {
      const each = yield* ShopActorObjects;
      const reads: readonly Effect.Effect<unknown>[] = [each.list(), each.orphans()];
      for (const read of reads) {
        const defect = defectOf(yield* Effect.exit(read));
        assert.instanceOf(defect, Error);
        assert.strictEqual(defect.message, NOT_ON_THIS_STAGE);
      }
      assert.deepStrictEqual(cloudflare.asked, []);
    }).pipe(Effect.provide(cloudflare.layer), Effect.provide(services()), Effect.provide(unbound));
  });

  it.effect("a namespace list without the stage's ShopActor is a defect", () => {
    const cloudflare = cloudflareOver({
      namespaces: () =>
        Response.json({
          result: [{ id: "other", class: "ShopActor", script: "testbed-backend-production" }],
        }),
    });
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.flatMap(ShopActorObjects, (each) => each.list()));
      const defect = defectOf(exit);
      assert.instanceOf(defect, Error);
      assert.strictEqual(defect.message, "ShopActor namespace not found");
      assert.strictEqual(cloudflare.asked.length, 1);
    }).pipe(Effect.provide(cloudflare.layer), Effect.provide(services()), Effect.provide(deployed));
  });

  it.effect("an HTTP failure is logged with its status, then is a defect", () => {
    const cloudflare = cloudflareOver({
      namespaces: () => new Response("token lacks Workers Scripts Read", { status: 403 }),
    });
    const logged: Logged[] = [];
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.flatMap(ShopActorObjects, (each) => each.list())).pipe(
        capturingLogs(logged),
      );
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
      assert.deepStrictEqual(logged, [
        {
          level: "Error",
          message: "ShopActorObjects.listBatch: status=403: Cloudflare API failed",
        },
      ]);
      assert.strictEqual(cloudflare.asked.length, 1);
    }).pipe(Effect.provide(cloudflare.layer), Effect.provide(services()), Effect.provide(deployed));
  });
});

describe("ShopActorObjects.destroyOrphan", () => {
  it.effect(
    "refuses an installed shop's id and destroys nothing, and destroys any other id",
    () => {
      const destroyedIds: string[] = [];
      return Effect.gen(function* () {
        const each = yield* ShopActorObjects;
        const refused = yield* Effect.flip(each.destroyOrphan(idOf(LIVE)));
        assert.instanceOf(refused, OrphanInstalledError);
        assert.deepStrictEqual(destroyedIds, []);

        yield* each.destroyOrphan("unknown-with-data");
        yield* each.destroyOrphan("unknown-with-data");
        assert.deepStrictEqual(destroyedIds, ["unknown-with-data", "unknown-with-data"]);
      }).pipe(
        Effect.provide(ShopActorObjects.layerTest([])),
        Effect.provide(services(destroyedIds)),
      );
    },
  );
});

describe("shopActorObjectMethods", () => {
  const ADMIN = Schema.decodeUnknownSync(Email)("admin@site.test");
  const USER = Schema.decodeUnknownSync(Email)("user@site.test");
  const siteAuth = () =>
    SiteAuthTest.layer({
      users: [
        { email: ADMIN, role: "admin" },
        { email: USER, role: "user" },
      ],
    });
  const signedIn = (email: Email) =>
    Effect.map(SiteAuthTest.signIn(email), (cookie) => ({ cookie, ip: undefined }));

  it.live(
    "serve the three to an admin over plain payloads, and a refusal crosses as its plain fields",
    () => {
      const destroyedIds: string[] = [];
      return Effect.gen(function* () {
        const methods = yield* shopActorObjectMethods;
        const request = yield* signedIn(ADMIN);
        assert.deepStrictEqual(yield* methods.shopActorObjects(request, {}), {
          objects: [{ id: "only" }],
          cursor: undefined,
        });
        assert.deepStrictEqual(
          yield* methods.orphanShopActorObjects(request, { cursor: undefined }),
          { orphans: [{ id: "only" }], cursor: undefined },
        );
        const refused = yield* Effect.flip(methods.destroyOrphan(request, { id: idOf(LIVE) }));
        assert.deepStrictEqual(refused, { _tag: "OrphanInstalledError" });
        yield* methods.destroyOrphan(request, { id: "only" });
        assert.deepStrictEqual(destroyedIds, ["only"]);
      }).pipe(
        Effect.provide(ShopActorObjects.layerTest([[{ id: "only" }]])),
        Effect.provide(services(destroyedIds)),
        Effect.provide(siteAuth()),
      );
    },
  );

  it.live("refuse anyone signed out or not an admin, and destroy nothing", () => {
    const destroyedIds: string[] = [];
    return Effect.gen(function* () {
      const methods = yield* shopActorObjectMethods;
      const signedOut = { cookie: undefined, ip: undefined };
      assert.deepStrictEqual(yield* Effect.flip(methods.destroyOrphan(signedOut, { id: "only" })), {
        _tag: "UnauthorizedError",
      });
      assert.deepStrictEqual(
        yield* Effect.flip(methods.destroyOrphan(yield* signedIn(USER), { id: "only" })),
        { _tag: "ForbiddenError" },
      );
      assert.deepStrictEqual(yield* Effect.flip(methods.shopActorObjects(signedOut, {})), {
        _tag: "UnauthorizedError",
      });
      assert.deepStrictEqual(destroyedIds, []);
    }).pipe(
      Effect.provide(ShopActorObjects.layerTest([[{ id: "only" }]])),
      Effect.provide(services(destroyedIds)),
      Effect.provide(siteAuth()),
    );
  });

  it.live("a payload that does not decode is a defect", () =>
    Effect.gen(function* () {
      const methods = yield* shopActorObjectMethods;
      const request = yield* signedIn(ADMIN);
      const exit = yield* Effect.exit(methods.destroyOrphan(request, { id: "" })).pipe(
        capturingLogs([]),
      );
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
    }).pipe(
      Effect.provide(ShopActorObjects.layerTest([])),
      Effect.provide(services()),
      Effect.provide(siteAuth()),
    ),
  );
});
