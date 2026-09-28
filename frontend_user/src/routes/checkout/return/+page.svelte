<script lang="ts">
  import { onMount } from 'svelte';
  import { clearCart } from '$lib/cart';
  import { getOrder, verifyPayment } from '$lib/api';
  import type { OrderConfirmation } from '$lib/types';

  export let data: {
    order: OrderConfirmation | null;
    reference: string;
    paymentReference: boolean;
    error: string | null;
  };

  let order = data.order;
  let error = data.error;
  let checking = false;
  let reference = data.reference;
  let paymentReference = data.paymentReference;
  let status = '';
  let paymentStatus = '';
  let paid = false;
  let pending = false;

  $: status = order?.status?.toLowerCase() ?? '';
  $: paymentStatus = order?.paymentStatus?.toLowerCase() ?? '';
  $: paid = order?.paymentStatus === 'success';
  $: pending = !error && !!order && !paid && ['pending', 'reconciliation_required'].includes(paymentStatus);

  onMount(() => {
    void loadOrder();
  });

  async function loadOrder() {
    if (paid) {
      clearCart();
      forgetOrderReference();
      return;
    }
    if (!reference) {
      try {
        reference = sessionStorage.getItem('goodfolk-order-reference') || '';
      } catch {
        reference = '';
      }
    }
    if (!reference || order || checking) return;

    checking = true;
    try {
      order = paymentReference ? await verifyPayment(reference) : await getOrder(reference);
      error = null;
      if (isPaid(order)) {
        clearCart();
        forgetOrderReference();
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'We could not check your order yet.';
    } finally {
      checking = false;
    }
  }

  async function checkAgain() {
    if (!reference || checking) return;
    checking = true;
    error = null;
    try {
      order = paymentReference ? await verifyPayment(reference) : await getOrder(reference);
      if (isPaid(order)) {
        clearCart();
        forgetOrderReference();
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'We could not check your order yet.';
    } finally {
      checking = false;
    }
  }

  function isPaid(candidate: OrderConfirmation): boolean {
    return candidate.paymentStatus === 'success';
  }

  function forgetOrderReference() {
    try {
      sessionStorage.removeItem('goodfolk-order-reference');
    } catch {
      // Confirmation remains visible even if session storage is unavailable.
    }
  }
</script>

<svelte:head>
  <title>Order update — Goodfolk</title>
  <meta name="description" content="Check the status of your Goodfolk order." />
</svelte:head>

<section class="state-panel page-state return-state">
  {#if paid}
    <span class="state-icon success-icon">✓</span>
    <p class="eyebrow">THAT'S A GOOD CHOICE</p>
    <h1>Order confirmed.</h1>
    <p>Payment received. Your order is <strong>{status.replace(/_/g, ' ')}</strong>; we’ll take good care of it from here.</p>
    {#if order?.orderReference}<p class="reference-note">Order reference <strong>{order.orderReference}</strong></p>{/if}
    <a class="button button-dark" href={order?.orderReference ? `/account/orders/${encodeURIComponent(order.orderReference)}` : '/account'}>View order</a>
  {:else if pending}
    <span class="state-icon">◷</span>
    <p class="eyebrow">PAYMENT UPDATE</p>
    <h1>We're checking on it.</h1>
    <p>Payment status: {order?.paymentStatus || 'pending'}. Your order status: {status.replace(/_/g, ' ') || 'awaiting payment'}.</p>
    {#if order?.orderReference}<p class="reference-note">Order reference <strong>{order.orderReference}</strong></p>{/if}
    <button class="button button-dark" onclick={checkAgain} disabled={checking}>
      {checking ? 'Checking…' : 'Check again'}
    </button>
  {:else}
    <span class="state-icon">↗</span>
    <p class="eyebrow">ORDER UPDATE</p>
    <h1>{checking ? 'Checking your order…' : paymentStatus ? 'Payment wasn’t completed.' : 'We couldn’t confirm that yet.'}</h1>
    <p>{error || (paymentStatus ? `The payment status is ${paymentStatus}. Your bag is still saved if you would like to try again.` : reference ? 'Your order details are not available right now.' : 'No order reference was provided. Check your payment confirmation or contact us with your receipt.')}</p>
    {#if reference}<p class="reference-note">Order reference <strong>{reference}</strong></p>{/if}
    {#if reference}
      <button class="button button-dark" onclick={checkAgain} disabled={checking}>Try again</button>
    {:else}
      <a class="button button-dark" href="/">Back to the shop</a>
    {/if}
  {/if}
</section>
