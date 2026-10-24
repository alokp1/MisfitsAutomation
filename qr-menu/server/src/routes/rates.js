// Nightly room rates. One price per dorm bed per property, and one per private room type.
// Owners and the property's manager can change them; every change is logged.
const express = require('express');
const db = require('../db');
const { getLocation, adminLocation, targetLocationId } = require('../locations');
const { canAccess } = require('../auth');

const router = express.Router();
const MAX_PAISE = 10000000; // ₹1,00,000 a night: anything above is a typo

// The prices a property needs, from its rooms: 'dorm' (per bed) if it has dorms,
// plus each private room type (per room).
function rateGroups(locationId) {
  const rooms = db
    .prepare('SELECT kind, room_type, MIN(sort_order) AS o FROM rooms WHERE location_id = ? AND active = 1 GROUP BY kind, room_type ORDER BY o')
    .all(locationId);
  const groups = [];
  if (rooms.some((r) => r.kind === 'dorm')) groups.push({ rate_key: 'dorm', label: 'Dorm bed', unit: 'bed', kind: 'dorm' });
  for (const r of rooms.filter((x) => x.kind === 'private')) {
    groups.push({ rate_key: r.room_type, label: r.room_type, unit: 'room', kind: /family/i.test(r.room_type) ? 'family' : 'private' });
  }
  return groups;
}

function ratesFor(locationId) {
  const stored = new Map(
    db
      .prepare(
        `SELECT r.rate_key, r.amount_paise, r.updated_at, s.name AS updated_by_name
           FROM room_rates r LEFT JOIN staff s ON s.id = r.updated_by
          WHERE r.location_id = ?`,
      )
      .all(locationId)
      .map((r) => [r.rate_key, r]),
  );
  return rateGroups(locationId).map((g) => ({
    ...g,
    amount_paise: stored.get(g.rate_key)?.amount_paise ?? null,
    updated_at: stored.get(g.rate_key)?.updated_at ?? null,
    updated_by_name: stored.get(g.rate_key)?.updated_by_name ?? null,
  }));
}

router.get('/', adminLocation, (req, res) => {
  const changes = db
    .prepare(
      `SELECT c.rate_key, c.old_paise, c.new_paise, c.changed_at, COALESCE(s.name, 'Owner') AS changed_by
         FROM room_rate_changes c LEFT JOIN staff s ON s.id = c.changed_by
        WHERE c.location_id = ? ORDER BY c.id DESC LIMIT 20`,
    )
    .all(req.location.id);
  res.json({ rates: ratesFor(req.location.id), changes });
});

// Body: { location_id, rates: [{ rate_key, amount_paise }] }. Only changed prices are logged.
router.put('/', (req, res) => {
  const b = req.body || {};
  const locationId = targetLocationId(req, b);
  if (!getLocation(locationId)) return res.status(400).json({ error: 'location_id must be a known property' });
  if (!canAccess(req, locationId)) return res.status(403).json({ error: 'You can only manage your own property' });
  if (!Array.isArray(b.rates) || b.rates.length === 0) return res.status(400).json({ error: 'Nothing to save' });

  const valid = new Map(rateGroups(locationId).map((g) => [g.rate_key, g]));
  for (const r of b.rates) {
    if (!valid.has(r.rate_key)) return res.status(400).json({ error: `Unknown room type: ${r.rate_key}` });
    const n = Math.round(Number(r.amount_paise));
    if (!(n > 0 && n <= MAX_PAISE)) return res.status(400).json({ error: `${valid.get(r.rate_key).label}: price must be between ₹1 and ₹1,00,000` });
  }

  const by = req.auth.staff ? req.auth.staff.id : null;
  const current = db.prepare('SELECT amount_paise FROM room_rates WHERE location_id = ? AND rate_key = ?');
  const upsert = db.prepare(
    `INSERT INTO room_rates (location_id, rate_key, amount_paise, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (location_id, rate_key) DO UPDATE SET
       amount_paise = excluded.amount_paise, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  );
  const log = db.prepare('INSERT INTO room_rate_changes (location_id, rate_key, old_paise, new_paise, changed_by) VALUES (?, ?, ?, ?, ?)');
  let changed = 0;
  db.transaction(() => {
    for (const r of b.rates) {
      const n = Math.round(Number(r.amount_paise));
      const old = current.get(locationId, r.rate_key)?.amount_paise ?? null;
      if (old === n) continue;
      upsert.run(locationId, r.rate_key, n, by);
      log.run(locationId, r.rate_key, old, n, by);
      changed += 1;
    }
  })();
  res.json({ ok: true, changed });
});

module.exports = { router, ratesFor };
