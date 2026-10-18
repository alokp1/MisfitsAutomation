# Misfits Hostel & Cafe

Website and operations tooling for Misfits Hostel & Cafe (Shoja & Kasol).

## Layout

```text
hostel/
|-- docker-compose.yml   # whole stack: web gateway + QR menu client + API
|-- .env.example
|-- website/             # public site (static export) + gateway nginx
|   |-- index.html       # main site (exported as "Misfits Hostel.dc.html")
|   |-- shoja-only.dc.html, before-trends.dc.html   # design variants
|   |-- support.js       # dc-runtime (generated — do not edit)
|   |-- fluid.js         # WebGL hero mist / ink logo / particles
|   |-- assets/          # photos and video
|   |-- nginx.conf       # routes /, /cafe/, /api/
|   `-- Dockerfile
`-- qr-menu/             # QR ordering app (React + Express + SQLite)
    |-- client/          # built with Vite base '/cafe/'
    `-- server/
```

## URLs

Everything is served from one origin by the `web` container:

| Path | What |
|---|---|
| `/` | Website |
| `/cafe/` | Cafe picker |
| `/cafe/shoja/menu?table=T1`, `/cafe/kasol/menu?table=T1` | Each cafe's QR menu for a table |
| `/cafe/admin` (short: `/manage`) | Back office: bookings, expenses, cafe orders, menu, QR codes, analytics, managers |
| `/api/*` | QR menu API |

`/menu` and `/admin/*` redirect to their `/cafe/` equivalents, and cafe-less `/cafe/menu` opens the Shoja menu, so QR codes printed before the move or before menus were split keep working.

## Run

```bash
cp .env.example .env     # set ADMIN_PASSWORD (required) and Razorpay keys
docker compose up -d --build
```

Open <http://localhost:8080>. For phones on the same Wi-Fi, set `PUBLIC_BASE_URL=http://<laptop-LAN-IP>:8080/cafe` in `.env` and regenerate QR codes — each code encodes `<PUBLIC_BASE_URL>/<cafe>/menu?table=…`.

To put it online with HTTPS and nightly backups, follow [HOSTING.md](HOSTING.md).

`docker compose down -v` deletes the SQLite volume: every booking, expense, menu item and order. Back the volume up before running it.

## Who signs in

- **Owner:** the `ADMIN_PASSWORD`. Sees both properties; the switcher at the top of the sidebar picks one, or **All properties** for combined cafe orders and analytics. Adds managers under **Managers**.
- **Property manager:** their name and a 4–8 digit PIN, set by the owner. Sees only their own property. Five wrong PINs lock the name for 15 minutes; a new PIN or deactivation signs them out everywhere. On a phone, open `/manage` and add it to the home screen.

## Hostel operations

- **Bookings:** a day view (arriving, staying, leaving, beds taken tonight) and a booking form with a bed map. Taken beds can't be picked, and the server refuses overlapping bookings for the same bed or room. Bookings made here are **not sent to AsiaTech**: block the beds there too, or the OTAs can sell them.
- **Expenses:** an Excel-like sheet for logging many at once: date, category, what for, amount, who paid, how, and an optional bill photo per row (shrunk on the phone before upload; stored on the data volume in `receipts/`). Tab / Enter / arrow keys move between cells, rows pasted from Excel or Google Sheets fill in (dates like 17/10/2026, ₹1,250, "GPay", "Eggs" are understood; anything unrecognised turns red), and one Save stores every row or none. Up to 100 rows per save; unsaved rows survive a reload. On a phone each row is a card. Existing expenses are edited one at a time. Only the owner can delete an expense.
- **Stock:** a daily count of each item, pre-filled with the last count, with ± buttons (by 50 for grams), **Same as last count**, ↑ ↓ / Enter to move down the list, paste a column of numbers or "item ⇥ count" rows from Excel, a count of changed items on Save, and a low-stock flag. Items come from the old inventory sheet (migration 3) and can be added or removed per property.
- **Room rates:** one nightly price per dorm bed per property, and one per private room type (Shoja: Deluxe room, Family room; Kasol: Private room), used to fill in the amount on bookings entered here (beds × price × nights, still editable for discounts). Owners and the property's manager can change them; every change is logged with who made it. Changing a price doesn't touch existing bookings. Website and OTA prices are set in AsiaTech.
- **Counter sale:** cafe orders paid at the counter in cash, UPI or card. Priced from the menu like a QR order and recorded as served and paid, so they count in cafe sales.
- **Rooms** are seeded by migration 2 in `qr-menu/server/src/db.js`: Shoja 101–106 and 201–206, Kasol's dorms G1, R2, S2, H1, H2, R1, G2 and its six private rooms.

## Booking from the website

Every **Book** button on the website (header, menu, room cards, the Book direct section, footer) opens the AsiaTech booking engine for the property on screen, in a new tab:

- Shoja: https://asiatech.in/booking_engine/index3?token=MTEwODI=
- Kasol: https://asiatech.in/booking_engine/index3?token=NTYzOA==

The website shows no prices: they change with dates and demand, and guests see them on the booking page before paying. Bookings made there go into AsiaTech with the OTA bookings, so the beds are blocked on the OTAs too. WhatsApp stays as a second option. The links live in `website/index.html` (`bookingUrl` for each property).

The server has no public booking endpoints. The `booking_requests` table from the earlier request form is kept so old requests aren't lost, but nothing reads or writes it.

## Guest self check-in

Replaces the "Skip the Line" Google Form. The manager assigns the beds or room on the booking as usual, then opens the booking and taps **Get check-in link**. From there:

- **Send on WhatsApp** (to the booking's phone number), **Copy link**, or let the guest scan the QR code at the desk.
- The guest's page (`/cafe/checkin/<link>`) shows their property, room and dates, and asks the same questions as the old form: name as on their ID, coming from, booked through (prefilled from the booking), check-out date and time, phone/WhatsApp, email, ID photos (front required, back optional) and vehicle.
- Each guest on the booking fills it in once; after one guest finishes, the page offers "Check in the next guest". It stops at the booking's guest count.
- The booking page lists every check-in, flags a check-out date that differs from the booking, and opens the ID photos. A wrong entry can be removed. Booking cards show **Not checked in**, **1/2 checked in** or **Checked in**.
- The property's Telegram chat gets a message for each check-in, if Telegram is set up.

The link stops working when the booking is cancelled or the stay has ended. ID photos are stored on the server's data volume (`guest-ids/`), only the owner and that property's manager can open them, and they are deleted automatically `ID_RETENTION_DAYS` (default 365) after check-out; the rest of the check-in record stays.

## Owner dashboard

`/cafe/admin/dashboard`, owner only. For a date range (presets or custom) and one property or all of them: net (rooms + cafe − expenses), occupancy of dorm beds and private rooms, income and expenses by day (by month past 62 days), where bookings came from, expenses by category, and how guests paid, including cash taken to check against the cash box.

Room income is spread across each stay's nights, so a 3-night ₹3,000 stay counts ₹1,000 on each night. That keeps a period's revenue and its occupancy describing the same nights. Booking sources and payment methods count stays starting in the period at their full amount.

## Telegram notifications

Optional. Set `TELEGRAM_BOT_TOKEN` and chat ids in `.env` (steps in `.env.example`, and on the **Notifications** page):

- **Evening reminder** (`REMINDER_AT`, default 21:00 India time) to each property's manager, only when that day's expenses or stock count haven't been logged.
- **Nightly summary** (`SUMMARY_AT`, default 22:30) to the owner: each property's rooms, beds and rooms taken, cafe, expenses, arrivals today and tomorrow, low stock and anything not logged, plus a combined total.

Each message goes at most once a day, even across restarts; a failed send is retried every minute. The Notifications page shows what's configured, previews tonight's messages, and sends test messages.

### Importing the old bookings sheet

The sheet holds guest names, so its JSON never goes in the repo (`*.xlsx` and `*-history.json` are git-ignored). Run once per property:

```bash
python tools/import-sheets/sheets_to_json.py "Daily Hotel Performance Sheet 2026-27.xlsx" shoja > ../shoja-history.json
docker compose exec -T server node src/scripts/import-history.js < ../shoja-history.json
```

The converter uses only Python's standard library. The import refuses to run twice for a property. Rows it had to fix (a check-out on the check-in day, an unknown room such as `022`) are imported with a note saying what changed.

## Cafes

Shoja and Kasol each have their own categories, menu, prices, orders and QR codes. A cafe with an empty menu offers to copy another cafe's menu as a starting point. The cafe list is seeded by the server's database migration (`qr-menu/server/src/db.js`).

## Updating the website

The site is a design-tool export rendered in the browser by `support.js` (React and Babel are loaded from unpkg). To bring in a new export, replace the files in `website/`, renaming the main `Misfits Hostel.dc.html` to `index.html`, and re-add the cafe menu link in the `#cafe` section (`<a href="/cafe/{{ L.key }}/menu" ...>See the cafe menu</a>` — `L.key` is the property tab the visitor has selected).

## QR menu development

See [qr-menu/README.md](qr-menu/README.md). The Vite dev server serves the app at <http://localhost:5173/cafe/>.
