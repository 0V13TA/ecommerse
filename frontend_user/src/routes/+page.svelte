<script lang="ts">
  import { goto } from '$app/navigation';
  import { storeBrand } from '$lib/brand';
  import ProductCard from '$lib/components/ProductCard.svelte';
  import type { Category, Product } from '$lib/types';

  export let data: {
    category?: string;
    products: Product[];
    categories: Category[];
    productsError: string | null;
    categoriesError: boolean;
  };

  function selectCategory(category: string | undefined) {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';
    goto(`/${query}`, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>{storeBrand.homeTitle} — {storeBrand.name}</title>
  <meta name="description" content={storeBrand.homeDescription} />
</svelte:head>

<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow hero-eyebrow">A GOOD PLACE TO BEGIN</p>
    <h1>Everyday things,<br /><em>exceptionally</em> chosen.</h1>
    <p class="hero-description">A considered collection of useful objects for the way you live, work and unwind.</p>
    <a class="button button-dark" href="#collection">Explore the collection <span aria-hidden="true">↘</span></a>
  </div>
  <div class="hero-art" aria-label="A still life of carefully chosen everyday objects">
    <div class="hero-sun"></div>
    <div class="hero-arch">
      <div class="hero-vase"></div>
      <div class="hero-stem stem-one"></div>
      <div class="hero-stem stem-two"></div>
      <div class="hero-book"></div>
      <div class="hero-bowl"></div>
    </div>
    <span class="art-caption">THE OBJECTS WE KEEP</span>
  </div>
  <div class="hero-index">01 / 04</div>
</section>

<section class="collection section-wrap" id="collection">
  <div class="section-heading">
    <div>
      <p class="eyebrow">SHOP THE GOOD STUFF</p>
      <h2>{data.category ? 'A little more of what you love.' : 'Made for the everyday.'}</h2>
    </div>
    <p class="section-note">Fewer things, better chosen.</p>
  </div>

  {#if data.categories.length > 0}
    <div class="category-list" aria-label="Filter products by category">
      <button class:chosen={!data.category} class="category-chip" onclick={() => selectCategory(undefined)}>Everything</button>
      {#each data.categories as category (category.slug)}
        <button
          class:chosen={data.category === category.slug}
          class="category-chip"
          onclick={() => selectCategory(category.slug)}
        >{category.name}</button>
      {/each}
    </div>
  {:else if data.categoriesError}
    <p class="inline-note">Categories are temporarily unavailable. You can still browse all products.</p>
  {/if}

  {#if data.productsError}
    <div class="state-panel">
      <span class="state-icon">↗</span>
      <h3>We couldn't load the collection.</h3>
      <p>{data.productsError}</p>
      <button class="text-button" onclick={() => location.reload()}>Try again <span aria-hidden="true">→</span></button>
    </div>
  {:else if data.products.length === 0}
    <div class="state-panel">
      <span class="state-icon">✳</span>
      <h3>No finds just yet.</h3>
      <p>There are no products in this collection right now. Try another category soon.</p>
      {#if data.category}
        <button class="text-button" onclick={() => selectCategory(undefined)}>See everything <span aria-hidden="true">→</span></button>
      {/if}
    </div>
  {:else}
    <div class="product-grid">
      {#each data.products as product (product.id)}
        <ProductCard {product} />
      {/each}
    </div>
  {/if}
</section>

<section class="manifesto">
  <p class="eyebrow">LESS, BUT BETTER</p>
  <h2>Good things make<br />good <em>everydays.</em></h2>
  <p>We believe the things we use every day deserve a little more thought. That's why every piece in our collection earns its place.</p>
  <a class="text-button" href="#about">A note from us <span aria-hidden="true">→</span></a>
</section>
