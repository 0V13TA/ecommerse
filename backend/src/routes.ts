import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { asyncHandler, HttpError, logError } from "./errors.js";
import { createCheckout, processPayment } from "./commerce.js";
import { isValidWebhookSignature } from "./paystack.js";
import { requireAdmin } from "./auth.js";
import { identifyCustomerIfPresent, requireCustomer } from "./customer-auth.js";
import rateLimit from "express-rate-limit";

const router = Router();
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many checkout attempts. Please try again later." }
});
const analyticsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many analytics events. Please try again later." }
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
const customerProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(5).max(40),
  address: z.string().trim().min(3).max(300),
  city: z.string().trim().min(1).max(100),
  country: z.string().trim().min(2).max(100)
});
const analyticsEventBatchSchema = z.object({
  sessionId: uuid,
  events: z.array(z.object({
    eventId: uuid,
    name: z.enum(["product_view", "add_to_cart", "remove_from_cart", "cart_view", "checkout_started"]),
    productId: uuid.nullable().optional()
  })).min(1).max(20)
}).superRefine((batch, context) => {
  for (const [index, event] of batch.events.entries()) {
    const requiresProduct = ["product_view", "add_to_cart", "remove_from_cart"].includes(event.name);
    if (requiresProduct !== Boolean(event.productId)) {
      context.addIssue({
        code: "custom",
        path: ["events", index, "productId"],
        message: requiresProduct ? "A product is required for this event" : "Cart view events cannot include a product"
      });
    }
  }
});

async function ensureCustomer(userId: string, email: string, emailConfirmed: boolean) {
  if (!emailConfirmed) {
    throw new HttpError(403, "Confirm your email address before using customer account features");
  }
  const name = email.split("@")[0] || "Customer";
  const result = await pool.query(
    `insert into public.customers (email, user_id, first_name, last_name, phone, address, city, country)
     values ($1, $2, $3, '', '', '', '', '')
     on conflict (email) do update set user_id = excluded.user_id, updated_at = now()
       where public.customers.user_id is null or public.customers.user_id = excluded.user_id
     returning id, user_id`,
    [email, userId, name]
  );
  if (!result.rows[0]) {
    throw new HttpError(409, "This email address is already associated with a different customer account");
  }
  await pool.query(
    `update public.orders set customer_id = $1
      where customer_id is null and lower(customer_email) = lower($2)`,
    [result.rows[0].id, email]
  );
  return result.rows[0].id as string;
}

async function getCustomerProfile(userId: string, email: string, emailConfirmed: boolean) {
  const customerId = await ensureCustomer(userId, email, emailConfirmed);
  const result = await pool.query(
    `select id, email, first_name, last_name, phone, address, city, country, avatar_url,
            created_at, updated_at
       from public.customers where id = $1`,
    [customerId]
  );
  return result.rows[0];
}

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

router.post("/analytics/events", analyticsLimiter, identifyCustomerIfPresent, asyncHandler(async (req, res) => {
  const input = analyticsEventBatchSchema.parse(req.body);
  const productIds = [...new Set(input.events.flatMap((event) => event.productId ? [event.productId] : []))];
  if (productIds.length) {
    const products = await pool.query(
      `select id from public.products where id = any($1::uuid[])`,
      [productIds]
    );
    if (products.rowCount !== productIds.length) throw new HttpError(400, "Analytics event contains an unknown product");
  }

  if (req.customerUserId) {
    await pool.query(
      `update public.storefront_analytics_events
          set user_id = $2
        where session_id = $1 and user_id is null`,
      [input.sessionId, req.customerUserId]
    );
  }
  const result = await pool.query(
    `insert into public.storefront_analytics_events
       (event_id, session_id, user_id, event_name, product_id)
     select event.event_id, $1, $2, event.name, event.product_id
       from jsonb_to_recordset($3::jsonb)
         as event(event_id uuid, name text, product_id uuid)
     on conflict (event_id) do nothing`,
    [input.sessionId, req.customerUserId ?? null, JSON.stringify(input.events.map((event) => ({
      event_id: event.eventId,
      name: event.name,
      product_id: event.productId ?? null
    })))]
  );
  res.status(202).json({ accepted: result.rowCount ?? 0 });
}));

router.post("/checkout", checkoutLimiter, requireCustomer, asyncHandler(async (req, res) => {
  if (!req.customerUserId || !req.customerEmail) throw new HttpError(401, "Customer authentication required");
  if (!req.customerEmailConfirmed) throw new HttpError(403, "Confirm your email address before checkout");
  const input = checkoutSchema.parse(req.body);
  const sessionHeader = uuid.safeParse(req.header("x-analytics-session"));
  const analyticsSessionId = sessionHeader.success ? sessionHeader.data : undefined;
  if (analyticsSessionId) {
    void pool.query(
      `update public.storefront_analytics_events
          set user_id = $2
        where session_id = $1 and user_id is null`,
      [analyticsSessionId, req.customerUserId]
    ).catch((error: unknown) => {
      console.warn("Unable to associate storefront events with authenticated customer", error);
    });
  }
  res.status(201).json(await createCheckout(input.items, {
    ...input.customer,
    email: req.customerEmail
  }, req.customerUserId, analyticsSessionId));
}));

router.get("/payments/:reference/verify", requireCustomer, asyncHandler(async (req, res) => {
  if (!req.customerUserId || !req.customerEmail) throw new HttpError(401, "Customer authentication required");
  const customerId = await ensureCustomer(req.customerUserId, req.customerEmail, !!req.customerEmailConfirmed);
  const reference = z.string().regex(/^PAY-[A-F0-9]{32}$/).parse(req.params.reference);
  const owner = await pool.query(
    `select 1 from public.payments p join public.orders o on o.id = p.order_id
      where p.reference = $1 and o.customer_id = $2`,
    [reference, customerId]
  );
  if (!owner.rows[0]) throw new HttpError(404, "Payment reference not found");
  await processPayment(reference);
  const result = await pool.query(
    `select o.id, o.order_reference, o.order_status, o.payment_status,
            o.currency, o.total_minor
       from public.payments p join public.orders o on o.id = p.order_id where p.reference = $1`,
    [reference]
  );
  if (!result.rows[0]) throw new HttpError(404, "Payment reference not found");
  res.json({ order: result.rows[0] });
}));

router.get("/customer/profile", requireCustomer, asyncHandler(async (req, res) => {
  if (!req.customerUserId || !req.customerEmail) throw new HttpError(401, "Customer authentication required");
  const profile = await getCustomerProfile(req.customerUserId, req.customerEmail, !!req.customerEmailConfirmed);
  res.json({ profile });
}));

router.patch("/customer/profile", requireCustomer, asyncHandler(async (req, res) => {
  if (!req.customerUserId || !req.customerEmail) throw new HttpError(401, "Customer authentication required");
  const input = customerProfileSchema.parse(req.body);
  const customerId = await ensureCustomer(req.customerUserId, req.customerEmail, !!req.customerEmailConfirmed);
  const result = await pool.query(
    `update public.customers
        set first_name = $2, last_name = $3, phone = $4, address = $5,
            city = $6, country = $7, updated_at = now()
      where id = $1 returning id, email, first_name, last_name, phone, address,
        city, country, avatar_url, created_at, updated_at`,
    [customerId, input.firstName, input.lastName, input.phone, input.address, input.city, input.country]
  );
  res.json({ profile: result.rows[0] });
}));

router.post("/customer/profile/avatar", requireCustomer, upload.single("image"), asyncHandler(async (req, res) => {
  if (!req.customerUserId || !req.customerEmail) throw new HttpError(401, "Customer authentication required");
  const file = req.file;
  if (!file) throw new HttpError(400, "Image file is required");
  const customerId = await ensureCustomer(req.customerUserId, req.customerEmail, !!req.customerEmailConfirmed);
  const previous = await pool.query<{ avatar_path: string | null }>(
    `select avatar_path from public.customers where id = $1`,
    [customerId]
  );
  const extension = file.mimetype.split("/")[1]?.replace("jpeg", "jpg") ?? "img";
  const path = `customers/${req.customerUserId}/${randomUUID()}.${extension}`;
  const stored = await storage.from(config.SUPABASE_STORAGE_BUCKET).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: false
  });
  if (stored.error) {
    logError("Failed to upload customer profile image to Supabase Storage", stored.error);
    throw new HttpError(502, "Profile image upload failed. Check the Supabase Storage bucket configuration.");
  }
  const publicUrl = storage.from(config.SUPABASE_STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  let result;
  try {
    result = await pool.query(
      `update public.customers set avatar_path = $2, avatar_url = $3, updated_at = now()
        where id = $1 returning id, email, first_name, last_name, phone, address,
          city, country, avatar_url, created_at, updated_at`,
      [customerId, path, publicUrl]
    );
  } catch (error) {
    const removed = await storage.from(config.SUPABASE_STORAGE_BUCKET).remove([path]);
    if (removed.error) logError("Failed to clean up customer avatar after database error", removed.error);
    throw error;
  }
  const previousPath = previous.rows[0]?.avatar_path;
  if (previousPath) {
    const removed = await storage.from(config.SUPABASE_STORAGE_BUCKET).remove([previousPath]);
    if (removed.error) logError("Failed to remove previous customer avatar", removed.error);
  }
  res.json({ profile: result.rows[0] });
}));

router.get("/customer/orders", requireCustomer, asyncHandler(async (req, res) => {
  if (!req.customerUserId || !req.customerEmail) throw new HttpError(401, "Customer authentication required");
  const customerId = await ensureCustomer(req.customerUserId, req.customerEmail, !!req.customerEmailConfirmed);
  const page = pagination.parse(req.query);
  const result = await pool.query(
    `select o.id, o.order_reference, o.order_status, o.payment_status, o.currency,
            o.total_minor, o.created_at,
            count(oi.id)::integer as item_count,
            p.reference as payment_reference
       from public.orders o
       left join public.order_items oi on oi.order_id = o.id
       left join public.payments p on p.order_id = o.id
      where o.customer_id = $1
      group by o.id, p.reference
      order by o.created_at desc
      limit $2 offset $3`,
    [customerId, page.limit, (page.page - 1) * page.limit]
  );
  res.json({ orders: result.rows, page: page.page, limit: page.limit });
}));

router.get("/customer/orders/:orderReference", requireCustomer, asyncHandler(async (req, res) => {
  if (!req.customerUserId || !req.customerEmail) throw new HttpError(401, "Customer authentication required");
  const customerId = await ensureCustomer(req.customerUserId, req.customerEmail, !!req.customerEmailConfirmed);
  const reference = z.string().regex(/^ORD-[A-F0-9]{32}$/).parse(req.params.orderReference);
  const result = await pool.query(
    `select o.id, o.order_reference, o.order_status, o.payment_status, o.currency,
            o.subtotal_minor, o.total_minor, o.created_at, o.customer_first_name,
            o.customer_last_name, o.customer_email, o.customer_phone, o.shipping_address,
            o.shipping_city, o.shipping_country, p.reference as payment_reference,
            coalesce(json_agg(json_build_object('id', oi.id, 'productName', oi.product_name,
              'sku', oi.product_sku, 'quantity', oi.quantity,
              'unitPriceMinor', oi.unit_price_minor, 'lineTotalMinor', oi.line_total_minor)
              order by oi.created_at) filter (where oi.id is not null), '[]') as items
       from public.orders o
       left join public.order_items oi on oi.order_id = o.id
       left join public.payments p on p.order_id = o.id
      where o.customer_id = $1 and o.order_reference = $2
      group by o.id, p.reference`,
    [customerId, reference]
  );
  if (!result.rows[0]) throw new HttpError(404, "Order not found");
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
  if ((event.event === "charge.success" || event.event === "charge.failed") && event.data?.reference) {
    await processPayment(event.data.reference);
  }
  res.sendStatus(200);
}));

router.use("/admin", requireAdmin);

router.get("/admin/analytics", asyncHandler(async (req, res) => {
  const range = z.enum(["today", "7d", "30d", "90d", "all"]).default("30d").parse(req.query.range);
  const starts: Record<Exclude<typeof range, "all">, Date> = {
    today: new Date(new Date().setUTCHours(0, 0, 0, 0)),
    "7d": new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    "30d": new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    "90d": new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  };
  const start = range === "all" ? null : starts[range];
  const bucket = range === "all" ? "month" : range === "today" ? "hour" : "day";

  const [engagement, checkouts, payments, funnel, trend, productMetrics] = await Promise.all([
    pool.query(
      `select count(*) filter (where event_name = 'product_view')::integer as product_views,
              count(distinct session_id) filter (where event_name = 'product_view')::integer as product_view_sessions,
              count(*) filter (where event_name = 'add_to_cart')::integer as cart_additions,
              count(distinct session_id) filter (where event_name = 'add_to_cart')::integer as cart_add_sessions,
              count(*) filter (where event_name = 'remove_from_cart')::integer as cart_removals,
              count(*) filter (where event_name = 'cart_view')::integer as cart_views
         from public.storefront_analytics_events
        where $1::timestamptz is null or created_at >= $1`,
      [start]
    ),
    pool.query(
      `with checkout_events as (
         select session_id, created_at
           from public.storefront_analytics_events
          where event_name = 'checkout_started'
            and ($1::timestamptz is null or created_at >= $1)
       ),
       checkout_orders as (
         select id, analytics_session_id as session_id, created_at, checkout_expired_at
           from public.orders
          where $1::timestamptz is null or created_at >= $1
       ),
       starts as (
         select session_id from checkout_events
         union
         select session_id from checkout_orders where session_id is not null
       ),
       unsubmitted_abandoned as (
         select distinct e.session_id
           from checkout_events e
          where e.created_at <= now() - interval '30 minutes'
            and not exists (
              select 1 from public.orders o
               where o.analytics_session_id = e.session_id
                 and o.created_at >= e.created_at
                 and o.created_at < e.created_at + interval '30 minutes'
            )
       ),
       expired_abandoned as (
         select o.id as order_id, o.session_id
           from checkout_orders o
          where o.checkout_expired_at is not null
            and not exists (
              select 1 from public.payments p
               where p.order_id = o.id and p.cancelled_at is not null
            )
       ),
       abandoned_sessions as (
         select session_id from unsubmitted_abandoned
         union
         select session_id from expired_abandoned where session_id is not null
       )
       select ((select count(*) from starts)
                 + (select count(*) from checkout_orders where session_id is null))::integer as checkout_starts,
              (select count(*) from starts)::integer as checkout_sessions,
              ((select count(*) from abandoned_sessions)
                 + (select count(*) from expired_abandoned where session_id is null))::integer
                as abandoned_checkouts,
              ((select count(*) from abandoned_sessions)
                 + (select count(*) from expired_abandoned where session_id is null))::integer
                as abandoned_checkout_sessions`,
      [start]
    ),
    pool.query(
      `select count(*) filter (
                where (p.initialized_at is not null or p.status = 'success' or p.cancelled_at is not null)
                  and ($1::timestamptz is null or coalesce(p.initialized_at, p.created_at) >= $1)
              )::integer as payment_attempts,
              count(distinct o.analytics_session_id) filter (
                where (p.initialized_at is not null or p.status = 'success' or p.cancelled_at is not null)
                  and ($1::timestamptz is null or coalesce(p.initialized_at, p.created_at) >= $1)
              )::integer as payment_sessions,
              count(*) filter (
                where p.status = 'abandoned' and p.cancelled_at is not null
                  and ($1::timestamptz is null or coalesce(p.initialized_at, p.created_at) >= $1)
              )::integer as payment_cancellations,
              count(*) filter (
                where p.status = 'failed' and p.initialized_at is not null
                  and ($1::timestamptz is null or p.initialized_at >= $1)
              )::integer as payment_failures,
              count(*) filter (
                where p.status = 'success'
                  and ($1::timestamptz is null or coalesce(p.paid_at, p.updated_at) >= $1)
              )::integer as successful_payments,
              count(distinct o.id) filter (
                where p.status = 'success'
                  and ($1::timestamptz is null or coalesce(p.paid_at, p.updated_at) >= $1)
              )::integer as orders_placed,
              count(distinct o.analytics_session_id) filter (
                where p.status = 'success'
                  and ($1::timestamptz is null or coalesce(p.paid_at, p.updated_at) >= $1)
              )::integer
                as purchase_sessions
         from public.payments p
         join public.orders o on o.id = p.order_id`,
      [start]
    ),
    pool.query(
      `with session_events as (
         select session_id,
                  bool_or(event_name = 'product_view') as viewed,
                  bool_or(event_name = 'add_to_cart') as added
           from public.storefront_analytics_events
          where ($1::timestamptz is null or created_at >= $1)
          group by session_id
       ),
       session_checkouts as (
         select session_id, true as checked_out
           from (
             select session_id, created_at as checkout_at
               from public.storefront_analytics_events
              where event_name = 'checkout_started'
                and ($1::timestamptz is null or created_at >= $1)
             union all
             select analytics_session_id, created_at
               from public.orders
              where analytics_session_id is not null
                and ($1::timestamptz is null or created_at >= $1)
           ) checkout_activity
          group by session_id
       ),
       session_attempts as (
         select o.analytics_session_id as session_id,
                bool_or(p.initialized_at is not null or p.status = 'success' or p.cancelled_at is not null)
                  as attempted,
                bool_or(p.status = 'success') as paid
           from public.payments p
           join public.orders o on o.id = p.order_id
          where o.analytics_session_id is not null
            and (p.initialized_at is not null or p.status = 'success' or p.cancelled_at is not null)
            and ($1::timestamptz is null or p.initialized_at >= $1
                 or p.cancelled_at >= $1
                 or (p.status = 'success' and coalesce(p.paid_at, p.updated_at) >= $1)
                 or (p.status = 'failed' and p.updated_at >= $1))
          group by o.analytics_session_id
       )
       select count(*) filter (where viewed)::integer as views,
              count(*) filter (where viewed and added)::integer as adds,
              count(*) filter (
                where viewed and added and checked_out
              )::integer as checkouts,
              count(*) filter (
                where viewed and added and checked_out and attempted
              )::integer as payments,
              count(*) filter (
                where viewed and added and checked_out and attempted and paid
              )::integer as purchases
         from session_events e
         left join session_checkouts c using (session_id)
         left join session_attempts p using (session_id)`,
      [start]
    ),
    pool.query(
      `with trend_rows as (
         select date_trunc('${bucket}', created_at) as period,
                count(*) filter (where event_name = 'product_view')::integer as views,
                count(*) filter (where event_name = 'add_to_cart')::integer as additions,
                0::integer as checkouts,
                0::integer as purchases
           from public.storefront_analytics_events
          where $1::timestamptz is null or created_at >= $1
          group by date_trunc('${bucket}', created_at)
         union all
         select date_trunc('${bucket}', checkout_at), 0, 0, count(*)::integer, 0
           from (
             select created_at as checkout_at
               from public.storefront_analytics_events
              where event_name = 'checkout_started'
                and ($1::timestamptz is null or created_at >= $1)
             union all
             select o.created_at
               from public.orders o
              where ($1::timestamptz is null or o.created_at >= $1)
                and not exists (
                  select 1 from public.storefront_analytics_events e
                   where e.event_name = 'checkout_started'
                     and e.session_id = o.analytics_session_id
                     and e.created_at between o.created_at - interval '30 minutes' and o.created_at
                )
           ) checkout_points
          group by date_trunc('${bucket}', checkout_at)
         union all
         select date_trunc('${bucket}', coalesce(p.paid_at, p.updated_at)), 0, 0, 0, count(distinct o.id)::integer
           from public.payments p
           join public.orders o on o.id = p.order_id
          where p.status = 'success'
            and ($1::timestamptz is null or coalesce(p.paid_at, p.updated_at) >= $1)
          group by date_trunc('${bucket}', coalesce(p.paid_at, p.updated_at))
       )
       select period, sum(views)::integer as views, sum(additions)::integer as additions,
              sum(checkouts)::integer as checkouts, sum(purchases)::integer as purchases
         from trend_rows group by period order by period`,
      [start]
    ),
    pool.query(
      `with engagement as (
         select product_id,
                count(*) filter (where event_name = 'product_view')::integer as views,
                count(*) filter (where event_name = 'add_to_cart')::integer as additions
           from public.storefront_analytics_events
          where product_id is not null and ($1::timestamptz is null or created_at >= $1)
          group by product_id
       ),
       purchases as (
         select oi.product_id, sum(oi.quantity)::integer as purchases
           from public.payments pay
           join public.orders o on o.id = pay.order_id
           join public.order_items oi on oi.order_id = o.id
          where pay.status = 'success'
            and ($1::timestamptz is null or coalesce(pay.paid_at, pay.updated_at) >= $1)
          group by oi.product_id
       )
       select p.id, p.name, coalesce(e.views, 0)::integer as views,
              coalesce(e.additions, 0)::integer as additions,
              coalesce(b.purchases, 0)::integer as purchases
         from public.products p
         left join engagement e on e.product_id = p.id
         left join purchases b on b.product_id = p.id
        where coalesce(e.views, 0) > 0 or coalesce(e.additions, 0) > 0
           or coalesce(b.purchases, 0) > 0
        order by greatest(coalesce(e.views, 0), coalesce(e.additions, 0), coalesce(b.purchases, 0)) desc,
                 p.name`,
      [start]
    )
  ]);

  res.json({
    range,
    metrics: {
      ...engagement.rows[0],
      ...checkouts.rows[0],
      ...payments.rows[0]
    },
    funnel: funnel.rows[0],
    trend: trend.rows,
    productMetrics: productMetrics.rows
  });
}));

router.get("/admin/dashboard", asyncHandler(async (_req, res) => {
  const [orders, products, recent, sales] = await Promise.all([
    pool.query(
      `select count(*)::integer as total_orders,
        count(*) filter (where order_status in ('pending_payment','received','processing'))::integer as pending_orders,
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
  if (stored.error) {
    logError("Failed to upload product image to Supabase Storage", stored.error);
    throw new HttpError(502, "Image upload failed. Check the Supabase Storage bucket configuration.");
  }
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
  const status = z.enum(["pending_payment", "received", "processing", "shipped", "delivered", "cancelled"]).optional().parse(req.query.status);
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
    `select o.*, (select p.reference from public.payments p where p.order_id = o.id
       order by p.created_at desc limit 1) as payment_reference,
       coalesce(json_agg(json_build_object('id', oi.id, 'productId', oi.product_id,
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

router.get("/admin/customers/:id/orders", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const [customer, result] = await Promise.all([
    pool.query(
      `select id, email, first_name, last_name, phone, address, city, country
         from public.customers where id = $1`,
      [id]
    ),
    pool.query(
    `select id, order_reference, order_status, payment_status, currency, total_minor, created_at
       from public.orders where customer_id = $1 order by created_at desc`,
      [id]
    )
  ]);
  if (!customer.rows[0]) throw new HttpError(404, "Customer not found");
  res.json({ customer: customer.rows[0], orders: result.rows });
}));

router.patch("/admin/orders/:id/status", asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({
    status: z.enum(["received", "processing", "shipped", "delivered", "cancelled"])
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
        received: ["processing"],
        processing: ["shipped"],
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
