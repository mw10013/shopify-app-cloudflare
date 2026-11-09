import { assert, describe, it } from "@effect/vitest";
import {
  applyCloseOutcome,
  closeOutcome,
  makeNoticeDispatch,
  NOTICE_THROTTLE,
  reaskAtom,
  retryPolicy,
  socketStateAtom,
  type Visibility,
} from "@mw10013/shopify-app-workers/client";
import {
  CONNECTION_CLOSE_DISPLACED,
  CONNECTION_CLOSE_FORBIDDEN,
  CONNECTION_CLOSE_PAYMENT_REQUIRED,
  CONNECTION_CLOSE_REVOKED,
  CONNECTION_CLOSE_TRY_AGAIN,
  CONNECTION_CLOSE_UNAUTHENTICATED,
  CONNECTION_CLOSE_UNINSTALLED,
} from "@mw10013/shopify-app-workers/contract";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schedule from "effect/Schedule";
import * as Socket from "effect/socket/Socket";
import { afterEach, beforeEach, vi } from "vite-plus/test";

import { reachedPackages } from "./reach.ts";

describe("/client", () => {
  it("reaches neither Alchemy nor @shopify/shopify-api, so a browser bundle can carry it", () => {
    assert.deepStrictEqual(
      reachedPackages("client.ts").filter(
        (specifier) =>
          specifier.startsWith("@shopify/") ||
          specifier.startsWith("@alchemy.run/") ||
          specifier.startsWith("alchemy"),
      ),
      [],
    );
  });
});

const closed = (code: number) =>
  new Socket.SocketError({ reason: new Socket.SocketCloseError({ code }) });

/** Whether the policy continues after one input, stepped directly (no time passes). */
const continuesAfter = (error: Socket.SocketError) =>
  Effect.gen(function* () {
    const step = yield* Schedule.toStep(retryPolicy(() => Effect.void));
    const exit = yield* Effect.exit(step(0, error));
    return Exit.isSuccess(exit);
  });

describe("retry policy", () => {
  it.effect.each([
    { code: CONNECTION_CLOSE_UNAUTHENTICATED, continues: false },
    { code: CONNECTION_CLOSE_FORBIDDEN, continues: false },
    { code: CONNECTION_CLOSE_UNINSTALLED, continues: false },
    { code: CONNECTION_CLOSE_PAYMENT_REQUIRED, continues: false },
    { code: CONNECTION_CLOSE_DISPLACED, continues: false },
    { code: CONNECTION_CLOSE_REVOKED, continues: true },
    { code: 4499, continues: false },
    { code: 1006, continues: true },
    { code: CONNECTION_CLOSE_TRY_AGAIN, continues: true },
  ])("after $code it continues: $continues", ({ code, continues }) =>
    Effect.gen(function* () {
      assert.strictEqual(yield* continuesAfter(closed(code)), continues);
    }),
  );
});

describe("close outcome", () => {
  it.effect.each([
    { code: 1006, state: "lost", reasks: 0 },
    { code: CONNECTION_CLOSE_TRY_AGAIN, state: "lost", reasks: 0 },
    { code: CONNECTION_CLOSE_REVOKED, state: "lost", reasks: 0 },
    {
      code: CONNECTION_CLOSE_PAYMENT_REQUIRED,
      state: { stopped: CONNECTION_CLOSE_PAYMENT_REQUIRED },
      reasks: 1,
    },
    { code: CONNECTION_CLOSE_FORBIDDEN, state: { stopped: CONNECTION_CLOSE_FORBIDDEN }, reasks: 1 },
    {
      code: CONNECTION_CLOSE_UNINSTALLED,
      state: { stopped: CONNECTION_CLOSE_UNINSTALLED },
      reasks: 1,
    },
  ] as const)(
    "$code leaves the page $state, asking again $reasks times",
    ({ code, state, reasks }) =>
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        yield* applyCloseOutcome(registry, closeOutcome(closed(code)));
        assert.deepStrictEqual(registry.get(socketStateAtom), state);
        assert.strictEqual(registry.get(reaskAtom), reasks);
        registry.dispose();
      }),
  );
});

describe("notice dispatch", () => {
  const window = Duration.toMillis(NOTICE_THROTTLE);
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const refreshes: string[][] = [];
    const tab = { hidden: false, listeners: new Set<() => void>() };
    const visibility: Visibility = {
      isHidden: () => tab.hidden,
      onChange: (listener) => {
        tab.listeners.add(listener);
        return () => tab.listeners.delete(listener);
      },
    };
    const dispatch = makeNoticeDispatch(
      (keys) => {
        refreshes.push([...keys]);
      },
      { throttle: NOTICE_THROTTLE, visibility },
    );
    const show = (hidden: boolean) => {
      tab.hidden = hidden;
      for (const listener of tab.listeners) listener();
    };
    return { refreshes, dispatch, show };
  };
  const notice = (...invalidated: string[]) => ({
    _tag: "ShopActorNotice" as const,
    invalidated,
  });

  it("a burst inside the window refreshes once at once and once when it ends", () => {
    const t = setup();
    for (let i = 0; i < 4; i++) t.dispatch.notice(notice("a"));
    assert.deepStrictEqual(t.refreshes, [["a"]]);
    vi.advanceTimersByTime(window + 1);
    assert.deepStrictEqual(t.refreshes, [["a"], ["a"]]);
    vi.advanceTimersByTime(window + 1);
    assert.strictEqual(t.refreshes.length, 2);
  });

  it("the writer's own notice refreshes at once inside a window, and nothing is owed after it", () => {
    const t = setup();
    t.dispatch.notice(notice("a"));
    t.dispatch.notice(notice("a"));
    t.dispatch.notice({ _tag: "ShopActorOwnNotice", invalidated: ["a"] });
    assert.deepStrictEqual(t.refreshes, [["a"], ["a"]]);
    vi.advanceTimersByTime(window + 1);
    assert.strictEqual(t.refreshes.length, 2);
  });

  it("a hidden tab holds its keys until it is shown", () => {
    const t = setup();
    t.show(true);
    t.dispatch.notice(notice("a", "b"));
    assert.deepStrictEqual(t.refreshes, []);
    t.show(false);
    assert.deepStrictEqual(t.refreshes, [["a", "b"]]);
  });

  it("every connect refreshes, inside a window and while hidden", () => {
    const t = setup();
    t.dispatch.notice(notice("a"));
    t.show(true);
    t.dispatch.notice({ _tag: "Connected", invalidated: ["a", "b"] });
    assert.deepStrictEqual(t.refreshes, [["a"], ["a", "b"]]);
    t.dispatch.dispose();
  });
});
