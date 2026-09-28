<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { StoreAnalytics } from '$lib/types';

  const ranges: Array<{ value: StoreAnalytics['range']; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: 'all', label: 'All time' }
  ];

  let range: StoreAnalytics['range'] = '30d';
  let analytics: StoreAnalytics | null = null;
  let loading = true;
  let error = '';

  onMount(() => load());

  async function load() {
    loading = true;
    error = '';
    try {
      analytics = await api.analytics(range);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Analytics could not be loaded.';
    } finally {
      loading = false;
    }
  }

  $: metrics = analytics?.metrics;
  $: funnel = analytics?.funnel;
  $: stages = funnel ? [
    { name: 'Product view', sessions: funnel.views, events: metrics?.product_views ?? 0 },
    { name: 'Added to cart', sessions: funnel.adds, events: metrics?.cart_additions ?? 0 },
    { name: 'Checkout', sessions: funnel.checkouts, events: metrics?.checkout_starts ?? 0 },
    { name: 'Payment', sessions: funnel.payments, events: metrics?.payment_attempts ?? 0 },
    { name: 'Order', sessions: funnel.purchases, events: metrics?.orders_placed ?? 0 }
  ] : [];
  $: maxFunnel = Math.max(1, ...stages.map((stage) => stage.sessions));
  $: maxTrend = Math.max(1, ...(analytics?.trend ?? []).flatMap((point) => [
    point.views, point.additions, point.checkouts, point.purchases
  ]));
  $: highestViews = [...(analytics?.productMetrics ?? [])].sort((a, b) => b.views - a.views).slice(0, 8);
  $: highestAdds = [...(analytics?.productMetrics ?? [])].sort((a, b) => b.additions - a.additions).slice(0, 8);
  $: highestPurchases = [...(analytics?.productMetrics ?? [])].sort((a, b) => b.purchases - a.purchases).slice(0, 8);
  $: abandonmentRate = rate(metrics?.abandoned_checkouts ?? 0, metrics?.checkout_starts ?? 0);
  $: cancellationRate = rate(metrics?.payment_cancellations ?? 0, metrics?.payment_attempts ?? 0);
  $: failureRate = rate(metrics?.payment_failures ?? 0, metrics?.payment_attempts ?? 0);
  $: conversionRate = rate(funnel?.purchases ?? 0, funnel?.views ?? 0);

  function rate(value: number, total: number): string {
    return total ? `${((value / total) * 100).toFixed(1)}%` : '0%';
  }

  function periodLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return range === 'today'
      ? date.toLocaleTimeString(undefined, { hour: 'numeric' })
      : range === 'all'
        ? date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function barHeight(value: number): string {
    return `${value ? Math.max(5, (value / maxTrend) * 100) : 0}%`;
  }
</script>

<svelte:head>
  <title>Store analytics · Admin</title>
  <meta name="description" content="Customer behavior and store conversion analytics." />
</svelte:head>

<section class="page-heading analytics-heading">
  <div><div class="eyebrow">CUSTOMER BEHAVIOR</div><h1>Store analytics</h1><p>See how customers discover products and move toward purchase.</p></div>
  <label class="analytics-range">Time range
    <select bind:value={range} on:change={load} disabled={loading}>
      {#each ranges as option}<option value={option.value}>{option.label}</option>{/each}
    </select>
  </label>
</section>

{#if error}<div class="notice notice-error" role="alert">{error}</div>{/if}
{#if loading}
  <div class="loading-line"><span class="spinner"></span> Loading customer insights…</div>
{:else if analytics}
  <section class="analytics-stats">
    <article class="analytics-stat"><span>PRODUCT VIEWS</span><strong>{metrics?.product_views.toLocaleString() ?? '0'}</strong><small>{metrics?.product_view_sessions.toLocaleString() ?? '0'} browsing sessions</small></article>
    <article class="analytics-stat"><span>CART ADDITIONS</span><strong>{metrics?.cart_additions.toLocaleString() ?? '0'}</strong><small>{metrics?.cart_removals.toLocaleString() ?? '0'} removals</small></article>
    <article class="analytics-stat"><span>CHECKOUTS STARTED</span><strong>{metrics?.checkout_starts.toLocaleString() ?? '0'}</strong><small>{abandonmentRate} abandoned</small></article>
    <article class="analytics-stat"><span>SUCCESSFUL ORDERS</span><strong>{metrics?.orders_placed.toLocaleString() ?? '0'}</strong><small>{conversionRate} view-to-order conversion</small></article>
  </section>

  <section class="analytics-grid">
    <article class="panel analytics-panel funnel-panel">
      <div class="panel-heading"><div><h2>Shopping funnel</h2><p>Distinct anonymous sessions progressing through each step.</p></div></div>
      {#if stages[0]?.sessions}
        <div class="funnel-list">
          {#each stages as stage, index}
            <div class="funnel-stage">
              <div class="funnel-stage-heading"><strong>{stage.name}</strong><span>{stage.sessions.toLocaleString()} sessions <small>· {stage.events.toLocaleString()} events</small></span></div>
              <div class="funnel-track"><span style={`width:${stage.sessions ? Math.max(2, stage.sessions / maxFunnel * 100) : 0}%`}></span></div>
              {#if index > 0}
                <small class="funnel-dropoff">{rate(stages[index - 1].sessions - stage.sessions, stages[index - 1].sessions)} drop-off from previous step</small>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="analytics-empty">Customer activity will appear here as shoppers browse and buy.</div>
      {/if}
    </article>

    <article class="panel analytics-panel">
      <div class="panel-heading"><div><h2>Checkout health</h2><p>Payment outcomes reported by the server.</p></div></div>
      <div class="health-list">
        <div><span>Payment attempts</span><strong>{metrics?.payment_attempts.toLocaleString() ?? '0'}</strong></div>
        <div><span>Payment cancellations</span><strong>{metrics?.payment_cancellations.toLocaleString() ?? '0'} <small>{cancellationRate}</small></strong></div>
        <div><span>Payment failures</span><strong>{metrics?.payment_failures.toLocaleString() ?? '0'} <small>{failureRate}</small></strong></div>
        <div><span>Successful payments</span><strong>{metrics?.successful_payments.toLocaleString() ?? '0'}</strong></div>
        <div><span>Abandoned checkouts</span><strong>{metrics?.abandoned_checkouts.toLocaleString() ?? '0'} <small>{abandonmentRate}</small></strong></div>
        <div><span>Cart views</span><strong>{metrics?.cart_views.toLocaleString() ?? '0'}</strong></div>
      </div>
    </article>
  </section>

  <section class="panel analytics-panel trend-panel">
    <div class="panel-heading"><div><h2>Activity over time</h2><p>Product views, cart additions, checkouts, and paid orders.</p></div></div>
    {#if analytics.trend.length}
      <div class="analytics-legend"><span><i class="legend-views"></i>Views</span><span><i class="legend-adds"></i>Cart additions</span><span><i class="legend-checkouts"></i>Checkouts</span><span><i class="legend-purchases"></i>Orders</span></div>
      <div class="analytics-chart" aria-label="Customer activity over time">
        {#each analytics.trend.slice(-24) as point}
          <div class="analytics-chart-column" title={`${periodLabel(point.period)}: ${point.views} views, ${point.additions} additions, ${point.checkouts} checkouts, ${point.purchases} orders`}>
            <div class="analytics-bars">
              <span class="trend-bar trend-views" style={`height:${barHeight(point.views)}`}></span>
              <span class="trend-bar trend-adds" style={`height:${barHeight(point.additions)}`}></span>
              <span class="trend-bar trend-checkouts" style={`height:${barHeight(point.checkouts)}`}></span>
              <span class="trend-bar trend-purchases" style={`height:${barHeight(point.purchases)}`}></span>
            </div>
            <small>{periodLabel(point.period)}</small>
          </div>
        {/each}
      </div>
    {:else}<div class="analytics-empty">No activity recorded in this time range.</div>{/if}
  </section>

  <section class="panel analytics-panel product-performance-panel">
    <div class="panel-heading"><div><h2>Product performance</h2><p>Compare interest, cart additions, and purchased units.</p></div></div>
    {#if analytics.productMetrics.length}
      <div class="table-wrap"><table class="analytics-products-table">
        <thead><tr><th>PRODUCT</th><th class="align-right">VIEWS</th><th class="align-right">ADDED TO CART</th><th class="align-right">UNITS PURCHASED</th><th class="align-right">VIEW → CART</th></tr></thead>
        <tbody>{#each analytics.productMetrics as product (product.id)}
          <tr><td><strong>{product.name}</strong></td><td class="align-right">{product.views.toLocaleString()}</td><td class="align-right">{product.additions.toLocaleString()}</td><td class="align-right">{product.purchases.toLocaleString()}</td><td class="align-right">{rate(product.additions, product.views)}</td></tr>
        {/each}</tbody>
      </table></div>
    {:else}<div class="analytics-empty">Product performance will appear once customers start browsing.</div>{/if}
  </section>

  <section class="product-rankings">
    <article class="panel analytics-panel"><div class="panel-heading"><div><h2>Most viewed</h2><p>Products attracting attention</p></div></div>
      {#if highestViews.length}<ol>{#each highestViews as product (product.id)}<li><span>{product.name}</span><strong>{product.views.toLocaleString()}</strong></li>{/each}</ol>{:else}<div class="rankings-empty">No product views yet.</div>{/if}
    </article>
    <article class="panel analytics-panel"><div class="panel-heading"><div><h2>Most added</h2><p>Products customers want</p></div></div>
      {#if highestAdds.length}<ol>{#each highestAdds as product (product.id)}<li><span>{product.name}</span><strong>{product.additions.toLocaleString()}</strong></li>{/each}</ol>{:else}<div class="rankings-empty">No cart additions yet.</div>{/if}
    </article>
    <article class="panel analytics-panel"><div class="panel-heading"><div><h2>Most purchased</h2><p>Units sold from paid orders</p></div></div>
      {#if highestPurchases.length}<ol>{#each highestPurchases as product (product.id)}<li><span>{product.name}</span><strong>{product.purchases.toLocaleString()}</strong></li>{/each}</ol>{:else}<div class="rankings-empty">No purchases yet.</div>{/if}
    </article>
  </section>
{/if}
