import { PUBLIC_API_URL } from '$env/static/public';
import { supabase } from './supabase';
import type { AnalyticsProductMetric, AnalyticsTrend, Category, CustomerOrderHistory, DashboardStats, Order, Product, ProductImage, ProductInput, SalesOverTime, StoreAnalytics } from './types';

type Query = Record<string, string | number | boolean | undefined>;
type ProductResponse = { product: Product };
type CategoryResponse = { category: Category };
type OrderResponse = { order: Order };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error('Your session has expired. Please sign in again.');

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${PUBLIC_API_URL.replace(/\/$/, '')}${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? `Request failed (${response.status})`;
    throw new Error(typeof message === 'string' ? message : 'The request could not be completed.');
  }
  return payload as T;
}

function queryString(query: Query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

function unwrapList<T>(payload: Record<string, unknown>, key: string): T[] {
  const value = payload[key];
  if (!Array.isArray(value)) throw new Error(`Unexpected API response: expected "${key}" list.`);
  return value as T[];
}

function unwrap<T>(payload: Record<string, unknown>, key: string): T {
  const value = payload[key];
  if (!value || typeof value !== 'object') throw new Error(`Unexpected API response: expected "${key}" object.`);
  return value as T;
}

function normalizeProduct(value: Product): Product {
  const raw = value as Product & Record<string, unknown>;
  const currency = String(raw.currency ?? 'NGN');
  const priceMinor = Number(raw.priceMinor ?? raw.price_minor ?? 0);
  const images = Array.isArray(raw.images) ? raw.images as Product['images'] : [];
  return {
    ...value,
    price: Number(raw.price ?? fromMinor(priceMinor, currency)),
    priceMinor,
    currency,
    stockOnHand: Number(raw.stockOnHand ?? raw.stock_on_hand ?? 0),
    lowStockThreshold: Number(raw.lowStockThreshold ?? raw.low_stock_threshold ?? 0),
    categoryId: (raw.categoryId ?? raw.category_id ?? null) as string | null,
    category: raw.category ?? (
      raw.category_name
        ? { id: String(raw.category_id ?? ''), name: String(raw.category_name) }
        : null
    ),
    imageUrl: (raw.imageUrl ?? raw.image_url ?? images?.[0]?.url ?? null) as string | null,
    images,
    isAvailable: Boolean(raw.isAvailable ?? raw.is_available ?? true),
    status: (raw.isAvailable ?? raw.is_available ?? true) ? 'active' : 'inactive'
  };
}

function normalizeOrder(value: Order): Order {
  const raw = value as Order & Record<string, unknown>;
  const rawItems = raw.items ?? raw.order_items;
  const currency = String(raw.currency ?? 'NGN');
  const totalMinor = Number(raw.total_minor ?? raw.totalMinor ?? 0);
  return {
    ...value,
    order_status: String(raw.order_status ?? raw.status ?? 'pending'),
    payment_status: (raw.payment_status ?? raw.paymentStatus) as string | undefined,
    total_minor: totalMinor,
    total: fromMinor(totalMinor, currency),
    currency,
    orderNumber: (raw.orderNumber ?? raw.order_number ?? raw.order_reference) as string | undefined,
    customerName: (raw.customerName ?? raw.customer_name ?? [raw.customer_first_name, raw.customer_last_name].filter(Boolean).join(' ') ?? (raw.customer as { name?: string } | undefined)?.name) as string | undefined,
    customerEmail: (raw.customerEmail ?? raw.customer_email ?? (raw.customer as { email?: string } | undefined)?.email) as string | undefined,
    customerId: (raw.customerId ?? raw.customer_id) as string | undefined,
    customer_phone: (raw.customer_phone ?? raw.phone) as string | undefined,
    shipping_address: raw.shipping_address as string | undefined,
    shipping_city: raw.shipping_city as string | undefined,
    shipping_country: raw.shipping_country as string | undefined,
    createdAt: (raw.createdAt ?? raw.created_at) as string | undefined,
    items: Array.isArray(rawItems) ? (rawItems as Array<Record<string, unknown>>).map((item) => ({
      id: item.id as string | undefined,
      name: (item.name ?? item.productName ?? item.product_name) as string | undefined,
      quantity: Number(item.quantity ?? 0),
      priceMinor: Number(item.priceMinor ?? item.price_minor ?? item.unitPriceMinor ?? 0),
      currency: String(item.currency ?? raw.currency ?? 'NGN')
    })) : []
  };
}

function normalizeStats(value: DashboardStats): DashboardStats {
  const raw = value as DashboardStats & Record<string, unknown>;
  return {
    ...value,
    totalSalesMinor: Number(raw.totalSalesMinor ?? raw.total_sales_minor ?? raw.total_sales ?? raw.totalSales ?? 0),
    totalOrders: Number(raw.totalOrders ?? raw.total_orders ?? raw.ordersCount ?? 0),
    totalProducts: Number(raw.totalProducts ?? raw.total_products ?? raw.product_count ?? raw.productsCount ?? 0),
    lowStockCount: Number(raw.lowStockCount ?? raw.low_stock_count ?? raw.lowStockProducts ?? 0),
    currency: String(raw.currency ?? 'NGN')
  };
}

function productPayload(input: ProductInput) {
  const fractionDigits = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: input.currency
  }).resolvedOptions().maximumFractionDigits;
  return {
    name: input.name,
    slug: slugify(input.name),
    sku: input.sku,
    description: input.description,
    priceMinor: Math.round(input.price * 10 ** fractionDigits),
    currency: input.currency,
    stockOnHand: input.stockOnHand,
    lowStockThreshold: input.lowStockThreshold,
    categoryId: input.categoryId,
    isAvailable: input.status === 'active'
  };
}

function slugify(value: string) {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const api = {
  async analytics(range: StoreAnalytics['range']) {
    const payload = await request<Record<string, unknown>>(
      `/api/v1/admin/analytics${queryString({ range })}`
    );
    const metrics = payload.metrics as Record<string, unknown> | undefined;
    const funnel = payload.funnel as Record<string, unknown> | undefined;
    if (!metrics || !funnel || !Array.isArray(payload.trend)) {
      throw new Error('Unexpected analytics response.');
    }
    const count = (value: Record<string, unknown>, key: string) => Number(value[key] ?? 0);
    const normalizeProducts = (value: unknown): AnalyticsProductMetric[] => {
      if (!Array.isArray(value)) return [];
      return value.map((item) => {
        const product = item as Record<string, unknown>;
        return {
          id: String(product.id ?? ''),
          name: String(product.name ?? 'Product'),
          views: Number(product.views ?? 0),
          additions: Number(product.additions ?? 0),
          purchases: Number(product.purchases ?? 0)
        };
      });
    };
    return {
      range,
      metrics: {
        product_views: count(metrics, 'product_views'),
        product_view_sessions: count(metrics, 'product_view_sessions'),
        cart_additions: count(metrics, 'cart_additions'),
        cart_add_sessions: count(metrics, 'cart_add_sessions'),
        cart_removals: count(metrics, 'cart_removals'),
        cart_views: count(metrics, 'cart_views'),
        checkout_starts: count(metrics, 'checkout_starts'),
        checkout_sessions: count(metrics, 'checkout_sessions'),
        abandoned_checkouts: count(metrics, 'abandoned_checkouts'),
        abandoned_checkout_sessions: count(metrics, 'abandoned_checkout_sessions'),
        payment_attempts: count(metrics, 'payment_attempts'),
        payment_sessions: count(metrics, 'payment_sessions'),
        payment_cancellations: count(metrics, 'payment_cancellations'),
        payment_failures: count(metrics, 'payment_failures'),
        successful_payments: count(metrics, 'successful_payments'),
        orders_placed: count(metrics, 'orders_placed'),
        purchase_sessions: count(metrics, 'purchase_sessions')
      },
      funnel: {
        views: count(funnel, 'views'),
        adds: count(funnel, 'adds'),
        checkouts: count(funnel, 'checkouts'),
        payments: count(funnel, 'payments'),
        purchases: count(funnel, 'purchases')
      },
      trend: payload.trend.map((item) => {
        const point = item as Record<string, unknown>;
        return {
          period: String(point.period ?? ''),
          views: Number(point.views ?? 0),
          additions: Number(point.additions ?? 0),
          checkouts: Number(point.checkouts ?? 0),
          purchases: Number(point.purchases ?? 0)
        };
      }) as AnalyticsTrend[],
      productMetrics: normalizeProducts(payload.productMetrics)
    };
  },
  async dashboard() {
    const payload = await request<{ stats: DashboardStats; recentOrders: Order[]; salesOverTime: SalesOverTime[] }>('/api/v1/admin/dashboard');
    return {
      stats: normalizeStats(payload.stats ?? {}),
      recentOrders: (payload.recentOrders ?? []).map(normalizeOrder),
      salesOverTime: (payload.salesOverTime ?? []).map((point) => ({
        date: String((point as SalesOverTime & { day?: string }).date ?? (point as SalesOverTime & { day?: string }).day ?? ''),
        totalMinor: Number((point as SalesOverTime & { total_minor?: number; salesMinor?: number }).totalMinor ?? (point as SalesOverTime & { total_minor?: number; salesMinor?: number }).total_minor ?? (point as SalesOverTime & { salesMinor?: number }).salesMinor ?? 0)
      }))
    };
  },
  async products(query: Query = {}) {
    return unwrapList<Product>(await request<Record<string, unknown>>(`/api/v1/admin/products${queryString(query)}`), 'products').map(normalizeProduct);
  },
  async product(id: string) {
    const payload = await request<Record<string, unknown>>(`/api/v1/admin/products/${encodeURIComponent(id)}`);
    return normalizeProduct(unwrap<Product>(payload, 'product'));
  },
  async createProduct(input: ProductInput) {
    const payload = await request<ProductResponse>('/api/v1/admin/products', json('POST', productPayload(input)));
    return normalizeProduct(payload.product);
  },
  async updateProduct(id: string, input: Partial<ProductInput>) {
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) {
      payload.name = input.name;
      payload.slug = slugify(input.name);
    }
    if (input.sku !== undefined) payload.sku = input.sku;
    if (input.description !== undefined) payload.description = input.description;
    if (input.price !== undefined) {
      const currency = input.currency ?? 'NGN';
      const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
      payload.priceMinor = Math.round(input.price * 10 ** fractionDigits);
      payload.currency = currency;
    } else if (input.currency !== undefined) payload.currency = input.currency;
    if (input.stockOnHand !== undefined) payload.stockOnHand = input.stockOnHand;
    if (input.lowStockThreshold !== undefined) payload.lowStockThreshold = input.lowStockThreshold;
    if (input.categoryId !== undefined) payload.categoryId = input.categoryId;
    if (input.status !== undefined) payload.isAvailable = input.status === 'active';
    const response = await request<ProductResponse>(`/api/v1/admin/products/${encodeURIComponent(id)}`, json('PATCH', payload));
    return normalizeProduct(response.product);
  },
  deleteProduct: (id: string) => request<void>(`/api/v1/admin/products/${encodeURIComponent(id)}`, json('DELETE')),
  async uploadProductImage(id: string, image: File) {
    const body = new FormData();
    body.append('image', image);
    const payload = await request<{ image: ProductImage }>(
      `/api/v1/admin/products/${encodeURIComponent(id)}/images`,
      { method: 'POST', body }
    );
    return payload.image;
  },
  deleteProductImage(id: string, imageId: string) {
    return request<void>(
      `/api/v1/admin/products/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
      json('DELETE')
    );
  },
  async categories() {
    return unwrapList<Category>(await request<Record<string, unknown>>('/api/v1/admin/categories'), 'categories');
  },
  async createCategory(input: Pick<Category, 'name' | 'description'>) {
    const payload = await request<CategoryResponse>('/api/v1/admin/categories', json('POST', {
      ...input,
      slug: slugify(input.name)
    }));
    return payload.category;
  },
  async updateCategory(id: string, input: Pick<Category, 'name' | 'description'>) {
    const payload = await request<CategoryResponse>(`/api/v1/admin/categories/${encodeURIComponent(id)}`, json('PATCH', {
      ...input,
      slug: slugify(input.name)
    }));
    return payload.category;
  },
  deleteCategory: (id: string) => request<void>(`/api/v1/admin/categories/${encodeURIComponent(id)}`, json('DELETE')),
  async lowStock() {
    return unwrapList<Product>(await request<Record<string, unknown>>('/api/v1/admin/inventory/low-stock'), 'products').map(normalizeProduct);
  },
  async updateInventory(id: string, stockOnHand: number, lowStockThreshold: number) {
    const payload = await request<ProductResponse>(
      `/api/v1/admin/inventory/${encodeURIComponent(id)}`,
      json('PATCH', { stockOnHand, lowStockThreshold })
    );
    return normalizeProduct(payload.product);
  },
  async orders(query: Query = {}) {
    return unwrapList<Order>(await request<Record<string, unknown>>(`/api/v1/admin/orders${queryString(query)}`), 'orders').map(normalizeOrder);
  },
  async order(id: string) {
    const payload = await request<Record<string, unknown>>(`/api/v1/admin/orders/${encodeURIComponent(id)}`);
    return normalizeOrder(unwrap<Order>(payload, 'order'));
  },
  async customerOrders(id: string) {
    const payload = await request<Record<string, unknown>>(`/api/v1/admin/customers/${encodeURIComponent(id)}/orders`);
    const customer = payload.customer as CustomerOrderHistory['customer'] | undefined;
    if (!customer || !Array.isArray(payload.orders)) throw new Error('Unexpected customer order history response.');
    return {
      customer,
      orders: (payload.orders as Order[]).map(normalizeOrder)
    };
  },
  async updateOrderStatus(id: string, status: string) {
    const payload = await request<OrderResponse>(
      `/api/v1/admin/orders/${encodeURIComponent(id)}/status`,
      json('PATCH', { status })
    );
    return normalizeOrder(payload.order);
  }
};

export function records<T>(result: T[] | null | undefined): T[] {
  return Array.isArray(result) ? result : [];
}

export function formatMinor(minor: number, currency = 'USD'): string {
  const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format((Number(minor) || 0) / 10 ** fractionDigits);
}

export function toMinor(amount: number, currency = 'USD'): number {
  const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return Math.round((Number(amount) || 0) * 10 ** fractionDigits);
}

export function fromMinor(minor: number, currency = 'USD'): number {
  const fractionDigits = new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return (Number(minor) || 0) / 10 ** fractionDigits;
}
