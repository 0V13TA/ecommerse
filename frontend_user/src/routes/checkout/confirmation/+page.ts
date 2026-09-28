import type { PageLoad } from './$types';
import { getOrder, verifyPayment } from '$lib/api';
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

  try {
    const order = paymentReference
      ? await verifyPayment(paymentReference, fetch)
      : await getOrder(orderReference, fetch);
    return { order, reference, paymentReference: !!paymentReference, error: null };
  } catch (error) {
    return {
      order: null as OrderConfirmation | null,
      reference,
      paymentReference: !!paymentReference,
      error: error instanceof Error ? error.message : 'We could not check your order yet.'
    };
  }
};
