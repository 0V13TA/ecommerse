import type { PageLoad } from './$types';
import type { OrderConfirmation } from '$lib/types';

export const load: PageLoad = async ({ fetch, url }) => {
  const paymentReference = url.searchParams.get('reference') || '';
  const orderReference = url.searchParams.get('orderReference') || '';
  const reference = paymentReference || orderReference;
  if (!reference) {
    return {
      order: null as OrderConfirmation | null,
      reference: '',
      paymentReference: false,
      error: null
    };
  }

  return {
    order: null as OrderConfirmation | null,
    reference,
    paymentReference: !!paymentReference,
    error: null
  };
};
