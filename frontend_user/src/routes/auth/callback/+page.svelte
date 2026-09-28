<script lang="ts">
  import { onMount } from 'svelte';
  import { storeBrand } from '$lib/brand';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  let error = '';

  function safeRedirect(value: string | null) {
    return value && value.startsWith('/') && !value.startsWith('//') ? value : '/account';
  }

  onMount(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session) {
      error = sessionError?.message || 'This sign-in link is invalid or has expired. Please try again.';
      return;
    }
    await goto(safeRedirect($page.url.searchParams.get('next')));
  });
</script>

<svelte:head><title>Finishing sign in — {storeBrand.name}</title></svelte:head>
<section class="section-wrap auth-page">
  <div class="auth-card auth-message">
    <p class="eyebrow">SECURE SIGN IN</p>
    <h1>{error ? 'Sign-in link unavailable.' : 'One moment.'}</h1>
    <p>{error || 'We’re finishing your sign-in and returning you to your order.'}</p>
    {#if error}<div class="form-error" role="alert">{error}</div><a class="button button-dark" href="/login">Back to sign in</a>{/if}
  </div>
</section>
