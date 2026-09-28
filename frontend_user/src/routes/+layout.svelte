<script lang="ts">
  import { onMount } from 'svelte';
  import { navigating, page } from '$app/stores';
  import { hydrateCart, cart } from '$lib/cart';
  import { supabase } from '$lib/supabase';
  import '../styles.css';

  let customerEmail = '';
  let customerReady = false;

  onMount(hydrateCart);
  onMount(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.error('Failed to restore customer session', error.message);
      customerEmail = data.session?.user.email ?? '';
      customerReady = true;
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      customerEmail = session?.user.email ?? '';
      customerReady = true;
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  });
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
      {#if customerReady}
        <a class:active={$page.url.pathname.startsWith('/account')} href={customerEmail ? '/account' : '/login?redirect=%2Faccount'}>
          {customerEmail ? 'Account' : 'Sign in'}
        </a>
      {/if}
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
