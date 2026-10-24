const express = require('express');
const db = require('../db');
const { getLocation, requireLocation, adminLocation } = require('../locations');
const { canAccess } = require('../auth');

const publicRouter = express.Router();
const adminRouter = express.Router();

// A category may only hold items from its own cafe. No category is always fine.
function categoryBelongsTo(categoryId, locationId) {
  if (!categoryId) return true;
  const c = db.prepare('SELECT location_id FROM categories WHERE id = ?').get(Number(categoryId));
  return !!c && c.location_id === locationId;
}

// Public: list available items for one cafe, grouped-friendly
publicRouter.get('/', requireLocation, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.id, m.location_id, m.name, m.description, m.price_paise, m.tax_percent, m.is_veg, m.image_url,
              m.is_available, m.category_id, c.name AS category_name
         FROM menu_items m
         LEFT JOIN categories c ON c.id = m.category_id
        WHERE m.is_available = 1 AND m.location_id = ?
        ORDER BY c.sort_order, c.name, m.name`,
    )
    .all(req.location.id);
  res.json(rows);
});

// Admin: list ALL items for one cafe, including unavailable
adminRouter.get('/', adminLocation, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.id, m.location_id, m.name, m.description, m.price_paise, m.tax_percent, m.is_veg, m.image_url,
              m.is_available, m.category_id, c.name AS category_name
         FROM menu_items m
         LEFT JOIN categories c ON c.id = m.category_id
        WHERE m.location_id = ?
        ORDER BY c.sort_order, c.name, m.name`,
    )
    .all(req.location.id);
  res.json(rows);
});

adminRouter.post('/', (req, res) => {
  const {
    location_id,
    category_id = null,
    name,
    description = '',
    price_paise,
    tax_percent = 5,
    is_veg = 1,
    image_url = '',
    is_available = 1,
  } = req.body || {};
  if (!getLocation(location_id)) return res.status(400).json({ error: 'location_id must be a known cafe id' });
  if (!canAccess(req, location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (price_paise == null || isNaN(Number(price_paise))) {
    return res.status(400).json({ error: 'price_paise is required (integer paise)' });
  }
  if (isNaN(Number(tax_percent)) || Number(tax_percent) < 0) {
    return res.status(400).json({ error: 'tax_percent must be zero or greater' });
  }
  if (!categoryBelongsTo(category_id, location_id)) {
    return res.status(400).json({ error: 'category belongs to a different cafe' });
  }
  const info = db
    .prepare(
      `INSERT INTO menu_items
       (location_id, category_id, name, description, price_paise, tax_percent, is_veg, image_url, is_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      location_id,
      category_id || null,
      name.trim(),
      description,
      Math.round(Number(price_paise)),
      Number(tax_percent),
      is_veg ? 1 : 0,
      image_url,
      is_available ? 1 : 0,
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

// Copy every category and item from one cafe into another whose menu is still empty.
// Body: { from, to }
adminRouter.post('/copy', (req, res) => {
  const { from, to } = req.body || {};
  if (!getLocation(from) || !getLocation(to)) {
    return res.status(400).json({ error: 'from and to must be known cafe ids' });
  }
  if (from === to) return res.status(400).json({ error: 'from and to must be different cafes' });
  if (!canAccess(req, to)) return res.status(403).json({ error: 'You can only manage your own property' });
  const targetHasMenu =
    db.prepare('SELECT 1 FROM menu_items WHERE location_id = ? LIMIT 1').get(to) ||
    db.prepare('SELECT 1 FROM categories WHERE location_id = ? LIMIT 1').get(to);
  if (targetHasMenu) {
    return res.status(409).json({ error: 'The target cafe already has a menu; copy only works into an empty one' });
  }

  const copied = db.transaction(() => {
    const categoryIdMap = new Map();
    const cats = db.prepare('SELECT * FROM categories WHERE location_id = ?').all(from);
    const insertCat = db.prepare('INSERT INTO categories (location_id, name, sort_order) VALUES (?, ?, ?)');
    for (const c of cats) {
      categoryIdMap.set(c.id, insertCat.run(to, c.name, c.sort_order).lastInsertRowid);
    }
    const items = db.prepare('SELECT * FROM menu_items WHERE location_id = ?').all(from);
    const insertItem = db.prepare(
      `INSERT INTO menu_items
       (location_id, category_id, name, description, price_paise, tax_percent, is_veg, image_url, is_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of items) {
      insertItem.run(
        to,
        m.category_id ? categoryIdMap.get(m.category_id) ?? null : null,
        m.name,
        m.description,
        m.price_paise,
        m.tax_percent,
        m.is_veg,
        m.image_url,
        m.is_available,
      );
    }
    return { categories: cats.length, items: items.length };
  })();
  res.status(201).json(copied);
});

adminRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, existing.location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  const b = req.body || {};
  if (b.tax_percent != null && (isNaN(Number(b.tax_percent)) || Number(b.tax_percent) < 0)) {
    return res.status(400).json({ error: 'tax_percent must be zero or greater' });
  }
  const categoryId = b.category_id !== undefined ? b.category_id || null : existing.category_id;
  if (!categoryBelongsTo(categoryId, existing.location_id)) {
    return res.status(400).json({ error: 'category belongs to a different cafe' });
  }
  db.prepare(
    `UPDATE menu_items SET
        category_id = ?, name = ?, description = ?, price_paise = ?, tax_percent = ?,
        is_veg = ?, image_url = ?, is_available = ?
      WHERE id = ?`,
  ).run(
    categoryId,
    (b.name ?? existing.name).trim(),
    b.description ?? existing.description,
    b.price_paise != null ? Math.round(Number(b.price_paise)) : existing.price_paise,
    b.tax_percent != null ? Number(b.tax_percent) : existing.tax_percent,
    b.is_veg != null ? (b.is_veg ? 1 : 0) : existing.is_veg,
    b.image_url ?? existing.image_url,
    b.is_available != null ? (b.is_available ? 1 : 0) : existing.is_available,
    id,
  );
  res.json({ ok: true });
});

adminRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT location_id FROM menu_items WHERE id = ?').get(id);
  if (existing && !canAccess(req, existing.location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = { public: publicRouter, admin: adminRouter };
