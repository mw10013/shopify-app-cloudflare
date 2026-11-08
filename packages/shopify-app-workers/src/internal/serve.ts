/**
 * The Backend's methods as they cross a Worker binding: Alchemy's `toRpcAsync` drops a method's
 * error type on the calling Worker's side, so the serving Worker decides what crosses.
 *
 * @module
 */

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** The schema of the contract errors a method declares; it encodes with no services. */
export type Failures = Schema.Top & { readonly EncodingServices: never };

/**
 * A cause as one line per error, for the message of the `Error` {@link serve} dies with. A tagged
 * error's own message is empty, so its name stands in.
 */
const causeMessage = (cause: Cause.Cause<unknown>) =>
  Cause.prettyErrors(cause)
    .map(({ name, message }) =>
      message === "" ? name : name === "Error" ? message : `${name}: ${message}`,
    )
    .join("\n");

/**
 * One Backend method as it crosses the binding. A failure in `failures` crosses encoded, as its
 * plain `{ _tag, ...fields }`; the type admits no other failure, so a method dies on its internal
 * errors itself. A defect is logged once, at Error, as `Backend.serve: method=<name>
 * status=failed`, and crosses as an `Error` of its message, never as the raw defect, since the
 * Website shows only the message.
 */
export const serve = <A, E extends F["Type"], R, F extends Failures = typeof Schema.Never>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  failures?: F,
): Effect.Effect<A, F["Encoded"], R> =>
  effect.pipe(
    Effect.catch((error) =>
      Schema.encodeUnknownEffect(failures ?? Schema.Never)(error).pipe(
        Effect.orDie,
        Effect.flatMap((encoded) => Effect.fail(encoded as F["Encoded"])),
      ),
    ),
    Effect.catchCauseIf(
      (cause) => Cause.hasDies(cause) || !Cause.hasFails(cause),
      (cause) =>
        Effect.logError(`Backend.serve: method=${method} status=failed`, cause).pipe(
          Effect.annotateLogs({ method, status: "failed" }),
          Effect.andThen(Effect.die(new Error(causeMessage(cause)))),
        ),
    ),
  );

type Method = (...args: never) => Effect.Effect<unknown, unknown, unknown>;

type Undeclared<M extends Method, F extends Failures> = Exclude<
  M extends (...args: never) => Effect.Effect<unknown, infer E, unknown> ? E : never,
  F["Type"]
>;

/** `methods` as {@link serveAll} serves them: each fails only with its entry's encoded form. */
export type Served<M, F extends { readonly [K in keyof M]: Failures }> = {
  readonly [K in keyof M]: M[K] extends (
    ...args: infer P
  ) => Effect.Effect<infer A, unknown, infer R>
    ? (...args: P) => Effect.Effect<A, F[K]["Encoded"], R>
    : never;
};

/**
 * Every method of `methods` through {@link serve}, under its own name, with its `failures` entry,
 * written inline at the call. Each method needs one. A method that can fail outside its entry
 * does not compile: the entry then needs an `undeclared` property, whose type names the errors
 * to declare or die on. Why a table: a method that forgot to call `serve` itself would let any
 * error cross unchecked.
 */
export const serveAll = <
  M extends { readonly [K in keyof M]: Method },
  F extends { readonly [K in keyof M]: Failures },
>(
  methods: M,
  failures: F & {
    readonly [K in keyof M]: [Undeclared<M[K], F[K]>] extends [never]
      ? unknown
      : { readonly undeclared: Undeclared<M[K], F[K]> };
  },
): Served<M, F> =>
  Object.fromEntries(
    Object.entries<Method>(methods).map(([name, method]) => [
      name,
      (...args: never) => serve(name, method(...args), failures[name as keyof M]),
    ]),
  ) as Served<M, F>;
