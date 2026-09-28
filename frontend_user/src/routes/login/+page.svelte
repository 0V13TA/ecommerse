<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  let email = '';
  let password = '';
  let firstName = '';
  let lastName = '';
  let error = '';
  let notice = '';
  let busy = false;
  let mode: 'signin' | 'signup' = 'signin';
  $: redirectTo = safeRedirect($page.url.searchParams.get('redirect'));

  function safeRedirect(value: string | null) {
    return value && value.startsWith('/') && !value.startsWith('//') ? value : '/account';
  }

  onMount(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) await goto(redirectTo);
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    notice = '';
    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { first_name: firstName, last_name: lastName },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`
          }
        });
        if (authError) throw authError;
        if (data.session) {
          await goto(redirectTo);
        } else {
          notice = 'Check your email for a confirmation link, then return here to sign in.';
          mode = 'signin';
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        await goto(redirectTo);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Authentication failed. Please try again.';
    } finally {
      busy = false;
    }
  }

  async function googleSignIn() {
    busy = true;
    error = '';
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`
        }
      });
      if (authError) throw authError;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Google sign-in could not be started.';
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{mode === 'signin' ? 'Sign in' : 'Create account'} — Goodfolk</title>
  <meta name="description" content="Sign in or create a Goodfolk customer account." />
</svelte:head>

<section class="section-wrap auth-page">
  <div class="auth-card">
    <p class="eyebrow">GOOD TO HAVE YOU</p>
    <h1>{mode === 'signin' ? 'Welcome back.' : 'A place for your orders.'}</h1>
    <p class="auth-description">Browse and fill your bag freely. Sign in when you’re ready to checkout.</p>
    <button class="button button-google" type="button" onclick={googleSignIn} disabled={busy}>
      <span class="google-mark" aria-hidden="true">G</span> Continue with Google
    </button>
    <div class="auth-divider"><span>or use email</span></div>
    <form onsubmit={submit}>
      {#if mode === 'signup'}
        <div class="form-grid auth-name-grid">
          <label>First name<input autocomplete="given-name" bind:value={firstName} required /></label>
          <label>Last name<input autocomplete="family-name" bind:value={lastName} required /></label>
        </div>
      {/if}
      <label>Email address<input type="email" autocomplete="email" bind:value={email} required /></label>
      <label>Password<input type="password" autocomplete={mode === 'signin' ? 'current-password' : 'new-password'} minlength="8" bind:value={password} required /></label>
      {#if error}<div class="form-error" role="alert">{error}</div>{/if}
      {#if notice}<div class="form-success" role="status">{notice}</div>{/if}
      <button class="button button-dark auth-submit" type="submit" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <span aria-hidden="true">→</span>
      </button>
    </form>
    <p class="auth-switch">
      {mode === 'signin' ? 'New to Goodfolk?' : 'Already have an account?'}
      <button type="button" onclick={() => { mode = mode === 'signin' ? 'signup' : 'signin'; error = ''; notice = ''; }}>
        {mode === 'signin' ? 'Create an account' : 'Sign in'}
      </button>
    </p>
  </div>
</section>
