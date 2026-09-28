<script lang="ts">
  import { onMount } from 'svelte';
  import { api, formatMinor } from '$lib/api';
  import type { Order } from '$lib/types';
  let orders: Order[] = [];
  let loading = true;
  let error = '';
  let search = '';
  let filter = 'all';
  const date = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  onMount(async () => {
    try { orders = await api.orders(); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load orders.'; }
    finally { loading = false; }
  });
  $: statuses = [...new Set(orders.map((order) => order.order_status).filter(Boolean))];
  $: filtered = orders.filter((order) => (filter === 'all' || order.order_status === filter) && `${order.orderNumber ?? order.id} ${order.customerName ?? ''} ${order.customerEmail ?? ''}`.toLowerCase().includes(search.toLowerCase()));
</script>

<section class="page-heading"><div><div class="eyebrow">CUSTOMER ACTIVITY</div><h1>Orders</h1><p>Review purchases and keep fulfillment on track.</p></div></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
<section class="panel data-panel">
  <div class="toolbar"><div class="search-box"><span>⌕</span><input bind:value={search} placeholder="Search orders or customers…" aria-label="Search orders" /></div><select class="filter-select" bind:value={filter} aria-label="Filter orders"><option value="all">All statuses</option>{#each statuses as status}<option value={status}>{status}</option>{/each}</select><span class="result-count">{filtered.length} orders</span></div>
  {#if loading}<div class="loading-line"><span class="spinner"></span> Loading orders…</div>{:else if filtered.length}<div class="table-wrap"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>DATE</th><th>ITEMS</th><th>STATUS</th><th class="align-right">TOTAL</th><th></th></tr></thead><tbody>{#each filtered as order}<tr><td><a class="order-link" href={`/orders/${order.id}`}>#{order.orderNumber ?? order.id.slice(0, 8)}</a></td><td><strong>{order.customerName ?? 'Customer'}</strong><small class="table-subtext">{order.customerEmail ?? ''}</small></td><td class="muted">{date(order.createdAt)}</td><td class="muted">{order.items?.length ?? '—'}</td><td><span class={`status-pill status-${(order.order_status ?? 'pending').toLowerCase().replace(/\s+/g, '-')}`}>{order.order_status ?? 'Pending'}</span></td><td class="align-right">{formatMinor(order.total_minor, order.currency)}</td><td><a class="row-arrow" href={`/orders/${order.id}`} aria-label="View order">↗</a></td></tr>{/each}</tbody></table></div>{:else}<div class="empty-state">{search ? 'No orders match your search.' : 'No orders have been received yet.'}</div>{/if}
</section>
