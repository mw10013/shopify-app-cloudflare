/**
 * The Website's React half: the shop socket's holder and banners, the live route helpers over the
 * app's router and actor client, and the orphan sweep's admin pages. Needs the optional peers `react`, `@tanstack/react-router`
 * and `@effect/atom-react`.
 *
 * @module
 */

export {
  keepLastAnswer,
  type LiveClient,
  type LiveRead,
  makeLiveReads,
  makeLiveRoutes,
  reloadFromServer,
  rereadFailedAtom,
  rereadRoute,
  STALE_ON_NOTICE_ONLY,
} from "#internal/live-route.ts";
export {
  type DestroyOutcome,
  OrphanShopActorObjectsPage,
  type OrphanShopActorObjectsPageProps,
  ShopActorObjectsPage,
  type ShopActorObjectsPageProps,
  type ShopActorObjectsSearch,
} from "#internal/shop-actor-objects-pages.tsx";
export {
  SignInPage,
  type SignInPageProps,
  SignOutButton,
  signOut,
  verifySignInCode,
  type VerifyCodeResult,
} from "#internal/site-sign-in.tsx";
export {
  RereadFailedBanner,
  type SocketCredential,
  ShopSocket,
  SocketBanner,
} from "#internal/shop-socket.tsx";
