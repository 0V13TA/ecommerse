<script lang="ts">
  import Confirmation from '../return/+page.svelte';

  export let data: {
    order: import('$lib/types').OrderConfirmation | null;
    reference: string;
    paymentReference: boolean;
    error: string | null;
  };
</script>

<Confirmation {data} />
