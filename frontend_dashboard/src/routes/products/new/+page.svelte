<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, records } from '$lib/api';
  import type { Category, ProductInput } from '$lib/types';
  let categories: Category[] = [];
  let busy = false;
  let error = '';
  let form: ProductInput = { name: '', sku: '', description: '', price: 0, currency: 'NGN', stockOnHand: 0, lowStockThreshold: 5, categoryId: null, status: 'active' };
  let image: File | null = null;
  let imageName = '';
  onMount(async () => {
    try { categories = await api.categories(); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load categories.'; }
  });
  async function save(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = '';
    try {
      const product = await api.createProduct(form);
      if (image) await api.uploadProductImage(product.id, image);
      await goto('/products');
    } catch (e) { error = e instanceof Error ? e.message : 'Could not create product.'; }
    finally { busy = false; }
  }
</script>

<section class="page-heading compact-heading"><div><a class="back-link" href="/products">← Products</a><h1>Add product</h1><p>Create a new item for your store catalog.</p></div></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
<form class="panel editor-form" on:submit={save}>
  <div class="form-section"><h2>Product details</h2><p>Tell customers about this product.</p>
    <div class="field"><label for="name">Product name <span>*</span></label><input id="name" bind:value={form.name} required placeholder="e.g. Everyday Tote" /></div>
    <div class="field-row"><div class="field"><label for="sku">SKU</label><input id="sku" bind:value={form.sku} placeholder="e.g. BAG-001" /></div><div class="field"><label for="category">Category</label><select id="category" bind:value={form.categoryId}><option value={null}>No category</option>{#each categories as category}<option value={category.id}>{category.name}</option>{/each}</select></div></div>
    <div class="field"><label for="description">Description</label><textarea id="description" bind:value={form.description} rows="4" placeholder="Describe what makes this product special…"></textarea></div>
    <div class="field"><label for="image">Product image</label><label class="upload-area" for="image"><span class="upload-icon">↑</span><strong>{imageName || 'Choose an image to upload'}</strong><small>JPEG, PNG, WebP, or AVIF; maximum 5 MB. Image upload is sent after the product is created.</small></label><input class="file-input" id="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" on:change={(event) => { image = event.currentTarget.files?.[0] ?? null; imageName = image?.name ?? ''; }} /></div>
  </div>
  <div class="form-section"><h2>Pricing & inventory</h2><p>Set the price and keep track of available stock.</p>
    <div class="field-row"><div class="field"><label for="price">Price <span>*</span></label><div class="input-prefix"><span>{form.currency}</span><input id="price" type="number" min="0.01" step="0.01" bind:value={form.price} required /></div></div><div class="field"><label for="currency">Currency</label><select id="currency" bind:value={form.currency}><option>NGN</option><option>GHS</option><option>ZAR</option><option>KES</option><option>USD</option></select></div></div>
    <div class="field-row"><div class="field"><label for="stock">Stock on hand</label><input id="stock" type="number" min="0" bind:value={form.stockOnHand} /></div><div class="field"><label for="threshold">Low-stock alert at</label><input id="threshold" type="number" min="0" bind:value={form.lowStockThreshold} /></div></div>
    <div class="field"><label for="status">Status</label><select id="status" bind:value={form.status}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
  </div>
  <div class="form-actions"><a class="button button-light" href="/products">Cancel</a><button class="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Create product'}</button></div>
</form>
