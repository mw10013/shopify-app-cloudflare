/**
 * The Website's React half: the shop socket's holder and banners, the live route helpers over the
 * app's router and actor client, and the admin section's route options (its layout, home, Shops
 * pages and the orphan sweep's pages). Needs the optional peers `react`, `@tanstack/react-router`
 * and `@effect/atom-react`.
 *
 * @module
 */

export { Field, Fields, Instant } from "#internal/admin-fields.tsx";
export {
  adminShop,
  adminShopOverview,
  adminShops,
  adminShopsList,
} from "#internal/admin-pages.tsx";
export {
  AdminLink,
  AdminLinkButton,
  type AdminPage,
  type AdminTab,
  adminHome,
  adminLayout,
  type ServerCall,
} from "#internal/admin-section.tsx";
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
  adminOrphanShopActorObjects,
  adminShopActorObjects,
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
