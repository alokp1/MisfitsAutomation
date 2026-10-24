const express = require('express');
const db = require('../db');
const { getLocation } = require('../locations');
const { requireOwner, hashPin, PIN_PATTERN } = require('../auth');

const router = express.Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT s.id, s.name, s.location_id, l.name AS location_name, s.active, s.locked_until, s.created_at
           FROM staff s JOIN locations l ON l.id = s.location_id
          ORDER BY s.active DESC, l.sort_order, s.name`,
      )
      .all(),
  );
});

router.post('/', (req, res) => {
  const { name, location_id, pin } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required' });
  if (!getLocation(location_id)) return res.status(400).json({ error: 'Choose a property' });
  if (!PIN_PATTERN.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be 4 to 8 digits' });
  const info = db
    .prepare('INSERT INTO staff (name, location_id, pin_hash) VALUES (?, ?, ?)')
    .run(String(name).trim(), location_id, hashPin(String(pin)));
  res.status(201).json({ id: info.lastInsertRowid });
});

// Body may change name, property, active, or set a new pin. A new pin or
// deactivation signs the person out everywhere.
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.location_id != null && !getLocation(b.location_id)) return res.status(400).json({ error: 'Choose a property' });
  if (b.pin != null && !PIN_PATTERN.test(String(b.pin))) return res.status(400).json({ error: 'PIN must be 4 to 8 digits' });
  const name = b.name != null ? String(b.name).trim() : existing.name;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const active = b.active != null ? (b.active ? 1 : 0) : existing.active;

  db.transaction(() => {
    db.prepare(
      `UPDATE staff SET name = ?, location_id = ?, active = ?, pin_hash = ?,
              failed_attempts = CASE WHEN ? THEN 0 ELSE failed_attempts END,
              locked_until = CASE WHEN ? THEN NULL ELSE locked_until END
        WHERE id = ?`,
    ).run(
      name,
      b.location_id ?? existing.location_id,
      active,
      b.pin != null ? hashPin(String(b.pin)) : existing.pin_hash,
      b.pin != null ? 1 : 0,
      b.pin != null ? 1 : 0,
      existing.id,
    );
    if (b.pin != null || !active || (b.location_id && b.location_id !== existing.location_id)) {
      db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(existing.id);
    }
  })();
  res.json({ ok: true });
});

module.exports = router;
