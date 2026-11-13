import { execFileSync } from "node:child_process";

/** Vitest's own variables are left out, so the build sees no `NODE_ENV=test`. */
export default function setup() {
  const { NODE_ENV: _nodeEnv, VITEST: _vitest, VITEST_MODE: _vitestMode, ...env } = process.env;
  execFileSync("vp", ["build"], { cwd: `${import.meta.dirname}/../..`, env, stdio: "inherit" });
}
