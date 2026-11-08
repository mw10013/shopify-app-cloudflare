import { toRpcAsync } from "@alchemy.run/cloudflare/Bridge";

import type Backend from "#backend/worker.ts";

import { env } from "./env.server.ts";

/**
 * The Backend through the service binding, read at call time; see `env`. A declared failure
 * rejects the call as its plain `{ _tag, ...fields }`; any other as an `Error` with its message.
 */
export const backend = () => toRpcAsync<Backend>(env.BACKEND);
