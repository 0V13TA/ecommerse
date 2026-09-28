import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { HttpError } from "./errors.js";
import { initializeTransaction, verifyTransaction } from "./paystack.js";

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface CustomerInput {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  country: string;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createCheckout(items: CartLine[], customer: CustomerInput) {
  const productIds = items.map((item) => item.productId);
  if (productIds.length === 0 || new Set(productIds).size !== productIds.length) {
    throw new HttpError(400, "Cart must contain unique products");
  }
  customer = { ...customer, email: customer.email.trim().toLowerCase() };
  const orderReference = `ORD-${randomUUID().replaceAll("-", "").toUpperCase()}`;
  const order = await inTransaction(async (client) => {
    const products = await client.query<{
      id: string;
      name: string;
      sku: string | null;
      price_minor: string;
      currency: string;
      stock_on_hand: number;
      is_available: boolean;
    }>(
      `select id, name, sku, price_minor, currency, stock_on_hand, is_available
         from public.products
        where id = any($1::uuid[]) and archived_at is null
         order by id
         for update`,
      [productIds]
    );
    if (products.rowCount !== productIds.length) {
      throw new HttpError(400, "One or more products are unavailable");
    }
    const byId = new Map(products.rows.map((product) => [product.id, product]));
    const currency = products.rows[0]?.currency;
    if (!currency || products.rows.some((product) => product.currency !== currency)) {
      throw new HttpError(400, "Products must use the same currency");
    }
    const reserved = await client.query<{ product_id: string; quantity: string }>(
      `select product_id, sum(quantity) as quantity
         from public.inventory_reservations
        where product_id = any($1::uuid[]) and status = 'active' and expires_at > now()
        group by product_id`,
      [productIds]
    );
    const reservedById = new Map(reserved.rows.map((row) => [row.product_id, BigInt(row.quantity)]));
    let subtotal = 0n;
    const lines = items.map((item) => {
      const product = byId.get(item.productId);
      if (!product || !product.is_available) throw new HttpError(400, "Product is unavailable");
      if (BigInt(product.stock_on_hand) - (reservedById.get(product.id) ?? 0n) < BigInt(item.quantity)) {
        throw new HttpError(409, `${product.name} does not have enough stock`);
      }
      subtotal += BigInt(product.price_minor) * BigInt(item.quantity);
      return { item, product };
    });
    if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new HttpError(400, "Cart total is too large to process");
    }
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const customerResult = await client.query<{ id: string }>(
      `insert into public.customers (email, first_name, last_name, phone, address, city, country)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (email) do update set first_name = excluded.first_name,
         last_name = excluded.last_name, phone = excluded.phone, address = excluded.address,
         city = excluded.city, country = excluded.country, updated_at = now()
       returning id`,
      [customer.email, customer.firstName, customer.lastName, customer.phone, customer.address, customer.city, customer.country]
    );
    const customerId = customerResult.rows[0]?.id;
    if (!customerId) throw new Error("Customer insert did not return an id");
    const createdOrder = await client.query<{ id: string }>(
      `insert into public.orders
         (order_reference, customer_id, customer_email, customer_first_name, customer_last_name,
          customer_phone, shipping_address, shipping_city, shipping_country, currency,
          subtotal_minor, total_minor, order_status, payment_status, reserved_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11,
          'pending_payment', 'pending', $12)
       returning id`,
      [
        orderReference,
        customerId,
        customer.email,
        customer.firstName,
        customer.lastName,
        customer.phone,
        customer.address,
        customer.city,
        customer.country,
        currency,
        subtotal.toString(),
        expiresAt
      ]
    );
    const orderId = createdOrder.rows[0]?.id;
    if (!orderId) throw new Error("Order insert did not return an id");
    for (const { item, product } of lines) {
      await client.query(
        `insert into public.order_items
           (order_id, product_id, product_name, product_sku, unit_price_minor, quantity, line_total_minor)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          product.id,
          product.name,
          product.sku,
          product.price_minor,
          item.quantity,
          (BigInt(product.price_minor) * BigInt(item.quantity)).toString()
        ]
      );
      await client.query(
        `insert into public.inventory_reservations
           (order_id, product_id, quantity, expires_at)
         values ($1, $2, $3, $4)`,
        [orderId, product.id, item.quantity, expiresAt]
      );
    }
    const paymentReference = `PAY-${randomUUID().replaceAll("-", "").toUpperCase()}`;
    await client.query(
      `insert into public.payments (order_id, provider, reference, amount_minor, currency, status)
       values ($1, 'paystack', $2, $3, $4, 'pending')`,
      [orderId, paymentReference, subtotal.toString(), currency]
    );
    return { orderId, orderReference, paymentReference, subtotal: subtotal.toString(), currency };
  });

  try {
    const transaction = await initializeTransaction({
      email: customer.email,
      amount: Number(order.subtotal),
      reference: order.paymentReference,
      currency: order.currency,
      metadata: { order_reference: order.orderReference }
    });
    return { orderReference: order.orderReference, paymentUrl: transaction.authorization_url };
  } catch (error) {
    await inTransaction(async (client) => {
      await client.query(`select id from public.orders where id = $1 for update`, [order.orderId]);
      const payment = await client.query<{ status: string }>(
        `select status from public.payments where reference = $1 for update`,
        [order.paymentReference]
      );
      if (payment.rows[0]?.status === "success") return;
      await client.query(
        `update public.payments set status = 'failed', updated_at = now()
          where reference = $1 and status = 'pending'`,
        [order.paymentReference]
      );
      await client.query(
        `update public.inventory_reservations set status = 'released', updated_at = now()
          where order_id = $1 and status = 'active'`,
        [order.orderId]
      );
      await client.query(
        `update public.orders set order_status = 'cancelled', payment_status = 'failed',
          reserved_until = null, updated_at = now() where id = $1`,
        [order.orderId]
      );
    });
    throw error;
  }
}

export async function processPayment(reference: string) {
  const payment = await pool.query<{
    order_id: string;
    amount_minor: string;
    currency: string;
    payment_status: string;
  }>(
    `select p.order_id, p.amount_minor, p.currency, p.status as payment_status
       from public.payments p where p.reference = $1`,
    [reference]
  );
  const existing = payment.rows[0];
  if (!existing) throw new HttpError(404, "Payment reference not found");
  if (existing.payment_status === "success") return;

  const verified = await verifyTransaction(reference);
  if (verified.amount !== Number(existing.amount_minor) || verified.currency !== existing.currency) {
    throw new HttpError(400, "Payment amount or currency does not match the order");
  }
  if (verified.status !== "success") {
    if (verified.status !== "failed" && verified.status !== "abandoned") return;
    await inTransaction(async (client) => {
      const lockedOrder = await client.query(
        `select id from public.orders where id = $1 for update`,
        [existing.order_id]
      );
      if (!lockedOrder.rows[0]) throw new HttpError(404, "Order not found");
      const lockedPayment = await client.query<{ status: string }>(
        `select status from public.payments where reference = $1 for update`,
        [reference]
      );
      if (lockedPayment.rows[0]?.status === "success") return;
      await client.query(
        `update public.payments set status = $2, updated_at = now()
          where reference = $1 and status in ('pending', 'abandoned')`,
        [reference, verified.status === "abandoned" ? "abandoned" : "failed"]
      );
      await client.query(
        `update public.inventory_reservations set status = 'released', updated_at = now()
          where order_id = $1 and status = 'active'`,
        [existing.order_id]
      );
      await client.query(
        `update public.orders set order_status = 'cancelled', payment_status = $2,
          reserved_until = null, updated_at = now()
          where id = $1 and order_status = 'pending_payment'`,
        [existing.order_id, verified.status === "abandoned" ? "abandoned" : "failed"]
      );
    });
    return;
  }

  await inTransaction(async (client) => {
    const lockedOrder = await client.query(
      `select id from public.orders where id = $1 for update`,
      [existing.order_id]
    );
    if (!lockedOrder.rows[0]) throw new HttpError(404, "Order not found");
    const locked = await client.query<{ status: string; order_id: string; amount_minor: string }>(
      `select p.status, p.order_id, p.amount_minor
         from public.payments p where p.reference = $1 for update`,
      [reference]
    );
    const row = locked.rows[0];
    if (!row || row.status === "success") return;
    const reservations = await client.query<{
      id: string;
      product_id: string;
      quantity: number;
      expires_at: Date;
    }>(
      `select id, product_id, quantity, expires_at
         from public.inventory_reservations
        where order_id = $1 and status = 'active'
      order by product_id
      for update`,
      [row.order_id]
    );
    if (
      reservations.rowCount === 0 ||
      reservations.rows.some((reservation) => reservation.expires_at.getTime() < Date.now())
    ) {
      await client.query(
        `update public.payments set status = 'reconciliation_required', updated_at = now()
          where reference = $1`,
        [reference]
      );
      await client.query(
        `update public.orders set payment_status = 'reconciliation_required', updated_at = now()
          where id = $1`,
        [row.order_id]
      );
      return;
    }
    for (const reservation of reservations.rows) {
      const updated = await client.query(
        `update public.products set stock_on_hand = stock_on_hand - $1, updated_at = now()
          where id = $2 and stock_on_hand >= $1`,
        [reservation.quantity, reservation.product_id]
      );
      if (updated.rowCount !== 1) throw new HttpError(409, "Reserved product stock is unavailable");
    }
    await client.query(
      `update public.inventory_reservations set status = 'consumed', updated_at = now()
        where order_id = $1 and status = 'active'`,
      [row.order_id]
    );
    await client.query(
      `update public.payments set status = 'success', paid_at = coalesce($2, now()), updated_at = now()
        where reference = $1`,
      [reference, verified.paid_at ?? null]
    );
    await client.query(
      `update public.orders set payment_status = 'success', order_status = 'confirmed',
        reserved_until = null, updated_at = now() where id = $1`,
      [row.order_id]
    );
  });
}

export async function releaseExpiredReservations() {
  return inTransaction(async (client) => {
    const expired = await client.query<{ order_id: string }>(
      `with expired_orders as (
         select id from public.orders
          where order_status = 'pending_payment' and reserved_until < now()
          order by reserved_until
          limit 500
          for update skip locked
       )
       select id as order_id from expired_orders`
    );
    for (const order of expired.rows) {
      await client.query(
        `update public.payments set status = 'abandoned', updated_at = now()
          where order_id = $1 and status = 'pending'`,
        [order.order_id]
      );
      await client.query(
        `update public.inventory_reservations set status = 'released', updated_at = now()
          where order_id = $1 and status = 'active' and expires_at < now()`,
        [order.order_id]
      );
      await client.query(
        `update public.orders set order_status = 'cancelled', payment_status = 'abandoned',
          reserved_until = null, updated_at = now()
          where id = $1 and order_status = 'pending_payment'`,
        [order.order_id]
      );
    }
    return expired.rowCount;
  });
}
