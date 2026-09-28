<script lang="ts">
  import { cart, formatPrice } from '$lib/cart';
  import { createCheckout } from '$lib/api';
  import type { CartLine, CheckoutRequest } from '$lib/types';

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
  $: lines = $cart;
  $: subtotal = lines.reduce((sum: number, line: CartLine) => sum + line.product.price * line.quantity, 0);

  async function startPayment(event: SubmitEvent) {
    event.preventDefault();
    if (!lines.length || busy) return;
    busy = true;
    error = '';
    const body: CheckoutRequest = {
      items: lines.map(({ product, quantity }) => ({ productId: product.id, quantity })),
      customer: { email, firstName, lastName, phone, address, city, country }
    };

    try {
      const response = await createCheckout(body);
      if (!response.orderReference || !response.paymentUrl) {
        throw new Error('The store did not provide a payment link. Please try again.');
      }
      const payment = new URL(response.paymentUrl);
      const trustedPaystackHost =
        payment.hostname === 'paystack.com' || payment.hostname.endsWith('.paystack.com');
      if (payment.protocol !== 'https:' || !trustedPaystackHost) {
        throw new Error('The payment link was not valid. Please try again.');
      }
      try {
        sessionStorage.setItem('goodfolk-order-reference', response.orderReference);
      } catch {
        // Paystack's callback reference can still confirm the order without session storage.
      }
      window.location.assign(payment.href);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'We could not start checkout. Please try again.';
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Checkout — Goodfolk</title>
  <meta name="description" content="Complete your order securely with guest checkout." />
</svelte:head>

<section class="section-wrap checkout-page">
  <div class="page-heading">
    <p class="eyebrow">ALMOST YOURS</p>
    <h1>Checkout<span class="wordmark-period">.</span></h1>
  </div>

  {#if lines.length === 0}
    <div class="state-panel empty-cart">
      <span class="state-icon">▱</span>
      <h2>Your bag is empty.</h2>
      <p>Add something lovely before checking out.</p>
      <a class="button button-dark" href="/">Explore the collection</a>
    </div>
  {:else}
    <div class="checkout-layout">
      <form class="checkout-form" onsubmit={startPayment}>
        <h2>Where should we send your order?</h2>
        <p class="form-intro">No account needed. Just a few details and you're all set.</p>
        {#if error}<div class="form-error" role="alert">{error}</div>{/if}
        <div class="form-grid">
          <label>First name<input name="firstName" autocomplete="given-name" bind:value={firstName} required /></label>
          <label>Last name<input name="lastName" autocomplete="family-name" bind:value={lastName} required /></label>
          <label class="full-field">Email address<input name="email" type="email" autocomplete="email" bind:value={email} required /></label>
          <label class="full-field">Phone number<input name="phone" type="tel" autocomplete="tel" bind:value={phone} required /></label>
          <label class="full-field">Street address<input name="address" autocomplete="street-address" bind:value={address} required /></label>
          <label>City<input name="city" autocomplete="address-level2" bind:value={city} required /></label>
          <label>Country<input name="country" autocomplete="country-name" bind:value={country} required /></label>
        </div>
        <button class="button button-dark pay-button" type="submit" disabled={busy}>
          {busy ? 'Connecting to Paystack…' : 'Continue to secure payment'}
          {#if !busy}<span aria-hidden="true">→</span>{/if}
        </button>
        <p class="payment-privacy">Your payment details are entered securely on Paystack. We never see or store your card details.</p>
      </form>
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
