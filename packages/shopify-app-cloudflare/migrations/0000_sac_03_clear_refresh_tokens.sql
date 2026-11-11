-- @mw10013/shopify-app-cloudflare: clears the AppInstallation refresh columns. Shipped by the
-- package; an app keeps a byte-identical copy in its own migrations/ folder, which
-- `expectMigrationsSynced` checks.
--
-- Since 0.12.0 every token comes from the application-only grant, which has no refresh token, and
-- a mint writes both columns null. A row the refresh design wrote keeps its refresh token until
-- that shop's next mint. This clears every such row at once.
--
-- The columns stay: migrations are forward only, and a Workers rollback to 0.12.0 still names
-- them. That version never reads them, so clearing them breaks nothing it does.

update AppInstallation set refreshToken = null, refreshTokenExpiresAt = null;
