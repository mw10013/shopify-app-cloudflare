import * as Cloudflare from "@alchemy.run/cloudflare";

/**
 * The testbed's D1 database: the package's `AppInstallation` table (`0000_sac_*`, copied byte for
 * byte) and the testbed's own tables after it.
 */
export const Database = Cloudflare.D1.Database("Database", {
  migrations: "./migrations",
  readReplication: { mode: "disabled" },
});
