import "../internal/domain.mjs";
import "effect/Schema";
import "effect/Option";
import "effect/Config";
import "effect/Redacted";
/** `GET <path>?shop=<shop>.myshopify.com`: the shop's `E2eShopStatus`. */
export declare const E2E_STATUS_PATH = "/api/e2e/status";
/** `GET <path>`: the `E2eWebhookDeliveries` the Backend answered since it started. */
export declare const E2E_WEBHOOKS_PATH = "/api/e2e/webhooks";