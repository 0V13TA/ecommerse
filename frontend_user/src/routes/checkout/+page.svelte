<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { cart, formatPrice } from '$lib/cart';
  import { createCheckout, updateCustomerProfile, getCustomerProfile } from '$lib/api';
  import { supabase } from '$lib/supabase';
  import type { CartLine, CheckoutRequest, CheckoutResponse } from '$lib/types';

  let email = '';
  let firstName = '';
  let lastName = '';
  let phone = '';
  let address = '';
  let city = '';
  let country = 'Nigeria';
  let busy = false;
  let error = '';
  let lines: CartLine[] = [];
  let subtotal = 0;
  let authReady = false;
  let paymentPrepared = false;
  let payment: CheckoutResponse | null = null;
  let paystackReady = false;
  let paystackError = '';
  let scriptPromise: Promise<void> | null = null;

  type PaystackPopup = { resumeTransaction(accessCode: string): void };
  declare global {
    interface Window {
      PaystackPop?: new () => PaystackPopup;
    }
  }

  $: lines = $cart;
  $: subtotal = lines.reduce((sum: number, line: CartLine) => sum + line.product.price * line.quantity, 0);

  onMount(() => {
    void initializePage();
  });

  async function initializePage() {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session) {
      await goto(`/login?redirect=${encodeURIComponent('/checkout')}`);
      return;
    }
    email = data.session.user.email ?? '';
    scriptPromise = loadPaystackScript()
      .then(() => { paystackReady = true; })
      .catch((cause: unknown) => {
        paystackError = cause instanceof Error ? cause.message : 'Paystack Inline could not be loaded.';
      });
    try {
      const profile = await getCustomerProfile();
      firstName = profile.first_name;
      lastName = profile.last_name;
      phone = profile.phone;
      address = profile.address;
      city = profile.city;
      country = profile.country || 'Nigeria';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'We could not load your saved delivery details.';
    } finally {
      authReady = true;
    }
  }

  function loadPaystackScript(): Promise<void> {
    if (typeof window.PaystackPop === 'function') return Promise.resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-paystack-inline]');
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Paystack Inline could not be loaded.')), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v2/inline.js';
      script.async = true;
      script.dataset.paystackInline = 'true';
      script.onload = () => typeof window.PaystackPop === 'function'
        ? resolve()
        : reject(new Error('Paystack Inline loaded without its checkout interface.'));
      script.onerror = () => reject(new Error('Paystack Inline could not be loaded.'));
      document.head.appendChild(script);
    });
  }

  async function startPayment(event: SubmitEvent) {
    event.preventDefault();
    if (!lines.length || busy) return;
    busy = true;
    error = '';
    const customer = { firstName, lastName, phone, address, city, country };
    const body: CheckoutRequest = {
      items: lines.map(({ product, quantity }) => ({ productId: product.id, quantity })),
      customer
    };

    try {
      await updateCustomerProfile({
        first_name: firstName,
        last_name: lastName,
        phone,
        address,
        city,
        country
      });
      payment = await createCheckout(body);
      if (!payment.orderReference || !payment.accessCode || !payment.paymentReference) {
        throw new Error('The store did not provide the secure payment details. Please try again.');
      }
      try {
        sessionStorage.setItem('goodfolk-order-reference', payment.orderReference);
        sessionStorage.setItem('goodfolk-payment-reference', payment.paymentReference);
      } catch {
        // The Paystack callback still provides a reference if session storage is unavailable.
      }
      paymentPrepared = true;
      void scriptPromise?.catch(() => undefined);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'We could not start checkout. Please try again.';
    } finally {
      busy = false;
    }
  }

  function openPaystack() {
    if (!payment || busy) return;
    error = '';
    if (!paystackReady || !window.PaystackPop) {
      try {
        const fallback = new URL(payment.paymentUrl);
        const trustedHost = fallback.hostname === 'paystack.com' || fallback.hostname.endsWith('.paystack.com');
        if (fallback.protocol !== 'https:' || !trustedHost) {
          throw new Error('The payment link was not valid.');
        }
        window.location.assign(fallback.href);
      } catch (cause) {
        error = cause instanceof Error && cause.message !== 'Invalid URL'
          ? cause.message
          : paystackError || 'Paystack is still loading. Please try again in a moment.';
      }
      return;
    }
    try {
      const popup = new window.PaystackPop();
      popup.resumeTransaction(payment.accessCode);
    } catch {
      error = 'Paystack could not open. Use the secure payment link instead.';
    }
  }

  async function checkPayment() {
    if (!payment || busy) return;
    busy = true;
    error = '';
    try {
      const { verifyPayment } = await import('$lib/api');
      const order = await verifyPayment(payment.paymentReference);
      if (order.paymentStatus === 'success') {
        await goto(`/checkout/confirmation?orderReference=${encodeURIComponent(order.orderReference)}`);
      } else {
        error = `Payment is currently ${order.paymentStatus || 'pending'}. You can check again shortly.`;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'We could not verify payment yet.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Checkout — Goodfolk</title>
  <meta name="description" content="Complete your order securely with your Goodfolk account." />
</svelte:head>

<section class="section-wrap checkout-page">
  <div class="page-heading">
    <p class="eyebrow">ALMOST YOURS</p>
    <h1>Checkout<span class="wordmark-period">.</span></h1>
  </div>

  {#if !authReady}
    <div class="state-panel"><span class="state-icon">◷</span><h2>Preparing your checkout.</h2></div>
  {:else if lines.length === 0}
    <div class="state-panel empty-cart">
      <span class="state-icon">▱</span>
      <h2>Your bag is empty.</h2>
      <p>Add something lovely before checking out.</p>
      <a class="button button-dark" href="/">Explore the collection</a>
    </div>
  {:else}
    <div class="checkout-layout">
      {#if paymentPrepared && payment}
        <section class="checkout-form payment-ready">
          <p class="eyebrow">SECURE PAYMENT</p>
          <h2>Your order is ready.</h2>
          <p class="form-intro">Order <strong>{payment.orderReference}</strong> is reserved for 15 minutes. Complete payment in the Paystack window.</p>
          {#if error}<div class="form-error" role="alert">{error}</div>{/if}
          <button class="button button-dark pay-button" type="button" onclick={openPaystack} disabled={busy}>
            {paystackReady ? 'Pay securely with Paystack' : 'Open secure payment'} <span aria-hidden="true">→</span>
          </button>
          <button class="text-button payment-check" type="button" onclick={checkPayment} disabled={busy}>
            {busy ? 'Checking payment…' : 'I completed payment — check status'}
          </button>
          <p class="payment-privacy">Payment confirmation comes directly from Paystack to our server. This page never treats a browser message as proof of payment.</p>
        </section>
      {:else}
        <form class="checkout-form" onsubmit={startPayment}>
          <h2>Where should we send your order?</h2>
          <p class="form-intro">Signed in as <strong>{email}</strong>. Your bag stayed saved while you signed in.</p>
          {#if error}<div class="form-error" role="alert">{error}</div>{/if}
          <div class="form-grid">
            <label>First name<input name="firstName" autocomplete="given-name" bind:value={firstName} required /></label>
            <label>Last name<input name="lastName" autocomplete="family-name" bind:value={lastName} required /></label>
            <label class="full-field">Phone number<input name="phone" type="tel" autocomplete="tel" bind:value={phone} required /></label>
            <label class="full-field">Street address<input name="address" autocomplete="street-address" bind:value={address} required /></label>
            <label>City<input name="city" autocomplete="address-level2" bind:value={city} required /></label>
            <label>Country<input name="country" autocomplete="country-name" bind:value={country} required /></label>
          </div>
          <button class="button button-dark pay-button" type="submit" disabled={busy}>
            {busy ? 'Preparing secure payment…' : 'Continue to secure payment'}
            {#if !busy}<span aria-hidden="true">→</span>{/if}
          </button>
          <p class="payment-privacy">Your delivery information is saved to your profile. Past orders keep their original delivery address.</p>
        </form>
      {/if}
      <aside class="order-summary checkout-summary">
        <p class="eyebrow">IN YOUR BAG ({lines.reduce((n: number, line: CartLine) => n + line.quantity, 0)})</p>
        {#each lines as line (line.product.id)}
          <div class="checkout-item">
            <span class="checkout-item-quantity">{line.quantity}</span>
            <span>{line.product.name}</span>
            <strong>{formatPrice(line.product.price * line.quantity, line.product.currency)}</strong>
          </div>
        {/each}
        <div class="summary-row checkout-total"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
        <p class="summary-note">Final delivery costs and any applicable charges are confirmed before payment.</p>
      </aside>
    </div>
  {/if}
</section>
