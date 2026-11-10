/**
 * The browser client over the shop actor's WebSocket: connection state, retry by close code, and
 * notices that refresh what the page shows. No React and no router.
 *
 * @module
 */

export {
  applyCloseOutcome,
  type CloseOutcome,
  closeOutcome,
  lostAtom,
  merchantTokenAtom,
  reaskAtom,
  reconnectAtom,
  retryPolicy,
  shopKeyAtom,
  type SocketState,
  socketStateAtom,
} from "#internal/actor-connection.ts";
export {
  type BusNotice,
  type LiveRoutes,
  liveRoutesAtom,
  makeNoticeDispatch,
  makeNoticesAtom,
  nameSocket,
  NOTICE_THROTTLE,
  noticeBus,
  shopActorProtocol,
  type Visibility,
} from "#internal/shop-actor-client.ts";
