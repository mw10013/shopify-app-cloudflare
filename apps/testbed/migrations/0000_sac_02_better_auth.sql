-- @mw10013/shopify-app-cloudflare: Better Auth's tables for site sign-in, as Better Auth 1.7 lays
-- them out for the package's plugins (email OTP and admin). Shipped by the package; an app keeps a
-- byte-identical copy in its own migrations/ folder, which `expectMigrationsSynced` checks.
--
-- Better Auth owns the rows and stores instants as ISO text and booleans as 0 or 1. An admin is a
-- user row whose role is 'admin', written by the stage's auth seed; sign-in never writes one.

create table if not exists user (
  id text not null primary key,
  name text not null,
  email text not null unique,
  emailVerified integer not null,
  image text,
  createdAt date not null,
  updatedAt date not null,
  role text,
  banned integer,
  banReason text,
  banExpires date
);

create table if not exists session (
  id text not null primary key,
  expiresAt date not null,
  token text not null unique,
  createdAt date not null,
  updatedAt date not null,
  ipAddress text,
  userAgent text,
  userId text not null references user (id) on delete cascade,
  impersonatedBy text
);

create index if not exists session_userId_idx on session (userId);

create table if not exists account (
  id text not null primary key,
  accountId text not null,
  providerId text not null,
  userId text not null references user (id) on delete cascade,
  accessToken text,
  refreshToken text,
  idToken text,
  accessTokenExpiresAt date,
  refreshTokenExpiresAt date,
  scope text,
  password text,
  createdAt date not null,
  updatedAt date not null
);

create index if not exists account_userId_idx on account (userId);

create table if not exists verification (
  id text not null primary key,
  identifier text not null,
  value text not null,
  expiresAt date not null,
  createdAt date not null,
  updatedAt date not null
);

create index if not exists verification_identifier_idx on verification (identifier);
