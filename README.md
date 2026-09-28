# Single-company e-commerce

The project contains two independent SvelteKit frontends and a shared Express API:

- `frontend_user` — public storefront, with guest browsing/cart and authenticated checkout/accounts
- `frontend_dashboard` — Supabase-authenticated admin application
- `backend` — API, payment processing, and business rules
- `supabase/migrations` — PostgreSQL schema

## Requirements

- Node.js 20+
- A Supabase project with PostgreSQL, Auth, and a Storage bucket
- A Paystack account and API secret

## Setup

1. Copy each `.env.example` to `.env` in the corresponding app and configure values.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and, for a local database,
   start its services with Docker:

   ```sh
   supabase start
   supabase db reset
   ```

   `db reset` recreates the local database, applies every migration in `supabase/migrations`,
   then runs `supabase/seed.sql` as configured in `supabase/config.toml`. This reset is
   destructive to the local Supabase database.
3. To apply migrations to a hosted Supabase project, link the project and push migrations:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

   `db push` applies migrations; it does not run the demo seed. Only seed a development/test
   project, for example with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql`.
   The seed is safe to run repeatedly and does not create fake orders or payments.
   To apply a newly added migration to the running local database without deleting its users
   or data, run `supabase migration up` from the repository root. Do not use `supabase db reset`
   for normal schema updates; reset recreates the local database.
4. Create the public Supabase Storage bucket named `product-images` (or set `SUPABASE_STORAGE_BUCKET`).
   Product and customer profile images are stored in this bucket.
5. Create or invite administrator accounts in Supabase Auth; public self-registration is not
   provided. After creating each account, add its UUID to `admin_users` to authorize it:

   ```sql
   insert into public.admin_users (user_id)
   values ('SUPABASE_AUTH_USER_UUID');
   ```

   There is no built-in admin password. Set the password when creating the user in Supabase
   Auth, or use the invitation flow. The admin dev server uses `http://localhost:5175`, and
   local Supabase Auth redirects invitations to its `/auth/setup-password` route. Restart local Supabase after
   changing `supabase/config.toml` (`supabase stop` followed by `supabase start`; this does not
   reset the database). Open the invitation in Mailpit and choose a password on
   `http://localhost:5175/auth/setup-password`. To authorize an existing user by email, run this in the SQL Editor
   after replacing the address:

   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where lower(email) = lower('admin@example.com')
   on conflict (user_id) do nothing;
   ```

6. Install dependencies at the repository root with `npm install`.
7. Start the API, storefront, and admin in separate terminals with `npm run dev:api`, `npm run dev:storefront`, and `npm run dev:admin`.

For local development, point both frontends' `PUBLIC_API_URL` at `http://localhost:3001`.
Set both frontends' `PUBLIC_SUPABASE_URL` to `http://127.0.0.1:54321` and
`PUBLIC_SUPABASE_ANON_KEY` to the local publishable/anon key reported by `supabase status`;
never use the service-role/secret key in a frontend. The backend
should use the local database URL `postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
the same local Supabase URL, and the local service-role key from `supabase status`. Keep that
service-role key only in `backend/.env`. Include `http://localhost:5175` in the backend's
`CORS_ORIGINS`; the storefront may run on either 5173 or 5174. The local config allows the
admin and storefront callback routes; restart Supabase after editing `supabase/config.toml`.
For Google sign-in, configure the Google provider in Supabase Auth with Google OAuth client
credentials. For local Supabase CLI, enable `auth.external.google` in `supabase/config.toml`
and provide `client_id` and `secret` through environment references such as
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` and
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`. Add Supabase's Auth callback URL
(`http://127.0.0.1:54321/auth/v1/callback`) to Google's authorized redirect URLs and
`http://localhost:5174/auth/callback` to Supabase's redirect allow-list. For hosted environments,
add the project Auth callback URL from Supabase settings to Google's authorized redirect URLs
and the exact storefront callback (`https://example.com/auth/callback`) to Supabase's redirect
allow-list. The API's `CORS_ORIGINS` must contain the exact storefront and admin origins.
Configure Paystack's webhook URL as `https://api.example.com/api/v1/webhooks/paystack`, and
set `PAYSTACK_CALLBACK_URL` to the deployed storefront's `/checkout/return` route (locally
`http://localhost:5174/checkout/return`). The storefront opens Paystack Inline from the
server-initialized access code; the hosted authorization URL remains a fallback. Set the
company display name and logo in Paystack's merchant/business settings. Use HTTPS for production.

The admin session stays on `admin.example.com` and the admin app sends its Supabase access
token to the API in an `Authorization` header. It does not use a shared cookie with
`example.com`. The customer session is stored on the storefront origin and its bearer token is
sent to customer API routes. Browsing and cart use remain guest-friendly; checkout, profiles,
and order history require a confirmed Supabase account. The API verifies customer tokens and
scopes profile, checkout, payment verification, and receipt queries to that customer. Existing
guest orders are associated with an account only after Supabase confirms the matching email.
The API validates admin tokens and checks `admin_users` on each admin request, independently
of frontend route guards.

The API uses a direct PostgreSQL connection (`DATABASE_URL`) so inventory reservations and
payment updates can run in database transactions. Use a Supavisor session-mode or direct
connection string suitable for a long-lived Node.js process.

## API overview

All endpoints are under `/api/v1`. The public API provides `GET /categories`,
`GET /products`, and `GET /products/:slug`. Customer bearer authentication is required for
`POST /checkout`, `GET /payments/:reference/verify`, `/customer/profile`,
`/customer/profile/avatar`, `/customer/orders`, and `/customer/orders/:orderReference`.
Paystack calls `POST /webhooks/paystack`.

All `/admin/*` routes require a valid Supabase bearer token and an entry in `admin_users`.
They provide dashboard statistics, product/category CRUD, product-image upload/deletion,
low-stock inventory lookup and updates, order listing/details/status transitions, and customer
order history.
The separate admin origin receives no special trust from the API: CORS is restricted to the
configured origins, while authorization is performed for every admin request.

## Payment and inventory behavior

Authenticated checkout creates a pending-payment order linked to the customer and temporarily
reserves its stock for 15 minutes before initializing Paystack. The browser return page and
Inline callbacks are not proof of payment: payment completion and inventory consumption occur
only after server-side Paystack verification. Verified payments set fulfillment to `received`;
admins then advance the order through `processing`, `shipped`, and `delivered`. Payment status
remains separate from fulfillment status. The webhook signature is validated against the raw
request body, and its event is verified with Paystack before changing order or inventory state.
The API periodically releases expired stock reservations in-process.
