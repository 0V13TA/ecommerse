# Single-company e-commerce template

A reusable storefront and operations template for a single company. It includes a public SvelteKit storefront, a separate SvelteKit admin dashboard, a shared Express API, Supabase Auth and Storage, PostgreSQL migrations, and Paystack checkout.

The storefront is guest-friendly for browsing and cart management. Customers sign in or create an account when checking out, and can then manage their profile and view orders. Administrators sign in separately and must also be explicitly authorized in the database.

This is a small, single-company application—not a marketplace, multi-vendor system, or multi-tenant SaaS platform.

## Contents

- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Customizing the frontend](#customizing-the-frontend)
- [Environment variables](#environment-variables)
- [Database and Supabase setup](#database-and-supabase-setup)
- [Authentication and authorization](#authentication-and-authorization)
- [Payments](#payments)
- [Orders and inventory](#orders-and-inventory)
- [Analytics](#analytics)
- [Run locally](#run-locally)
- [Deployment](#deployment)
- [Customization checklist](#customization-checklist)

## Architecture

```text
 Customer's browser                         Administrator's browser
 ┌─────────────────────────┐               ┌──────────────────────────┐
 │ SvelteKit storefront    │               │ SvelteKit admin          │
 │ example.com             │               │ admin.example.com        │
 └────────────┬────────────┘               └─────────────┬────────────┘
              │ public/customer API                      │ admin API
              │ Supabase customer token                  │ Supabase admin token
              └─────────────────┬────────────────────────┘
                                ▼
                    ┌──────────────────────┐
                    │ Express API          │
                    │ api.example.com      │
                    │ auth, commerce,      │
                    │ inventory, analytics │
                    └───────┬────────┬─────────────┘
                            │        │             │
                     PostgreSQL   Supabase Auth  Paystack API
                     (Supabase)     / Storage
```

Paystack sends signed webhook requests back to the Express API.

- **Storefront (`frontend_user`)**: public catalogue, product pages, local cart, customer login/account, checkout and order confirmation.
- **Admin (`frontend_dashboard`)**: a separately deployed SvelteKit application for catalogue, inventory, orders, customers, and analytics.
- **API (`backend`)**: Express owns data access and business logic. Both apps call it; the API validates Supabase bearer tokens and protects admin routes independently of frontend navigation.
- **Database (`supabase`)**: Supabase-hosted PostgreSQL, modified through committed SQL migrations. The API uses the PostgreSQL connection for transactional order/inventory work and the Supabase service role for Auth verification and Storage operations.
- **Supabase Auth**: customer and admin identities. The frontends use only the public publishable/anon key; the backend validates tokens and checks the `admin_users` allow-list for administrator access.
- **Paystack**: the backend initializes transactions and verifies results. The storefront opens Paystack Inline when available, with the hosted authorization URL as fallback.

The applications have separate origins and keep their own Supabase browser sessions. They do not share cookies. The API is the trust boundary; CORS is not a substitute for authentication or authorization.

## Repository structure

```text
.
├── backend/
│   ├── .env.example              # Server-side configuration template
│   └── src/
│       ├── routes.ts             # Public, customer, admin, webhook, analytics routes
│       ├── commerce.ts           # Checkout, Paystack verification, stock reservations
│       ├── auth.ts               # Admin token validation and admin_users authorization
│       ├── customer-auth.ts      # Customer token middleware
│       ├── paystack.ts           # Paystack API and webhook signature verification
│       ├── db.ts                 # PostgreSQL connection pool
│       ├── config.ts             # Server environment validation
│       └── errors.ts             # API errors and error handling
├── frontend_user/
│   ├── .env.example
│   ├── static/favicon.svg        # Storefront favicon
│   └── src/
│       ├── lib/brand.ts          # Store name, mark, metadata text
│       ├── lib/components/       # ProductCard, OrderProgress
│       ├── lib/                  # API client, cart, Supabase, analytics, types
│       ├── routes/               # Homepage, products, cart, login, checkout, account
│       ├── app.html              # HTML shell and favicon link
│       └── styles.css            # Storefront theme and responsive styles
├── frontend_dashboard/
│   ├── .env.example
│   ├── static/favicon.svg        # Admin favicon
│   └── src/
│       ├── lib/brand.ts          # Admin name, mark, descriptor
│       ├── lib/                  # Admin API, Supabase client, shared types
│       ├── routes/               # Overview, products, inventory, orders, analytics
│       ├── app.html              # HTML shell and favicon link
│       └── app.css               # Admin theme and responsive styles
├── supabase/
│   ├── config.toml               # Local Supabase/Auth configuration
│   ├── migrations/               # Ordered PostgreSQL schema changes
│   └── seed.sql                  # Repeatable sample catalogue data
├── package.json                  # npm workspaces and root scripts
└── package-lock.json
```

Where to make a change:

| Task | Start here |
|---|---|
| Storefront shell, header, footer, navigation | `frontend_user/src/routes/+layout.svelte` |
| Homepage content, categories and product grid | `frontend_user/src/routes/+page.svelte` and `+page.ts` |
| Product card | `frontend_user/src/lib/components/ProductCard.svelte` |
| Product detail/add-to-cart behavior | `frontend_user/src/routes/products/[slug]/+page.svelte` |
| Cart persistence and cart operations | `frontend_user/src/lib/cart.ts` |
| Checkout and Paystack popup UI | `frontend_user/src/routes/checkout/+page.svelte` |
| Customer profile, history, receipt | `frontend_user/src/routes/account/` |
| Admin navigation and shell | `frontend_dashboard/src/routes/+layout.svelte` |
| Admin pages and API client | `frontend_dashboard/src/routes/` and `frontend_dashboard/src/lib/api.ts` |
| API endpoint, validation, authorization | `backend/src/routes.ts` |
| SQL schema or indexes | Add the next numbered file in `supabase/migrations/` |
| Order/payment/inventory lifecycle | `backend/src/commerce.ts` |
| Admin/customer authentication | `backend/src/auth.ts`, `backend/src/customer-auth.ts`, and the relevant frontend `lib/supabase.ts` |
| Paystack provider behavior | `backend/src/paystack.ts` and `backend/src/commerce.ts` |
| Analytics collection/reporting | `frontend_user/src/lib/analytics.ts`, `backend/src/routes.ts`, `supabase/migrations/0003_storefront_analytics.sql`, and `frontend_dashboard/src/routes/analytics/+page.svelte` |
| Shared component within an app | That app's `src/lib/components/` (the two frontends do not currently share a component package) |

The root `npm run check` and `npm run build` run the matching workspace scripts across the API and both frontends.

## Customizing the frontend

### Brand identity

For a new project, change these first:

1. **Store name, mark, tagline and common metadata**: `frontend_user/src/lib/brand.ts` (`storeBrand`). The shell, route titles and account copy use these values.
2. **Admin name, mark and descriptor**: `frontend_dashboard/src/lib/brand.ts` (`adminBrand`).
3. **Logo and favicon**: the current wordmarks are rendered as text plus a single-character mark in the two layouts. Replace those elements with your logo component or image if needed. Replace `frontend_user/static/favicon.svg` and `frontend_dashboard/static/favicon.svg` for the browser tab icons.
4. **Colors and typography**:
   - Storefront: theme variables near the top of `frontend_user/src/styles.css`, including `--ink`, `--paper`, `--green`, and `--accent`.
   - Admin: variables near the top of `frontend_dashboard/src/app.css`, including `--ink`, `--muted`, `--teal`, `--paper`, and `--bg`.
   - Fonts are imported in the respective CSS files. Update both the import and font-family declarations when changing typefaces.
   - Browser chrome theme colors are in each app's `src/app.html` `theme-color` meta tag.
5. **Images and brand assets**: add static files under the corresponding `static/` directory and reference them with `/...` URLs. Product imagery is managed as product data and Supabase Storage, not as a compiled brand asset.
6. **Currency**: products default to `NGN` in `supabase/migrations/0001_initial_schema.sql`, and the storefront formatting helper also falls back to `NGN`. Products store integer minor units and each checkout must use one currency. For another currency, update the product defaults/seed data and formatting fallback, then confirm the chosen currency is supported by the Paystack account before accepting payments.

The current palettes and typography are intentionally separate: customers see the storefront brand, while staff see the admin brand. They can be aligned if the new company wants one visual system.

### Storefront content and behavior

- **Navigation/header/footer**: `frontend_user/src/routes/+layout.svelte`. Navigation labels, announcement, footer copy and analytics privacy notice live there.
- **Homepage**: `frontend_user/src/routes/+page.svelte` contains the hero, editorial copy, category filters, product grid and manifesto. The product/category data is loaded by `+page.ts`.
- **Product card**: `frontend_user/src/lib/components/ProductCard.svelte`.
- **Product detail**: `frontend_user/src/routes/products/[slug]/+page.svelte`.
- **Cart**: `frontend_user/src/routes/cart/+page.svelte`; behavior and browser persistence are in `frontend_user/src/lib/cart.ts`.
- **Login/signup and OAuth callback**: `frontend_user/src/routes/login/+page.svelte` and `frontend_user/src/routes/auth/callback/+page.svelte`.
- **Checkout**: `frontend_user/src/routes/checkout/+page.svelte`; labels, delivery fields, payment UI and Paystack Inline launch are in this page. Keep server verification in the API.
- **Customer dashboard and receipts**: `frontend_user/src/routes/account/+page.svelte` and `frontend_user/src/routes/account/orders/[reference]/+page.svelte`.
- **Static HTML metadata**: `frontend_user/src/app.html`; the favicon is linked there. Per-route titles/descriptions are generally set with `<svelte:head>`.
- **Responsive layout**: storefront rules are in `frontend_user/src/styles.css`; page-specific responsive rules live alongside the base styles.

Editorial phrases and navigation labels are intentionally ordinary page content, not all brand configuration. Search the relevant route component when replacing the template's sample copy.

### Admin and customer dashboards

The admin is its own SvelteKit app. Change its shell/navigation in `frontend_dashboard/src/routes/+layout.svelte`, overview in `src/routes/+page.svelte`, and colors/layouts in `src/app.css`. Product, category, inventory, order, customer-history, and analytics screens each have their own route under `src/routes/`.

The customer account area is part of the storefront app; there is no third customer application. Its account page, order progress component and receipt page are under `frontend_user/src/routes/account/` and `frontend_user/src/lib/components/OrderProgress.svelte`.

Keep presentation changes in the frontends where possible. Prices, stock availability, authorization decisions, payment state, and order transitions must continue to be enforced by the backend.

## Environment variables

Copy each `.env.example` to `.env` in the named app directory. Never commit `.env` files. The checked-in examples contain placeholders/local defaults only.

### Backend (`backend/.env`)

| Variable | Required | Purpose / where to get it | Browser-safe? |
|---|---:|---|---|
| `PORT` | No | Express port; defaults to `3001`. | No frontend exposure needed |
| `NODE_ENV` | No | `development`, `test`, or `production`; defaults to `development`. | No |
| `DATABASE_URL` | Yes | PostgreSQL connection string from local Supabase status or the hosted Supabase database connection settings. Use a connection mode suitable for a long-running Node process. | **Secret** |
| `SUPABASE_URL` | Yes | Project URL from Supabase project settings or local `supabase status`. | Server setting; URL is not a credential |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side Supabase secret/service-role key from project API settings or local status. Grants privileged access. | **Secret—backend only; never expose or commit** |
| `SUPABASE_STORAGE_BUCKET` | No | Storage bucket used for product and avatar uploads; defaults to `product-images`, provisioned by migration `0004`. If customized, create the bucket in Supabase Storage with public reads enabled. | No |
| `PAYSTACK_SECRET_KEY` | Yes | Paystack API secret key; use a test key locally and a live key only in production. | **Secret—backend only** |
| `PAYSTACK_CALLBACK_URL` | Yes | Absolute storefront return URL, such as `http://localhost:5173/checkout/return` locally or `https://shop.example.com/checkout/return` in production. | No |
| `CORS_ORIGINS` | No | Comma-separated exact browser origins allowed to call the API. Defaults cover local storefront and admin ports. Production must list the storefront/admin origins. | No |
| `LOW_STOCK_DEFAULT` | No | Default low-stock threshold for new products; defaults to `5`. | No |

### Storefront and admin (`frontend_user/.env`, `frontend_dashboard/.env`)

Both frontends use these names:

| Variable | Required | Purpose / where to get it | Browser-safe? |
|---|---:|---|---|
| `PUBLIC_API_URL` | No for local | API origin, e.g. `http://localhost:3001` or `https://api.example.com`. The storefront defaults to localhost in its API client; set this explicitly for deployment. | Yes |
| `PUBLIC_SUPABASE_URL` | Yes | Supabase project URL from project settings or `supabase status`. | Yes |
| `PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase publishable/anon client key from project API settings or local status. RLS and server authorization must remain the security controls. | Yes; **never substitute a service-role key** |

Store identity is configured in `frontend_user/src/lib/brand.ts` and `frontend_dashboard/src/lib/brand.ts`, not in environment variables. Supabase, Paystack, domains, company name/logo, callback URLs and CORS origins normally change for every new deployment.

## Database and Supabase setup

The schema is relational and migrations are the source of truth:

| Table | Purpose and relationships |
|---|---|
| `categories` | Product categories; products optionally reference one. |
| `products` | Catalogue, price in minor currency units, availability, stock and low-stock threshold. |
| `product_images` | Ordered image records for a product. |
| `customers` | Customer delivery/profile data; linked to Supabase `auth.users` after account authentication. |
| `orders` | Customer snapshot, delivery snapshot, total, fulfillment/payment states and optional analytics session. |
| `order_items` | Price/name/quantity snapshots for each order line; linked to an order and optionally a product. |
| `payments` | Paystack reference, amount, currency and payment status for an order. No card credentials are stored. |
| `inventory_reservations` | Temporarily reserves product quantities for pending checkout; consumed on verified success or released on expiry/failure. |
| `admin_users` | Allow-list of Supabase Auth user IDs permitted to use admin endpoints. |
| `storefront_analytics_events` | Privacy-minimized events keyed by anonymous session and optional Auth user/product. |

Core relationships:

```text
categories 1 ── * products 1 ── * product_images
customers  0..1 ── * orders 1 ── * order_items * ── 0..1 products
                         ├── * payments
                         └── * inventory_reservations * ── 1 products
auth.users 1 ── 0..1 customers
auth.users 1 ── 0..1 admin_users
products   1 ── * storefront_analytics_events
auth.users 1 ── 0..* storefront_analytics_events
```

`orders.customer_id` can be null for legacy/unassociated guest orders; current checkout requires customer authentication.

`0001_initial_schema.sql` creates the commerce tables and enables RLS. `0002_customer_accounts_and_fulfillment.sql` links customers to Supabase Auth and adds the four-stage fulfillment values. `0003_storefront_analytics.sql` adds session/payment analytics metadata and the event table. `0004_product_image_storage_bucket.sql` provisions the public Storage bucket used for product and customer images. Add future schema changes as the next numbered migration; do not edit an already-applied migration.

The browser clients do not access commerce tables directly. RLS is enabled and direct `anon`/`authenticated` table access is revoked in the migrations; the API accesses PostgreSQL and Supabase Storage using its server-only service-role credentials. Keep those credentials out of frontends. Migration `0004_product_image_storage_bucket.sql` creates the public `product-images` bucket with a 5 MB limit and JPEG/PNG/WebP/AVIF allow-list. Public reads are required because the API returns public image URLs; writes and removals go through authenticated API routes. If `SUPABASE_STORAGE_BUCKET` is changed, create a bucket with the same public-read and upload constraints in Supabase Storage.

For a **fresh local database**, `npx supabase db reset` applies all migrations and `supabase/seed.sql`. It drops/recreates the local database, so it is destructive when used after local users/data exist. For schema updates on an existing local database, use `npx supabase migration up`; do not reset just to apply a migration.

For a hosted project, link it and apply migrations:

```sh
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`db push` does not seed sample catalogue data. For a development/test project only, run the seed using a protected database connection. Do not seed a live store unless you deliberately want the demo products.

### API routes

All paths below are prefixed with `/api/v1`. Customer routes require a customer Supabase bearer token; admin routes require both a valid Supabase bearer token and membership in `admin_users`. The Paystack webhook is authenticated by its signature instead.

| Method and path | Access | Purpose |
|---|---|---|
| `GET /health` | Public | API liveness check. |
| `GET /categories` | Public | List active categories. |
| `GET /products?page=&limit=&category=&search=` | Public | Browse available products. |
| `GET /products/:slug` | Public | Product detail by slug. |
| `POST /analytics/events` | Public, rate-limited | Best-effort storefront event ingestion; can optionally include a customer bearer token. |
| `POST /checkout` | Confirmed customer | Create a pending order, reserve inventory, initialize Paystack. |
| `GET /payments/:reference/verify` | Customer/order owner | Verify payment with Paystack, then return the owned order status. |
| `GET /customer/profile` | Customer | Load or initialize the signed-in customer's profile. |
| `PATCH /customer/profile` | Customer | Update profile and delivery address. |
| `POST /customer/profile/avatar` | Customer | Upload profile image to Supabase Storage. |
| `GET /customer/orders?page=&limit=` | Customer | List the customer's orders. |
| `GET /customer/orders/:orderReference` | Customer/order owner | Load owned order and receipt details. |
| `POST /webhooks/paystack` | Paystack signature | Verify and process Paystack webhook events. |
| `GET /admin/dashboard` | Admin | Business summary, recent orders and sales trend. |
| `GET /admin/analytics?range=today\|7d\|30d\|90d\|all` | Admin | Storefront funnel, behavior, payment and product analytics. |
| `/admin/products` and `/admin/products/:id` | Admin | List, create, read, update and archive products. |
| `/admin/products/:id/images` | Admin | Upload/delete product images. |
| `/admin/categories` and `/admin/categories/:id` | Admin | List, create, update and delete categories. |
| `GET /admin/inventory/low-stock` | Admin | List products at or below their threshold. |
| `PATCH /admin/inventory/:productId` | Admin | Update on-hand stock and threshold. |
| `/admin/orders` and `/admin/orders/:id` | Admin | List orders and view order/customer/delivery details. |
| `PATCH /admin/orders/:id/status` | Admin | Advance fulfillment through allowed states. |
| `GET /admin/customers/:id/orders` | Admin | View customer contact and order history. |

Request validation, authorization and business rules are in `backend/src/routes.ts`; shared order/payment behavior is in `backend/src/commerce.ts`.

## Authentication and authorization

### Customers

- Public browsing, product details and the local-storage cart do not require sign-in.
- Checkout, profile and order-history API operations require a valid Supabase customer token; checkout also requires a confirmed email.
- Sign-in supports email/password and Google OAuth. A guest checkout attempt is redirected through login/signup with a local return path back to checkout; the cart stays in the browser.
- The storefront Supabase client persists and refreshes the session on the storefront origin. Customer API calls send its access token as a bearer token.
- The API verifies the token with Supabase Auth and scopes profile, payment verification and order reads to the authenticated customer's record. Existing guest orders are associated only after a confirmed matching email.

### Administrators

- Admin sign-in uses Supabase Auth email/password. There is no public admin signup form.
- A valid Auth user is **not** automatically an administrator. Add its UUID to `public.admin_users`; the backend checks both the token and that allow-list on each `/admin/*` call.
- Create/invite users through Supabase Auth, then authorize an existing user with:

  ```sql
  insert into public.admin_users (user_id)
  select id from auth.users
  where lower(email) = lower('admin@example.com')
  on conflict (user_id) do nothing;
  ```

- Admin tokens remain in the admin application's Supabase session and are sent to the API as bearer tokens. They are not shared as cookies with the storefront.

For local Auth redirects, `supabase/config.toml` uses `http://localhost:5175/auth/setup-password` as its site URL and allows storefront/admin callback URLs on ports `5173`, `5174`, and `5175`. Restart local Supabase after changing that config. For production, set the Supabase Auth site URL to your chosen canonical app URL and allow the exact customer callback (`https://shop.example.com/auth/callback`) plus admin invitation/setup callback (`https://admin.example.com/auth/setup-password`).

For Google OAuth, configure the Google provider in Supabase Auth with your Google OAuth client ID and secret. Add the Supabase project callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`, or the local callback `http://127.0.0.1:54321/auth/v1/callback`) to Google's authorized redirect URLs. Add the storefront callback URL to Supabase's redirect allow-list. The local CLI config can use environment references for Google credentials; never commit OAuth secrets.

## Payments

The Paystack secret key and callback URL are server environment variables. Configure the webhook URL as:

```text
https://api.example.com/api/v1/webhooks/paystack
```

The flow is:

1. The authenticated customer submits product IDs, quantities and delivery information to `POST /api/v1/checkout`.
2. The API reloads authoritative prices/availability, locks products in a PostgreSQL transaction, creates a pending-payment order and reserves stock for 15 minutes.
3. The API initializes Paystack with the server-side secret and returns an access code for Inline checkout plus a hosted authorization URL fallback.
4. After popup completion/return, the frontend asks the API to verify. Browser callbacks are not proof of payment.
5. The API fetches transaction status from Paystack and checks amount/currency against its stored payment before consuming inventory and confirming payment.
6. The Paystack webhook is checked using an HMAC SHA-512 signature over the raw body; the server then verifies the transaction with Paystack before updating commerce records.

Payment states are separate from fulfillment. Successful verification sets payment to `success`, consumes reserved stock and creates a `received` order. Verified failed/abandoned payments release stock where applicable. Expired reservations are released by the API's periodic cleanup. Analytics never establishes payment success.

Configure company display name, logo and other merchant identity in Paystack's merchant settings. To use another payment provider, replace the provider integration in `backend/src/paystack.ts`, the initialization/verification calls in `backend/src/commerce.ts`, webhook handling in `backend/src/routes.ts`, and the frontend checkout UI; preserve the API's server-side verification and transaction rules.

Paystack webhooks require a reachable API URL. For local webhook testing, expose the local API through a temporary HTTPS tunnel and configure that URL in the Paystack test dashboard; never use the tunnel as a production endpoint.

## Orders and inventory

Fulfillment lifecycle:

```text
Received → Processing → Shipped → Delivered
```

The admin can advance an order through those transitions. The API disallows invalid transitions. `pending_payment` and `cancelled` are technical/exceptional states outside the normal four-stage fulfillment lifecycle. A paid order cannot be cancelled through the current admin action because refunds are not automated.

Checkout reserves stock atomically after locking product rows. A successful verified Paystack transaction decrements on-hand stock and consumes reservations in a database transaction. A failed/abandoned transaction or 15-minute timeout releases reservations. The core logic is in `backend/src/commerce.ts`; admin stock changes and order-state transitions are in `backend/src/routes.ts`. Never treat browser cart quantities as authoritative stock.

## Analytics

Analytics is first-party, lightweight and opt-out. The storefront footer explains collection and lets shoppers opt out. Events use an anonymous UUID stored in `sessionStorage`; no name, email, IP address or arbitrary page URL is sent. Once a shopper is authenticated, the API may associate events with the verified Supabase user ID. Product/cart/checkout view events are deduplicated per tab for 30 minutes; add/remove actions are tracked per interaction.

Client-side engagement events are:

- `product_view`
- `add_to_cart`
- `remove_from_cart`
- `cart_view`
- `checkout_started`

The API accepts those events at `POST /api/v1/analytics/events` with rate limiting and idempotent event IDs. Payment initialization/outcomes and purchases are sourced from server-side Paystack/payment/order records, not client-reported success. Unsubmitted checkout starts become abandoned after a 30-minute window; expired unpaid reservations and Paystack cancellations are distinguished.

The protected `GET /api/v1/admin/analytics?range=today|7d|30d|90d|all` endpoint powers the Admin → Analytics view: funnel counts/drop-off, event/payment summaries, trends and product views/additions/purchased units. To add an event, update the event validation and database constraint, emit it from the storefront, then add its aggregation/reporting and UI metric. Analytics writes are separate from the commerce transaction path and must remain best-effort so analytics outages do not block checkout or payment.

## Run locally

Prerequisites: Node.js 20 or later, npm, Docker, and access to Supabase CLI (included as a root development dependency; `npx supabase` avoids requiring a global install).

1. Clone the repository and install workspace dependencies:

   ```sh
   npm install
   ```

2. Copy the environment templates:

   ```sh
   cp backend/.env.example backend/.env
   cp frontend_user/.env.example frontend_user/.env
   cp frontend_dashboard/.env.example frontend_dashboard/.env
   ```

   The examples contain local URLs/placeholders. Fill the backend service-role/database/Paystack values and both frontend Supabase URL/public key values after starting Supabase.

3. Start local Supabase and inspect the generated local connection details:

   ```sh
   npx supabase start
   npx supabase status
   ```

   Local defaults are API `http://127.0.0.1:54321`, PostgreSQL `127.0.0.1:54322`, Studio `http://127.0.0.1:54323`, and Mailpit `http://127.0.0.1:54324`. Copy the local publishable/anon key to both frontend `.env` files and the local database URL/service-role key to `backend/.env`. Keep the service-role key only in `backend/.env`.

4. On a fresh local database, apply schema and demo catalogue data:

   ```sh
   npx supabase db reset
   ```

   This is destructive to existing local database data. To apply migrations without deleting local users/data, use `npx supabase migration up`.

5. Migration `0004` creates the public `product-images` Storage bucket when schema migrations run. If you set `SUPABASE_STORAGE_BUCKET` to a different name, create that bucket in Studio and enable public reads. For local Auth email links, use Mailpit. Configure Google OAuth credentials in Supabase Auth only if testing Google login. For Paystack, use test credentials and set the callback URL to the storefront origin currently in use. A Paystack webhook cannot reach localhost directly; use a temporary HTTPS tunnel if testing webhook delivery locally.

6. Start all three applications together from the repository root:

   ```sh
   npm run dev
   ```

   This runs each workspace's development server in parallel in the same terminal; press `Ctrl+C` to stop them. If you prefer separate terminals, run `npm run dev:api`, `npm run dev:storefront`, and `npm run dev:admin` individually. The API uses port `3001`, Vite's default storefront port is `5173` (it may select `5174` if occupied), and the admin is fixed to `5175`. The API CORS defaults permit `localhost` and `127.0.0.1` on ports `5173`, `5174`, and `5175`. If Vite selects another origin, add that exact origin to `CORS_ORIGINS` and Supabase's Auth redirect allow-list, then restart the API.

7. Create the first administrator in local Supabase Auth (Studio), then add its `auth.users.id` to `public.admin_users` using the SQL above. Customer accounts are created through the storefront signup flow.

Check the backend health endpoint at `http://localhost:3001/api/v1/health`. Useful validation commands are `npm run check` and `npm run build` from the root.

## Deployment

Typical deployment:

| Service | Example address | Configuration |
|---|---|---|
| Storefront | `https://shop.example.com` (or apex domain) | Build/deploy `frontend_user`; set Supabase public URL/key and API URL. |
| Admin | `https://admin.example.com` | Build/deploy `frontend_dashboard`; set Supabase public URL/key and API URL. |
| API | `https://api.example.com` | Deploy `backend`; configure secrets, database URL, Supabase service-role key, Paystack key, callback URL, and CORS. |
| Supabase | Project-specific Supabase URL | PostgreSQL, Auth, Storage bucket, migrations, OAuth and Auth redirect allow-list. |
| Paystack | Paystack account | Test/live keys, merchant branding, and API webhook URL. |

For every new company/deployment:

- Replace the brand configuration/assets and storefront content.
- Set `PUBLIC_API_URL` in both frontends to the deployed API origin; configure both `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`. The Supabase values are imported as static public environment variables and must be set when building each frontend. The admin API URL is also static; the storefront reads its API URL from SvelteKit's dynamic public environment.
- Configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_CALLBACK_URL`, `CORS_ORIGINS`, and `NODE_ENV=production` on the API host. Use the Supabase direct or session-mode database connection appropriate to the host. Never put the service-role or Paystack secret in frontend variables.
- Set `CORS_ORIGINS` to the exact scheme/host/port of the storefront and admin origins (no paths), for example `https://shop.example.com,https://admin.example.com`.
- Apply committed SQL migrations to the production Supabase project with `npx supabase link` and `npx supabase db push`. Create the Storage bucket and authorize at least one initial admin.
- Set Supabase Auth Site URL and redirect allow-list entries to the deployed customer callback and admin setup callback. Add the Supabase Auth callback URL to the Google OAuth client if Google login is enabled.
- Set `PAYSTACK_CALLBACK_URL` to the actual deployed storefront's `/checkout/return` URL and Paystack webhook URL to `https://api.example.com/api/v1/webhooks/paystack`. Use live Paystack credentials only in the production API environment.
- Use HTTPS for all production apps/API and test OAuth, email confirmation, payment verification, webhook, CORS, image access, customer scoping and admin authorization on the deployed domains.

The domain examples are illustrative; replace them everywhere with the real domains. CORS, OAuth redirects, Paystack callbacks and webhook URLs must agree with the deployed addresses.

## Customization checklist

- [ ] Change `storeBrand` and `adminBrand` in the two `src/lib/brand.ts` files.
- [ ] Replace both favicon SVGs; replace the text wordmark with the company's logo if needed.
- [ ] Update theme colors, typography, announcement/footer and homepage editorial content.
- [ ] Review product card/detail, checkout, customer account and responsive layouts.
- [ ] Update navigation and admin dashboard content/branding.
- [ ] Set the storefront, admin and API domains.
- [ ] Create a Supabase project and configure its URL/public keys for both frontends.
- [ ] Configure backend database URL and keep the Supabase service-role key server-side.
- [ ] Apply migrations (including `0004` for the default image bucket); if using a custom bucket name, create and configure it; decide whether to load sample seed products.
- [ ] Configure customer Auth redirects and Google OAuth credentials/redirects if used.
- [ ] Create and authorize the initial admin user in `admin_users`.
- [ ] Configure Paystack test/live credentials, merchant name/logo, callback and webhook URL.
- [ ] Set production CORS origins and verify the API health endpoint.
- [ ] Test guest browsing/cart, authenticated checkout, payment verification, failed/cancelled/abandoned payment, and successful inventory consumption.
- [ ] Test admin order progression (`Received → Processing → Shipped → Delivered`).
- [ ] Test customer receipts/history, analytics opt-out and dashboard metrics.
- [ ] Run `npm run check`, `npm run build`, and responsive checks on phone, tablet and desktop widths.

## Change boundaries

**Normally customized per project:** brand files/assets, page copy, colors/fonts, domains, Supabase project/Auth settings, database credentials, Paystack account/branding, CORS and redirect URLs.

**Usually retained:** the three-app split, API authorization boundary, relational commerce model, migration-based schema management, guest cart behavior, server-side payment verification and transaction-based inventory reservation.

**Do not change casually:** service-role placement, RLS/grants, token validation and admin allow-list checks, payment/webhook verification, order/payment status constraints, stock reservation/consumption transactions, or migration history. These enforce data privacy, authorization, financial integrity and stock correctness.
