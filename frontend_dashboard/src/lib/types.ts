export interface Product {
  id: string;
  name: string;
  slug?: string;
  sku?: string | null;
  description?: string | null;
  price: number;
  priceMinor: number;
  currency: string;
  stockOnHand: number;
  lowStockThreshold: number;
  categoryId?: string | null;
  category?: { id: string; name: string } | string | null;
  imageUrl?: string | null;
  status?: string;
  isAvailable?: boolean;
  images?: ProductImage[];
  [key: string]: unknown;
}

export interface ProductImage {
  id: string;
  url: string;
  altText?: string | null;
  sort_order?: number;
}

export interface Category {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
}

export interface OrderItem {
  id?: string;
  name?: string;
  quantity: number;
  price?: number;
  priceMinor?: number;
  currency?: string;
}

export interface Order {
  id: string;
  orderNumber?: string;
  customerName?: string;
  customerEmail?: string;
  customerId?: string;
  customer_phone?: string;
  shipping_address?: string;
  shipping_city?: string;
  shipping_country?: string;
  order_status: string;
  payment_status?: string;
  total: number;
  total_minor: number;
  currency: string;
  createdAt?: string;
  items?: OrderItem[];
  [key: string]: unknown;
}

export interface CustomerOrderHistory {
  customer: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
    address: string;
    city: string;
    country: string;
  };
  orders: Order[];
}

export interface DashboardStats {
  totalSalesMinor?: number;
  totalSales?: number;
  totalOrders?: number;
  totalProducts?: number;
  lowStockCount?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface SalesOverTime {
  date: string;
  total: number;
  totalMinor: number;
}

export interface ProductInput {
  name: string;
  sku: string;
  description: string;
  price: number;
  currency: string;
  stockOnHand: number;
  lowStockThreshold: number;
  categoryId: string | null;
  status: 'active' | 'inactive';
}
