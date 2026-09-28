import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { supabase } from './supabase';

export type StorefrontEventName =
  | 'product_view'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'cart_view'
  | 'checkout_started';

const API_ORIGIN = (env.PUBLIC_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
const PREFERENCE_KEY = 'goodfolk-analytics-enabled';
const SESSION_KEY = 'goodfolk-analytics-session';
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export function isAnalyticsEnabled(): boolean {
  if (!browser) return true;
  try {
    return localStorage.getItem(PREFERENCE_KEY) !== 'false';
  } catch {
    return false;
  }
}

export function getAnalyticsSessionId(): string | null {
  if (!browser || !isAnalyticsEnabled()) return null;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sessionId);
    return sessionId;
  } catch {
    return null;
  }
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (!browser) return;
  try {
    localStorage.setItem(PREFERENCE_KEY, String(enabled));
  } catch (error) {
    console.warn('Unable to save analytics preference', error);
    return;
  }
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key === SESSION_KEY || key?.startsWith(`${SESSION_KEY}:`)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.warn('Unable to clear analytics session data', error);
  }
  window.dispatchEvent(new CustomEvent('goodfolk-analytics-preference'));
}

export function trackStorefrontEvent(name: StorefrontEventName, productId?: string): void {
  const sessionId = getAnalyticsSessionId();
  const requiresProduct = name === 'product_view' || name === 'add_to_cart' || name === 'remove_from_cart';
  if (!sessionId || (requiresProduct && !productId)) return;

  let eventId: string;
  try {
    eventId = crypto.randomUUID();
  } catch {
    return;
  }
  const dedupeKey = name === 'product_view' || name === 'cart_view' || name === 'checkout_started'
    ? `${SESSION_KEY}:${name}:${productId ?? 'page'}`
    : null;
  let dedupeValue: string | null = null;
  if (dedupeKey) {
    try {
      const previous = sessionStorage.getItem(dedupeKey);
      const previousTimestamp = Number(previous?.split(':')[1]);
      const age = Date.now() - previousTimestamp;
      if (previous && Number.isFinite(age) && age >= 0 && age < DEDUPE_WINDOW_MS) return;
      dedupeValue = `${eventId}:${Date.now()}`;
      sessionStorage.setItem(dedupeKey, dedupeValue);
    } catch {
      return;
    }
  }

  function clearDeduplicationMark() {
    if (!dedupeKey || !dedupeValue) return;
    try {
      if (sessionStorage.getItem(dedupeKey) === dedupeValue) sessionStorage.removeItem(dedupeKey);
    } catch {
      // Analytics storage can be unavailable without affecting the store.
    }
  }

  void (async () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    let authResult: Awaited<ReturnType<typeof supabase.auth.getSession>> | null = null;
    try {
      authResult = await supabase.auth.getSession();
    } catch (error) {
      console.warn('Could not associate analytics with the signed-in customer', error);
    }
    if (authResult?.data.session?.access_token) {
      headers.set('Authorization', `Bearer ${authResult.data.session.access_token}`);
    }

    try {
      const response = await fetch(`${API_ORIGIN}/api/v1/analytics/events`, {
        method: 'POST',
        headers,
        keepalive: true,
        body: JSON.stringify({
          sessionId,
          events: [{ eventId, name, productId: productId ?? null }]
        })
      });
      if (!response.ok) {
        clearDeduplicationMark();
        console.warn(`Analytics event was not accepted (${response.status})`);
      }
    } catch (error) {
      clearDeduplicationMark();
      console.warn('Analytics event could not be sent', error);
    }
  })();
}
