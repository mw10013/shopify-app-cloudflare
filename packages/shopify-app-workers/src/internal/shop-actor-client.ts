/**
 * The browser's socket to its shop actor: the RPC protocol with the actor's notices taken out,
 * and the notices turned into refreshes of what the page shows. No React and no router: an app
 * hands {@link liveRoutesAtom} the router's half.
 *
 * @module
 */

import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";

import {
  applyCloseOutcome,
  closeOutcome,
  merchantTokenAtom,
  reconnectAtom,
  retryPolicy,
  shopKeyAtom,
  socketStateAtom,
} from "./actor-connection.ts";
import type { ShopDomain } from "./domain.ts";
import { ACTOR_PATH, type Notice, NoticeFrame, type OwnNotice } from "./shop-actor-contract.ts";

/**
 * What {@link noticeBus} carries: the actor's notices, and `Connected`, which the socket publishes
 * itself on every (re)connect, naming every key, because a notice sent while this browser was
 * disconnected is lost.
 */
export type BusNotice =
  | Notice
  | OwnNotice
  | { readonly _tag: "Connected"; readonly invalidated: readonly string[] };

/**
 * Notices pulled off the socket, and the socket's `Connected`; one per registry, like the socket.
 * The last one is replayed to a new subscriber: the first `Connected` is published while the
 * notices atom may still be subscribing, and dropping it would leave the server-rendered page
 * unchecked until the next write.
 */
export const noticeBus = Atom.make(() =>
  Effect.runSync(PubSub.unbounded<BusNotice>({ replay: 1 })),
).pipe(Atom.keepAlive);

const decodeNotice = Schema.decodeUnknownOption(NoticeFrame);

/**
 * The RPC socket with the actor's notice frames taken out: a frame that decodes as a notice is
 * published to `notices` and never reaches the RPC protocol. Pull again when a chunk held nothing
 * else, because a reader's pull must return a non-empty array.
 */
const layerSocketWithNotices = (url: Effect.Effect<string>, notices: PubSub.PubSub<BusNotice>) =>
  Layer.effect(
    Socket.Socket,
    Effect.gen(function* () {
      const inner = yield* Socket.makeWebSocket(url);
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

/** This page's origin as a WebSocket origin: `ws:` under `http:`, `wss:` under `https:`. */
const wsOrigin = () => {
  const url = new URL(window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
};

interface ProtocolInput {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly notices: PubSub.PubSub<BusNotice>;
  readonly key: ShopDomain;
  readonly merchantToken: Option.Option<Effect.Effect<string>>;
  readonly allKeys: readonly string[];
}

/**
 * One hibernating WebSocket per browser, retried on `retryPolicy`. The gate names the socket on
 * its upgrade, from the session cookie or, for a merchant, the Shopify ID token on the URL, minted
 * for each connect, so no call carries a credential. Every close goes through `closeOutcome` to
 * the page's atoms.
 */
const browserProtocol = (input: ProtocolInput) => {
  const url = Effect.suspend(() => {
    const base = new URL(`${ACTOR_PATH}/${input.key}`, wsOrigin());
    return Option.match(input.merchantToken, {
      onNone: () => Effect.succeed(base.toString()),
      onSome: (mint) =>
        Effect.map(mint, (token) => {
          base.searchParams.set("token", token);
          return base.toString();
        }),
    });
  });
  const setState = (state: "connecting" | "open") =>
    Effect.sync(() => {
      input.registry.set(socketStateAtom, state);
    });
  return Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      retryPolicy: retryPolicy((error) => applyCloseOutcome(input.registry, closeOutcome(error))),
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        layerSocketWithNotices(url, input.notices),
        RpcSerialization.layerJson,
        Layer.succeed(RpcClient.ConnectionHooks)({
          onConnect: setState("open").pipe(
            Effect.andThen(
              PubSub.publish<BusNotice>(input.notices, {
                _tag: "Connected",
                invalidated: input.allKeys,
              }),
            ),
          ),
          onDisconnect: Effect.sync(() => {
            const state = input.registry.get(socketStateAtom);
            if (typeof state === "string") input.registry.set(socketStateAtom, "lost");
          }),
        }),
      ),
    ),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.tap(() => setState("connecting")),
  );
};

/**
 * A socket atom read before the socket holder named the shop: a broken invariant. The server
 * meets it too if it ever reads one, since only the browser names the socket.
 */
const unnamedShop = Layer.effect(
  RpcClient.Protocol,
  Effect.die(new Error("a socket atom was read before the socket holder named the shop")),
);

/**
 * The `protocol` of an app's `AtomRpc.Service` over its actor's procedures:
 *
 * ```ts
 * class ShopActorClient extends AtomRpc.Service<ShopActorClient>()("app/ShopActorClient", {
 *   group: AppRpcs,
 *   protocol: shopActorProtocol({ allKeys: ALL_KEYS }),
 * }) {}
 * ```
 *
 * It reads {@link shopKeyAtom}, `merchantTokenAtom` and `reconnectAtom`, so a change to any of
 * them rebuilds the client and reconnects. `allKeys` is every reactivity key the app's pages
 * read, which each connect names.
 */
export const shopActorProtocol =
  (options: { readonly allKeys: readonly string[] }) => (get: Atom.AtomContext) => {
    get(reconnectAtom);
    return Option.match(get(shopKeyAtom), {
      onNone: () => unnamedShop,
      onSome: (key) =>
        browserProtocol({
          registry: get.registry,
          notices: get(noticeBus),
          key,
          merchantToken: get(merchantTokenAtom),
          allKeys: options.allKeys,
        }),
    });
  };

/**
 * Names the shop and credential the protocol connects with, and starts the socket state afresh:
 * with `merchantToken`, a merchant's socket carrying a Shopify ID token minted per connect;
 * without, a socket the gate names from the session cookie. The key is set last, since naming it
 * is what lets the protocol connect. Only the socket holder runs it, once per shop and credential,
 * in the browser, before anything reads a socket atom.
 */
export const nameSocket = (
  registry: AtomRegistry.AtomRegistry,
  key: ShopDomain,
  merchantToken?: Effect.Effect<string>,
) => {
  registry.set(merchantTokenAtom, Option.fromUndefinedOr(merchantToken));
  registry.set(shopKeyAtom, Option.some(key));
  registry.set(socketStateAtom, "connecting");
};

/**
 * The default length of a notice key's window: the first notice for a key refreshes at once and
 * opens it; any more inside it cost one refresh when it ends, which opens the next. A burst of
 * writes then costs two reads of each shown page, not one per notice. A tab watching another
 * tab's writes may lag by up to the window; the tab that wrote never does, as its own notice is
 * not throttled.
 */
export const NOTICE_THROTTLE = Duration.seconds(3);

/** Notice keys to the routes that read them: the router's half of a live read. */
export interface LiveRoutes {
  readonly invalidate: (keys: ReadonlySet<string>) => void;
}

/** The browser router's {@link LiveRoutes}, set once by the app when it makes its router. */
export const liveRoutesAtom = Atom.make<LiveRoutes | undefined>(undefined).pipe(Atom.keepAlive);

/** Whether the tab is hidden, and a way to hear it change. The browser's is the document's. */
export interface Visibility {
  readonly isHidden: () => boolean;
  /** Calls `listener` on each change; answers the unsubscribe. */
  readonly onChange: (listener: () => void) => () => void;
}

const documentVisibility: Visibility = {
  isHidden: () => document.visibilityState === "hidden",
  onChange: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => {
      document.removeEventListener("visibilitychange", listener);
    };
  },
};

/**
 * Each key is throttled over `throttle`, leading and trailing; while the tab is hidden its keys
 * are held, and released through the throttle when it is visible again, so a background tab reads
 * nothing. `Connected` is neither throttled nor held: it is rare, and whatever is shown may be
 * stale by however long the socket was down. An `OwnNotice` is not throttled or held either, and
 * it clears the read its keys owe: it comes after every notice before it, so its read covers
 * theirs. Windows that end together refresh together, so a route under two keys reruns once.
 */
export const makeNoticeDispatch = (
  refresh: (keys: ReadonlySet<string>) => void,
  options: { readonly throttle: Duration.Duration; readonly visibility: Visibility },
) => {
  const { throttle, visibility } = options;
  /** Each open window's end, and whether a notice came in during it. */
  const windows = new Map<string, { readonly endsAt: DateTime.Utc; trailing: boolean }>();
  const held = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (keys: readonly string[]) => {
    if (keys.length > 0) refresh(new Set(keys));
  };
  const open = (key: string, now: DateTime.Utc) => {
    windows.set(key, { endsAt: DateTime.addDuration(now, throttle), trailing: false });
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const first = Array.from(windows.values(), ({ endsAt }) => endsAt).reduce<DateTime.Utc | null>(
      (min, endsAt) => (min === null ? endsAt : DateTime.min(min, endsAt)),
      null,
    );
    if (first !== null) {
      const wait = Duration.max(Duration.zero, DateTime.distance(DateTime.nowUnsafe(), first));
      timer = setTimeout(close, Duration.toMillis(wait));
    }
  };
  const close = () => {
    timer = undefined;
    const now = DateTime.nowUnsafe();
    const due: string[] = [];
    for (const [key, window] of windows) {
      if (DateTime.isGreaterThan(window.endsAt, now)) continue;
      windows.delete(key);
      if (!window.trailing) continue;
      if (visibility.isHidden()) held.add(key);
      else {
        due.push(key);
        open(key, now);
      }
    }
    send(due);
    schedule();
  };
  const throttled = (keys: readonly string[]) => {
    const now = DateTime.nowUnsafe();
    const lead: string[] = [];
    for (const key of keys) {
      const window = windows.get(key);
      if (window === undefined) {
        lead.push(key);
        open(key, now);
      } else {
        window.trailing = true;
      }
    }
    send(lead);
    schedule();
  };
  const own = (keys: readonly string[]) => {
    for (const key of keys) {
      held.delete(key);
      const window = windows.get(key);
      if (window !== undefined) window.trailing = false;
    }
    send(keys);
  };
  const unsubscribe = visibility.onChange(() => {
    if (visibility.isHidden() || held.size === 0) return;
    const keys = [...held];
    held.clear();
    throttled(keys);
  });
  return {
    notice: (notice: BusNotice) => {
      Match.valueTags(notice, {
        Connected: ({ invalidated }) => {
          send(invalidated);
        },
        ShopActorNotice: ({ invalidated }) => {
          if (visibility.isHidden()) for (const key of invalidated) held.add(key);
          else throttled(invalidated);
        },
        ShopActorOwnNotice: ({ invalidated }) => {
          own(invalidated);
        },
      });
    },
    dispose: () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    },
  };
};

/**
 * The atom that turns notices into reruns of the live routes they name, on the app's client
 * runtime: `makeNoticesAtom(ShopActorClient.runtime)`. The socket holder mounts it for as long as
 * the layout is, which is also what keeps the client's runtime, and so the socket, alive. Browser
 * only. It sees the last notice published before it subscribed, so every connect, the first
 * included, rereads what the page shows.
 */
export const makeNoticesAtom = <R, ER>(
  runtime: Atom.AtomRuntime<R, ER>,
  options: { readonly throttle?: Duration.Input | undefined } = {},
) =>
  runtime.atom((get) => {
    const dispatch = makeNoticeDispatch(
      (keys) => {
        get.registry.get(liveRoutesAtom)?.invalidate(keys);
      },
      {
        throttle: Duration.fromInputUnsafe(options.throttle ?? NOTICE_THROTTLE),
        visibility: documentVisibility,
      },
    );
    get.addFinalizer(dispatch.dispose);
    return Stream.fromPubSub(get(noticeBus)).pipe(
      Stream.tap((notice) =>
        Effect.sync(() => {
          dispatch.notice(notice);
        }),
      ),
    );
  });
