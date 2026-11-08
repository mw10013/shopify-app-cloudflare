// src/internal/webhook-topics.ts
/**
* The webhook topics the package answers itself, apart from `Webhooks` so the end-to-end spec
* pack names them without loading the Backend.
*
* @module
*/
/** The GDPR/CPRA compliance topics, which every app subscribes for App Store review. */
const COMPLIANCE_TOPICS = [
	"customers/data_request",
	"customers/redact",
	"shop/redact"
];
/**
* The topics the package answers itself, in the header's form. An app's definition may not
* name one.
*/
const BUILT_IN_TOPICS = [
	...COMPLIANCE_TOPICS,
	"app/scopes_update",
	"app/uninstalled"
];
export { BUILT_IN_TOPICS, COMPLIANCE_TOPICS };
