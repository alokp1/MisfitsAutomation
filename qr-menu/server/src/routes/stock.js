const express = require('express');
const db = require('../db');
const { getLocation, adminLocation, targetLocationId } = require('../locations');
const { canAccess } = require('../auth');

const router = express.Router();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const forbidden = (res) => res.status(403).json({ error: 'You can only manage your own property' });

// Items for one property with the count for ?date= (if taken) and the most recent count before it.
router.get('/', adminLocation, (req, res) => {
  const date = req.query.date;
  if (!DATE.test(date || '')) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const items = db
    .prepare(
      `SELECT i.id, i.name, i.unit, i.low_at,
              c.quantity AS quantity, c.updated_at AS counted_at,
              p.quantity AS previous_quantity, p.counted_on AS previous_on
         FROM stock_items i
         LEFT JOIN stock_counts c ON c.item_id = i.id AND c.counted_on = ?
         LEFT JOIN stock_counts p ON p.item_id = i.id AND p.counted_on = (
           SELECT MAX(counted_on) FROM stock_counts WHERE item_id = i.id AND counted_on < ?)
        WHERE i.location_id = ? AND i.active = 1
        ORDER BY i.sort_order, i.name`,
    )
    .all(date, date, req.location.id);
  res.json({ date, items });
});

// Save a whole day's count. Body: { location_id, date, counts: [{ item_id, quantity }] }
router.put('/counts', (req, res) => {
  const b = req.body || {};
  const locationId = targetLocationId(req, b);
  if (!getLocation(locationId)) return res.status(400).json({ error: 'location_id must be a known property' });
  if (!canAccess(req, locationId)) return forbidden(res);
  if (!DATE.test(b.date || '')) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!Array.isArray(b.counts) || b.counts.length === 0) return res.status(400).json({ error: 'Nothing to save' });

  const own = new Set(db.prepare('SELECT id FROM stock_items WHERE location_id = ?').all(locationId).map((r) => r.id));
  for (const c of b.counts) {
    if (!own.has(Number(c.item_id))) return res.status(400).json({ error: 'An item is not at this property' });
    if (!(Number(c.quantity) >= 0)) return res.status(400).json({ error: 'Counts must be zero or more' });
  }
  const upsert = db.prepare(
    `INSERT INTO stock_counts (item_id, counted_on, quantity, counted_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (item_id, counted_on) DO UPDATE SET
       quantity = excluded.quantity, counted_by = excluded.counted_by, updated_at = datetime('now')`,
  );
  db.transaction(() => {
    for (const c of b.counts) upsert.run(Number(c.item_id), b.date, Number(c.quantity), req.auth.staff?.id ?? null);
  })();
  res.json({ ok: true, saved: b.counts.length });
});

function parseItem(b) {
  const name = String(b.name || '').trim();
  const unit = String(b.unit || '').trim();
  if (!name) return { error: 'Item name is required' };
  if (!unit) return { error: 'Unit is required (e.g. tray, litre, packet)' };
  const low_at = b.low_at === '' || b.low_at == null ? null : Number(b.low_at);
  if (low_at != null && !(low_at >= 0)) return { error: 'Low-stock level must be zero or more' };
  return { value: { name, unit, low_at } };
}

router.post('/items', (req, res) => {
  const b = req.body || {};
  const locationId = targetLocationId(req, b);
  if (!getLocation(locationId)) return res.status(400).json({ error: 'location_id must be a known property' });
  if (!canAccess(req, locationId)) return forbidden(res);
  const parsed = parseItem(b);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const existing = db.prepare('SELECT id, active FROM stock_items WHERE location_id = ? AND name = ?').get(locationId, v.name);
  if (existing?.active) return res.status(409).json({ error: `${v.name} is already on the list` });
  if (existing) {
    // Re-adding a removed item brings it (and its history) back.
    db.prepare('UPDATE stock_items SET unit = ?, low_at = ?, active = 1 WHERE id = ?').run(v.unit, v.low_at, existing.id);
    return res.status(201).json({ id: existing.id });
  }
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM stock_items WHERE location_id = ?').get(locationId).n;
  const info = db
    .prepare('INSERT INTO stock_items (location_id, name, unit, low_at, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(locationId, v.name, v.unit, v.low_at, order);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/items/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, existing.location_id)) return forbidden(res);
  const b = req.body || {};
  const parsed = parseItem({ name: existing.name, unit: existing.unit, low_at: existing.low_at, ...b });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const active = b.active != null ? (b.active ? 1 : 0) : existing.active;
  try {
    db.prepare('UPDATE stock_items SET name = ?, unit = ?, low_at = ?, active = ? WHERE id = ?').run(
      v.name, v.unit, v.low_at, active, existing.id,
    );
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: `${v.name} is already on the list` });
    throw e;
  }
  res.json({ ok: true });
});

module.exports = router;
