import * as Effect from "effect/Effect";
// src/internal/defects.ts
/**
* Defects as they cross Workers RPC: a Durable Object's methods rebuild each defect as a plain
* `Error` chain, so the Backend method that called the object logs its full cause.
*
* @module
*/
/**
* `defect` as a plain `Error` chain: each link's `name`, `message`, string, number and boolean
* fields, and `cause`. Workers RPC carries a thrown error's own properties and `cause` only while
* every value beneath it serializes; one function anywhere (a `SchemaError`'s issue holds its
* schema's checks) reduces the whole error to an `Error` of `<name>: <message>`, its cause and
* fields gone.
*
* @see https://developers.cloudflare.com/workers/runtime-apis/rpc/error-handling/
*/
const crossableDefect = (defect, seen = /* @__PURE__ */ new Set()) => {
	if (typeof defect !== "object" || defect === null) return new Error(String(defect));
	const original = defect;
	const cause = original.cause;
	const error = new Error(typeof original.message === "string" ? original.message : "", cause === void 0 || seen.has(cause) ? void 0 : { cause: crossableDefect(cause, /* @__PURE__ */ new Set([...seen, defect])) });
	if (typeof original.name === "string") error.name = original.name;
	for (const [key, value] of Object.entries(original)) if ([
		"string",
		"number",
		"boolean"
	].includes(typeof value) && !(key in error)) Object.assign(error, { [key]: value });
	return error;
};
/**
* `methods` with each defect replaced by its {@link crossableDefect}, for the methods a Durable
* Object serves over Workers RPC: Alchemy throws a method's defect as it is, and the caller logs
* what arrives.
*/
const crossDefects = (methods) => Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args) => {
	const result = method(...args);
	if (!Effect.isEffect(result)) return result;
	return result.pipe(Effect.catchDefect((defect) => Effect.die(crossableDefect(defect))));
}]));
export { crossDefects, crossableDefect };
