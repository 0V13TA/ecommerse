<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { storeBrand } from '$lib/brand';
  import { supabase } from '$lib/supabase';
  import { formatPrice } from '$lib/cart';
  import { getCustomerOrders, getCustomerProfile, updateCustomerProfile, uploadCustomerAvatar } from '$lib/api';
  import OrderProgress from '$lib/components/OrderProgress.svelte';
  import type { CustomerProfile } from '$lib/api';
  import type { OrderConfirmation } from '$lib/types';

  let profile: CustomerProfile | null = null;
  let orders: OrderConfirmation[] = [];
  let loading = true;
  let saving = false;
  let error = '';
  let notice = '';
  let avatarInput: HTMLInputElement;

  onMount(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      await goto(`/login?redirect=${encodeURIComponent('/account')}`);
      return;
    }
    try {
      [profile, orders] = await Promise.all([getCustomerProfile(), getCustomerOrders()]);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Your account could not be loaded.';
    } finally {
      loading = false;
    }
  });

  async function saveProfile(event: SubmitEvent) {
    event.preventDefault();
    if (!profile || saving) return;
    saving = true;
    error = '';
    notice = '';
    try {
      profile = await updateCustomerProfile(profile);
      notice = 'Your profile and delivery address have been saved.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Your profile could not be saved.';
    } finally {
      saving = false;
    }
  }

  async function updateAvatar(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || saving) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
      error = 'Choose a JPEG, PNG, WebP, or AVIF image.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      error = 'Profile images must be 5 MB or smaller.';
      return;
    }
    saving = true;
    error = '';
    notice = '';
    try {
      profile = await uploadCustomerAvatar(file);
      notice = 'Your profile picture has been updated.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Your profile picture could not be updated.';
    } finally {
      saving = false;
      input.value = '';
    }
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      error = 'You could not be signed out. Please try again.';
      return;
    }
    await goto('/');
  }
</script>

<svelte:head>
  <title>Your account — {storeBrand.name}</title>
  <meta name="description" content={`Manage your ${storeBrand.name} ${storeBrand.accountDescription}`} />
</svelte:head>

<section class="section-wrap account-page">
  <header class="page-heading account-heading">
    <div><p class="eyebrow">YOUR {storeBrand.name.toUpperCase()} ACCOUNT</p><h1>Your account<span class="wordmark-period">.</span></h1><p>Profile, delivery details, and every order in one place.</p></div>
    <button class="text-button" type="button" onclick={signOut}>Sign out <span aria-hidden="true">↗</span></button>
  </header>
  {#if error}<div class="form-error account-alert" role="alert">{error}</div>{/if}
  {#if notice}<div class="form-success account-alert" role="status">{notice}</div>{/if}
  {#if loading}
    <div class="state-panel"><span class="state-icon">◷</span><h2>Loading your account.</h2></div>
  {:else if profile}
    <div class="account-layout">
      <section class="account-panel">
        <div class="account-panel-heading"><div><p class="eyebrow">YOUR DETAILS</p><h2>Profile & delivery</h2></div></div>
        <div class="avatar-editor">
          {#if profile.avatar_url}<img src={profile.avatar_url} alt="Your profile" class="profile-avatar" />{:else}<span class="profile-avatar avatar-initial">{profile.first_name.slice(0, 1).toUpperCase() || 'G'}</span>{/if}
          <div><strong>{profile.email}</strong><button type="button" class="text-button" onclick={() => avatarInput?.click()} disabled={saving}>Change profile picture</button><input bind:this={avatarInput} class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onchange={updateAvatar} /></div>
        </div>
        <form class="account-form" onsubmit={saveProfile}>
          <div class="form-grid">
            <label>First name<input autocomplete="given-name" bind:value={profile.first_name} required /></label>
            <label>Last name<input autocomplete="family-name" bind:value={profile.last_name} required /></label>
            <label class="full-field">Phone number<input type="tel" autocomplete="tel" bind:value={profile.phone} required /></label>
            <label class="full-field">Street address<input autocomplete="street-address" bind:value={profile.address} required /></label>
            <label>City<input autocomplete="address-level2" bind:value={profile.city} required /></label>
            <label>Country<input autocomplete="country-name" bind:value={profile.country} required /></label>
          </div>
          <button class="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </form>
      </section>
      <section class="account-orders">
        <div class="account-panel-heading"><div><p class="eyebrow">YOUR PURCHASES</p><h2>Order history</h2></div><span class="order-count">{orders.length} {orders.length === 1 ? 'order' : 'orders'}</span></div>
        {#if orders.length === 0}
          <div class="account-panel empty-account-orders"><span class="state-icon">▱</span><h3>No orders yet.</h3><p>Your orders and receipts will appear here after checkout.</p><a class="button button-dark" href="/">Explore the collection</a></div>
        {:else}
          <div class="order-history-list">
            {#each orders as order (order.orderReference)}
              <article class="account-order-card">
                <div class="account-order-top"><div><p class="eyebrow">ORDER</p><a href={`/account/orders/${encodeURIComponent(order.orderReference)}`} class="account-order-reference">{order.orderReference}</a></div><div class="account-order-total"><small>{order.created_at ? new Date(order.created_at).toLocaleDateString() : ''}</small><strong>{formatPrice(order.total ?? 0, order.currency ?? 'NGN')}</strong></div></div>
                <div class="order-badge-row"><span class={`order-status-badge status-${order.status}`}>{order.status.replace(/_/g, ' ')}</span><span class={`payment-status-badge payment-${order.paymentStatus ?? 'pending'}`}>Payment {order.paymentStatus ?? 'pending'}</span></div>
                <OrderProgress status={order.status} />
                <a class="order-card-link" href={`/account/orders/${encodeURIComponent(order.orderReference)}`}>View receipt and details <span aria-hidden="true">→</span></a>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</section>
