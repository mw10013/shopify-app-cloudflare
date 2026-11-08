-- @mw10013/shopify-app-workers: when the app was installed on the shop. The insert of a shop's
-- row (its first token exchange, or the first after an uninstall deleted the row) stamps it; an
-- exchange on an existing row leaves it. Null on a row a previous package version inserted.

alter table AppInstallation add column installedAt integer;
