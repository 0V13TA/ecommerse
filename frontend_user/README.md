# Goodfolk storefront

A self-contained SvelteKit + TypeScript storefront. The frontend is a guest checkout client; product, order, and payment data come from the shared backend, and payment is completed on Paystack's hosted checkout.

## Run locally

1. Copy `.env.example` to `.env` and set `PUBLIC_API_URL` to the backend origin (for example `http://localhost:3001`).
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.

`npm run check` runs Svelte/TypeScript diagnostics and `npm run build` creates a production build. The API must allow browser requests from the storefront origin (CORS).

## Backend contract

The configured API origin is combined with `/api/v1`:

- `GET /products?category=<slug>&page=1` returns `{ products, page, limit, total }`
- `GET /categories` returns `{ categories }`
- `GET /products/:slug` returns `{ product }`
- `POST /checkout` with `{ items: [{ productId, quantity }], customer: { email, firstName, lastName, phone, address, city, country } }`
- `GET /orders/:orderReference` returns `{ order }` for safe public confirmation
- `GET /payments/:reference/verify` verifies a Paystack payment reference and returns `{ order }`

Checkout responds with `{ orderReference, paymentUrl }`. The storefront only follows HTTPS payment URLs hosted on `paystack.com` and redirects the guest to Paystack. The payment confirmation routes `/checkout/confirmation` and `/checkout/return` accept `?reference=` from Paystack and verify it through `/payments/:reference/verify`; an explicit `?orderReference=` checks the safe public order endpoint. The local cart is cleared only after a paid status is confirmed. The callback route `/checkout/confirmation` matches the backend callback URL.

Product data follows the backend's snake_case fields (`price_minor`, `stock_on_hand`, `category_name`, `images`); minor-unit prices are displayed in major currency units. The API client also accepts numeric `price` and common wrapped/array list responses.
