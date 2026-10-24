// Figures for the owner dashboard and the nightly summary.
//
// Room revenue is spread evenly over a stay's nights, so a period's revenue and
// occupancy describe the same nights. Cafe sales are paid, non-cancelled orders,
// dated in India time. Expenses are dated by when they were spent.
const db = require('./db');

// orders.created_at is UTC; the properties are in India (UTC+5:30).
const IST_SQL_OFFSET = '+330 minutes';

const DAY_MS = 86400000;
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY_MS);
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);

const SOURCE_LABELS = { walk_in: 'Walk-in', website: 'Website', phone: 'Phone', instagram: 'Instagram', ota: 'OTA', other: 'Other' };

function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function addTo(map, key, amount, count = 1) {
  const row = map.get(key) || { key, amount_paise: 0, count: 0 };
  row.amount_paise += amount;
  row.count += count;
  map.set(key, row);
}
const sorted = (map) => [...map.values()].sort((a, b) => b.amount_paise - a.amount_paise);

// One property, dates from..to inclusive.
function propertyReport(locationId, from, to) {
  const dates = eachDate(from, to);
  const days = dates.length;
  const daily = new Map(dates.map((d) => [d, { date: d, rooms_paise: 0, cafe_paise: 0, expenses_paise: 0, beds_sold: 0, private_sold: 0 }]));

  const capacity = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'dorm' THEN beds ELSE 0 END), 0) AS dorm_beds,
              COALESCE(SUM(kind = 'private'), 0) AS private_rooms
         FROM rooms WHERE location_id = ? AND active = 1`,
    )
    .get(locationId);

  // Rooms: every non-cancelled stay that has a night inside the period.
  const bookings = db
    .prepare(
      `SELECT * FROM bookings
        WHERE location_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out > ?`,
    )
    .all(locationId, to, from);
  const units = db
    .prepare(
      `SELECT u.booking_id, u.bed, r.kind, r.beds
         FROM booking_units u JOIN rooms r ON r.id = u.room_id JOIN bookings b ON b.id = u.booking_id
        WHERE b.location_id = ? AND b.status != 'cancelled' AND b.check_in <= ? AND b.check_out > ?`,
    )
    .all(locationId, to, from);
  const unitsBy = new Map();
  for (const u of units) {
    if (!unitsBy.has(u.booking_id)) unitsBy.set(u.booking_id, []);
    unitsBy.get(u.booking_id).push(u);
  }

  const bySource = new Map();
  const byPayment = new Map();
  let arrivals = 0;
  for (const b of bookings) {
    const nights = Math.max(1, daysBetween(b.check_in, b.check_out));
    const perNight = b.amount_paise / nights;
    let beds = 0;
    let privates = 0;
    for (const u of unitsBy.get(b.id) || []) {
      if (u.kind === 'private') privates += 1;
      else beds += u.bed == null ? u.beds : 1;
    }
    const first = b.check_in > from ? b.check_in : from;
    const last = addDays(b.check_out, -1) < to ? addDays(b.check_out, -1) : to;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const row = daily.get(d);
      row.rooms_paise += perNight;
      row.beds_sold += beds;
      row.private_sold += privates;
    }
    // Mix of business: stays that start in the period, at their full booked amount.
    if (b.check_in >= from && b.check_in <= to) {
      arrivals += 1;
      addTo(bySource, b.source === 'ota' && b.ota ? b.ota : SOURCE_LABELS[b.source] || b.source, b.amount_paise);
      addTo(byPayment, b.payment_mode, b.amount_paise);
    }
  }

  // Cafe: paid orders, by India-time date.
  const cafeRows = db
    .prepare(
      `SELECT date(created_at, '${IST_SQL_OFFSET}') AS day, payment_method, table_id, total_paise
         FROM orders
        WHERE location_id = ? AND payment_status = 'paid' AND status != 'cancelled'
          AND date(created_at, '${IST_SQL_OFFSET}') BETWEEN ? AND ?`,
    )
    .all(locationId, from, to);
  const cafeByMethod = new Map();
  let counterSales = 0;
  for (const o of cafeRows) {
    daily.get(o.day).cafe_paise += o.total_paise;
    addTo(cafeByMethod, o.payment_method || 'online', o.total_paise);
    if (o.table_id === 'Counter') counterSales += 1;
  }

  const expenseRows = db
    .prepare('SELECT spent_on, category, amount_paise FROM expenses WHERE location_id = ? AND spent_on BETWEEN ? AND ?')
    .all(locationId, from, to);
  const expensesByCategory = new Map();
  for (const e of expenseRows) {
    daily.get(e.spent_on).expenses_paise += e.amount_paise;
    addTo(expensesByCategory, e.category, e.amount_paise);
  }

  const series = [...daily.values()].map((r) => ({ ...r, rooms_paise: Math.round(r.rooms_paise) }));
  const sum = (k) => series.reduce((s, r) => s + r[k], 0);
  const rooms = sum('rooms_paise');
  const cafe = sum('cafe_paise');
  const expenses = sum('expenses_paise');
  const bedNights = sum('beds_sold');
  const privateNights = sum('private_sold');
  const pct = (sold, cap) => (cap > 0 ? Math.round((sold / cap) * 1000) / 10 : null);

  return {
    from,
    to,
    days,
    capacity,
    totals: {
      rooms_paise: rooms,
      cafe_paise: cafe,
      expenses_paise: expenses,
      net_paise: rooms + cafe - expenses,
      bed_nights_sold: bedNights,
      private_nights_sold: privateNights,
      dorm_occupancy_pct: pct(bedNights, capacity.dorm_beds * days),
      private_occupancy_pct: pct(privateNights, capacity.private_rooms * days),
      arrivals,
      cafe_orders: cafeRows.length,
      counter_sales: counterSales,
      expense_entries: expenseRows.length,
    },
    by_source: sorted(bySource),
    rooms_by_payment: sorted(byPayment),
    cafe_by_method: sorted(cafeByMethod),
    expenses_by_category: sorted(expensesByCategory),
    daily: series,
  };
}

// What still hasn't been logged for a property on a date.
function missingEntries(locationId, date) {
  const missing = [];
  if (!db.prepare('SELECT 1 FROM expenses WHERE location_id = ? AND spent_on = ? LIMIT 1').get(locationId, date)) {
    missing.push('expenses');
  }
  const hasItems = db.prepare('SELECT 1 FROM stock_items WHERE location_id = ? AND active = 1 LIMIT 1').get(locationId);
  const counted = db
    .prepare(
      `SELECT 1 FROM stock_counts c JOIN stock_items i ON i.id = c.item_id
        WHERE i.location_id = ? AND c.counted_on = ? LIMIT 1`,
    )
    .get(locationId, date);
  if (hasItems && !counted) missing.push('stock count');
  return missing;
}

function lowStock(locationId, date) {
  return db
    .prepare(
      `SELECT i.name, i.unit, c.quantity FROM stock_items i
         JOIN stock_counts c ON c.item_id = i.id AND c.counted_on = ?
        WHERE i.location_id = ? AND i.active = 1 AND i.low_at IS NOT NULL AND c.quantity <= i.low_at
        ORDER BY i.sort_order`,
    )
    .all(date, locationId);
}

module.exports = { propertyReport, missingEntries, lowStock, addDays, daysBetween };
