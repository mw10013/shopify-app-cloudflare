import * as Effect from "effect/Effect";

import type { AppInstallationStore } from "./app-installation-store.ts";
import type { ShopDomain } from "./domain.ts";
import { bestEffort, type ShopifyHooksShape } from "./hooks.ts";

export const uninstallShop = (
  installations: AppInstallationStore["Service"],
  hooks: ShopifyHooksShape,
) =>
  Effect.fnUntraced(function* (shop: ShopDomain) {
    yield* bestEffort("beforeUninstall", shop, hooks.beforeUninstall(shop));
    yield* installations.delete(shop);
    yield* hooks.afterUninstall(shop);
  });
