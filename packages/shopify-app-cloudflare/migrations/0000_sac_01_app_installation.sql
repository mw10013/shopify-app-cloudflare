-- @mw10013/shopify-app-cloudflare: the AppInstallation table. Shipped by the package; an app keeps a
-- byte-identical copy in its own migrations/ folder, which `expectMigrationsSynced` checks.
--
-- The contract an app builds on: the table is named AppInstallation, its primary key is `shop`,
-- and nothing in the package deletes a row but `app/uninstalled`. An app's own table whose rows
-- go with the shop references it:
--
--   shop text not null references AppInstallation (shop) on delete cascade
--
-- The package never writes this table with `insert or replace`: a replace is a delete, and the
-- delete cascades.
--
-- Forward only, expand before contract. A later package migration only adds a nullable or
-- defaulted column or an index, so the previous app version still works against the new schema
-- (a Workers rollback does not revert D1).
--
-- An app adopting the package starts from a fresh database, or first brings its own
-- AppInstallation table to exactly the columns below, so the later package migrations apply.
-- `if not exists` does not reconcile an existing table: over an older one missing a column it
-- creates nothing and adds nothing, and the package then fails on the first query of that column.
--
-- Instants are integers of epoch milliseconds. Apps never add columns here: their per-shop data
-- lives in their own tables.
--
-- `installedAt` is when the app was installed on the shop. The insert of a shop's row (its first
-- token exchange, or the first after an uninstall deleted the row) stamps it; an exchange on an
-- existing row leaves it.

create table if not exists AppInstallation (
  shop text primary key,
  shopGid text not null,
  scope text,
  accessToken text,
  accessTokenExpiresAt integer,
  planHandle text,
  planHandleExpiresAt integer,
  planBoundaryAt integer,
  installedAt integer
);
