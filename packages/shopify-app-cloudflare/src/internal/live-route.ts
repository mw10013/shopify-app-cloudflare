import { type AnyRouteMatch, type AnyRouter, isNotFound, isRedirect } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Result from "effect/Result";

import { socketStateAtom } from "./actor-connection.ts";
import type { LiveRoutes } from "./shop-actor-client.ts";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The notice keys whose writes may change this route's loader data. Absent: not live. */
    readonly live?: readonly string[];
  }
}

/** The app's `AtomRpc.Service` client class over the shop actor's socket. */
export interface LiveClient<Self, Client, ER> extends Context.Key<Self, Client> {
  readonly runtime: Atom.AtomRuntime<Self, ER>;
}

/**
 * One live read over both transports: the server function, and the same actor procedure over the
 * socket. Both end in the same actor function, so the caller never sees which one ran.
 */
export interface LiveRead<Client, A> {
  readonly server: () => Promise<A>;
  readonly socket: (client: Client) => Effect.Effect<A, unknown>;
}

const transportFailed = (cause: Cause.Cause<unknown>) =>
  Result.match(Cause.findError(cause), {
    onSuccess: (error) => Predicate.isTagged(error, "RpcClientError"),
    onFailure: () => false,
  });

class ReadUnavailableError extends Data.TaggedError("ReadUnavailableError")<{
  readonly cause: unknown;
}> {}

const readServer = <A>(server: () => Promise<A>) =>
  server().catch((error: unknown) => {
    if (isRedirect(error) || isNotFound(error) || error instanceof ReadUnavailableError)
      throw error;
    throw new ReadUnavailableError({ cause: error });
  });

const procedureFailed = (cause: Cause.Cause<unknown>) => Result.isSuccess(Cause.findError(cause));

const serverReloads = Atom.make(0).pipe(Atom.keepAlive);

const readsFromServer = (registry: AtomRegistry.AtomRegistry) => registry.get(serverReloads) > 0;

/**
 * `router.invalidate()` for a caller that wants the server's answer, not the socket's (a refused
 * socket): every live loader it reruns reads through the Backend. Not a loader's `cause`: the
 * router calls a match `stay` whenever the same route holds the same place in the tree, so a
 * filter or a page change is a `stay` too.
 */
export const reloadFromServer = async (
  registry: AtomRegistry.AtomRegistry,
  router: { readonly invalidate: () => Promise<void> },
) => {
  registry.set(serverReloads, registry.get(serverReloads) + 1);
  try {
    await router.invalidate();
  } finally {
    registry.set(serverReloads, registry.get(serverReloads) - 1);
  }
};

type LastAnswers = Map<string, { readonly request: string; readonly answer: unknown }>;
const lastAnswers = new WeakMap<AtomRegistry.AtomRegistry, LastAnswers>();

/** True while `route` shows its last answer because a reread failed ({@link keepLastAnswer}). */
export const rereadFailedAtom = Atom.family((_route: string) =>
  Atom.make(false).pipe(Atom.keepAlive),
);

/**
 * A live loader's answer, kept per route and request. When a read of the request the route last
 * answered fails without a refusal, the route keeps that answer and {@link rereadFailedAtom} says
 * so, instead of the error page replacing a page the merchant may be working in; the next notice
 * reads again. A refusal, a procedure's own failure, or a failed read of another request throws.
 */
export const keepLastAnswer = async <A>(
  registry: AtomRegistry.AtomRegistry,
  at: { readonly route: string; readonly request: string },
  read: (last: Option.Option<A>) => Promise<A>,
): Promise<A> => {
  const routes: LastAnswers = lastAnswers.get(registry) ?? new Map();
  lastAnswers.set(registry, routes);
  const entry = routes.get(at.route);
  const last = entry?.request === at.request ? Option.some(entry.answer as A) : Option.none<A>();
  try {
    const answer = await read(last);
    routes.set(at.route, { request: at.request, answer });
    registry.set(rereadFailedAtom(at.route), false);
    return answer;
  } catch (error) {
    if (!(error instanceof ReadUnavailableError)) throw error;
    if (Option.isNone(last)) throw error.cause;
    registry.set(rereadFailedAtom(at.route), true);
    return last.value;
  }
};

/**
 * The live reads over the app's actor client. `readLive` on the server calls the server function.
 * In the browser it reads over the actor socket while the socket is open, and over the server
 * function otherwise; it never waits for a socket, and neither read is ever interrupted.
 *
 * `readLiveAnswer` is for a loader whose server answer holds more than its socket read: the first
 * read of a request, and every `fresh` one, goes through the server function, and later ones read
 * the live part over the socket into the last answer ({@link keepLastAnswer}).
 *
 * `onServer` defaults to there being no `document`.
 */
export const makeLiveReads = <Self, Client, ER>(
  client: LiveClient<Self, Client, ER>,
  options: { readonly onServer?: boolean } = {},
) => {
  const onServer = options.onServer ?? typeof document === "undefined";
  const readLive = async <A>(
    registry: AtomRegistry.AtomRegistry,
    read: LiveRead<Client, A>,
  ): Promise<A> => {
    if (onServer) return read.server();
    if (registry.get(socketStateAtom) !== "open" || readsFromServer(registry))
      return readServer(read.server);
    const exit = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, client.runtime, { suspendOnWaiting: true }).pipe(
        Effect.flatMap((context) => read.socket(Context.get(context, client))),
      ),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    if (transportFailed(exit.cause)) return readServer(read.server);
    if (procedureFailed(exit.cause)) throw Cause.squash(exit.cause);
    throw new ReadUnavailableError({ cause: Cause.squash(exit.cause) });
  };
  const readLiveAnswer = <A>(
    registry: AtomRegistry.AtomRegistry,
    read: {
      readonly route: string;
      readonly request: string;
      readonly fresh?: boolean;
      readonly server: () => Promise<A>;
      readonly socket: (client: Client, last: A) => Effect.Effect<A, unknown>;
    },
  ): Promise<A> =>
    keepLastAnswer(registry, read, (last) =>
      Option.match(read.fresh === true ? Option.none<A>() : last, {
        onNone: () => readServer(read.server),
        onSome: (answer) =>
          readLive(registry, {
            server: read.server,
            socket: (service) => read.socket(service, answer),
          }),
      }),
    );
  return { readLive, readLiveAnswer };
};

/** A live route's `staleTime`: never stale by age, only when a notice names its keys. */
export const STALE_ON_NOTICE_ONLY = Number.POSITIVE_INFINITY;

/**
 * Runs `run` once the router is not loading. Each wait looks again after the `onResolved` emit
 * has finished, not inside it: an earlier waiter may start a load there, and a waiter that
 * subscribed again inside the emit would be called by the same emit, which walks a live `Set`,
 * and again, without end.
 *
 * @see refs/tanstack-start/packages/router-core/src/router.ts (`emit`)
 */
const whenSettled = (router: AnyRouter, run: () => void) => {
  if (router.state.status !== "pending") {
    run();
    return;
  }
  const stop = router.subscribe("onResolved", () => {
    stop();
    queueMicrotask(() => {
      whenSettled(router, run);
    });
  });
};

/**
 * Reruns `routeId`'s loader now, resolving once its new data is in: for a write whose page must
 * show its result before it moves on.
 */
export const rereadRoute = (router: AnyRouter, routeId: string) =>
  new Promise<void>((resolve) => {
    whenSettled(router, () => {
      void router.invalidate({ filter: (match) => match.routeId === routeId }).finally(resolve);
    });
  });

const readsAny = (match: AnyRouteMatch, keys: ReadonlySet<string>) =>
  (match.staticData.live ?? []).some((key) => keys.has(key));

/**
 * Notice keys to `router.invalidate`, for the routes that declare them; the app sets it as
 * `liveRoutesAtom` in the browser's registry. It never invalidates while the router is loading:
 * `invalidate` would detach that load's reads, which still run at the actor, and pay for them
 * twice. The keys are owed instead and replayed once that load resolves. A call no live match
 * reads starts no load.
 */
export const makeLiveRoutes = (router: AnyRouter): LiveRoutes => {
  const owed = new Set<string>();
  let waiting = false;
  const live = (keys: ReadonlySet<string>) =>
    [
      ...router.state.matches,
      // oxlint-disable-next-line no-underscore-dangle -- the cached matches router.invalidate walks; 1.170 has no public list
      ...router._cache.values(),
    ].some((match) => readsAny(match, keys));
  const flush = () => {
    waiting = false;
    const keys = new Set(owed);
    owed.clear();
    if (keys.size === 0 || !live(keys)) return;
    void router.invalidate({ filter: (match) => readsAny(match, keys) });
  };
  return {
    invalidate: (keys) => {
      for (const key of keys) owed.add(key);
      if (waiting) return;
      waiting = true;
      whenSettled(router, flush);
    },
  };
};
