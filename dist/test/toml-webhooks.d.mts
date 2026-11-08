/**
 * `readWebhooks`: the webhook subscriptions of a `shopify.app.toml`, apart from
 * `expectTomlMatches` so the end-to-end spec pack reads them without loading the Backend.
 *
 * @module
 */
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
/**
 * Reads `[webhooks] api_version` and each `[[webhooks.subscriptions]]`'s `uri`, `topics` and
 * `compliance_topics` from a `shopify.app.toml`: the subset of TOML Shopify CLI writes there,
 * string values and arrays of strings, an array allowed to span lines.
 */
export declare const readWebhooks: (toml: string) => TomlWebhooks;