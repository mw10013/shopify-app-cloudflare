import * as Effect from "effect/Effect";

import type { AppInstallationStore } from "./app-installation-store.ts";
import type { ShopDomain } from "./domain.ts";
import { bestEffort, type ShopifyHooksShape } from "./hooks.ts";

/**
 * Erases an installation Shopify has ended: `beforeUninstall`, best effort; the row and its
 * cascade; then `afterUninstall`, whose defect fails the caller so its retry runs it all again.
 */
export const uninstallShop = (
  installations: AppInstallationStore["Service"],
  hooks: ShopifyHooksShape,
) =>
  Effect.fnUntraced(function* (shop: ShopDomain) {
    yield* bestEffort("beforeUninstall", shop, hooks.beforeUninstall(shop));
    yield* installations.delete(shop);
    yield* hooks.afterUninstall(shop);
  });
