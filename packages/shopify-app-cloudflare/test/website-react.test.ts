import { assert, describe, it } from "@effect/vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as RpcClientError from "effect/rpc/RpcClientError";
import { afterEach, beforeEach, onTestFinished, vi } from "vite-plus/test";

import { socketStateAtom } from "#internal/actor-connection.ts";
import {
  type LiveClient,
  makeLiveReads,
  makeLiveRoutes,
  rereadFailedAtom,
  STALE_ON_NOTICE_ONLY,
} from "#internal/live-route.ts";
import {
  type BusNotice,
  makeNoticeDispatch,
  NOTICE_THROTTLE,
  type Visibility,
} from "#internal/shop-actor-client.ts";
import {
  CONNECTION_CLOSE_DISPLACED,
  CONNECTION_CLOSE_UNAUTHENTICATED,
  CONNECTION_CLOSE_UNINSTALLED,
  ForbiddenError,
} from "#internal/shop-actor-contract.ts";
import { bannerCopy } from "#internal/shop-socket.tsx";

class LiveTestClient extends Context.Service<LiveTestClient, { readonly name: string }>()(
  "test/LiveTestClient",
) {
  static readonly runtime = Atom.runtime(Layer.succeed(LiveTestClient)({ name: "socket" }));
}

const liveTestClient = LiveTestClient as unknown as LiveClient<
  LiveTestClient,
  { readonly name: string },
  never
>;

const { readLive, readLiveAnswer } = makeLiveReads(liveTestClient, { onServer: false });

const dropped = new RpcClientError.RpcClientError({
  reason: new RpcClientError.RpcClientDefect({ message: "socket closed", cause: null }),
});

const browser = (socket: "open" | "lost") => {
  const registry = AtomRegistry.make();
  onTestFinished(() => {
    registry.dispose();
  });
  registry.set(socketStateAtom, socket);
  const server = { calls: 0 };
  const fromServer =
    (answer: () => string = () => "server") =>
    () => {
      server.calls++;
      return Promise.resolve().then(answer);
    };
  return { registry, server, fromServer };
};

describe("readLive in the browser", () => {
  it("answers from the socket while it is open", async () => {
    const t = browser("open");
    const answer = await readLive(t.registry, {
      server: t.fromServer(),
      socket: (client) => Effect.succeed(client.name),
    });
    assert.strictEqual(answer, "socket");
    assert.strictEqual(t.server.calls, 0);
  });

  it("answers from the server function while the socket is not open", async () => {
    const t = browser("lost");
    const answer = await readLive(t.registry, {
      server: t.fromServer(),
      socket: (client) => Effect.succeed(client.name),
    });
    assert.strictEqual(answer, "server");
    assert.strictEqual(t.server.calls, 1);
  });

  it("on the server it calls the server function, whatever the socket says", async () => {
    const t = browser("open");
    const onServer = makeLiveReads(liveTestClient, { onServer: true });
    const answer = await onServer.readLive(t.registry, {
      server: t.fromServer(),
      socket: (client) => Effect.succeed(client.name),
    });
    assert.strictEqual(answer, "server");
  });
});

describe("readLiveAnswer", () => {
  const route = { route: "/r", request: "q" };
  const down = () => {
    throw new Error("Backend down");
  };

  it("reads the server first, then the live part over the socket into the last answer", async () => {
    const t = browser("open");
    const read = (count: number) =>
      readLiveAnswer(t.registry, {
        ...route,
        server: t.fromServer(() => JSON.stringify({ shop: "s", count: 1 })),
        socket: (_client, last) => Effect.succeed(JSON.stringify({ ...JSON.parse(last), count })),
      });
    assert.deepStrictEqual(JSON.parse(await read(5)), { shop: "s", count: 1 });
    assert.deepStrictEqual(JSON.parse(await read(6)), { shop: "s", count: 6 });
    assert.strictEqual(t.server.calls, 1);
  });

  it("a reread with no answer from either transport keeps the last answer, and says so", async () => {
    const t = browser("open");
    const read = (server: () => string) =>
      readLiveAnswer(t.registry, {
        ...route,
        server: t.fromServer(server),
        socket: () => Effect.fail(dropped),
      });
    assert.strictEqual(await read(() => "first"), "first");
    assert.strictEqual(await read(down), "first");
    assert.isTrue(t.registry.get(rereadFailedAtom("/r")));
    t.registry.set(socketStateAtom, "lost");
    assert.strictEqual(await read(() => "second"), "second");
    assert.isFalse(t.registry.get(rereadFailedAtom("/r")));
  });

  it("a refusal throws, though there is a last answer", async () => {
    const t = browser("open");
    await readLiveAnswer(t.registry, {
      ...route,
      server: t.fromServer(),
      socket: (_client, last) => Effect.succeed(last),
    });
    const refused = new ForbiddenError();
    const thrown = await readLiveAnswer(t.registry, {
      ...route,
      server: t.fromServer(),
      socket: () => Effect.fail(refused),
    }).then(
      () => assert.fail("the read answered"),
      (error: unknown) => error,
    );
    assert.strictEqual(thrown, refused);
    t.registry.set(socketStateAtom, "lost");
    const away = redirect({ href: "/elsewhere" });
    const redirected = await readLiveAnswer(t.registry, {
      ...route,
      server: () =>
        Promise.resolve().then(() => {
          throw away;
        }),
      socket: (_client, last) => Effect.succeed(last),
    }).then(
      () => assert.fail("the read answered"),
      (error: unknown) => error,
    );
    assert.strictEqual(redirected, away);
    assert.isFalse(t.registry.get(rereadFailedAtom("/r")));
  });
});

describe("notice reruns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const page = async () => {
    const loads = { count: 0 };
    const root = createRootRoute();
    const counter = createRoute({
      getParentRoute: () => root,
      path: "/",
      staleTime: STALE_ON_NOTICE_ONLY,
      staticData: { live: ["count"] },
      loader: () => {
        loads.count++;
      },
    });
    const router = createRouter({
      routeTree: root.addChildren([counter]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const reruns = () => loads.count - 1;
    const tab = { hidden: false, listeners: new Set<() => void>() };
    const visibility: Visibility = {
      isHidden: () => tab.hidden,
      onChange: (listener) => {
        tab.listeners.add(listener);
        return () => tab.listeners.delete(listener);
      },
    };
    const dispatch = makeNoticeDispatch(makeLiveRoutes(router).invalidate, {
      throttle: NOTICE_THROTTLE,
      visibility,
    });
    onTestFinished(dispatch.dispose);
    const notice = async (notice: BusNotice) => {
      dispatch.notice(notice);
      await vi.advanceTimersByTimeAsync(0);
    };
    const show = (hidden: boolean) => {
      tab.hidden = hidden;
      for (const listener of tab.listeners) listener();
    };
    return { reruns, notice, show };
  };

  it("a notice naming no key the route reads reruns nothing", async () => {
    const t = await page();
    await t.notice({ _tag: "ShopActorNotice", invalidated: ["other"] });
    await vi.runAllTimersAsync();
    assert.strictEqual(t.reruns(), 0);
  });

  it("the writer's own notice reruns the route at once, inside another tab's window", async () => {
    const t = await page();
    await t.notice({ _tag: "ShopActorNotice", invalidated: ["count"] });
    await t.notice({ _tag: "ShopActorNotice", invalidated: ["count"] });
    assert.strictEqual(t.reruns(), 1);
    await t.notice({ _tag: "ShopActorOwnNotice", invalidated: ["count"] });
    assert.strictEqual(t.reruns(), 2);
    await vi.runAllTimersAsync();
    assert.strictEqual(t.reruns(), 2);
  });

  it("a hidden tab defers the rerun until it is shown", async () => {
    const t = await page();
    t.show(true);
    await t.notice({ _tag: "ShopActorNotice", invalidated: ["count"] });
    await vi.runAllTimersAsync();
    assert.strictEqual(t.reruns(), 0);
    t.show(false);
    await vi.advanceTimersByTimeAsync(0);
    assert.strictEqual(t.reruns(), 1);
  });
});

describe("bannerCopy", () => {
  const copy = (socket: Parameters<typeof bannerCopy>[0], merchant = true, lost = true) =>
    bannerCopy(socket, { appName: "Testbed", merchant, lost });

  it("a healthy socket, and one lost inside its grace, show nothing", () => {
    assert.isTrue(Option.isNone(copy("open")));
    assert.isTrue(Option.isNone(copy("connecting")));
    assert.isTrue(Option.isNone(copy("lost", true, false)));
  });

  it("a lost socket past its grace says what being down costs, with no Reconnect", () => {
    assert.deepStrictEqual(
      copy("lost"),
      Option.some({
        tone: "warning",
        heading:
          "Testbed lost its connection. This page won't update, and you can't make changes until it reconnects.",
        reconnect: false,
      }),
    );
  });

  it("an uninstall, and an expired merchant session, end the socket with no Reconnect", () => {
    assert.deepStrictEqual(
      copy({ stopped: CONNECTION_CLOSE_UNINSTALLED }),
      Option.some({
        tone: "critical",
        heading: "Testbed was uninstalled from this store.",
        reconnect: false,
      }),
    );
    assert.deepStrictEqual(
      copy({ stopped: CONNECTION_CLOSE_UNAUTHENTICATED }),
      Option.some({ tone: "critical", heading: "Your Shopify session expired.", reconnect: false }),
    );
  });

  it("a member's 4401 is not the merchant's expiry: it offers Reconnect", () => {
    assert.deepStrictEqual(
      copy({ stopped: CONNECTION_CLOSE_UNAUTHENTICATED }, false),
      Option.some({
        tone: "warning",
        heading: "Testbed stopped updating this page. Reconnect to try again.",
        reconnect: true,
      }),
    );
  });

  it("a displaced socket offers Reconnect to keep working here", () => {
    assert.deepStrictEqual(
      copy({ stopped: CONNECTION_CLOSE_DISPLACED }),
      Option.some({
        tone: "warning",
        heading: "Signed in elsewhere. Reconnect to keep working here.",
        reconnect: true,
      }),
    );
  });
});
