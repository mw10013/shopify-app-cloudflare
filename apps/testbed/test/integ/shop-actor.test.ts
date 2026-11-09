import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { assert } from "@effect/vitest";
import {
  CONNECTION_CLOSE_FORBIDDEN,
  CONNECTION_CLOSE_REVOKED,
  CONNECTION_CLOSE_UNINSTALLED,
  type Notice,
  NoticeFrame,
  type OwnNotice,
  ShopDomain,
  ShopGid,
} from "@mw10013/shopify-app-workers/contract";
import { deliverWebhook, mintIdToken } from "@mw10013/shopify-app-workers/test";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";

import { catalog } from "#backend/app.ts";
import { COUNT_KEY, CounterRpcs } from "#contract/counter.ts";

import { door } from "./door.ts";
import { fileStage } from "./file-stage.ts";
import Stack from "./stack.ts";

/**
 * The testbed's `ShopActor`, built by the package's kit, in workerd, driven as a merchant's
 * browser drives it: straight at the test Backend, through the gate, its refusals and the
 * actor's closes read as close codes.
 */
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: fileStage("shopactor"),
});

const stack = beforeAll(deploy(Stack));
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack));

const shopNamed = (name: string) => Schema.decodeUnknownSync(ShopDomain)(`${name}.myshopify.com`);
const SHOP_GID = Schema.decodeUnknownSync(ShopGid)("gid://shopify/Shop/17");

/** Installs `shop` on the catalog's first plan, cached for an hour, as an exchange would. */
const install = (backendUrl: string, shop: ShopDomain, planHandleExpiresAt = Duration.hours(1)) =>
  door(backendUrl, (client) =>
    client.Seed({
      row: {
        shop,
        shopGid: SHOP_GID,
        scope: "",
        planHandle: catalog.handles[0],
        planHandleExpiresAt: DateTime.addDuration(DateTime.nowUnsafe(), planHandleExpiresAt),
      },
    }),
  );

const decodeNotice = Schema.decodeUnknownOption(NoticeFrame);

/**
 * One browser's socket to `shop`'s actor through the gate, its ID token on the URL: Effect RPC on
 * the socket, notice frames taken out onto `received`, and every socket error offered to
 * `closes`. It reconnects as the browser does, except after a 44xx close. Lives in the caller's
 * scope.
 */
const connect = (backendUrl: string, shop: ShopDomain, token: string) =>
  Effect.gen(function* () {
    const url = new URL(`/api/actor/${shop}`, backendUrl.replace(/^http/u, "ws"));
    url.searchParams.set("token", token);
    const notices = yield* PubSub.unbounded<Notice | OwnNotice>();
    const closes = yield* Queue.unbounded<Socket.SocketError>();
    const socket = Layer.effect(
      Socket.Socket,
      Effect.gen(function* () {
        const inner = yield* Socket.makeWebSocket(url.toString());
        const pullFiltered = (pull: Socket.Reader["pull"]): Socket.Reader["pull"] =>
          Effect.gen(function* () {
            while (true) {
              const rest: (Uint8Array | string)[] = [];
              for (const frame of yield* pull) {
                const notice = typeof frame === "string" ? decodeNotice(frame) : Option.none();
                if (Option.isSome(notice)) yield* PubSub.publish(notices, notice.value);
                else rest.push(frame);
              }
              if (Arr.isArrayNonEmpty(rest)) return rest;
            }
          });
        return Socket.make({
          writer: inner.writer,
          reader: Effect.map(inner.reader, (reader) => ({
            ...reader,
            pull: pullFiltered(reader.pull),
          })),
        });
      }),
    );
    const protocol = yield* Layer.build(
      Layer.effect(
        RpcClient.Protocol,
        RpcClient.makeProtocolSocket({
          retryPolicy: Schedule.spaced("200 millis").pipe(
            Schedule.setInputType<Socket.SocketError>(),
            Schedule.tap(({ input }) => Queue.offer(closes, input)),
            Schedule.while(
              ({ input }) =>
                !(
                  input.reason._tag === "SocketCloseError" &&
                  input.reason.code >= 4400 &&
                  input.reason.code < 4500
                ),
            ),
          ),
        }),
      ).pipe(
        Layer.provide(Layer.mergeAll(socket, RpcSerialization.layerJson)),
        Layer.provide(NodeSocket.layerWebSocketConstructor),
      ),
    );
    const client = yield* RpcClient.make(CounterRpcs).pipe(Effect.provideContext(protocol));
    const received = yield* PubSub.subscribe(notices);
    return { client, received, closes };
  });

/** The next close code a socket saw, within a few seconds; -1 for an error that is not a close. */
const nextCloseCode = (closes: Queue.Dequeue<Socket.SocketError>) =>
  Queue.take(closes).pipe(
    Effect.timeout("5 seconds"),
    Effect.map((error) => (error.reason._tag === "SocketCloseError" ? error.reason.code : -1)),
  );

test(
  "a socket increments and gets its own notice; a second socket of the shop gets the plain one",
  Effect.gen(function* () {
    const { backendUrl } = yield* stack;
    const shop = shopNamed("actor-notice");
    yield* install(backendUrl, shop);
    const token = yield* mintIdToken({ shop });
    yield* Effect.gen(function* () {
      const a = yield* connect(backendUrl, shop, token);
      const b = yield* connect(backendUrl, shop, token);
      assert.strictEqual(yield* b.client.MerchantGetCount(), 0);

      assert.strictEqual(yield* a.client.MerchantIncrement(), 1);
      const own = yield* PubSub.take(a.received).pipe(Effect.timeout("5 seconds"));
      assert.deepStrictEqual(own, { _tag: "ShopActorOwnNotice", invalidated: [COUNT_KEY] });
      const notice = yield* PubSub.take(b.received).pipe(Effect.timeout("5 seconds"));
      assert.deepStrictEqual(notice, { _tag: "ShopActorNotice", invalidated: [COUNT_KEY] });
      assert.strictEqual(yield* b.client.MerchantGetCount(), 1);
    }).pipe(Effect.scoped);
  }),
);

test(
  "the gate refuses another shop's token with 4403",
  Effect.gen(function* () {
    const { backendUrl } = yield* stack;
    const shop = shopNamed("actor-gate");
    const other = shopNamed("actor-gate-other");
    yield* install(backendUrl, shop);
    yield* install(backendUrl, other);
    const code = yield* Effect.gen(function* () {
      const { client, closes } = yield* connect(
        backendUrl,
        shop,
        yield* mintIdToken({ shop: other }),
      );
      // The request opens the socket; the gate's close ends it before any answer.
      yield* Effect.forkScoped(client.MerchantGetCount());
      return yield* nextCloseCode(closes);
    }).pipe(Effect.scoped);
    assert.strictEqual(code, CONNECTION_CLOSE_FORBIDDEN);
  }),
);

test(
  "app/uninstalled closes the shop's socket with 4410, and after a reinstall the actor starts empty",
  Effect.gen(function* () {
    const { backendUrl } = yield* stack;
    const shop = shopNamed("actor-leaving");
    yield* install(backendUrl, shop);
    const token = yield* mintIdToken({ shop });
    const uninstall = () =>
      deliverWebhook(
        new URL("webhooks/app/uninstalled", backendUrl).href,
        "app/uninstalled",
        shop,
        {},
      );
    yield* Effect.gen(function* () {
      const socket = yield* connect(backendUrl, shop, token);
      assert.strictEqual(yield* socket.client.MerchantIncrement(), 1);
      assert.strictEqual(yield* uninstall(), 200);
      assert.strictEqual(yield* nextCloseCode(socket.closes), CONNECTION_CLOSE_UNINSTALLED);
    }).pipe(Effect.scoped);
    assert.strictEqual(yield* uninstall(), 200, "a repeated delivery");

    yield* install(backendUrl, shop);
    const count = yield* Effect.gen(function* () {
      const socket = yield* connect(backendUrl, shop, token);
      return yield* socket.client.MerchantGetCount();
    }).pipe(Effect.scoped);
    assert.strictEqual(count, 0);
  }),
);

test(
  "a plan change the daily cron finds closes the shop's socket with 3401, and the socket reconnects",
  Effect.gen(function* () {
    const { backendUrl } = yield* stack;
    const shop = shopNamed("actor-plan-change");
    yield* install(backendUrl, shop);
    const token = yield* mintIdToken({ shop });
    yield* Effect.gen(function* () {
      const socket = yield* connect(backendUrl, shop, token);
      assert.strictEqual(yield* socket.client.MerchantIncrement(), 1);
      yield* install(backendUrl, shop, Duration.minutes(-1));
      yield* door(backendUrl, (client) =>
        client.ScriptPartner({
          shopGid: SHOP_GID,
          answer: {
            _tag: "Subscribed",
            handle: catalog.handles[1],
            cycleStartAt: null,
            boundaryAt: null,
          },
        }),
      );
      const scheduled = yield* Effect.promise(() =>
        fetch(
          new URL(`cdn-cgi/handler/scheduled?cron=${encodeURIComponent("17 4 * * *")}`, backendUrl),
        ),
      );
      assert.strictEqual(scheduled.status, 200);
      assert.strictEqual(yield* nextCloseCode(socket.closes), CONNECTION_CLOSE_REVOKED);
      // Until the reconnect lands, the client fails each call with the close it last saw.
      const reread = socket.client
        .MerchantGetCount()
        .pipe(Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 30 }));
      assert.strictEqual(yield* reread, 1, "the reconnect, through the gate, reads again");
    }).pipe(Effect.scoped);
  }),
);
