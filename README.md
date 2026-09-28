# Single-company e-commerce

The project contains two independent SvelteKit frontends and a shared Express API:

- `frontend_user` — public guest storefront
- `frontend_dashboard` — Supabase-authenticated admin application
- `backend` — API, payment processing, and business rules
- `supabase/migrations` — PostgreSQL schema

## Requirements

- Node.js 20+
- A Supabase project with PostgreSQL, Auth, and a Storage bucket
- A Paystack account and API secret

## Setup

1. Copy each `.env.example` to `.env` in the corresponding app and configure values.
2. Apply the SQL migration in `supabase/migrations` to the Supabase database.
3. Create the public Supabase Storage bucket named `product-images` (or set `SUPABASE_STORAGE_BUCKET`).
4. Create or invite administrator accounts in Supabase Auth; public self-registration is not
   provided. After creating each account, add its UUID to `admin_users` to authorize it:

   ```sql
   insert into public.admin_users (user_id)
   values ('SUPABASE_AUTH_USER_UUID');
   ```

5. Install dependencies at the repository root with `npm install`.
6. Start the API, storefront, and admin in separate terminals with `npm run dev:api`, `npm run dev:storefront`, and `npm run dev:admin`.

Set the frontend `PUBLIC_API_URL` values to the API origin, such as `http://localhost:3001`.
Configure Supabase Auth's site URL and allowed redirect URLs for the admin origin. The API's
`CORS_ORIGINS` must contain the exact storefront and admin origins.
Configure Paystack's webhook URL as `https://api.example.com/api/v1/webhooks/paystack`, and
set `PAYSTACK_CALLBACK_URL` to the deployed storefront's `/checkout/return` route. Use HTTPS
for all production origins.

The admin session stays on `admin.example.com` and the admin app sends its Supabase access
token to the API in an `Authorization` header. It does not use a shared cookie with
`example.com`; customer shopping remains guest-only. The API validates the token and checks
`admin_users` on each protected request, independently of frontend route guards.

The API uses a direct PostgreSQL connection (`DATABASE_URL`) so inventory reservations and
payment updates can run in database transactions. Use a Supavisor session-mode or direct
connection string suitable for a long-lived Node.js process.

## API overview

All endpoints are under `/api/v1`. The public API provides `GET /categories`,
`GET /products`, `GET /products/:slug`, `POST /checkout`, `GET /orders/:orderReference`,
and `GET /payments/:reference/verify`. Paystack calls `POST /webhooks/paystack`.

All `/admin/*` routes require a valid Supabase bearer token and an entry in `admin_users`.
They provide dashboard statistics, product/category CRUD, product-image upload/deletion,
low-stock inventory lookup and updates, and order listing/details/status transitions.
The separate admin origin receives no special trust from the API: CORS is restricted to the
configured origins, while authorization is performed for every admin request.

## Payment and inventory behavior

Checkout creates a pending order and temporarily reserves its stock for 15 minutes before
initializing Paystack. The browser return page is not proof of payment: payment completion
is applied only after server-side Paystack verification. The webhook signature is validated
against the raw request body, and its event is verified with Paystack before changing order
or inventory state. The API periodically releases expired stock reservations in-process.
