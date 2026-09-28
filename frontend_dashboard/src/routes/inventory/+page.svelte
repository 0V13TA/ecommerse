<script lang="ts">
  import { onMount } from 'svelte';
  import { api, formatMinor } from '$lib/api';
  import type { Product } from '$lib/types';
  let items: Product[] = [];
  let loading = true;
  let error = '';
  let saving = '';
  async function load() {
    loading = true; error = '';
    try {
      const result = await api.lowStock();
      items = result.map((product) => ({ ...product, stockOnHand: Number(product.stockOnHand ?? 0), lowStockThreshold: Number(product.lowStockThreshold ?? 0) }));
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load inventory.'; }
    finally { loading = false; }
  }
  onMount(load);
  async function save(item: Product) {
    saving = item.id; error = '';
    try {
      const updated = await api.updateInventory(item.id, Number(item.stockOnHand), Number(item.lowStockThreshold));
      const saved = { ...item, ...(updated ?? {}) };
      if (Number(saved.stockOnHand) > Number(saved.lowStockThreshold)) items = items.filter((row) => row.id !== item.id);
      else items = items.map((row) => row.id === item.id ? saved : row);
    } catch (e) { error = e instanceof Error ? e.message : 'Could not update stock.'; }
    finally { saving = ''; }
  }
</script>

<section class="page-heading"><div><div class="eyebrow">STOCK CONTROL</div><h1>Inventory</h1><p>Review products running low and update stock levels.</p></div><button class="button button-light" on:click={load}>↻ Refresh</button></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
{#if items.length > 0}
  <section class="inventory-banner"><div class="inventory-banner-icon">!</div><div><strong>{items.length} {items.length === 1 ? 'product needs' : 'products need'} attention</strong><p>Products at or below their low-stock threshold are shown here.</p></div><span class="inventory-pulse"></span></section>
{/if}
<section class="panel data-panel inventory-panel"><div class="panel-heading"><div><h2>Low stock</h2><p>Update on-hand quantities and alert thresholds.</p></div></div>
  {#if loading}<div class="loading-line"><span class="spinner"></span> Checking stock levels…</div>
  {:else if items.length}<div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>ON HAND</th><th>LOW-STOCK AT</th><th>PRICE</th><th></th></tr></thead><tbody>{#each items as item}<tr><td><div class="product-cell">{#if item.imageUrl}<img src={item.imageUrl} alt="" />{:else}<span class="product-placeholder">▦</span>{/if}<strong>{item.name}</strong></div></td><td class="muted">{item.sku || '—'}</td><td><input class="small-number" type="number" min="0" bind:value={item.stockOnHand} aria-label={`Stock on hand for ${item.name}`} /></td><td><input class="small-number" type="number" min="0" bind:value={item.lowStockThreshold} aria-label={`Low stock threshold for ${item.name}`} /></td><td>{formatMinor(item.priceMinor, item.currency)}</td><td><button class="button button-small button-primary" disabled={saving === item.id} on:click={() => save(item)}>{saving === item.id ? 'Saving…' : 'Update'}</button></td></tr>{/each}</tbody></table></div>
  {:else}<div class="success-empty"><span>✓</span><strong>All caught up</strong><p>There are no low-stock products right now.</p></div>{/if}
</section>
