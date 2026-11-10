/**
 * The actor socket's state as the page shows it, and what each close code means for it.
 *
 * @module
 */

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schedule from "effect/Schedule";
import type * as Socket from "effect/socket/Socket";

import type { ShopDomain } from "./domain.ts";
import { CONNECTION_CLOSE_REVOKED } from "./shop-actor-contract.ts";

/**
 * The shop whose actor this registry's client talks to; None until the socket holder names it
 * (`nameSocket`), which it does before the page reads any socket atom. This and the other plain
 * state atoms here are kept alive: they are set while nothing on the page reads them yet, and an
 * unread atom would drop the value.
 */
export const shopKeyAtom = Atom.make<Option.Option<ShopDomain>>(Option.none()).pipe(Atom.keepAlive);

/**
 * How the merchant's browser gets a Shopify ID token, run once per connect, so every reconnect
 * carries a token minted for it. None for a socket the gate names from the session cookie, and
 * until the socket holder names the socket.
 */
export const merchantTokenAtom = Atom.make<Option.Option<Effect.Effect<string>>>(
  Option.none(),
).pipe(Atom.keepAlive);

/** Bumped by each stop ({@link CloseOutcome}): the page asks the router again. */
export const reaskAtom = Atom.make(0).pipe(Atom.keepAlive);

/**
 * The actor socket as the page shows it. A stop, with its close code, is terminal: the socket
 * stays closed until the merchant asks again ({@link reconnectAtom}).
 */
export type SocketState = "connecting" | "open" | "lost" | { readonly stopped: number };
export const socketStateAtom = Atom.make<SocketState>("connecting").pipe(Atom.keepAlive);

/** Bumped by the banner's Reconnect; the protocol reads it, so a bump rebuilds it. */
export const reconnectAtom = Atom.make(0).pipe(Atom.keepAlive);

/** How long a lost socket stays quiet before the page says so; most reconnects are faster. */
const LOST_GRACE = Duration.seconds(4);

/** True once {@link socketStateAtom} has been `lost` for {@link LOST_GRACE}. */
export const lostAtom = Atom.make((get) => {
  if (get(socketStateAtom) !== "lost") return false;
  const timer = setTimeout(() => {
    get.setSelf(true);
  }, Duration.toMillis(LOST_GRACE));
  get.addFinalizer(() => {
    clearTimeout(timer);
  });
  return false;
});

/**
 * What a close means for the socket, one of two:
 *
 * - `Retry`: every close outside 44xx, such as a revoke's 3401 after a plan change, the gate's
 *   1013 or a dropped connection. The reconnect goes back through the gate, which gives the
 *   current answer: after a lapse, 4402. A 3401 also asks the router again (`reask`), since
 *   the revoke means what the page was given, such as the plan, has changed.
 * - `Stop`: every 44xx, the gate's refusals (4402 a lapsed plan among them) and the actor's
 *   uninstall. Asking the socket again would get the same answer, so it stays closed and the
 *   page asks the router instead.
 */
export type CloseOutcome =
  | { readonly _tag: "Retry"; readonly reask: boolean }
  | { readonly _tag: "Stop"; readonly code: number };

/** The 44xx closes: the gate's refusals, the actor's refusal of an unidentified socket, and its uninstall. */
const isRefusal = (code: number) => code >= 4400 && code < 4500;

const closeCode = (error: Socket.SocketError) =>
  error.reason._tag === "SocketCloseError" ? Option.some(error.reason.code) : Option.none();

export const closeOutcome = (error: Socket.SocketError): CloseOutcome =>
  Option.match(Option.filter(closeCode(error), isRefusal), {
    onNone: (): CloseOutcome => ({
      _tag: "Retry",
      reask: Option.contains(closeCode(error), CONNECTION_CLOSE_REVOKED),
    }),
    onSome: (code): CloseOutcome => ({ _tag: "Stop", code }),
  });

/**
 * The socket's retry policy: exponential from 250 ms, capped at 4 s, until a stop
 * ({@link CloseOutcome}). Every error the policy sees goes to `onError` first, which is how the
 * page learns the close code.
 */
export const retryPolicy = (onError: (error: Socket.SocketError) => Effect.Effect<void>) =>
  Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("4 seconds")]).pipe(
    Schedule.setInputType<Socket.SocketError>(),
    Schedule.tap(({ input }) => onError(input)),
    Schedule.while(({ input }) => closeOutcome(input)._tag === "Retry"),
  );

export const applyCloseOutcome = (
  registry: AtomRegistry.AtomRegistry,
  outcome: CloseOutcome,
): Effect.Effect<void> =>
  Effect.sync(() => {
    Match.value(outcome).pipe(
      Match.tagsExhaustive({
        Retry: ({ reask }) => {
          registry.set(socketStateAtom, "lost");
          if (reask) registry.update(reaskAtom, (n) => n + 1);
        },
        Stop: ({ code }) => {
          registry.set(socketStateAtom, { stopped: code });
          registry.update(reaskAtom, (n) => n + 1);
        },
      }),
    );
  });
