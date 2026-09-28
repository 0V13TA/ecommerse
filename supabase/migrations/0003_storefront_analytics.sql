alter table public.orders
  add column analytics_session_id uuid,
  add column checkout_expired_at timestamptz;

create index orders_analytics_session_created_idx
  on public.orders(analytics_session_id, created_at desc)
  where analytics_session_id is not null;
create index orders_checkout_expired_idx
  on public.orders(checkout_expired_at)
  where checkout_expired_at is not null;

alter table public.payments
  add column initialized_at timestamptz,
  add column cancelled_at timestamptz;

create index payments_initialized_at_idx
  on public.payments(initialized_at)
  where initialized_at is not null;
create index payments_cancelled_at_idx
  on public.payments(cancelled_at)
  where cancelled_at is not null;

create table public.storefront_analytics_events (
  event_id uuid primary key,
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null
    check (event_name in ('product_view', 'add_to_cart', 'remove_from_cart', 'cart_view', 'checkout_started')),
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now()
);

create index storefront_analytics_events_name_created_idx
  on public.storefront_analytics_events(event_name, created_at desc);
create index storefront_analytics_events_created_idx
  on public.storefront_analytics_events(created_at desc);
create index storefront_analytics_events_product_name_created_idx
  on public.storefront_analytics_events(product_id, event_name, created_at desc)
  where product_id is not null;
create index storefront_analytics_events_session_created_idx
  on public.storefront_analytics_events(session_id, created_at desc);

alter table public.storefront_analytics_events enable row level security;
revoke all on public.storefront_analytics_events from anon, authenticated;
grant select, insert, update, delete on public.storefront_analytics_events to service_role;
