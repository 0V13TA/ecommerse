create extension if not exists pgcrypto;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 180),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  sku text unique,
  price_minor bigint not null check (price_minor > 0),
  currency char(3) not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  stock_on_hand integer not null default 0 check (stock_on_hand >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  is_available boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_id_idx on public.products(category_id);
create index products_storefront_idx on public.products(is_available, created_at desc)
  where archived_at is null;
create index products_low_stock_idx on public.products(stock_on_hand, low_stock_threshold)
  where archived_at is null;

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  alt_text text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index product_images_product_sort_idx on public.product_images(product_id, sort_order);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (char_length(email) <= 254),
  first_name text not null,
  last_name text not null,
  phone text not null,
  address text not null,
  city text not null,
  country text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_reference text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  customer_email text not null,
  customer_first_name text not null,
  customer_last_name text not null,
  customer_phone text not null,
  shipping_address text not null,
  shipping_city text not null,
  shipping_country text not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  order_status text not null default 'pending_payment'
    check (order_status in ('pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'success', 'failed', 'abandoned', 'reconciliation_required')),
  reserved_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_created_at_idx on public.orders(created_at desc);
create index orders_order_status_created_idx on public.orders(order_status, created_at desc);
create index orders_payment_status_created_idx on public.orders(payment_status, created_at desc);
create index orders_customer_email_idx on public.orders(customer_email);
create index orders_expiring_reservations_idx on public.orders(reserved_until)
  where order_status = 'pending_payment';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_sku text,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items(order_id);
create index order_items_product_id_idx on public.order_items(product_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider = 'paystack'),
  reference text not null unique,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed', 'abandoned', 'reconciliation_required')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_id_idx on public.payments(order_id);
create index payments_status_created_idx on public.payments(status, created_at desc);

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, product_id)
);

create index inventory_reservations_product_active_idx
  on public.inventory_reservations(product_id, expires_at)
  where status = 'active';
create index inventory_reservations_expiry_idx
  on public.inventory_reservations(expires_at)
  where status = 'active';

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.admin_users enable row level security;

revoke all on public.categories, public.products, public.product_images, public.customers,
  public.orders, public.order_items, public.payments, public.inventory_reservations,
  public.admin_users from anon, authenticated;
grant select, insert, update, delete on public.categories, public.products, public.product_images,
  public.customers, public.orders, public.order_items, public.payments,
  public.inventory_reservations, public.admin_users to service_role;
