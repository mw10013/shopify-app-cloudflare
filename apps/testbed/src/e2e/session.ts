/**
 * The e2e session: the secret and the shop that gate the e2e status route. `vp run e2e:start`
 * writes a fresh one to {@link E2E_SESSION_FILE} before it starts a server, `alchemy.run.ts` binds
 * it to the `e2e` stage's Backend alone, and the suite reads the file to send the token.
 *
 * @module
 */

import { ShopDomain } from "@mw10013/shopify-app-workers/backend";
import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

/** Under the app's ignored `.state`, beside the stage's recorded store. */
export const E2E_SESSION_FILE = ".state/e2e.session.json";

/** The request header that carries the session's token. */
export const E2E_TOKEN_HEADER = "x-e2e-token";

/** The logical id of the session's binding on the `e2e` stage's Backend. */
export const E2E_SESSION_BINDING = "E2eSession";

/** The file's contents: the token and the leased pool store's shop. */
export const E2eSession = Schema.Struct({ token: Schema.NonEmptyString, shop: ShopDomain });
export type E2eSession = typeof E2eSession.Type;

/** The session as JSON text, the file's format. */
export const E2eSessionJson = Schema.fromJsonString(E2eSession);

/** The session as the Backend holds it, its token redacted. */
export interface E2eAccess {
  readonly token: Redacted.Redacted;
  readonly shop: ShopDomain;
}

/** The env the stack binds to the `e2e` stage's Backend. */
export const e2eSessionEnv = (session: E2eSession) => ({
  E2E_STATUS_TOKEN: Redacted.make(session.token),
  E2E_SHOP: session.shop,
});

/**
 * The bound session, `None` when the stack bound none (no session file, as under a bare
 * `alchemy destroy`): the route then answers every request 401.
 */
export const e2eAccessConfig: Config.Config<Option.Option<E2eAccess>> = Config.all({
  token: Config.option(Config.Redacted("E2E_STATUS_TOKEN")),
  shop: Config.option(Config.schema(ShopDomain, "E2E_SHOP")),
}).pipe(Config.map(Option.all));
