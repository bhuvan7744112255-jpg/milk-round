-- Milk Round — production schema
-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).
--
-- Architecture note: every table has Row Level Security enabled with NO policies,
-- meaning the anon/public key can read or write nothing directly. All real access
-- goes through the Vercel serverless functions in /api, which use the Supabase
-- SERVICE ROLE key (server-side only, never shipped to a browser) and enforce
-- authorization in code (see lib/session.js + each /api handler). This is simpler
-- to get right for a small team than hand-written RLS policies per role, and keeps
-- every secret off the client. If you outgrow this, RLS policies can be layered on
-- top later without changing the table shapes below.

create extension if not exists "pgcrypto";

-- ── Zones ────────────────────────────────────────────────────────────────
create table zones (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  pincode                   text,
  hub_lat                   double precision not null,
  hub_lng                   double precision not null,
  instant_delivery_enabled  boolean not null default false,
  created_at                timestamptz not null default now()
);

-- ── Products ─────────────────────────────────────────────────────────────
create table products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  pack_size        text,
  price            numeric(10,2) not null,
  discount_pct     numeric(5,2) not null default 0,
  discount_active  boolean not null default false,
  banner_text      text,
  created_at       timestamptz not null default now()
);

-- ── Inventory (per zone, per product, per day) ──────────────────────────
create table inventory (
  zone_id        uuid not null references zones(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  date           date not null,
  qty_available  integer not null default 0,
  primary key (zone_id, product_id, date)
);

-- ── Delivery partners ────────────────────────────────────────────────────
create table delivery_partners (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text not null unique,
  zone_ids        uuid[] not null default '{}',
  active_zone_id  uuid references zones(id),
  status          text not null default 'active' check (status in ('active','inactive')),
  created_at      timestamptz not null default now()
);

-- ── Customers ────────────────────────────────────────────────────────────
create table customers (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  phone         text not null unique,
  address_text  text,
  lat           double precision,
  lng           double precision,
  zone_id       uuid references zones(id),
  created_at    timestamptz not null default now()
);

-- ── Subscriptions ────────────────────────────────────────────────────────
-- pending_* columns implement §5.1: a mid-cycle quantity/plan change is staged
-- here and only applied when the current paid cycle finishes (days_remaining
-- hits 0 and the customer pays to renew).
create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers(id) on delete cascade,
  product_id         uuid not null references products(id),
  zone_id            uuid not null references zones(id),
  plan               text not null check (plan in ('Daily','Weekly','Monthly')),
  qty_per_day        integer not null default 1,
  cycle_days         integer not null,
  days_remaining     integer not null default 0,
  status             text not null default 'Active' check (status in ('Active','Paused','Cancelled')),
  pending_plan       text check (pending_plan in ('Daily','Weekly','Monthly')),
  pending_qty_per_day integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (customer_id, product_id)
);

-- ── Orders ───────────────────────────────────────────────────────────────
-- items: [{product_id, name, qty, price, delivered}]
create table orders (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references customers(id),
  zone_id               uuid not null references zones(id),
  date                  date not null default current_date,
  items                 jsonb not null,
  status                text not null default 'Pending'
                          check (status in ('Pending','Delivered','Partially Delivered','Not Delivered')),
  instant               boolean not null default false,
  payment_method        text check (payment_method in ('wallet','razorpay')),
  delivery_partner_id   uuid references delivery_partners(id),
  not_delivered_reason  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index orders_zone_date_status_idx on orders (zone_id, date, status);
create index orders_customer_date_idx on orders (customer_id, date);

-- ── Wallets ──────────────────────────────────────────────────────────────
create table wallets (
  customer_id  uuid primary key references customers(id) on delete cascade,
  balance      numeric(10,2) not null default 0
);

-- ── Wallet transactions ──────────────────────────────────────────────────
create table wallet_transactions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  date         timestamptz not null default now(),
  type         text not null check (type in ('credit','debit')),
  amount       numeric(10,2) not null,
  note         text
);

-- ── Exceptions (delivery failure log) ───────────────────────────────────
create table exceptions (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  customer_id  uuid references customers(id),
  zone_id      uuid references zones(id),
  order_id     uuid references orders(id),
  reason       text
);

-- ── OTP audit (optional but useful — request ids / rate-limit trail) ────
create table otp_requests (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  role        text not null check (role in ('customer','partner','admin')),
  created_at  timestamptz not null default now()
);

-- Lock every table down: RLS on, zero policies, so only the service-role
-- key (used exclusively by the /api backend) can touch these tables.
alter table zones enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table delivery_partners enable row level security;
alter table customers enable row level security;
alter table subscriptions enable row level security;
alter table orders enable row level security;
alter table wallets enable row level security;
alter table wallet_transactions enable row level security;
alter table exceptions enable row level security;
alter table otp_requests enable row level security;

-- ── Seed: Hyderabad launch zone (edit or delete before going live) ─────
insert into zones (name, pincode, hub_lat, hub_lng, instant_delivery_enabled)
values ('Jubilee Hills', '500033', 17.4326, 78.4071, true);

insert into products (name, pack_size, price, discount_pct, discount_active, banner_text)
values
  ('Full Cream Milk', '500 ml', 32.00, 0, false, null),
  ('Toned Milk', '500 ml', 26.00, 10, true, 'Introductory offer — 10% off Toned Milk this week'),
  ('Curd', '400 g', 40.00, 0, false, null);
