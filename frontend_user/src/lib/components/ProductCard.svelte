<script lang="ts">
  import { formatPrice } from '$lib/cart';
  import type { Product } from '$lib/types';

  export let product: Product;

  let image: string | null | undefined;
  let categoryName: string | undefined;
  $: image = product.imageUrl || product.image;
  $: categoryName =
    product.categoryName ||
    (typeof product.category === 'string' ? product.category : product.category?.name);
</script>

<article class="product-card">
  <a class="product-image-wrap" href={`/products/${encodeURIComponent(product.slug)}`}>
    {#if image}
      <img class="product-image" src={image} alt={product.name} loading="lazy" />
    {:else}
      <div class="image-placeholder" aria-label="No product image">
        <span>{product.name.slice(0, 1)}</span>
      </div>
    {/if}
    {#if product.stock === 0}
      <span class="image-badge">Sold out</span>
    {/if}
  </a>
  <div class="product-card-copy">
    <div>
      {#if categoryName}<p class="eyebrow">{categoryName}</p>{/if}
      <a class="product-name" href={`/products/${encodeURIComponent(product.slug)}`}>{product.name}</a>
    </div>
    <span class="product-price">{formatPrice(product.price, product.currency)}</span>
  </div>
</article>
