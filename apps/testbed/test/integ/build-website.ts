import { execFileSync } from "node:child_process";

/**
 * Integ's global setup: `vp build`, so `website-stack.ts` serves this checkout's Website as
 * production does, from `dist/server/server.js`. Vitest's own variables are left out, so the
 * build sees no `NODE_ENV=test`.
 */
export default function setup() {
  const { NODE_ENV: _nodeEnv, VITEST: _vitest, VITEST_MODE: _vitestMode, ...env } = process.env;
  execFileSync("vp", ["build"], { cwd: `${import.meta.dirname}/../..`, env, stdio: "inherit" });
}
