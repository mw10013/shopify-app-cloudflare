/**
 * An app's public identity from its stage's `shopify.app*.toml`. Free of Alchemy, so the dev bins
 * read it without loading the stack.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as Schema from "effect/Schema";

import { AppHandle } from "./bindings.ts";

const decodeAppHandle = Schema.decodeUnknownSync(AppHandle);

/** A Shopify app's client ID, the toml's `client_id`, which is its API key: 32 hex digits. */
const ClientId = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9a-f]{32}$/u));
const decodeClientId = Schema.decodeUnknownSync(ClientId);

export const pathOf = (tomlPath: string | URL): string =>
  tomlPath instanceof URL ? fileURLToPath(tomlPath) : tomlPath;

/** An app's public identity, as its stage's `shopify.app*.toml` writes it. */
export interface AppIdentity {
  /** The top-level `handle`. */
  readonly handle: string;
  /** The top-level `client_id`, which Shopify calls the app's API key. */
  readonly apiKey: string;
}

/**
 * The public identity of the app the toml at `tomlPath` configures: its top-level `handle` and
 * `client_id`, read from the lines before the first table header. A stage's toml is the one place
 * its app's identity is written, so the stack reads it rather than its environment. Throws,
 * naming the path, when the file is missing or either key is absent or malformed.
 */
export const readAppIdentity = (tomlPath: string | URL): AppIdentity => {
  const where = pathOf(tomlPath);
  let contents: string;
  try {
    contents = readFileSync(tomlPath, "utf8");
  } catch (cause) {
    throw new Error(`readAppIdentity: cannot read ${where}`, { cause });
  }
  const values = new Map<string, string>();
  for (const raw of contents.split("\n")) {
    const line = raw.replace(/#.*$/u, "").trim();
    if (line.startsWith("[")) break;
    const match = /^(?<key>handle|client_id)\s*=\s*"(?<value>[^"]*)"$/u.exec(line)?.groups;
    if (match?.key !== undefined && match.value !== undefined) values.set(match.key, match.value);
  }
  const value = (key: string) => {
    const found = values.get(key);
    if (found === undefined) throw new Error(`readAppIdentity: ${where} has no top-level ${key}`);
    return found;
  };
  return { handle: decodeAppHandle(value("handle")), apiKey: decodeClientId(value("client_id")) };
};
