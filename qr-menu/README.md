# MISFITS Hostel & Cafe - QR Menu Ordering System

A full-stack QR ordering app for MISFITS Hostel & Cafe. Customers scan a table QR code, browse the menu, build a cart, review item-level tax, and pay through Razorpay. Admin users manage categories/menu items, set tax percentages per item, track active and closed orders, generate QR codes, and view sales analytics.

## Features

- A separate menu, cart, orders and QR codes for each cafe (Shoja, Kasol): `/cafe/<cafe>/menu`.
- Customer menu with animated MISFITS branding.
- Cart, checkout, Razorpay payment flow, and order confirmation.
- Owner sign-in with `ADMIN_PASSWORD`; property managers sign in with their name and a PIN and only see their own property.
- Hostel bookings (with a bed map and double-booking checks) and expenses with bill photos — see the [root README](../README.md).
- Menu management with categories, item images, availability, veg/non-veg type, and per-item tax percentage.
- Orders page with confirmation before status updates.
- Orders marked `served` or `cancelled` move to a separate closed orders list.
- Analytics page with total order value, paid revenue, tax collected, average order, top items, and recent daily sales.
- QR code generator for table-specific menu URLs.
- SQLite persistence through a Docker named volume.

## Stack

- Backend: Node.js, Express, SQLite via `better-sqlite3`, Razorpay SDK, `qrcode`
- Frontend: React 18, Vite, React Router
- Payments: Razorpay Checkout
- Runtime: Docker Compose recommended

## Project Layout

This app lives in the `qr-menu/` folder of the Misfits monorepo and is served under `/cafe/` by the website gateway. Docker Compose, `.env` and nginx routing live at the repo root and in `website/` — see the [root README](../README.md).

```text
qr-menu/
|-- server/
|   |-- Dockerfile
|   |-- src/
|   |   |-- index.js
|   |   |-- db.js
|   |   `-- routes/
|   |-- .env.example
|   `-- package.json
`-- client/
    |-- Dockerfile
    |-- nginx.conf
    |-- vite.config.js     # base: '/cafe/'
    |-- public/
    |   |-- misfits-logo.jpeg
    |   `-- misfits-logo-animated.mp4
    |-- src/
    |   |-- components/
    |   |-- pages/
    |   |-- api.js
    |   |-- store.jsx
    |   `-- styles.css
    `-- package.json
```

## Run With Docker

From the repo root:

```bash
cp .env.example .env     # set ADMIN_PASSWORD, Razorpay keys, PUBLIC_BASE_URL
docker compose up -d --build
```

Open:

- Customer menu: <http://localhost:8080/cafe/shoja/menu> or <http://localhost:8080/cafe/kasol/menu>
- Admin panel: <http://localhost:8080/cafe/admin>

If Docker on Windows fails with a `dockerDesktopLinuxEngine` pipe error, start Docker Desktop and make sure it is running Linux containers.

`docker compose down -v` deletes the SQLite volume and all stored menu/order data.

## Local Development

Docker is preferred because the backend uses `better-sqlite3`, which may need native build tools on Windows. If you run locally, use an LTS Node version such as Node 20 or 22.

### Backend

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

The API listens on <http://localhost:4000>.

### Frontend

In another terminal:

```bash
cd client
npm install
npm run dev
```

Open <http://localhost:5173/cafe/>.

## Admin Workflow

1. Open `/cafe/admin`, log in with `ADMIN_PASSWORD`, and pick the cafe in the sidebar switcher.
2. Go to **Menu** and create categories.
3. Add menu items with price, tax percentage, image URL, veg/non-veg type, and availability.
4. Go to **QR Codes**, enter a table id like `T1`, and generate/download/print the QR.
5. Go to **Orders** to track incoming orders.
6. Updating order status asks for confirmation.
7. Marking an order as `served` or `cancelled` moves it to **Closed orders**.
8. Go to **Analytics** to see order totals, paid revenue, tax, top items, and daily sales.

## Customer Workflow

1. Open `/cafe/shoja/menu?table=T1` (or `/cafe/kasol/...`) or scan a generated QR code.
2. Add items to the cart.
3. Review subtotal, item-level tax, and total.
4. Enter optional name, phone, and kitchen note.
5. Pay with Razorpay Checkout.
6. View the order confirmation page.

## Phones Scanning QR Codes

Phones cannot reach your laptop through `localhost`. Set `PUBLIC_BASE_URL` in the root `.env` to your laptop LAN address plus `/cafe`, for example:

```env
PUBLIC_BASE_URL=http://192.168.1.42:8080/cafe
```

Then restart:

```bash
docker compose up -d
```

Newly generated QR codes will use that LAN URL.

## Tax

Tax is configured per menu item in the admin menu form. Each item stores `tax_percent`, defaulting to `5`.

At order time, the backend calculates tax from server-side item prices and tax percentages. The frontend mirrors this calculation only for customer display. Stored orders snapshot each line item's price, tax percentage, and tax amount.

## Analytics

Admin analytics are available at:

```text
/cafe/admin/analytics
```

The backend endpoint is:

```text
GET /api/admin/orders/analytics
```

Sales totals exclude cancelled orders. Paid revenue includes only paid, non-cancelled orders.

## API Summary

| Method | Path | Purpose |
|---:|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/config` | Razorpay public key id |
| GET | `/api/menu` | List available menu items |
| GET | `/api/categories` | List categories |
| POST | `/api/orders` | Place an order |
| GET | `/api/orders/:id` | Read an order |
| POST | `/api/payment/create-razorpay-order` | Create Razorpay order |
| POST | `/api/payment/verify` | Verify Razorpay payment |
| GET | `/api/qr?table=T1` | PNG QR code |
| GET | `/api/qr/data?table=T1` | QR URL and data URL |
| GET | `/api/admin/menu` | Admin list all menu items |
| POST | `/api/admin/menu` | Admin create menu item |
| PUT | `/api/admin/menu/:id` | Admin update menu item |
| DELETE | `/api/admin/menu/:id` | Admin delete menu item |
| POST | `/api/admin/categories` | Admin create category |
| DELETE | `/api/admin/categories/:id` | Admin delete category |
| GET | `/api/admin/orders` | Admin list recent orders |
| GET | `/api/admin/orders/analytics` | Admin analytics summary |
| PUT | `/api/admin/orders/:id/status` | Admin update order status |

Hostel operations: `/api/admin/bookings` (`/rooms`, `/occupancy`, `/day`, search, create, update, `/:id/cancel`), `/api/admin/expenses` (`/options`, `/:id/receipt`), `/api/admin/staff` (owner only), and `/api/auth/staff`, `/api/auth/login`, `/api/auth/logout` for manager sign-in.

All `/api/admin/*` endpoints require either the `x-admin-password` header matching `ADMIN_PASSWORD` (owner) or `Authorization: Bearer <token>` from `/api/auth/login` (property manager, limited to their own property).

## Branding Assets

The customer and admin frontend use:

- `client/public/misfits-logo.jpeg`
- `client/public/misfits-logo-animated.mp4`

Replace those files with the same names if you want to update the logo without changing code.

## Production Notes

- Replace the lightweight admin password header with a proper auth system before going live.
- Use HTTPS in production.
- Set `PUBLIC_BASE_URL` to the public customer-facing URL.
- Keep Razorpay keys in environment variables only.
- Consider PostgreSQL if you need multiple backend instances.
- Add Razorpay webhooks for stronger payment reconciliation.

## License

MIT. No warranty.
