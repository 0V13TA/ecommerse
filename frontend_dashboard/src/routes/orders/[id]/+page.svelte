<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, formatMinor } from '$lib/api';
  import type { Order } from '$lib/types';
  const id = $page.params.id;
  let order: Order | null = null;
  let loading = true;
  let error = '';
  let busy = false;
  let status = '';
  const transitions: Record<string, string[]> = {
    pending_payment: ['cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: []
  };
  const date = (value?: string) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  onMount(async () => {
    try { order = await api.order(id); status = order.order_status; }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load this order.'; }
    finally { loading = false; }
  });
  async function updateStatus() {
    if (!order || status === order.order_status) return;
    busy = true; error = '';
    try { order = await api.updateOrderStatus(id, status); status = order.order_status; }
    catch (e) { error = e instanceof Error ? e.message : 'Could not update order status.'; }
    finally { busy = false; }
  }
  $: allowedStatuses = order ? transitions[order.order_status] ?? [] : [];
</script>

<section class="page-heading compact-heading"><div><a class="back-link" href="/orders">← Orders</a><h1>Order {order?.orderNumber ? `#${order.orderNumber}` : `#${id.slice(0, 8)}`}</h1><p>Order details and fulfillment status.</p></div></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
{#if loading}<div class="loading-line"><span class="spinner"></span> Loading order…</div>{:else if order}
<div class="order-detail-grid">
  <section class="panel order-items-panel"><div class="panel-heading"><div><h2>Items ordered</h2><p>{order.items?.length ?? 0} line items</p></div><span class={`status-pill status-${(order.order_status ?? 'pending').toLowerCase().replace(/\s+/g, '-')}`}>{order.order_status}</span></div>
    {#if order.items?.length}<div class="order-line-items">{#each order.items as item}<div class="order-line"><span class="product-placeholder">▦</span><div class="order-line-info"><strong>{item.name ?? 'Product'}</strong><small>Qty {item.quantity}</small></div><strong>{formatMinor(Number(item.priceMinor ?? 0) * Number(item.quantity ?? 1), item.currency ?? order.currency)}</strong></div>{/each}</div>{:else}<div class="empty-state">Item details are not available for this order.</div>{/if}
    <div class="order-total"><span>Total</span><strong>{formatMinor(order.total_minor, order.currency)}</strong></div>
  </section>
  <aside class="panel order-side-panel"><div class="detail-block"><h2>Fulfillment</h2><p>Update the current order status.</p><label class="sr-only" for="order-status">Order status</label><select id="order-status" bind:value={status}><option value={order.order_status}>{order.order_status.replace(/_/g, ' ')}</option>{#each allowedStatuses as nextStatus}<option value={nextStatus}>{nextStatus.replace(/_/g, ' ')}</option>{/each}</select><button class="button button-primary full-button" disabled={busy || status === order.order_status || !allowedStatuses.includes(status)} on:click={updateStatus}>{busy ? 'Updating…' : 'Update status'}</button></div>
    <div class="detail-block"><h2>Payment</h2><p class={`status-pill status-${(order.payment_status ?? 'pending').toLowerCase().replace(/\s+/g, '-')}`}>{order.payment_status ?? 'pending'}</p></div>
    <div class="detail-block"><h2>Customer</h2><div class="customer-avatar">{(order.customerName ?? order.customerEmail ?? 'C').slice(0, 1).toUpperCase()}</div><strong>{order.customerName ?? 'Customer'}</strong><span>{order.customerEmail ?? 'Email not provided'}</span></div>
    <div class="detail-block"><h2>Order information</h2><dl class="detail-list"><div><dt>Placed</dt><dd>{date(order.createdAt)}</dd></div><div><dt>Order ID</dt><dd>{order.orderNumber ?? order.id}</dd></div></dl></div>
  </aside>
</div>{/if}
