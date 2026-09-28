<script lang="ts">
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  let email = '';
  let password = '';
  let error = '';
  let busy = false;

  async function login(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    busy = true;
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    busy = false;
    if (authError) error = 'Unable to sign in. Check your credentials and admin access.';
    else await goto('/');
  }
</script>

<svelte:head><title>Sign in · Northstar Admin</title></svelte:head>
<main class="login-page">
  <section class="login-card">
    <a class="brand login-brand" href="/"><span class="brand-mark">N</span><span>northstar<small>COMMERCE ADMIN</small></span></a>
    <div class="login-intro"><div class="eyebrow">ADMINISTRATOR ACCESS</div><h1>Welcome back</h1><p>Sign in to manage your store operations.</p></div>
    <form on:submit={login}>
      <label for="email">Email address</label>
      <input id="email" type="email" bind:value={email} placeholder="you@company.com" autocomplete="username" required />
      <div class="password-label"><label for="password">Password</label></div>
      <input id="password" type="password" bind:value={password} placeholder="Enter your password" autocomplete="current-password" required />
      {#if error}<div class="form-error" role="alert">{error}</div>{/if}
      <button class="button button-primary login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span>→</span></button>
    </form>
    <div class="login-footer"><span class="secure-dot"></span> Protected with secure authentication</div>
  </section>
  <div class="login-aside"><div class="aside-orb"></div><div class="aside-copy"><div class="eyebrow">YOUR BUSINESS, IN FOCUS</div><h2>Everything your store needs.<br /><em>All in one place.</em></h2><p>Thoughtful tools for the people who keep commerce moving.</p></div><div class="aside-caption">NORTHSTAR COMMERCE · ADMIN PORTAL</div></div>
</main>
