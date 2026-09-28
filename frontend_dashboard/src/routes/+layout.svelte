<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  import '../app.css';

  let ready = false;
  let signedIn = false;
  let email = '';
  const passwordSetupPath = '/auth/setup-password';

  function isPublicAuthPath(pathname: string) {
    return pathname === '/login' || pathname === passwordSetupPath;
  }

  onMount(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      signedIn = Boolean(data.session);
      email = data.session?.user.email ?? '';
      ready = true;
      if (!signedIn && !isPublicAuthPath($page.url.pathname)) goto('/login');
      if (signedIn && $page.url.pathname === '/login') goto('/');
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      signedIn = Boolean(session);
      email = session?.user.email ?? '';
      if (!signedIn && !isPublicAuthPath($page.url.pathname)) goto('/login');
      if (signedIn && $page.url.pathname === '/login') goto('/');
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  });

  async function signOut() {
    await supabase.auth.signOut();
    await goto('/login');
  }

  $: current = $page.url.pathname;
</script>

<svelte:head><title>Admin · Northstar</title><meta name="description" content="E-commerce administration dashboard" /></svelte:head>

{#if !ready}
  <div class="boot-screen"><span class="brand-mark">N</span><span class="spinner"></span></div>
{:else if current === '/login'}
  <slot />
{:else if current === '/auth/setup-password'}
  <slot />
{:else if signedIn}
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/"><span class="brand-mark">N</span><span>northstar<small>COMMERCE ADMIN</small></span></a>
      <div class="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        <a class:active={current === '/'} href="/"><span class="nav-icon">◫</span>Overview</a>
        <a class:active={current.startsWith('/products')} href="/products"><span class="nav-icon">▦</span>Products</a>
        <a class:active={current.startsWith('/categories')} href="/categories"><span class="nav-icon">◈</span>Categories</a>
        <a class:active={current.startsWith('/inventory')} href="/inventory"><span class="nav-icon">▤</span>Inventory</a>
        <a class:active={current.startsWith('/orders')} href="/orders"><span class="nav-icon">▣</span>Orders</a>
        <a class:active={current.startsWith('/analytics')} href="/analytics"><span class="nav-icon">⌁</span>Analytics</a>
      </nav>
      <div class="sidebar-bottom">
        <div class="secure-note"><span class="secure-dot"></span><span><strong>Secure workspace</strong><small>Admin access only</small></span></div>
        <button class="profile-button" on:click={signOut}><span class="avatar">{email.slice(0, 1).toUpperCase() || 'A'}</span><span class="profile-text"><strong>{email || 'Administrator'}</strong><small>Sign out</small></span><span class="signout">↗</span></button>
      </div>
    </aside>
    <main class="main-area">
      <header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <strong>{current === '/' ? 'Overview' : current.split('/')[1]?.replace(/^\w/, (letter) => letter.toUpperCase())}</strong></div><div class="topbar-right"><span class="live-dot"></span> Admin console <span class="topbar-divider"></span><span class="date-label">{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div></header>
      <div class="content"><slot /></div>
    </main>
  </div>
{/if}
