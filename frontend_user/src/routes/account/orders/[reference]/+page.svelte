<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { formatPrice } from '$lib/cart';
  import { getOrder } from '$lib/api';
  import { supabase } from '$lib/supabase';
  import OrderProgress from '$lib/components/OrderProgress.svelte';
  import type { OrderConfirmation } from '$lib/types';

  let order: OrderConfirmation | null = null;
  let loading = true;
  let error = '';
  $: reference = $page.params.reference;

  onMount(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      await goto(`/login?redirect=${encodeURIComponent(`/account/orders/${reference}`)}`);
      return;
    }
    try {
      order = await getOrder(reference);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Order details could not be loaded.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{order ? `Order ${order.orderReference}` : 'Order details'} — Goodfolk</title>
  <meta name="description" content="Order status, delivery information, and receipt." />
</svelte:head>

<section class="section-wrap account-page receipt-page">
  <a class="back-to-account" href="/account">← Back to your account</a>
  {#if loading}
    <div class="state-panel"><span class="state-icon">◷</span><h2>Loading your order.</h2></div>
  {:else if error}
    <div class="state-panel"><span class="state-icon">↗</span><h2>Order unavailable.</h2><p>{error}</p></div>
  {:else if order}
    <header class="receipt-heading">
      <div><p class="eyebrow">ORDER DETAILS & RECEIPT</p><h1>{order.orderReference}</h1><p>{order.created_at ? new Date(order.created_at).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : ''}</p></div>
      <button class="button button-outline" type="button" onclick={() => window.print()}>Print receipt</button>
    </header>
    <section class="account-panel receipt-status">
      <div class="receipt-status-top"><div><p class="eyebrow">FULFILLMENT</p><h2>{order.status.replace(/_/g, ' ')}</h2></div><span class={`order-status-badge status-${order.status}`}>{order.status.replace(/_/g, ' ')}</span></div>
      <OrderProgress status={order.status} />
      <p class="receipt-payment"><span class={`payment-status-badge payment-${order.paymentStatus ?? 'pending'}`}>Payment {order.paymentStatus ?? 'pending'}</span></p>
    </section>
    <div class="receipt-grid">
      <section class="account-panel receipt-items">
        <div class="account-panel-heading"><div><p class="eyebrow">YOUR ITEMS</p><h2>Order summary</h2></div></div>
        {#each order.items ?? [] as item, i}
          <div class="receipt-line">
            <div><strong>{item.name ?? item.productName ?? 'Item'}</strong><small>Qty {item.quantity}{item.sku ? ` · ${item.sku}` : ''}</small></div>
            <strong>{formatPrice(Number(item.lineTotalMinor ?? Number(item.unitPriceMinor ?? 0) * item.quantity) / 100, order.currency ?? 'NGN')}</strong>
          </div>
        {/each}
        <div class="receipt-total"><span>{order.paymentStatus === 'success' ? 'Total paid' : 'Order total'}</span><strong>{formatPrice(order.total ?? 0, order.currency ?? 'NGN')}</strong></div>
      </section>
      <aside class="account-panel delivery-panel">
        <p class="eyebrow">DELIVERY</p><h2>Shipping address</h2>
        <address>{order.customer_first_name} {order.customer_last_name}<br />{order.shipping_address}<br />{order.shipping_city}<br />{order.shipping_country}<br />{order.customer_phone}</address>
        <div class="receipt-reference"><span>Order reference</span><strong>{order.orderReference}</strong></div>
        {#if order.payment_reference}<div class="receipt-reference"><span>Payment reference</span><strong>{order.payment_reference}</strong></div>{/if}
        <div class="receipt-reference"><span>Payment status</span><strong>{order.paymentStatus ?? 'pending'}</strong></div>
      </aside>
    </div>
  {/if}
</section>
