const express = require('express');
const db = require('../db');
const { getLocation, requireLocation } = require('../locations');
const { canAccess } = require('../auth');

const publicRouter = express.Router();
const adminRouter = express.Router();

publicRouter.get('/', requireLocation, (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, location_id, name, sort_order FROM categories WHERE location_id = ? ORDER BY sort_order, name',
    )
    .all(req.location.id);
  res.json(rows);
});

adminRouter.post('/', (req, res) => {
  const { location_id, name, sort_order = 0 } = req.body || {};
  if (!getLocation(location_id)) return res.status(400).json({ error: 'location_id must be a known cafe id' });
  if (!canAccess(req, location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const info = db
      .prepare('INSERT INTO categories (location_id, name, sort_order) VALUES (?, ?, ?)')
      .run(location_id, name.trim(), Number(sort_order) || 0);
    res.status(201).json({ id: info.lastInsertRowid, location_id, name: name.trim(), sort_order });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    throw e;
  }
});

adminRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, sort_order } = req.body || {};
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, existing.location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  db.prepare('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?').run(
    name ?? existing.name,
    sort_order ?? existing.sort_order,
    id,
  );
  res.json({ ok: true });
});

adminRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT location_id FROM categories WHERE id = ?').get(id);
  if (existing && !canAccess(req, existing.location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = { public: publicRouter, admin: adminRouter };
