import type { PageLoad } from './$types';
import { getCategories, getProducts } from '$lib/api';

export const load: PageLoad = async ({ fetch, url }) => {
  const category = url.searchParams.get('category') || undefined;
  const [productsResult, categoriesResult] = await Promise.allSettled([
    getProducts({ category, page: 1 }, fetch),
    getCategories(fetch)
  ]);

  return {
    category,
    products: productsResult.status === 'fulfilled' ? productsResult.value.products : [],
    categories: categoriesResult.status === 'fulfilled' ? categoriesResult.value : [],
    productsError:
      productsResult.status === 'rejected'
        ? productsResult.reason instanceof Error
          ? productsResult.reason.message
          : 'Products are temporarily unavailable.'
        : null,
    categoriesError: categoriesResult.status === 'rejected'
  };
};
