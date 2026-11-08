import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
/** The schema of the contract errors a method declares; it encodes with no services. */
export type Failures = Schema.Top & {
  readonly EncodingServices: never;
};
/**
 * One Backend method as it crosses the binding. A failure in `failures` crosses encoded, as its
 * plain `{ _tag, ...fields }`; the type admits no other failure, so a method dies on its internal
 * errors itself. A defect is logged once, at Error, as `Backend.serve: method=<name>
 * status=failed`, and crosses as an `Error` of its message, never as the raw defect, since the
 * Website shows only the message.
 */
export declare const serve: <A, E extends F["Type"], R, F extends Failures = typeof Schema.Never>(method: string, effect: Effect.Effect<A, E, R>, failures?: F) => Effect.Effect<A, F["Encoded"], R>;
type Method = (...args: never) => Effect.Effect<unknown, unknown, unknown>;
type Undeclared<M extends Method, F extends Failures> = Exclude<M extends ((...args: never) => Effect.Effect<unknown, infer E, unknown>) ? E : never, F["Type"]>;
/** `methods` as {@link serveAll} serves them: each fails only with its entry's encoded form. */
export type Served<M, F extends { readonly [K in keyof M]: Failures; }> = { readonly [K in keyof M]: M[K] extends ((...args: infer P) => Effect.Effect<infer A, unknown, infer R>) ? (...args: P) => Effect.Effect<A, F[K]["Encoded"], R> : never; };
/**
 * Every method of `methods` through {@link serve}, under its own name, with its `failures` entry,
 * written inline at the call. Each method needs one. A method that can fail outside its entry
 * does not compile: the entry then needs an `undeclared` property, whose type names the errors
 * to declare or die on. Why a table: a method that forgot to call `serve` itself would let any
 * error cross unchecked.
 */
export declare const serveAll: <M extends { readonly [K in keyof M]: Method; }, F extends { readonly [K in keyof M]: Failures; }>(methods: M, failures: F & { readonly [K in keyof M]: [Undeclared<M[K], F[K]>] extends [never] ? unknown : {
  readonly undeclared: Undeclared<M[K], F[K]>;
}; }) => Served<M, F>;
export {};