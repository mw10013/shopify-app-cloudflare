/**
 * The Website's React half: the shop socket's holder and banners, and the live route helpers over
 * the app's router and actor client. Needs the optional peers `react`, `@tanstack/react-router`
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
export { RereadFailedBanner, ShopSocket, SocketBanner } from "#internal/shop-socket.tsx";
