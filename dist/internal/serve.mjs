import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
// src/internal/serve.ts
/**
* The Backend's methods as they cross a Worker binding: Alchemy's `toRpcAsync` drops a method's
* error type on the calling Worker's side, so the serving Worker decides what crosses.
*
* @module
*/
/**
* A cause as one line per error, for the message of the `Error` {@link serve} dies with. A tagged
* error's own message is empty, so its name stands in.
*/
const causeMessage = (cause) => Cause.prettyErrors(cause).map(({ name, message }) => message === "" ? name : name === "Error" ? message : `${name}: ${message}`).join("\n");
/**
* One Backend method as it crosses the binding. A failure in `failures` crosses encoded, as its
* plain `{ _tag, ...fields }`; the type admits no other failure, so a method dies on its internal
* errors itself. A defect is logged once, at Error, as `Backend.serve: method=<name>
* status=failed`, and crosses as an `Error` of its message, never as the raw defect, since the
* Website shows only the message.
*/
const serve = (method, effect, failures) => effect.pipe(Effect.catch((error) => Schema.encodeUnknownEffect(failures ?? Schema.Never)(error).pipe(Effect.orDie, Effect.flatMap((encoded) => Effect.fail(encoded)))), Effect.catchCauseIf((cause) => Cause.hasDies(cause) || !Cause.hasFails(cause), (cause) => Effect.logError(`Backend.serve: method=${method} status=failed`, cause).pipe(Effect.annotateLogs({
	method,
	status: "failed"
}), Effect.andThen(Effect.die(new Error(causeMessage(cause)))))));
/**
* Every method of `methods` through {@link serve}, under its own name, with its `failures` entry,
* written inline at the call. Each method needs one. A method that can fail outside its entry
* does not compile: the entry then needs an `undeclared` property, whose type names the errors
* to declare or die on. Why a table: a method that forgot to call `serve` itself would let any
* error cross unchecked.
*/
const serveAll = (methods, failures) => Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args) => serve(name, method(...args), failures[name])]));
export { serve, serveAll };
