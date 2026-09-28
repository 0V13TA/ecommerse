import type { PageLoad } from './$types';
import { getProduct } from '$lib/api';
import type { Product } from '$lib/types';

export const load: PageLoad = async ({ fetch, params }) => {
  try {
    return { product: await getProduct(params.slug, fetch), error: null };
  } catch (error) {
    return {
      product: null as Product | null,
      error: error instanceof Error ? error.message : 'This product could not be loaded.'
    };
  }
};
