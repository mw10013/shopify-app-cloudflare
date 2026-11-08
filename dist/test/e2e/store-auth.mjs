import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { runCommand } from "@mw10013/devkit/core/command";
import * as SchemaTransformation from "effect/SchemaTransformation";
// src/test/e2e/store-auth.ts
/**
* Store auth as the Shopify CLI lists it: the online token `shopify store execute` uses, which an
* app's suite and scripts need to read the store's Admin API. Granting it is the app's (a person
* or a script approving Shopify's page); the pack only checks it.
*
* @module
*/
var StoreAuthError = class extends Schema.TaggedError()("StoreAuthError", {
	message: Schema.String,
	cause: Schema.optionalKey(Schema.Defect())
}) {};
/** The scopes of `wanted` that `granted` lacks: Shopify's `write_X` includes `read_X`. */
const missingScopes = (wanted, granted) => wanted.filter((scope) => !granted.includes(scope) && !granted.includes(scope.replace(/^read_/u, "write_")));
/**
* The CLI prints progress events, one JSON object per line, then the result as one pretty-printed
* object over several lines, so the result is the last object, not the last line.
*/
const resultText = (stdout) => {
	const lines = stdout.split("\n").filter((line) => line !== "");
	const last = lines.at(-1) ?? "";
	if (last !== "}" && last !== "]") return last;
	const start = lines.lastIndexOf(last === "}" ? "{" : "[");
	return lines.slice(Math.max(start, 0)).join("\n");
};
const AuthList = Schema.String.pipe(Schema.decodeTo(Schema.String, SchemaTransformation.transform({
	decode: resultText,
	encode: (text) => text
})), Schema.decodeTo(Schema.fromJsonString(Schema.Struct({ sessions: Schema.Array(Schema.Struct({
	store: Schema.String,
	scopes: Schema.Array(Schema.String)
})) }))));
/**
* The scopes `shop`'s store auth lacks, every one of `wanted` when the CLI holds no session for
* it.
*/
const storeAuthMissing = Effect.fn("StoreAuth.missing")(function* (shop, wanted) {
	const stdout = yield* runCommand("shopify", [
		"store",
		"auth",
		"list",
		"--json",
		"--no-input"
	]).pipe(Effect.mapError((error) => new StoreAuthError({
		message: error.message,
		cause: error
	})));
	const { sessions } = yield* Schema.decodeUnknownEffect(AuthList)(stdout).pipe(Effect.mapError((error) => new StoreAuthError({
		message: `shopify store auth list printed a result that is not the expected shape: ${error.message}`,
		cause: error
	})));
	const session = sessions.find(({ store }) => store === shop);
	return session === void 0 ? [...wanted] : missingScopes(wanted, session.scopes);
});
export { StoreAuthError, missingScopes, resultText, storeAuthMissing };
