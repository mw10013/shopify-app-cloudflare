import * as Cloudflare from "@alchemy.run/cloudflare";

export const Database = Cloudflare.D1.Database("Database", {
  migrations: "./migrations",
  readReplication: { mode: "disabled" },
});

export const Email = Cloudflare.Email.SendEmail("Email");

export const SignInLimit = Cloudflare.RateLimit("SignInLimit", {
  namespaceId: 2001, // any stable integer, unique per limiter in the account
  simple: { limit: 5, period: 60 },
});
