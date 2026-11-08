import { ADMIN_API_VERSION } from "../../internal/versions.mjs";
import { ShopifyApp } from "../../internal/shopify-app.mjs";
import { readWebhooks } from "../toml-webhooks.mjs";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
// src/test/node/toml.ts
/**
* `expectTomlMatches`: holds an app's `shopify.app.toml` webhook subscriptions to its
* definition, the one list the Backend dispatches from.
*
* @module
*/
/**
* Asserts, with `node:assert`, that the toml at `tomlPath` matches `app`:
*
* - `[webhooks] api_version` is the package's `ADMIN_API_VERSION`;
* - every subscription's `uri` is under `/webhooks/`, the only path the Backend answers,
*   relative or on an absolute origin;
* - the subscribed topics are exactly the built-in topics and `app`'s extra ones, so a
*   subscription nobody handles, or a handler nobody subscribed, fails here and not in
*   production.
*/
const expectTomlMatches = (options) => {
	const { apiVersion, subscriptions } = readWebhooks(readFileSync(options.tomlPath, "utf8"));
	assert.equal(apiVersion, ADMIN_API_VERSION, "[webhooks] api_version is the package's ADMIN_API_VERSION");
	for (const { uri } of subscriptions) assert.match(uri ?? "", /^(?:https:\/\/[^/]+)?\/webhooks\//u, `subscription uri ${uri ?? "(none)"} is under /webhooks/`);
	assert.deepEqual([...new Set(subscriptions.flatMap(({ topics }) => topics))].toSorted(), [...ShopifyApp.topicsOf(options.app)].toSorted(), "the toml subscribes exactly the topics the app handles");
};
export { expectTomlMatches };
