<script lang="ts">
  import { cart, formatPrice, removeFromCart, setCartQuantity } from '$lib/cart';
  import type { CartLine } from '$lib/types';

  let lines: CartLine[] = [];
  let subtotal = 0;
  $: lines = $cart;
  $: subtotal = lines.reduce((sum: number, line: CartLine) => sum + line.product.price * line.quantity, 0);
</script>

<svelte:head>
  <title>Your bag — Goodfolk</title>
  <meta name="description" content="Review the thoughtful finds in your shopping bag." />
</svelte:head>

<section class="section-wrap cart-page">
  <div class="page-heading">
    <p class="eyebrow">YOUR GOOD FINDS</p>
    <h1>Your bag<span class="wordmark-period">.</span></h1>
  </div>

  {#if lines.length === 0}
    <div class="state-panel empty-cart">
      <span class="state-icon">▱</span>
      <h2>Your bag is taking a little breather.</h2>
      <p>Find something useful, lovely, or a little bit of both.</p>
      <a class="button button-dark" href="/">Explore the collection</a>
    </div>
  {:else}
    <div class="cart-layout">
      <div class="cart-lines">
        {#each lines as line (line.product.id)}
          <article class="cart-line">
            <a class="cart-thumb" href={`/products/${encodeURIComponent(line.product.slug)}?from=cart`}>
              {#if line.product.imageUrl || line.product.image}
                <img src={line.product.imageUrl || line.product.image || ''} alt={line.product.name} />
              {:else}
                <div class="image-placeholder"><span>{line.product.name.slice(0, 1)}</span></div>
              {/if}
            </a>
            <div class="cart-line-info">
              <a href={`/products/${encodeURIComponent(line.product.slug)}?from=cart`} class="cart-product-name">{line.product.name}</a>
              <p>{formatPrice(line.product.price, line.product.currency)}</p>
              <button class="remove-button" onclick={() => removeFromCart(line.product.id)}>Remove</button>
            </div>
            <div class="quantity-control" aria-label={`Quantity for ${line.product.name}`}>
              <button aria-label="Decrease quantity" onclick={() => setCartQuantity(line.product.id, line.quantity - 1)}>−</button>
              <span>{line.quantity}</span>
              <button aria-label="Increase quantity" onclick={() => setCartQuantity(line.product.id, line.quantity + 1)}>+</button>
            </div>
            <strong class="line-total">{formatPrice(line.product.price * line.quantity, line.product.currency)}</strong>
          </article>
        {/each}
      </div>
      <aside class="order-summary">
        <p class="eyebrow">THE DETAILS</p>
        <div class="summary-row"><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
        <p class="summary-note">Shipping and any applicable charges are calculated at checkout.</p>
        <a href="/checkout" class="button button-dark checkout-button">Continue to checkout <span aria-hidden="true">→</span></a>
        <a href="/" class="continue-link">Continue shopping</a>
        <div class="secure-note"><span aria-hidden="true">♡</span> Secure payment powered by Paystack</div>
      </aside>
    </div>
  {/if}
</section>
