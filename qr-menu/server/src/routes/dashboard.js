const express = require('express');
const db = require('../db');
const { requireOwner } = require('../auth');
const { propertyReport, daysBetween } = require('../reports');

const router = express.Router();
router.use(requireOwner);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

// ?from=&to= (inclusive), ?location= one property or omitted for all of them plus a combined total.
router.get('/', (req, res) => {
  const { from, to } = req.query;
  if (!DATE.test(from || '') || !DATE.test(to || '') || to < from) {
    return res.status(400).json({ error: 'from and to must be dates, from on or before to' });
  }
  if (daysBetween(from, to) + 1 > MAX_DAYS) return res.status(400).json({ error: `Pick at most ${MAX_DAYS} days` });

  const locations = db.prepare('SELECT id, name FROM locations ORDER BY sort_order, name').all();
  const wanted = req.query.location ? locations.filter((l) => l.id === req.query.location) : locations;
  if (!wanted.length) return res.status(400).json({ error: 'Unknown property' });

  const properties = wanted.map((l) => ({ id: l.id, name: l.name, report: propertyReport(l.id, from, to) }));
  res.json({ from, to, properties, combined: properties.length > 1 ? combine(properties.map((p) => p.report)) : null });
});

// Adds up several property reports (occupancy recomputed from summed nights and capacity).
function combine(reports) {
  const t = (k) => reports.reduce((s, r) => s + r.totals[k], 0);
  const days = reports[0].days;
  const dormCap = reports.reduce((s, r) => s + r.capacity.dorm_beds, 0);
  const privCap = reports.reduce((s, r) => s + r.capacity.private_rooms, 0);
  const pct = (sold, cap) => (cap > 0 ? Math.round((sold / cap) * 1000) / 10 : null);
  const merge = (key) => {
    const m = new Map();
    for (const r of reports) {
      for (const row of r[key]) {
        const cur = m.get(row.key) || { key: row.key, amount_paise: 0, count: 0 };
        cur.amount_paise += row.amount_paise;
        cur.count += row.count;
        m.set(row.key, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.amount_paise - a.amount_paise);
  };
  const daily = reports[0].daily.map((d, i) => {
    const row = { date: d.date };
    for (const k of ['rooms_paise', 'cafe_paise', 'expenses_paise', 'beds_sold', 'private_sold']) {
      row[k] = reports.reduce((s, r) => s + r.daily[i][k], 0);
    }
    return row;
  });
  return {
    from: reports[0].from,
    to: reports[0].to,
    days,
    capacity: { dorm_beds: dormCap, private_rooms: privCap },
    totals: {
      rooms_paise: t('rooms_paise'),
      cafe_paise: t('cafe_paise'),
      expenses_paise: t('expenses_paise'),
      net_paise: t('net_paise'),
      bed_nights_sold: t('bed_nights_sold'),
      private_nights_sold: t('private_nights_sold'),
      dorm_occupancy_pct: pct(t('bed_nights_sold'), dormCap * days),
      private_occupancy_pct: pct(t('private_nights_sold'), privCap * days),
      arrivals: t('arrivals'),
      cafe_orders: t('cafe_orders'),
      counter_sales: t('counter_sales'),
      expense_entries: t('expense_entries'),
    },
    by_source: merge('by_source'),
    rooms_by_payment: merge('rooms_by_payment'),
    cafe_by_method: merge('cafe_by_method'),
    expenses_by_category: merge('expenses_by_category'),
    daily,
  };
}

module.exports = router;
