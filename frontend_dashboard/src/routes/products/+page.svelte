<script lang="ts">
  import { onMount } from 'svelte';
  import { api, formatMinor } from '$lib/api';
  import type { Product } from '$lib/types';
  let products: Product[] = [];
  let loading = true;
  let error = '';
  let search = '';
  let deleting = '';
  async function load() {
    loading = true; error = '';
    try { products = await api.products(); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load products.'; }
    finally { loading = false; }
  }
  async function remove(product: Product) {
    if (!confirm(`Delete “${product.name}”? This cannot be undone.`)) return;
    deleting = product.id;
    try { await api.deleteProduct(product.id); products = products.filter((item) => item.id !== product.id); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not delete product.'; }
    finally { deleting = ''; }
  }
  onMount(load);
  $: filtered = products.filter((item) => `${item.name} ${item.sku ?? ''}`.toLowerCase().includes(search.toLowerCase()));
</script>

<section class="page-heading"><div><div class="eyebrow">CATALOG</div><h1>Products</h1><p>Manage the products available in your store.</p></div><a class="button button-primary" href="/products/new"><span>＋</span> Add product</a></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
<section class="panel data-panel">
  <div class="toolbar"><div class="search-box"><span>⌕</span><input bind:value={search} placeholder="Search products…" aria-label="Search products" /></div><span class="result-count">{products.length} products</span></div>
  {#if loading}<div class="loading-line"><span class="spinner"></span> Loading products…</div>
  {:else if filtered.length}<div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>PRICE</th><th>IN STOCK</th><th>STATUS</th><th></th></tr></thead><tbody>{#each filtered as product}<tr>
    <td><div class="product-cell">{#if product.imageUrl}<img src={product.imageUrl} alt="" />{:else}<span class="product-placeholder">▦</span>{/if}<strong>{product.name}</strong></div></td>
    <td class="muted">{product.sku || '—'}</td><td class="muted">{typeof product.category === 'object' && product.category ? product.category.name : product.category ?? '—'}</td><td>{formatMinor(product.priceMinor, product.currency)}</td>
    <td><span class:stock-low={product.stockOnHand <= product.lowStockThreshold}>{product.stockOnHand}</span></td><td><span class={`status-pill ${product.status === 'inactive' ? 'status-cancelled' : 'status-delivered'}`}>{product.status ?? 'Active'}</span></td>
    <td><div class="row-actions"><a href={`/products/${product.id}`} aria-label={`Edit ${product.name}`}>Edit</a><button class="icon-button danger-text" disabled={deleting === product.id} on:click={() => remove(product)} aria-label={`Delete ${product.name}`}>{deleting === product.id ? '…' : '×'}</button></div></td>
  </tr>{/each}</tbody></table></div>
  {:else}<div class="empty-state">{search ? 'No products match your search.' : 'No products yet. Add your first product to get started.'}</div>{/if}
</section>
