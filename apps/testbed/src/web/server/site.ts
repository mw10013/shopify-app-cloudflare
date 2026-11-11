import {
  AdminShopData,
  AdminShopRequest,
  AppInstallationRedactedPage,
  AppInstallationsPageRequest,
  DestroyOrphanRequest,
  ForbiddenError,
  OrphanInstalledError,
  OrphanShopActorObjectsData,
  ShopActorObjectsData,
  ShopActorObjectsRequest,
  ShopifyUnavailableError,
  SignInCodeRequest,
  UnauthorizedError,
} from "@mw10013/shopify-app-cloudflare/contract";
import { requestInfoOf, rescue, signInCodeResult } from "@mw10013/shopify-app-cloudflare/website";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import * as Schema from "effect/Schema";

import { backend } from "./backend.ts";

const requestInfo = () => requestInfoOf(getRequest());

export const requestSignInCode = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SignInCodeRequest))
  .handler(({ data }) => signInCodeResult(backend().requestSignInCode(requestInfo(), data)));

export const getSignedInUser = createServerFn({ method: "GET" }).handler(() =>
  backend()
    .signedInUser(requestInfo())
    .catch(rescue(UnauthorizedError, () => null)),
);

const rescueAdmin = rescue(ForbiddenError, () => {
  throw new Error("This page is for admins only.");
});

const decodeAppInstallationRedactedPage = Schema.decodeSync(AppInstallationRedactedPage);
const decodeAdminShopData = Schema.decodeSync(AdminShopData);
const decodeShopActorObjectsData = Schema.decodeSync(ShopActorObjectsData);
const decodeOrphanShopActorObjectsData = Schema.decodeSync(OrphanShopActorObjectsData);

export const listShopActorObjects = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ShopActorObjectsRequest))
  .handler(({ data }) =>
    backend()
      .shopActorObjects(requestInfo(), data)
      .then(decodeShopActorObjectsData)
      .catch(rescueAdmin),
  );

export const listOrphanShopActorObjects = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ShopActorObjectsRequest))
  .handler(({ data }) =>
    backend()
      .orphanShopActorObjects(requestInfo(), data)
      .then(decodeOrphanShopActorObjectsData)
      .catch(rescueAdmin),
  );

export const destroyOrphan = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DestroyOrphanRequest))
  .handler(({ data }) =>
    backend()
      .destroyOrphan(requestInfo(), data)
      .then(() => null)
      .catch(rescue(OrphanInstalledError, () => ({ _tag: "OrphanInstalledError" as const })))
      .catch(rescueAdmin),
  );

export const listAppInstallations = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(AppInstallationsPageRequest))
  .handler(({ data }) =>
    backend()
      .appInstallationsPage(requestInfo(), data)
      .then(decodeAppInstallationRedactedPage)
      .catch(rescueAdmin),
  );

export const getAdminShop = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(AdminShopRequest))
  .handler(({ data }) =>
    backend().adminShop(requestInfo(), data).then(decodeAdminShopData).catch(rescueAdmin),
  );

/** Answers `null` once the plan was re-read, else the sentence the Overview shows. */
export const refreshPlan = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AdminShopRequest))
  .handler(({ data }) =>
    backend()
      .refreshPlan(requestInfo(), data)
      .then(() => null)
      .catch(rescue(ShopifyUnavailableError, ({ message }) => message))
      .catch(rescueAdmin),
  );
