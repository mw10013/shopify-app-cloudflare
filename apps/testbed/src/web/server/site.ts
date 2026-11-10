/**
 * The admin side's server functions: TanStack Start's wrappers around the package's sign-in and
 * the Backend's admin methods, which the package's admin gate guards. The Website only turns a
 * signed-out answer into the sign-in page.
 *
 * @module
 */

import {
  AdminRefusal,
  DestroyOrphanRequest,
  OrphanInstalledError,
  OrphanShopActorObjectsData,
  ShopActorObjectsData,
  ShopActorObjectsRequest,
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

/** The sign-in page's code request (`BACKEND.requestSignInCode`). */
export const requestSignInCode = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(SignInCodeRequest))
  .handler(({ data }) => signInCodeResult(backend().requestSignInCode(requestInfo(), data)));

/** The signed-in user, or null when signed out (`BACKEND.signedInUser`). */
export const getSignedInUser = createServerFn({ method: "GET" }).handler(() =>
  backend()
    .signedInUser(requestInfo())
    .catch(rescue(UnauthorizedError, () => null)),
);

/**
 * The admin gate's refusals as the Website answers them: signed out goes to sign-in and back to
 * `path`; anyone else is shown that the page is for admins.
 */
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

/** Destroy, as POST: `null` when destroyed, the refusal as data when the shop was installed again. */
export const destroyOrphan = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DestroyOrphanRequest))
  .handler(({ data }) =>
    backend()
      .destroyOrphan(requestInfo(), data)
      .then(() => null)
      .catch(rescue(OrphanInstalledError, () => ({ _tag: "OrphanInstalledError" as const })))
      .catch(rescueAdmin("/admin/orphan-shop-actor-objects")),
  );
