import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { trackStorefrontEvent } from './analytics';
import type { CartLine, Product } from './types';

const STORAGE_KEY = 'everyday-store-cart';
const { subscribe, set, update } = writable<CartLine[]>([]);
let hydrated = false;

export const cart = { subscribe };

export function hydrateCart(): void {
  if (!browser || hydrated) return;
  hydrated = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const parsed: unknown = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      set(
        parsed.filter(
          (line): line is CartLine =>
            line &&
            typeof line === 'object' &&
            'product' in line &&
            !!line.product &&
            typeof line.product === 'object' &&
            'id' in line.product &&
            typeof line.product.id === 'string' &&
            'name' in line.product &&
            typeof line.product.name === 'string' &&
            'slug' in line.product &&
            typeof line.product.slug === 'string' &&
            'price' in line.product &&
            typeof line.product.price === 'number' &&
            'quantity' in line &&
            typeof line.quantity === 'number' &&
            line.quantity > 0
        )
      );
    }
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }
}

function save(lines: CartLine[]): CartLine[] {
  if (browser) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Keep the in-memory cart usable when persistent storage is unavailable.
    }
  }
  return lines;
}

export function addToCart(product: Product, quantity = 1): void {
  trackStorefrontEvent('add_to_cart', product.id);
  update((lines) => {
    const existing = lines.find((line) => line.product.id === product.id);
    const next = existing
      ? lines.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + quantity } : line
        )
      : [...lines, { product, quantity }];
    return save(next);
  });
}

export function setCartQuantity(productId: string, quantity: number): void {
  if (quantity < 1 && get(cart).some((line) => line.product.id === productId)) {
    trackStorefrontEvent('remove_from_cart', productId);
  }
  update((lines) =>
    save(
      quantity < 1
        ? lines.filter((line) => line.product.id !== productId)
        : lines.map((line) => (line.product.id === productId ? { ...line, quantity } : line))
    )
  );
}

export function removeFromCart(productId: string): void {
  if (get(cart).some((line) => line.product.id === productId)) {
    trackStorefrontEvent('remove_from_cart', productId);
  }
  update((lines) => save(lines.filter((line) => line.product.id !== productId)));
}

export function clearCart(): void {
  set([]);
  if (browser) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory cart is still cleared.
    }
  }
}

export function formatPrice(amount: number, currency = 'NGN'): string {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
