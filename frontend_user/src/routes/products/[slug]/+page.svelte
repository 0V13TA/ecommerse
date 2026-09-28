<script lang="ts">
  import { page } from '$app/stores';
  import { addToCart, formatPrice } from '$lib/cart';
  import type { Product } from '$lib/types';

  export let data: { product: Product | null; error: string | null };
  let added = false;
  let product: Product | null;
  let image: string | null | undefined;
  let category: string | undefined;

  $: product = data.product;
  $: image = product?.imageUrl || product?.image;
  $: category =
    product?.categoryName ||
    (typeof product?.category === 'string' ? product.category : product?.category?.name);

  function addProduct() {
    if (!product || product.stock === 0) return;
    addToCart(product);
    added = true;
    setTimeout(() => (added = false), 1800);
  }
</script>

<svelte:head>
  <title>{product ? `${product.name} — Goodfolk` : 'Product — Goodfolk'}</title>
  {#if product?.description}<meta name="description" content={product.description} />{/if}
</svelte:head>

<div class="breadcrumb section-wrap">
  <a href="/">Shop</a><span>/</span><span>{product?.name ?? 'Product'}</span>
</div>

{#if product}
  <section class="product-detail section-wrap">
    <div class="detail-image">
      {#if image}
        <img src={image} alt={product.name} />
      {:else}
        <div class="image-placeholder detail-placeholder"><span>{product.name.slice(0, 1)}</span></div>
      {/if}
    </div>
    <div class="detail-copy">
      {#if category}<p class="eyebrow">{category}</p>{/if}
      <h1>{product.name}</h1>
      <p class="detail-price">{formatPrice(product.price, product.currency)}</p>
      {#if product.description}
        <p class="detail-description">{product.description}</p>
      {:else}
        <p class="detail-description">A thoughtfully chosen essential, made to find its place in your everyday.</p>
      {/if}
      {#if product.stock === 0}
        <p class="stock-note">This piece is currently sold out.</p>
      {:else}
        <button class="button button-dark add-button" onclick={addProduct}>
          {added ? 'Added to your bag ✓' : 'Add to bag'}
        </button>
      {/if}
      <p class="detail-footnote">Secure checkout · Guest checkout · Pay safely with Paystack</p>
      <a class="back-link" href={$page.url.searchParams.get('from') === 'cart' ? '/cart' : '/'}>← Back to shopping</a>
    </div>
  </section>
{:else}
  <section class="state-panel page-state">
    <span class="state-icon">↗</span>
    <h2>We can't find that piece.</h2>
    <p>{data.error ?? 'It may have moved on to a new home.'}</p>
    <a class="button button-dark" href="/">Back to the collection</a>
  </section>
{/if}
