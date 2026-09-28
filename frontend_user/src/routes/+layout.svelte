<script lang="ts">
  import { onMount } from 'svelte';
  import { navigating, page } from '$app/stores';
  import { hydrateCart, cart } from '$lib/cart';
  import '../styles.css';

  onMount(hydrateCart);
</script>

<svelte:head>
  <title>Goodfolk — Everyday, considered</title>
</svelte:head>

<div class="site-shell">
  {#if $navigating}
    <div class="route-progress" role="status">Just a moment…</div>
  {/if}
  <div class="announcement">A little more thoughtful, a little more everyday.</div>
  <header class="site-header">
    <a class="wordmark" href="/" aria-label="Goodfolk home">
      <span class="wordmark-mark">g</span>
      <span>goodfolk<span class="wordmark-period">.</span></span>
    </a>
    <nav aria-label="Main navigation">
      <a class:active={$page.url.pathname === '/'} href="/">Shop</a>
      <a class:active={$page.url.pathname === '/#about'} href="/#about">Our story</a>
    </nav>
    <a class="cart-link" href="/cart" aria-label={`Shopping bag, ${$cart.reduce((n, line) => n + line.quantity, 0)} items`}>
      <span class="bag-icon" aria-hidden="true">▱</span>
      <span>Bag</span>
      {#if $cart.length}
        <span class="cart-count">{ $cart.reduce((n, line) => n + line.quantity, 0) }</span>
      {/if}
    </a>
  </header>
  <main>
    <slot />
  </main>
  <footer class="site-footer" id="about">
    <a class="wordmark footer-mark" href="/">goodfolk<span class="wordmark-period">.</span></a>
    <p>Useful things, chosen with care.</p>
    <span>Thoughtfully sourced. Made for everyday.</span>
  </footer>
</div>
