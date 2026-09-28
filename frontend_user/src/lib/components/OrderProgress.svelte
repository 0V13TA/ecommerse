<script lang="ts">
  export let status: string;
  const steps = [
    { id: 'received', label: 'Order received' },
    { id: 'processing', label: 'Processing' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'delivered', label: 'Delivered' }
  ];
  $: current = steps.findIndex((step) => step.id === status);
</script>

{#if status === 'cancelled'}
  <p class="order-cancelled"><span class="order-status-badge">Cancelled</span> This order will not be fulfilled.</p>
{:else if status !== 'pending_payment'}
  <ol class="order-progress" aria-label={`Order progress: ${status.replace(/_/g, ' ')}`}>
    {#each steps as step, index}
      <li class:complete={index <= current} class:current={index === current}>
        <span class="progress-dot">{index < current ? '✓' : index + 1}</span>
        <span>{step.label}</span>
      </li>
    {/each}
  </ol>
{:else}
  <p class="order-cancelled"><span class="order-status-badge pending">Awaiting payment</span> Your order will be received after payment is verified.</p>
{/if}
