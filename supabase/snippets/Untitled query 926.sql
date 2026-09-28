begin;

insert into public.categories (name, slug, description)
values
  ('Home & Living', 'home-living', 'Useful pieces for home and everyday routines.'),
  ('Accessories', 'accessories', 'Everyday carry and personal accessories.'),
  ('Stationery', 'stationery', 'Paper goods for notes, plans, and ideas.')
on conflict (slug) do nothing;

insert into public.products (
  category_id,
  name,
  slug,
  description,
  sku,
  price_minor,
  currency,
  stock_on_hand,
  low_stock_threshold,
  is_available
)
select
  c.id,
  demo.name,
  demo.slug,
  demo.description,
  demo.sku,
  demo.price_minor,
  'NGN',
  demo.stock_on_hand,
  demo.low_stock_threshold,
  true
from (
  values
    ('home-living', 'Ceramic Coffee Mug', 'ceramic-coffee-mug',
     'A simple ceramic mug for your daily coffee or tea.', 'DEMO-MUG-001', 850000, 18, 5),
    ('home-living', 'Insulated Water Bottle', 'insulated-water-bottle',
     'A reusable bottle for hot or cold drinks on the go.', 'DEMO-BOTTLE-001', 1450000, 2, 5),
    ('accessories', 'Everyday Canvas Tote', 'everyday-canvas-tote',
     'A durable canvas tote for errands and everyday carry.', 'DEMO-TOTE-001', 1200000, 12, 4),
    ('accessories', 'Cotton Baseball Cap', 'cotton-baseball-cap',
     'A comfortable cotton cap with an adjustable strap.', 'DEMO-CAP-001', 1750000, 8, 3),
    ('stationery', 'Pocket Notebook Set', 'pocket-notebook-set',
     'A set of three pocket notebooks for notes and lists.', 'DEMO-NOTEBOOK-001', 650000, 24, 6),
    ('stationery', 'Weekly Desk Planner', 'weekly-desk-planner',
     'An undated weekly planner for organizing your schedule.', 'DEMO-PLANNER-001', 950000, 0, 5)
) as demo(category_slug, name, slug, description, sku, price_minor, stock_on_hand, low_stock_threshold)
join public.categories c on c.slug = demo.category_slug
on conflict (slug) do nothing;

commit;
