/** The GDPR/CPRA compliance topics, which every app subscribes for App Store review. */
export const COMPLIANCE_TOPICS = [
  "customers/data_request",
  "customers/redact",
  "shop/redact",
] as const;

/**
 * The topics the package answers itself, in the header's form. An app's definition may not
 * name one.
 */
export const BUILT_IN_TOPICS = [
  ...COMPLIANCE_TOPICS,
  "app/scopes_update",
  "app/uninstalled",
] as const;
export type BuiltInTopic = (typeof BUILT_IN_TOPICS)[number];
