<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api, formatMinor } from '$lib/api';
  import type { CustomerOrderHistory } from '$lib/types';

  const id = $page.params.id;
  let history: CustomerOrderHistory | null = null;
  let loading = true;
  let error = '';
  const date = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

  onMount(async () => {
    try { history = await api.customerOrders(id); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not load customer history.'; }
    finally { loading = false; }
  });
</script>

<svelte:head><title>Customer order history · Admin</title></svelte:head>
<section class="page-heading compact-heading">
  <div>
    <a class="back-link" href="/orders">← Orders</a>
    <h1>{history ? `${history.customer.first_name} ${history.customer.last_name}` : 'Customer order history'}</h1>
    {#if history}<p>{history.customer.email} · {history.customer.phone || 'No phone provided'}</p>{/if}
  </div>
</section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
{#if loading}
  <div class="loading-line"><span class="spinner"></span> Loading customer history…</div>
{:else if history}
  <div class="customer-history-layout">
    <section class="panel data-panel">
      <div class="panel-heading"><div><h2>Orders</h2><p>{history.orders.length} previous orders</p></div></div>
      {#if history.orders.length}
        <div class="table-wrap"><table><thead><tr><th>ORDER</th><th>DATE</th><th>FULFILLMENT</th><th>PAYMENT</th><th class="align-right">TOTAL</th><th></th></tr></thead><tbody>
          {#each history.orders as order}
            <tr>
              <td><a class="order-link" href={`/orders/${order.id}`}>#{order.orderNumber ?? order.id.slice(0, 8)}</a></td>
              <td class="muted">{date(order.createdAt)}</td>
              <td><span class={`status-pill status-${order.order_status}`}>{order.order_status.replace(/_/g, ' ')}</span></td>
              <td><span class={`status-pill status-${order.payment_status ?? 'pending'}`}>{order.payment_status ?? 'pending'}</span></td>
              <td class="align-right">{formatMinor(order.total_minor, order.currency)}</td>
              <td><a class="row-arrow" href={`/orders/${order.id}`} aria-label="View order">↗</a></td>
            </tr>
          {/each}
        </tbody></table></div>
      {:else}<div class="empty-state">This customer has no orders yet.</div>{/if}
    </section>
    <aside class="panel customer-history-contact">
      <div class="detail-block"><h2>Customer contact</h2><strong>{history.customer.first_name} {history.customer.last_name}</strong><span>{history.customer.email}</span><span>{history.customer.phone || 'No phone provided'}</span></div>
      <div class="detail-block"><h2>Saved delivery address</h2><address>{history.customer.address || 'No saved address'}<br />{history.customer.city}<br />{history.customer.country}</address></div>
    </aside>
  </div>
{/if}
