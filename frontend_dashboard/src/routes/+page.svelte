<script lang="ts">
  import { onMount } from 'svelte';
  import { api, formatMinor } from '$lib/api';
  import type { DashboardStats, Order, SalesOverTime } from '$lib/types';
  let stats: DashboardStats = {};
  let orders: Order[] = [];
  let salesOverTime: SalesOverTime[] = [];
  let loading = true;
  let error = '';
  const date = (value?: string) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  onMount(async () => {
    try {
      const data = await api.dashboard();
      stats = data.stats;
      orders = data.recentOrders;
      salesOverTime = data.salesOverTime;
      if (!orders.length) orders = await api.orders();
      orders = orders.slice(0, 5);
    } catch (e) { error = e instanceof Error ? e.message : 'Unable to load dashboard.'; }
    finally { loading = false; }
  });

  $: sales = Number(stats.totalSalesMinor ?? 0);
  $: totalOrders = Number(stats.totalOrders ?? 0);
  $: totalProducts = Number(stats.totalProducts ?? 0);
  $: lowStock = Number(stats.lowStockCount ?? 0);
  $: chart = salesOverTime;
</script>

<section class="page-heading"><div><div class="eyebrow">STORE PULSE</div><h1>Good day, admin <span class="wave">✳</span></h1><p>Here’s what’s happening with your store today.</p></div><a class="button button-light" href="/orders">View orders <span>→</span></a></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
{#if loading}<div class="loading-line"><span class="spinner"></span> Loading store data…</div>{:else}
  <section class="stats-grid">
    <article class="stat-card"><div class="stat-top"><span class="stat-label">TOTAL SALES</span><span class="stat-icon sales-icon">$</span></div><div class="stat-value">{formatMinor(sales, stats.currency)}</div><div class="stat-foot"><span class="stat-note">Lifetime sales</span></div></article>
    <article class="stat-card"><div class="stat-top"><span class="stat-label">ORDERS</span><span class="stat-icon order-icon">▣</span></div><div class="stat-value">{totalOrders.toLocaleString()}</div><div class="stat-foot"><span class="stat-note">Orders received</span></div></article>
    <article class="stat-card"><div class="stat-top"><span class="stat-label">ACTIVE PRODUCTS</span><span class="stat-icon product-icon">▦</span></div><div class="stat-value">{totalProducts.toLocaleString()}</div><div class="stat-foot"><span class="stat-note">Across your catalog</span></div></article>
    <article class="stat-card"><div class="stat-top"><span class="stat-label">NEEDS ATTENTION</span><span class="stat-icon alert-icon">!</span></div><div class="stat-value">{lowStock.toLocaleString()}</div><div class="stat-foot"><a class="stat-link" href="/inventory">Low-stock items <span>↗</span></a></div></article>
  </section>
  <section class="dashboard-grid">
    <article class="panel sales-panel"><div class="panel-heading"><div><h2>Sales overview</h2><p>Store performance at a glance</p></div><span class="period-chip">Last 7 days</span></div>
      {#if chart.length}
        <div class="bar-chart" aria-label="Sales over the last seven days">{#each chart.slice(-7) as point}<div class="bar-column"><span class="bar-tooltip">{formatMinor(point.totalMinor, stats.currency)}</span><div class="bar-track"><div class="bar" style={`height:${Math.max(8, Math.min(100, (Number(point.totalMinor) / Math.max(...chart.map((d) => Number(d.totalMinor) || 0), 1)) * 100))}%`}></div></div><span class="bar-label">{new Date(point.date).toLocaleDateString(undefined, { weekday: 'short' })}</span></div>{/each}</div>
      {:else}<div class="empty-chart"><span class="chart-mark">↗</span><strong>Your sales story starts here</strong><span>Sales activity will appear when data is available.</span></div>{/if}
    </article>
    <article class="panel attention-panel"><div class="panel-heading"><div><h2>Quick actions</h2><p>Keep your store moving</p></div><span class="sparkle">✳</span></div><a class="action-row" href="/products/new"><span class="action-icon purple">＋</span><span><strong>Add a product</strong><small>Grow your catalog</small></span><b>→</b></a><a class="action-row" href="/inventory"><span class="action-icon amber">▤</span><span><strong>Review inventory</strong><small>{lowStock} items need attention</small></span><b>→</b></a><a class="action-row" href="/orders"><span class="action-icon green">▣</span><span><strong>Manage orders</strong><small>View and update fulfillment</small></span><b>→</b></a></article>
  </section>
  <section class="panel recent-panel"><div class="panel-heading"><div><h2>Recent orders</h2><p>Your latest customer activity</p></div><a class="text-link" href="/orders">All orders <span>→</span></a></div>
    {#if orders.length}<div class="table-wrap"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>DATE</th><th>STATUS</th><th class="align-right">TOTAL</th><th></th></tr></thead><tbody>{#each orders as order}<tr><td><a class="order-link" href={`/orders/${order.id}`}>#{order.orderNumber ?? order.id.slice(0, 8)}</a></td><td>{order.customerName ?? order.customerEmail ?? 'Customer'}</td><td class="muted">{date(order.createdAt)}</td><td><span class={`status-pill status-${(order.order_status ?? 'pending').toLowerCase().replace(/\s+/g, '-')}`}>{order.order_status ?? 'Pending'}</span></td><td class="align-right">{formatMinor(order.total_minor, order.currency)}</td><td><a class="row-arrow" href={`/orders/${order.id}`} aria-label="View order">↗</a></td></tr>{/each}</tbody></table></div>{:else}<div class="empty-state">No orders to show yet.</div>{/if}
  </section>
{/if}
