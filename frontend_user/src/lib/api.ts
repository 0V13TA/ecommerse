import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { supabase } from './supabase';
import type {
  Category,
  CheckoutRequest,
  CheckoutResponse,
  OrderConfirmation,
  Product,
  ProductPage
} from './types';

const API_ROOT = '/api/v1';
const API_ORIGIN = (env.PUBLIC_API_URL || 'http://localhost:3001').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, fetcher: typeof fetch, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    if (
      init?.body &&
      !(typeof FormData !== 'undefined' && init.body instanceof FormData) &&
      !headers.has('Content-Type')
    ) {
      headers.set('Content-Type', 'application/json');
    }
    response = await fetcher(`${API_ORIGIN}${API_ROOT}${path}`, {
      ...init,
      headers
    });
  } catch {
    throw new ApiError('We could not reach the store. Check your connection and try again.');
  }

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      // Keep the friendly fallback if the server does not return JSON.
    }
    throw new ApiError(message, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('The store returned an unexpected response.');
  }
}

async function customerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!browser) throw new ApiError('Sign in to access your account.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new ApiError('Sign in to continue.');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  return request<T>(path, fetch, { ...init, headers });
}

function unwrapList<T>(value: T[] | { data?: T[]; categories?: T[] }): T[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.categories)) return value.categories;
  if (value && typeof value === 'object' && Array.isArray(value.data)) return value.data;
  return [];
}

export async function getCategories(fetcher: typeof fetch = fetch): Promise<Category[]> {
  const result = await request<Category[] | { data?: Category[]; categories?: Category[] }>(
    '/categories',
    fetcher
  );
  return unwrapList(result);
}

export async function getProducts(
  options: { category?: string; page?: number } = {},
  fetcher: typeof fetch = fetch
): Promise<ProductPage> {
  const query = new URLSearchParams({ page: String(options.page ?? 1) });
  if (options.category) query.set('category', options.category);
  const result = await request<
    Product[] | { products?: Product[]; data?: Product[]; page?: number; totalPages?: number; total?: number }
  >(`/products?${query}`, fetcher);

  if (Array.isArray(result)) {
    return { products: result.map(normalizeProduct), page: options.page ?? 1 };
  }
  if (!result || typeof result !== 'object') {
    throw new ApiError('The store returned an unexpected product list.');
  }
  return {
    products: (result.products ?? result.data ?? []).map(normalizeProduct),
    page: result.page ?? options.page ?? 1,
    totalPages: result.totalPages ?? (result.total ? Math.ceil(result.total / 24) : undefined)
  };
}

export async function getProduct(slug: string, fetcher: typeof fetch = fetch): Promise<Product> {
  const result = await request<Product | { data: Product; product?: Product }>(
    `/products/${encodeURIComponent(slug)}`,
    fetcher
  );
  if (!result || typeof result !== 'object') throw new ApiError('This product could not be loaded.');
  const product = 'product' in result ? result.product : 'data' in result ? result.data : result;
  if (!product || typeof product !== 'object' || typeof product.name !== 'string') {
    throw new ApiError('The store returned unexpected product details.');
  }
  return normalizeProduct(product);
}

export function createCheckout(
  body: CheckoutRequest,
): Promise<CheckoutResponse> {
  return customerRequest<CheckoutResponse>('/checkout', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function getOrder(
  reference: string
): Promise<OrderConfirmation> {
  const result = await customerRequest<{ order: OrderConfirmation }>(
    `/customer/orders/${encodeURIComponent(reference)}`
  );
  if (!result || typeof result !== 'object') {
    throw new ApiError('The order confirmation is not available yet.');
  }
  return normalizeOrder(result.order);
}

export async function verifyPayment(
  reference: string
): Promise<OrderConfirmation> {
  const result = await customerRequest<{ order: { order_reference: string } }>(
    `/payments/${encodeURIComponent(reference)}/verify`
  );
  if (!result.order?.order_reference) throw new ApiError('The store returned an unexpected payment confirmation.');
  return getOrder(result.order.order_reference);
}

export interface CustomerProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  avatar_url: string | null;
}

export async function getCustomerProfile(): Promise<CustomerProfile> {
  const result = await customerRequest<{ profile: CustomerProfile }>('/customer/profile');
  return result.profile;
}

export async function updateCustomerProfile(profile: Omit<CustomerProfile, 'id' | 'email' | 'avatar_url'>): Promise<CustomerProfile> {
  const result = await customerRequest<{ profile: CustomerProfile }>('/customer/profile', {
    method: 'PATCH',
    body: JSON.stringify({
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      country: profile.country
    })
  });
  return result.profile;
}

export async function uploadCustomerAvatar(file: File): Promise<CustomerProfile> {
  const body = new FormData();
  body.append('image', file);
  const result = await customerRequest<{ profile: CustomerProfile }>('/customer/profile/avatar', {
    method: 'POST',
    body
  });
  return result.profile;
}

export async function getCustomerOrders(): Promise<OrderConfirmation[]> {
  const orders: OrderConfirmation[] = [];
  for (let page = 1; ; page += 1) {
    const result = await customerRequest<{ orders: OrderConfirmation[] }>(
      `/customer/orders?page=${page}&limit=100`
    );
    orders.push(...result.orders.map(normalizeOrder));
    if (result.orders.length < 100) return orders;
  }
}

export function normalizeProduct(product: Product): Product {
  const images = Array.isArray(product.images) ? product.images : [];
  const categoryName = product.categoryName ?? product.category_name;
  const priceMinor = product.price_minor;
  const price =
    typeof product.price === 'number'
      ? product.price
      : priceMinor !== undefined
        ? Number(priceMinor) / 100
        : Number.NaN;

  return {
    ...product,
    price,
    imageUrl: product.imageUrl ?? product.image ?? images[0]?.url ?? null,
    categoryName,
    category:
      product.category ??
      (categoryName
        ? { name: categoryName, slug: product.category_slug }
        : null),
    stock: product.stock ?? product.stock_on_hand
  };
}

export function normalizeOrder(order: OrderConfirmation): OrderConfirmation {
  const status = order.order_status ?? order.status;
  if (typeof status !== 'string') {
    throw new ApiError('The store returned an unexpected order confirmation.');
  }
  return {
    ...order,
    orderReference: order.orderReference ?? order.order_reference ?? '',
    status,
    paymentStatus: order.payment_status ?? order.paymentStatus,
    total:
      order.total ??
      (order.total_minor !== undefined ? Number(order.total_minor) / 100 : null),
    customerName: order.customerName ?? ([order.customer_first_name, order.customer_last_name].filter(Boolean).join(' ') || null),
    items: order.items?.map((item) => ({
      ...item,
      name: item.name ?? item.productName ?? 'Item',
      unitPriceMinor: item.unitPriceMinor ?? item.priceMinor ?? item.price_minor ?? 0
    }))
  };
}
