import { webhookHandlers } from "@mw10013/shopify-app-cloudflare/website";

import { backend } from "#web/server/backend.ts";
import { env } from "#web/server/env.server.ts";

const webhooks = webhookHandlers(env);

/**
 * The Website's side of the `BACKEND` binding as integ drives it, without TanStack Start, whose
 * dev server a test stack would have to start:
 *
 * - `/webhooks/*` is the package's forward ({@link webhookHandlers}), as the route serves it;
 * - `POST /<method>` with a JSON array of arguments calls that Backend method through the real
 *   binding, as a server function does ({@link backend}), and answers what came back: `Returned` with the value,
 *   `ThrewError` with the message of a thrown `Error`, or `Threw` with any other thrown value as
 *   it arrived.
 */
export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/webhooks/"))
      return request.method === "POST" ? webhooks.POST({ request }) : webhooks.ANY();
    const method = pathname.slice(1);
    const args = await request.json<unknown[]>();
    const methods = backend() as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    return Response.json(
      await methods[method]?.(...args).then(
        (value) => ({ _tag: "Returned", value }),
        (thrown: unknown) =>
          thrown instanceof Error
            ? { _tag: "ThrewError", message: thrown.message }
            : { _tag: "Threw", value: thrown },
      ),
    );
  },
} satisfies ExportedHandler;
