<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  import { adminBrand } from '$lib/brand';

  let ready = false;
  let sessionValid = false;
  let email = '';
  let password = '';
  let confirmPassword = '';
  let error = '';
  let busy = false;
  let saved = false;

  onMount(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      error = 'This invitation could not be verified. Request a new invitation and try again.';
    } else if (!data.session) {
      error = 'This invitation link is invalid or expired. Request a new invitation and try again.';
    } else {
      sessionValid = true;
      email = data.session.user.email ?? '';
    }
    ready = true;
  });

  async function setPassword(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (password.length < 8) {
      error = 'Use a password with at least 8 characters.';
      return;
    }
    if (password !== confirmPassword) {
      error = 'The passwords do not match.';
      return;
    }

    busy = true;
    const { error: updateError } = await supabase.auth.updateUser({ password });
    busy = false;
    if (updateError) {
      error = updateError.message;
      return;
    }

    saved = true;
  }

  async function continueToDashboard() {
    await goto('/');
  }
</script>

<svelte:head><title>Set password · {adminBrand.name} Admin</title></svelte:head>
<main class="login-page">
  <section class="login-card">
    <a class="brand login-brand" href="/"><span class="brand-mark">{adminBrand.mark}</span><span>{adminBrand.name.toLowerCase()}<small>{adminBrand.descriptor.toUpperCase()}</small></span></a>
    {#if !ready}
      <div class="login-intro"><h1>Checking invitation</h1><p>Please wait while we verify your secure link.</p></div>
    {:else if !sessionValid}
      <div class="login-intro"><div class="eyebrow">INVITATION REQUIRED</div><h1>Link unavailable</h1><p>Request a new administrator invitation and open its link in this browser.</p></div>
      <div class="form-error" role="alert">{error}</div>
    {:else if saved}
      <div class="login-intro"><div class="eyebrow">ACCOUNT READY</div><h1>Password set</h1><p>Your administrator password has been saved{email ? ` for ${email}` : ''}.</p></div>
      <button class="button button-primary login-submit" on:click={continueToDashboard}>Continue to dashboard <span>→</span></button>
    {:else}
      <div class="login-intro"><div class="eyebrow">FINISH ACCOUNT SETUP</div><h1>Choose a password</h1><p>{email ? `Set a password for ${email}.` : 'Set a password to finish activating your administrator account.'}</p></div>
      <form on:submit={setPassword}>
        <label for="password">Password</label>
        <input id="password" type="password" bind:value={password} autocomplete="new-password" minlength="8" required />
        <label for="confirm-password">Confirm password</label>
        <input id="confirm-password" type="password" bind:value={confirmPassword} autocomplete="new-password" minlength="8" required />
        {#if error}<div class="form-error" role="alert">{error}</div>{/if}
        <button class="button button-primary login-submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'} <span>→</span></button>
      </form>
    {/if}
    <div class="login-footer"><span class="secure-dot"></span> Protected with secure authentication</div>
  </section>
  <div class="login-aside"><div class="aside-orb"></div><div class="aside-copy"><div class="eyebrow">YOUR BUSINESS, IN FOCUS</div><h2>Everything your store needs.<br /><em>All in one place.</em></h2><p>Thoughtful tools for the people who keep commerce moving.</p></div><div class="aside-caption">{adminBrand.name.toUpperCase()} {adminBrand.descriptor.toUpperCase()} · ADMIN PORTAL</div></div>
</main>
