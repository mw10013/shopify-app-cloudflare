-- The testbed's own table: a note per shop, which goes with the shop's AppInstallation row by
-- cascade on `app/uninstalled`. It exists to prove an app table cascades from the package's.

create table if not exists TestbedNote (
  id integer primary key,
  shop text not null references AppInstallation (shop) on delete cascade,
  body text not null,
  createdAt integer not null
);

create index if not exists TestbedNote_shop on TestbedNote (shop);
