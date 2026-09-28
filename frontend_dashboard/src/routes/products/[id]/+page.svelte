<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api, fromMinor, records } from '$lib/api';
  import type { Category, Product, ProductInput } from '$lib/types';
  let product: Product | null = null;
  let categories: Category[] = [];
  let form: ProductInput = { name: '', sku: '', description: '', price: 0, currency: 'NGN', stockOnHand: 0, lowStockThreshold: 5, categoryId: null, status: 'active' };
  let loading = true;
  let busy = false;
  let error = '';
  let image: File | null = null;
  let imageName = '';
  let deletingImage = '';
  const id = $page.params.id;
  onMount(async () => {
    try {
      const [item, categoriesData] = await Promise.all([api.product(id), api.categories()]);
      product = item; categories = records(categoriesData);
      form = { name: item.name, sku: item.sku ?? '', description: item.description ?? '', price: fromMinor(item.priceMinor, item.currency), currency: item.currency, stockOnHand: item.stockOnHand, lowStockThreshold: item.lowStockThreshold, categoryId: item.categoryId ?? null, status: item.status ?? 'active' };
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load product.'; }
    finally { loading = false; }
  });
  async function save(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = '';
    try { await api.updateProduct(id, form); if (image) await uploadImage(); await goto('/products'); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not save product.'; }
    finally { busy = false; }
  }
  async function removeImage(imageId: string) {
    if (!product || !confirm('Remove this product image?')) return;
    deletingImage = imageId;
    error = '';
    try {
      await api.deleteProductImage(id, imageId);
      const images = (product.images ?? []).filter((item) => item.id !== imageId);
      product = { ...product, images, imageUrl: images[0]?.url ?? null };
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not remove this image.';
    } finally {
      deletingImage = '';
    }
  }
  async function uploadImage() {
    if (!product || !image) return;
    const uploaded = await api.uploadProductImage(id, image);
    product = {
      ...product,
      images: [...(product.images ?? []), uploaded],
      imageUrl: product.imageUrl ?? uploaded.url
    };
    image = null;
    imageName = '';
  }
</script>

<section class="page-heading compact-heading"><div><a class="back-link" href="/products">← Products</a><h1>Edit product</h1><p>Update catalog details, price, and availability.</p></div></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
{#if loading}<div class="loading-line"><span class="spinner"></span> Loading product…</div>{:else if product}
<form class="panel editor-form" on:submit={save}>
  <div class="form-section"><h2>Product details</h2><p>Tell customers about this product.</p>
    <div class="field"><label for="name">Product name <span>*</span></label><input id="name" bind:value={form.name} required /></div>
    <div class="field-row"><div class="field"><label for="sku">SKU</label><input id="sku" bind:value={form.sku} /></div><div class="field"><label for="category">Category</label><select id="category" bind:value={form.categoryId}><option value={null}>No category</option>{#each categories as category}<option value={category.id}>{category.name}</option>{/each}</select></div></div>
    <div class="field"><label for="description">Description</label><textarea id="description" bind:value={form.description} rows="4"></textarea></div>
    {#if product.images?.length}
      <div class="image-list">
        {#each product.images as productImage}
          <div class="current-image">
            <img src={productImage.url} alt={productImage.altText ?? `${product.name} product`} />
            <span>{productImage.altText || 'Product image'}</span>
            <button class="button button-light" type="button" disabled={deletingImage === productImage.id} on:click={() => removeImage(productImage.id)}>
              {deletingImage === productImage.id ? 'Removing…' : 'Remove'}
            </button>
          </div>
        {/each}
      </div>
    {/if}
    <div class="field"><label for="image">Add product image</label><label class="upload-area" for="image"><span class="upload-icon">↑</span><strong>{imageName || 'Choose an image to upload'}</strong><small>JPEG, PNG, WebP, or AVIF; maximum 5 MB. Image upload happens after saving.</small></label><input class="file-input" id="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" on:change={(event) => { image = event.currentTarget.files?.[0] ?? null; imageName = image?.name ?? ''; }} /></div>
  </div>
  <div class="form-section"><h2>Pricing & inventory</h2><p>Set the price and keep track of available stock.</p>
    <div class="field-row"><div class="field"><label for="price">Price <span>*</span></label><div class="input-prefix"><span>{form.currency}</span><input id="price" type="number" min="0.01" step="0.01" bind:value={form.price} required /></div></div><div class="field"><label for="currency">Currency</label><select id="currency" bind:value={form.currency}><option>NGN</option><option>GHS</option><option>ZAR</option><option>KES</option><option>USD</option></select></div></div>
    <div class="field-row"><div class="field"><label for="stock">Stock on hand</label><input id="stock" type="number" min="0" bind:value={form.stockOnHand} /></div><div class="field"><label for="threshold">Low-stock alert at</label><input id="threshold" type="number" min="0" bind:value={form.lowStockThreshold} /></div></div>
    <div class="field"><label for="status">Status</label><select id="status" bind:value={form.status}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
  </div>
  <div class="form-actions"><a class="button button-light" href="/products">Cancel</a><button class="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
</form>{/if}
