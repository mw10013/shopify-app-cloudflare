import { ShopDomain } from "../internal/domain.mjs";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Config from "effect/Config";
import * as Redacted from "effect/Redacted";
// src/test/e2e-session.ts
/**
* The e2e session: the secret and the shop that gate an app's e2e routes. The e2e server's
* `start` writes a fresh one to {@link E2E_SESSION_FILE} under the app's root before it starts
* `shopify app dev`, the stack binds it to the `e2e` stage's Backend alone (`bindE2eSession`), and
* the spec pack reads the file to send the token. Free of Node and of the Worker runtime, so the
* stack, the Backend, the e2e server and the pack share it.
*
* @module
*/
/** Relative to the app's root: under its ignored `.state`, beside the stage's recorded store. */
const E2E_SESSION_FILE = ".state/e2e.session.json";
/** The request header that carries the session's token. */
const E2E_TOKEN_HEADER = "x-e2e-token";
/** `GET <path>?shop=<shop>.myshopify.com`: the shop's `E2eShopStatus`. */
const E2E_STATUS_PATH = "/api/e2e/status";
/** `GET <path>`: the `E2eWebhookDeliveries` the Backend answered since it started. */
const E2E_WEBHOOKS_PATH = "/api/e2e/webhooks";
/** The logical id of the session's binding on the `e2e` stage's Backend. */
const E2E_SESSION_BINDING = "E2eSession";
/** The file's contents: the token and the leased pool store's shop. */
const E2eSession = Schema.Struct({
	token: Schema.NonEmptyString,
	shop: ShopDomain
});
/** The session as JSON text, the file's format. */
const E2eSessionJson = Schema.fromJsonString(E2eSession);
/** The env the stack binds to the `e2e` stage's Backend. */
const e2eSessionEnv = (session) => ({
	E2E_STATUS_TOKEN: Redacted.make(session.token),
	E2E_SHOP: session.shop
});
/**
* The bound session, `None` when the stack bound none (no session file, as under a bare
* `alchemy destroy`): the e2e routes then answer every request 401.
*/
const e2eAccessConfig = Config.all({
	token: Config.option(Config.Redacted("E2E_STATUS_TOKEN")),
	shop: Config.option(Config.schema(ShopDomain, "E2E_SHOP"))
}).pipe(Config.map(Option.all));
export { E2E_SESSION_BINDING, E2E_SESSION_FILE, E2E_STATUS_PATH, E2E_TOKEN_HEADER, E2E_WEBHOOKS_PATH, E2eSession, E2eSessionJson, e2eAccessConfig, e2eSessionEnv };
