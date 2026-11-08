/**
 * `expectTomlMatches`: holds an app's `shopify.app.toml` webhook subscriptions to its
 * definition, the one list the Backend dispatches from.
 *
 * @module
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ShopifyApp, type ShopifyAppDefinition } from "#internal/shopify-app.ts";
import { ADMIN_API_VERSION } from "#internal/versions.ts";

/** One `[[webhooks.subscriptions]]` table: its `uri` and the topics it names. */
export interface TomlSubscription {
  readonly uri: string | undefined;
  readonly topics: readonly string[];
}

/** What {@link readWebhooks} finds under `[webhooks]`. */
export interface TomlWebhooks {
  readonly apiVersion: string | undefined;
  readonly subscriptions: readonly TomlSubscription[];
}

const unquote = (value: string) => value.trim().replace(/^"(?<inner>.*)"$/u, "$<inner>");

/**
 * Reads `[webhooks] api_version` and each `[[webhooks.subscriptions]]`'s `uri`, `topics` and
 * `compliance_topics` from a `shopify.app.toml`: the subset of TOML Shopify CLI writes there,
 * string values and arrays of strings, an array allowed to span lines.
 */
export const readWebhooks = (toml: string): TomlWebhooks => {
  let table = "";
  let apiVersion: string | undefined;
  const subscriptions: { uri: string | undefined; topics: string[] }[] = [];
  const lines = toml.split("\n").map((line) => line.replace(/#.*$/u, "").trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "") continue;
    const header = /^\[\[?(?<name>[^\]]+)\]\]?$/u.exec(line);
    if (header?.groups?.name !== undefined) {
      table = header.groups.name.trim();
      if (table === "webhooks.subscriptions" && line.startsWith("[["))
        subscriptions.push({ uri: undefined, topics: [] });
      continue;
    }
    const pair = /^(?<key>[A-Za-z_]+)\s*=\s*(?<value>.*)$/u.exec(line);
    if (pair?.groups?.key === undefined || pair.groups.value === undefined) continue;
    let value = pair.groups.value;
    while (value.startsWith("[") && !value.includes("]") && index + 1 < lines.length) {
      index += 1;
      value += lines[index] ?? "";
    }
    const { key } = pair.groups;
    if (table === "webhooks" && key === "api_version") apiVersion = unquote(value);
    const current = subscriptions.at(-1);
    if (table !== "webhooks.subscriptions" || current === undefined) continue;
    if (key === "uri") current.uri = unquote(value);
    if (key === "topics" || key === "compliance_topics")
      current.topics.push(
        ...value
          .replaceAll(/^\[|\]$/gu, "")
          .split(",")
          .map(unquote)
          .filter((topic) => topic !== ""),
      );
  }
  return { apiVersion, subscriptions };
};

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
export const expectTomlMatches = (options: {
  readonly tomlPath: string | URL;
  readonly app: ShopifyAppDefinition<unknown, unknown>;
}) => {
  const { apiVersion, subscriptions } = readWebhooks(readFileSync(options.tomlPath, "utf8"));
  assert.equal(
    apiVersion,
    ADMIN_API_VERSION,
    "[webhooks] api_version is the package's ADMIN_API_VERSION",
  );
  for (const { uri } of subscriptions)
    assert.match(
      uri ?? "",
      /^(?:https:\/\/[^/]+)?\/webhooks\//u,
      `subscription uri ${uri ?? "(none)"} is under /webhooks/`,
    );
  assert.deepEqual(
    [...new Set(subscriptions.flatMap(({ topics }) => topics))].toSorted(),
    [...ShopifyApp.topicsOf(options.app)].toSorted(),
    "the toml subscribes exactly the topics the app handles",
  );
};
