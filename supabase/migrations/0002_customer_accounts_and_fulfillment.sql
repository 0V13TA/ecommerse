alter table public.customers
  add column user_id uuid unique references auth.users(id) on delete set null,
  add column avatar_path text,
  add column avatar_url text;

alter table public.orders drop constraint if exists orders_order_status_check;
update public.orders
   set order_status = 'received'
 where order_status = 'confirmed';

alter table public.orders
  add constraint orders_order_status_check
  check (order_status in ('pending_payment', 'received', 'processing', 'shipped', 'delivered', 'cancelled'));

create index orders_customer_created_idx on public.orders(customer_id, created_at desc);
