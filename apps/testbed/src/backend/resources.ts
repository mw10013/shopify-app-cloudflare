import * as Cloudflare from "@alchemy.run/cloudflare";

/**
 * The testbed's D1 database: the package's tables (`0000_sac_*`, copied byte for byte), the
 * `AppInstallation` row and Better Auth's, and the testbed's own tables after them.
 */
export const Database = Cloudflare.D1.Database("Database", {
  migrations: "./migrations",
  readReplication: { mode: "disabled" },
});

/** The Email Service binding sign-in codes are mailed through on the stages that mail them. */
export const Email = Cloudflare.Email.SendEmail("Email");

/** Sign-in code requests per client IP and per address (`SignInLimiter`). */
export const SignInLimit = Cloudflare.RateLimit("SignInLimit", {
  namespaceId: 2001, // any stable integer, unique per limiter in the account
  simple: { limit: 5, period: 60 },
});
