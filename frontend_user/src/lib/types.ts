export interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  price: number;
  price_minor?: number | string;
  currency?: string;
  imageUrl?: string | null;
  image?: string | null;
  images?: Array<{ id?: string; url: string; altText?: string | null }>;
  category?: string | { name: string; slug?: string } | null;
  categoryName?: string | null;
  stock?: number | null;
  stock_on_hand?: number | null;
  category_name?: string | null;
  category_slug?: string | null;
}

export interface Category {
  id?: string;
  name: string;
  slug: string;
}

export interface ProductPage {
  products: Product[];
  page: number;
  totalPages?: number;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface CheckoutRequest {
  items: Array<{ productId: string; quantity: number }>;
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    address: string;
    city: string;
    country: string;
  };
}

export interface CheckoutResponse {
  orderReference: string;
  paymentUrl: string;
}

export interface OrderConfirmation {
  orderReference: string;
  status: string;
  total?: number | null;
  currency?: string | null;
  customerName?: string | null;
  items?: Array<{ name?: string; productName?: string; quantity: number; unitPriceMinor?: number | string }>;
  order_reference?: string;
  order_status?: string;
  payment_status?: string;
  total_minor?: number | string;
  customer_first_name?: string;
}
