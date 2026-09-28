import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { asyncHandler, HttpError } from "./errors.js";
import { createCheckout, processPayment } from "./commerce.js";
import { isValidWebhookSignature } from "./paystack.js";
import { requireAdmin } from "./auth.js";
import rateLimit from "express-rate-limit";

const router = Router();
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many checkout attempts. Please try again later." }
});
const storage = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
}).storage;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype)) {
      callback(new HttpError(400, "Only JPEG, PNG, WebP, and AVIF images are allowed"));
      return;
    }
    callback(null, true);
  }
});

const uuid = z.string().uuid();
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24)
});
const checkoutSchema = z.object({
  items: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(50) })).min(1).max(30),
  customer: z.object({
    email: z.string().email().max(254).transform((email) => email.trim().toLowerCase()),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(5).max(40),
    address: z.string().trim().min(3).max(300),
    city: z.string().trim().min(1).max(100),
    country: z.string().trim().min(2).max(100)
  })
});
const productSchema = z.object({
  name: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(10_000).default(""),
  categoryId: uuid.nullable().optional(),
  sku: z.string().trim().max(80).nullable().optional(),
  priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().length(3).default("NGN"),
  stockOnHand: z.number().int().nonnegative().max(1_000_000).default(0),
  lowStockThreshold: z.number().int().nonnegative().max(1_000_000).default(config.LOW_STOCK_DEFAULT),
  isAvailable: z.boolean().default(true)
});
const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(1000).default(""),
  isActive: z.boolean().default(true)
});

router.get("/health", (_req, res) => res.json({ status: "ok" }));

router.get("/categories", asyncHandler(async (_req, res) => {
  const result = await pool.query(
    `select id, name, slug, description from public.categories
      where is_active = true order by name`
  );
  res.json({ categories: result.rows });
}));

router.get("/products", asyncHandler(async (req, res) => {
  const page = pagination.parse(req.query);
  const category = z.string().max(120).optional().parse(req.query.category);
  const search = z.string().trim().max(120).optional().parse(req.query.search);
  const conditions = ["p.is_available = true", "p.archived_at is null", "(p.category_id is null or c.is_active = true)"];
  const values: unknown[] = [];
  if (category) {
    values.push(category);
    conditions.push(`c.slug = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(p.name ilike $${values.length} or p.description ilike $${values.length})`);
  }
  const where = conditions.join(" and ");
  const count = await pool.query<{ count: string }>(
    `select count(*) from public.products p left join public.categories c on c.id = p.category_id where ${where}`,
    values
  );
  const listValues = [...values, page.limit, (page.page - 1) * page.limit];
  const products = await pool.query(
    `select p.id, p.name, p.slug, p.description, p.sku, p.price_minor, p.currency,
            greatest(p.stock_on_hand - coalesce(r.reserved_quantity, 0), 0)::integer as stock_on_hand,
            p.is_available, c.name as category_name, c.slug as category_slug,
            coalesce(json_agg(json_build_object('id', i.id, 'url', i.public_url, 'altText', i.alt_text)
              order by i.sort_order) filter (where i.id is not null), '[]') as images
       from public.products p
       left join public.categories c on c.id = p.category_id
       left join lateral (
         select sum(ir.quantity) as reserved_quantity from public.inventory_reservations ir
          where ir.product_id = p.id and ir.status = 'active' and ir.expires_at > now()
       ) r on true
       left join public.product_images i on i.product_id = p.id
      where ${where}
      group by p.id, c.name, c.slug, r.reserved_quantity
      order by p.created_at desc
      limit $${listValues.length - 1} offset $${listValues.length}`,
    listValues
  );
  res.json({ products: products.rows, page: page.page, limit: page.limit, total: Number(count.rows[0]?.count ?? 0) });
}));

router.get("/products/:slug", asyncHandler(async (req, res) => {
  const result = await pool.query(
    `select p.id, p.name, p.slug, p.description, p.sku, p.price_minor, p.currency,
            greatest(p.stock_on_hand - coalesce(r.reserved_quantity, 0), 0)::integer as stock_on_hand,
            p.is_available, c.name as category_name, c.slug as category_slug,
            coalesce(json_agg(json_build_object('id', i.id, 'url', i.public_url, 'altText', i.alt_text)
              order by i.sort_order) filter (where i.id is not null), '[]') as images
       from public.products p
       left join public.categories c on c.id = p.category_id
       left join lateral (
         select sum(ir.quantity) as reserved_quantity from public.inventory_reservations ir
          where ir.product_id = p.id and ir.status = 'active' and ir.expires_at > now()
       ) r on true
       left join public.product_images i on i.product_id = p.id
      where p.slug = $1 and p.is_available = true and p.archived_at is null
        and (p.category_id is null or c.is_active = true)
      group by p.id, c.name, c.slug, r.reserved_quantity`,
    [z.string().max(200).parse(req.params.slug)]
  );
  const product = result.rows[0];
  if (!product) throw new HttpError(404, "Product not found");
  res.json({ product });
}));

router.post("/checkout", checkoutLimiter, asyncHandler(async (req, res) => {
  const input = checkoutSchema.parse(req.body);
  res.status(201).json(await createCheckout(input.items, input.customer));
}));

router.get("/orders/:orderReference", asyncHandler(async (req, res) => {
  const reference = z.string().regex(/^ORD-[A-F0-9]{32}$/).parse(req.params.orderReference);
  const order = await pool.query(
    `select o.order_reference, o.order_status, o.payment_status, o.currency, o.total_minor,
            o.created_at, o.customer_first_name,
            coalesce(json_agg(json_build_object('productName', oi.product_name,
              'quantity', oi.quantity, 'unitPriceMinor', oi.unit_price_minor)
              order by oi.created_at) filter (where oi.id is not null), '[]') as items
       from public.orders o left join public.order_items oi on oi.order_id = o.id
      where o.order_reference = $1 group by o.id`,
    [reference]
  );
  if (!order.rows[0]) throw new HttpError(404, "Order not found");
  res.json({ order: order.rows[0] });
}));

router.get("/payments/:reference/verify", asyncHandler(async (req, res) => {
  const reference = z.string().regex(/^PAY-[A-F0-9]{32}$/).parse(req.params.reference);
  await processPayment(reference);
  const result = await pool.query(
    `select o.order_reference, o.order_status, o.payment_status
       from public.payments p join public.orders o on o.id = p.order_id where p.reference = $1`,
    [reference]
  );
  if (!result.rows[0]) throw new HttpError(404, "Payment reference not found");
  res.json({ order: result.rows[0] });
}));

router.post("/webhooks/paystack", asyncHandler(async (req, res) => {
  const body = req.body;
  const signature = req.header("x-paystack-signature");
  if (!Buffer.isBuffer(body) || !isValidWebhookSignature(body, signature)) {
    throw new HttpError(401, "Invalid webhook signature");
  }
  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(body.toString("utf8")) as typeof event;
  } catch {
    throw new HttpError(400, "Invalid webhook payload");
  }
  if (event.event === "charge.success" && event.data?.reference) {
    await processPayment(event.data.reference);
  }
  res.sendStatus(200);
}));

router.use("/admin", requireAdmin);

router.get("/admin/dashboard", asyncHandler(async (_req, res) => {
  const [orders, products, recent, sales] = await Promise.all([
    pool.query(
      `select count(*)::integer as total_orders,
        count(*) filter (where order_status in ('pending_payment','confirmed','processing'))::integer as pending_orders,
        count(*) filter (where order_status in ('shipped','delivered'))::integer as completed_orders,
        count(*) filter (where order_status = 'cancelled')::integer as cancelled_orders,
        coalesce(sum(total_minor) filter (where payment_status = 'success'), 0)::text as total_sales
       from public.orders`
    ),
    pool.query(
      `select count(*)::integer as product_count,
        count(*) filter (where stock_on_hand <= low_stock_threshold and archived_at is null)::integer as low_stock_count
       from public.products where archived_at is null`
    ),
    pool.query(
      `select id, order_reference, customer_first_name, customer_last_name, total_minor,
              currency, order_status, payment_status, created_at
         from public.orders order by created_at desc limit 8`
    ),
    pool.query(
      `select date_trunc('day', created_at)::date as date,
              coalesce(sum(total_minor), 0)::text as total_minor,
              count(*)::integer as order_count
         from public.orders
        where payment_status = 'success' and created_at >= now() - interval '30 days'
        group by date_trunc('day', created_at)::date order by date`
    )
  ]);
  res.json({ stats: { ...orders.rows[0], ...products.rows[0] }, recentOrders: recent.rows, salesOverTime: sales.rows });
}));

router.get("/admin/products", asyncHandler(async (req, res) => {
  const page = pagination.parse(req.query);
  const result = await pool.query(
    `select p.*, c.name as category_name,
       coalesce(json_agg(json_build_object('id', i.id, 'url', i.public_url, 'altText', i.alt_text)
         order by i.sort_order) filter (where i.id is not null), '[]') as images
       from public.products p left join public.categories c on c.id = p.category_id
       left join public.product_images i on i.product_id = p.id
      where p.archived_at is null group by p.id, c.name
      order by p.created_at desc limit $1 offset $2`,
    [page.limit, (page.page - 1) * page.limit]
  );
  res.json({ products: result.rows });
}));

router.post("/admin/products", asyncHandler(async (req, res) => {
  const p = productSchema.parse(req.body);
  const result = await pool.query(
    `insert into public.products
       (name, slug, description, category_id, sku, price_minor, currency, stock_on_hand,
        low_stock_threshold, is_available)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [p.name, p.slug, p.description, p.categoryId ?? null, p.sku ?? null, p.priceMinor, p.currency.toUpperCase(), p.stockOnHand, p.lowStockThreshold, p.isAvailable]
  );
  res.status(201).json({ product: result.rows[0] });
}));

router.get("/admin/products/:id", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const result = await pool.query(
    `select p.*, coalesce(json_agg(json_build_object('id', i.id, 'url', i.public_url,
       'altText', i.alt_text) order by i.sort_order) filter (where i.id is not null), '[]') as images
       from public.products p left join public.product_images i on i.product_id = p.id
      where p.id = $1 and p.archived_at is null group by p.id`,
    [id]
  );
  if (!result.rows[0]) throw new HttpError(404, "Product not found");
  res.json({ product: result.rows[0] });
}));

router.patch("/admin/products/:id", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const p = productSchema.partial().parse(req.body);
  const fields: Record<string, unknown> = {
    name: p.name, slug: p.slug, description: p.description, category_id: p.categoryId,
    sku: p.sku, price_minor: p.priceMinor, currency: p.currency?.toUpperCase(),
    stock_on_hand: p.stockOnHand, low_stock_threshold: p.lowStockThreshold, is_available: p.isAvailable
  };
  const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (updates.length === 0) throw new HttpError(400, "No product fields supplied");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      `select id from public.products where id = $1 and archived_at is null for update`,
      [id]
    );
    if (!current.rows[0]) throw new HttpError(404, "Product not found");
    if (p.stockOnHand !== undefined) {
      const reservations = await client.query<{ quantity: string | null }>(
        `select sum(quantity)::text as quantity from public.inventory_reservations
          where product_id = $1 and status = 'active' and expires_at > now()`,
        [id]
      );
      if (BigInt(p.stockOnHand) < BigInt(reservations.rows[0]?.quantity ?? "0")) {
        throw new HttpError(409, "Stock cannot be set below quantities currently reserved for checkout");
      }
    }
    const set = updates.map(([key], index) => `${key} = $${index + 2}`).join(", ");
    const result = await client.query(
      `update public.products set ${set}, updated_at = now()
        where id = $1 returning *`,
      [id, ...updates.map(([, value]) => value)]
    );
    await client.query("commit");
    res.json({ product: result.rows[0] });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}));

router.delete("/admin/products/:id", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const result = await pool.query(
    `update public.products set archived_at = now(), is_available = false, updated_at = now()
      where id = $1 and archived_at is null returning id`,
    [id]
  );
  if (!result.rows[0]) throw new HttpError(404, "Product not found");
  res.sendStatus(204);
}));

router.post("/admin/products/:id/images", upload.single("image"), asyncHandler(async (req, res) => {
  const productId = uuid.parse(req.params.id);
  const file = req.file;
  if (!file) throw new HttpError(400, "Image file is required");
  const altText = z.string().max(200).optional().parse(req.body.altText);
  const product = await pool.query("select id from public.products where id = $1 and archived_at is null", [productId]);
  if (!product.rows[0]) throw new HttpError(404, "Product not found");
  const extension = file.mimetype.split("/")[1]?.replace("jpeg", "jpg") ?? "img";
  const path = `${productId}/${randomUUID()}.${extension}`;
  const stored = await storage.from(config.SUPABASE_STORAGE_BUCKET).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: false
  });
  if (stored.error) throw new HttpError(502, "Image upload failed");
  const publicUrl = storage.from(config.SUPABASE_STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  const result = await pool.query(
    `insert into public.product_images (product_id, storage_path, public_url, alt_text, sort_order)
     values ($1, $2, $3, $4, coalesce((select max(sort_order) + 1 from public.product_images where product_id = $1), 0))
     returning id, public_url as url, alt_text as "altText", sort_order`,
    [productId, path, publicUrl, altText ?? null]
  ).catch(async (error: unknown) => {
    const removed = await storage.from(config.SUPABASE_STORAGE_BUCKET).remove([path]);
    if (removed.error) console.error("Failed to clean up uploaded image after database error", removed.error);
    throw error;
  });
  res.status(201).json({ image: result.rows[0] });
}));

router.delete("/admin/products/:id/images/:imageId", asyncHandler(async (req, res) => {
  const productId = uuid.parse(req.params.id);
  const imageId = uuid.parse(req.params.imageId);
  const selected = await pool.query<{ storage_path: string }>(
    `select storage_path from public.product_images where id = $1 and product_id = $2`,
    [imageId, productId]
  );
  const image = selected.rows[0];
  if (!image) throw new HttpError(404, "Product image not found");
  const removed = await storage.from(config.SUPABASE_STORAGE_BUCKET).remove([image.storage_path]);
  if (removed.error) throw new HttpError(502, "Image could not be removed from storage");
  await pool.query(`delete from public.product_images where id = $1`, [imageId]);
  res.sendStatus(204);
}));

router.get("/admin/categories", asyncHandler(async (_req, res) => {
  const result = await pool.query(
    `select c.*, count(p.id)::integer as product_count
       from public.categories c left join public.products p on p.category_id = c.id and p.archived_at is null
      group by c.id order by c.name`
  );
  res.json({ categories: result.rows });
}));

router.post("/admin/categories", asyncHandler(async (req, res) => {
  const c = categorySchema.parse(req.body);
  const result = await pool.query(
    `insert into public.categories (name, slug, description, is_active)
     values ($1,$2,$3,$4) returning *`,
    [c.name, c.slug, c.description, c.isActive]
  );
  res.status(201).json({ category: result.rows[0] });
}));

router.patch("/admin/categories/:id", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const c = categorySchema.partial().parse(req.body);
  const fields: Record<string, unknown> = { name: c.name, slug: c.slug, description: c.description, is_active: c.isActive };
  const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (updates.length === 0) throw new HttpError(400, "No category fields supplied");
  const set = updates.map(([key], index) => `${key} = $${index + 2}`).join(", ");
  const result = await pool.query(
    `update public.categories set ${set}, updated_at = now() where id = $1 returning *`,
    [id, ...updates.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new HttpError(404, "Category not found");
  res.json({ category: result.rows[0] });
}));

router.delete("/admin/categories/:id", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const result = await pool.query(
    `update public.categories set is_active = false, updated_at = now() where id = $1 returning id`,
    [id]
  );
  if (!result.rows[0]) throw new HttpError(404, "Category not found");
  res.sendStatus(204);
}));

router.get("/admin/inventory/low-stock", asyncHandler(async (_req, res) => {
  const result = await pool.query(
    `select id, name, sku, stock_on_hand, low_stock_threshold
       from public.products where archived_at is null and stock_on_hand <= low_stock_threshold
      order by stock_on_hand, name`
  );
  res.json({ products: result.rows });
}));

router.patch("/admin/inventory/:productId", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.productId);
  const input = z.object({
    stockOnHand: z.number().int().nonnegative().max(1_000_000),
    lowStockThreshold: z.number().int().nonnegative().max(1_000_000).optional()
  }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const product = await client.query(
      `select id from public.products where id = $1 and archived_at is null for update`,
      [id]
    );
    if (!product.rows[0]) throw new HttpError(404, "Product not found");
    const reservations = await client.query<{ quantity: string | null }>(
      `select sum(quantity)::text as quantity from public.inventory_reservations
        where product_id = $1 and status = 'active' and expires_at > now()`,
      [id]
    );
    if (BigInt(input.stockOnHand) < BigInt(reservations.rows[0]?.quantity ?? "0")) {
      throw new HttpError(409, "Stock cannot be set below quantities currently reserved for checkout");
    }
    const result = await client.query(
      `update public.products set stock_on_hand = $2,
         low_stock_threshold = coalesce($3, low_stock_threshold), updated_at = now()
        where id = $1 returning id, stock_on_hand, low_stock_threshold`,
      [id, input.stockOnHand, input.lowStockThreshold ?? null]
    );
    await client.query("commit");
    res.json({ product: result.rows[0] });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/admin/orders", asyncHandler(async (req, res) => {
  const page = pagination.parse(req.query);
  const status = z.enum(["pending_payment", "confirmed", "processing", "shipped", "delivered", "cancelled"]).optional().parse(req.query.status);
  const values: unknown[] = [];
  const where = status ? (values.push(status), "where order_status = $1") : "";
  const result = await pool.query(
    `select id, order_reference, customer_email, customer_first_name, customer_last_name,
            total_minor, currency, order_status, payment_status, created_at
       from public.orders ${where} order by created_at desc
      limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, page.limit, (page.page - 1) * page.limit]
  );
  res.json({ orders: result.rows, page: page.page, limit: page.limit });
}));

router.get("/admin/orders/:id", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const order = await pool.query(
    `select o.*, coalesce(json_agg(json_build_object('id', oi.id, 'productId', oi.product_id,
       'productName', oi.product_name, 'sku', oi.product_sku, 'unitPriceMinor', oi.unit_price_minor,
       'quantity', oi.quantity, 'lineTotalMinor', oi.line_total_minor)
       order by oi.created_at) filter (where oi.id is not null), '[]') as items
       from public.orders o left join public.order_items oi on oi.order_id = o.id
      where o.id = $1 group by o.id`,
    [id]
  );
  if (!order.rows[0]) throw new HttpError(404, "Order not found");
  res.json({ order: order.rows[0] });
}));

router.patch("/admin/orders/:id/status", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({
    status: z.enum(["processing", "shipped", "delivered", "cancelled"])
  }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const selected = await client.query<{ order_status: string; payment_status: string }>(
      `select order_status, payment_status from public.orders where id = $1 for update`,
      [id]
    );
    const current = selected.rows[0];
    if (!current) throw new HttpError(404, "Order not found");
    const allowed: Record<string, string[]> = {
        pending_payment: ["cancelled"],
        confirmed: ["processing", "cancelled"],
        processing: ["shipped", "cancelled"],
        shipped: ["delivered"]
    };
    if (!allowed[current.order_status]?.includes(input.status)) {
      throw new HttpError(409, `Cannot move order from ${current.order_status} to ${input.status}`);
    }
    if (input.status === "cancelled" && current.payment_status === "success") {
      throw new HttpError(409, "Paid orders require a refund before cancellation; refunds are not automated");
    }
    if (input.status === "cancelled") {
      await client.query(
        `update public.payments set status = 'abandoned', updated_at = now()
          where order_id = $1 and status = 'pending'`,
        [id]
      );
      await client.query(
        `update public.inventory_reservations set status = 'released', updated_at = now()
          where order_id = $1 and status = 'active'`,
        [id]
      );
    }
    const updated = await client.query(
      `update public.orders set order_status = $2,
        payment_status = case when $2 = 'cancelled' then 'abandoned' else payment_status end,
        reserved_until = case when $2 = 'cancelled' then null else reserved_until end,
        updated_at = now() where id = $1 returning *`,
      [id, input.status]
    );
    await client.query("commit");
    res.json({ order: updated.rows[0] });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}));

export { router };
