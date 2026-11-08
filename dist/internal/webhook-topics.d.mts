/**
 * The topics the package answers itself, in the header's form. An app's definition may not
 * name one.
 */
export declare const BUILT_IN_TOPICS: readonly ["customers/data_request", "customers/redact", "shop/redact", "app/scopes_update", "app/uninstalled"];
export type BuiltInTopic = (typeof BUILT_IN_TOPICS)[number];