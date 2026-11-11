import {
  AdminRefusal,
  AdminShopData,
  AdminShopRequest,
  AppInstallationRedactedPage,
  AppInstallationsPageRequest,
  DestroyOrphanRequest,
  OrphanInstalledError,
  OrphanShopActorObjectsData,
  ShopActorObjectsData,
  ShopActorObjectsRequest,
  ShopifyUnavailableError,
  SignInCodeRequest,
  UnauthorizedError,
} from "@mw10013/shopify-app-cloudflare/contract";
import { requestInfoOf, rescue, signInCodeResult } from "@mw10013/shopify-app-cloudflare/website";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import * as Match from "effect/Match";
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

const rescueAdmin = (path: string) =>
  rescue(AdminRefusal, (refusal) =>
    Match.valueTags(refusal, {
      UnauthorizedError: () => {
        throw redirect({ to: "/admin/sign-in", search: { redirect: path } });
      },
      ForbiddenError: () => {
        throw new Error("This page is for admins only.");
      },
    }),
  );

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
      .catch(rescueAdmin("/admin/shop-actor-objects")),
  );

export const listOrphanShopActorObjects = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ShopActorObjectsRequest))
  .handler(({ data }) =>
    backend()
      .orphanShopActorObjects(requestInfo(), data)
      .then(decodeOrphanShopActorObjectsData)
      .catch(rescueAdmin("/admin/orphan-shop-actor-objects")),
  );

export const destroyOrphan = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DestroyOrphanRequest))
  .handler(({ data }) =>
    backend()
      .destroyOrphan(requestInfo(), data)
      .then(() => null)
      .catch(rescue(OrphanInstalledError, () => ({ _tag: "OrphanInstalledError" as const })))
      .catch(rescueAdmin("/admin/orphan-shop-actor-objects")),
  );

export const listAppInstallations = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(AppInstallationsPageRequest))
  .handler(({ data }) =>
    backend()
      .appInstallationsPage(requestInfo(), data)
      .then(decodeAppInstallationRedactedPage)
      .catch(rescueAdmin("/admin/shops")),
  );

export const getAdminShop = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(AdminShopRequest))
  .handler(({ data }) =>
    backend()
      .adminShop(requestInfo(), data)
      .then(decodeAdminShopData)
      .catch(rescueAdmin(`/admin/shop/${data.shop}`)),
  );

/** Answers `null` once the plan was re-read, else the sentence the Overview shows. */
export const refreshPlan = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(AdminShopRequest))
  .handler(({ data }) =>
    backend()
      .refreshPlan(requestInfo(), data)
      .then(() => null)
      .catch(rescue(ShopifyUnavailableError, ({ message }) => message))
      .catch(rescueAdmin(`/admin/shop/${data.shop}`)),
  );
