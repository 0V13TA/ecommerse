<script lang="ts">
  import { onMount } from 'svelte';
  import { api, records } from '$lib/api';
  import type { Category } from '$lib/types';
  let categories: Category[] = [];
  let loading = true;
  let error = '';
  let name = '';
  let description = '';
  let editing = '';
  let busy = false;

  async function load() {
    try { categories = records(await api.categories()); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not load categories.'; }
    finally { loading = false; }
  }
  onMount(load);
  function startEdit(category: Category) { editing = category.id; name = category.name; description = category.description ?? ''; }
  function reset() { editing = ''; name = ''; description = ''; }
  async function save(event: SubmitEvent) {
    event.preventDefault(); error = ''; busy = true;
    try {
      const payload = { name: name.trim(), description: description.trim() };
      if (editing) await api.updateCategory(editing, payload); else await api.createCategory(payload);
      reset(); await load();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not save category.'; }
    finally { busy = false; }
  }
  async function remove(category: Category) {
    if (!confirm(`Delete category “${category.name}”?`)) return;
    try { await api.deleteCategory(category.id); categories = categories.filter((item) => item.id !== category.id); }
    catch (e) { error = e instanceof Error ? e.message : 'Could not delete category.'; }
  }
</script>

<section class="page-heading"><div><div class="eyebrow">CATALOG</div><h1>Categories</h1><p>Organize products so customers can find what they need.</p></div></section>
{#if error}<div class="notice notice-error">{error}</div>{/if}
<div class="category-layout">
  <section class="panel category-list"><div class="panel-heading"><div><h2>Your categories</h2><p>{categories.length} categories</p></div><span class="category-glyph">◈</span></div>
    {#if loading}<div class="loading-line"><span class="spinner"></span> Loading categories…</div>{:else if categories.length}<div class="category-rows">{#each categories as category}<div class="category-row"><span class="category-icon">◈</span><div class="category-info"><strong>{category.name}</strong><small>{category.description || 'No description'}</small></div><div class="row-actions"><button class="link-button" on:click={() => startEdit(category)}>Edit</button><button class="icon-button danger-text" on:click={() => remove(category)} aria-label={`Delete ${category.name}`}>×</button></div></div>{/each}</div>{:else}<div class="empty-state">No categories created yet.</div>{/if}
  </section>
  <section class="panel category-editor"><div class="panel-heading"><div><h2>{editing ? 'Edit category' : 'New category'}</h2><p>{editing ? 'Update the category details.' : 'Add a category to your catalog.'}</p></div></div>
    <form on:submit={save}><div class="field"><label for="category-name">Name <span>*</span></label><input id="category-name" bind:value={name} required maxlength="100" placeholder="e.g. Accessories" /></div><div class="field"><label for="category-description">Description</label><textarea id="category-description" bind:value={description} rows="4" placeholder="Optional short description"></textarea></div><div class="form-actions"><button type="button" class="button button-light" on:click={reset}>{editing ? 'Cancel' : 'Clear'}</button><button class="button button-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save category' : 'Create category'}</button></div></form>
  </section>
</div>
