import type { BrowserContext, Request } from "playwright";

const routed = new WeakSet<BrowserContext>();

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string | Buffer;
}

const escapeAttribute = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/**
 * The app's `answer` to a GET navigation, with a redirect within the tunnel's origin sent as a
 * refresh. Chromium follows a redirect that a route fulfills on the network, never through the
 * route, so the hop would reach the tunnel itself, whose hostname a fresh quick tunnel does not
 * resolve for its first minute or so. A refresh is a navigation of its own, which the route answers.
 */
const followLocally = (request: Request, answer: Answer, tunnel: URL): Answer => {
  const location = answer.headers.location;
  if (answer.status < 300 || answer.status > 399 || location === undefined) return answer;
  if (!request.isNavigationRequest() || request.method() !== "GET") return answer;
  const target = new URL(location, request.url());
  if (target.origin !== tunnel.origin) return answer;
  const { location: _, "content-length": __, ...headers } = answer.headers;
  return {
    status: 200,
    headers: { ...headers, "content-type": "text/html" },
    body: `<meta http-equiv="refresh" content="0;url=${escapeAttribute(target.href)}">`,
  };
};

/**
 * Answers `context`'s requests for the app at `server`'s tunnel from the app's local port. The
 * browser runs on this machine, so the tunnel is only for Shopify's servers (webhooks); a dev load
 * is about 240 module requests, and through a quick tunnel each takes 0.2 to 1 s and every one past
 * 200 in flight is a 429 (developers.cloudflare.com/tunnel/get-started/quick-tunnels). The page
 * keeps the tunnel's URL, so its origin and cookies do not change, and the Host and forwarding
 * headers stay the tunnel's, so the app builds its URLs as it would behind the tunnel. The app's
 * redirects within the tunnel are followed from the local port too ({@link followLocally}). A
 * request is retried once on ECONNRESET, as Chrome retries one sent on a keep-alive connection the
 * server just closed, and a request that still fails fails in the page instead of throwing in the
 * test.
 * Shopify CLI's own `/extensions` path and WebSockets still go through the tunnel: the CLI does
 * not tell the app its proxy's port, so only the app's own server is reached directly.
 */
export const routeAppToLocal = async (
  context: BrowserContext,
  server: { readonly port: number; readonly tunnel: string },
): Promise<void> => {
  if (routed.has(context)) return;
  routed.add(context);
  const tunnel = new URL(server.tunnel);
  const local = `http://localhost:${String(server.port)}`;
  await context.route(
    (url) => url.origin === tunnel.origin && !url.pathname.startsWith("/extensions"),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const fetched = await route
        .fetch({
          url: `${local}${url.pathname}${url.search}`,
          headers: {
            ...request.headers(),
            host: tunnel.host,
            "x-forwarded-host": tunnel.host,
            "x-forwarded-proto": "https",
          },
          maxRedirects: 0,
          maxRetries: 1,
        })
        .then(async (response) =>
          followLocally(
            request,
            { status: response.status(), headers: response.headers(), body: await response.body() },
            tunnel,
          ),
        )
        .catch(() => undefined);
      // The body is read here because `fulfill({ response })` sends Playwright a reference to it,
      // which closing the context disposes: a request in flight as a spec's `afterAll` closes the
      // context failed the test with "Fetch response has been disposed". `abort` and `fulfill`
      // themselves are silenced once the page is closed.
      await (fetched === undefined ? route.abort("connectionfailed") : route.fulfill(fetched));
    },
  );
};
