const express = require('express');
const db = require('../db');
const { getLocation, adminLocationOptional, targetLocationId } = require('../locations');
const { canAccess } = require('../auth');

const publicRouter = express.Router();
const adminRouter = express.Router();

const CLOSED_STATUSES = new Set(['served', 'cancelled']);

// Prices a cart from server-side menu prices and item tax rates.
// Returns { error } or { itemRows, subtotal, tax, total }.
function priceItems(location_id, items) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'items must be a non-empty array' };
  const itemRows = [];
  let subtotal = 0;
  let tax = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 0));
    const m = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(it.menu_item_id));
    if (!m) return { error: `Unknown menu item: ${it.menu_item_id}` };
    if (m.location_id !== location_id) return { error: `${m.name} is not on this cafe's menu` };
    if (!m.is_available) return { error: `Item not available: ${m.name}` };

    const lineSubtotal = m.price_paise * qty;
    const taxPercent = Number(m.tax_percent || 0);
    const lineTax = Math.round(lineSubtotal * (taxPercent / 100));
    subtotal += lineSubtotal;
    tax += lineTax;
    itemRows.push({
      menu_item_id: m.id,
      name_snapshot: m.name,
      price_paise_snapshot: m.price_paise,
      tax_percent_snapshot: taxPercent,
      tax_paise_snapshot: lineTax,
      quantity: qty,
    });
  }
  return { itemRows, subtotal, tax, total: subtotal + tax };
}

const insertOrder = db.prepare(
  `INSERT INTO orders
   (location_id, table_id, customer_name, customer_phone, note, subtotal_paise, tax_paise, total_paise,
    status, payment_status, payment_method)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertItem = db.prepare(
  `INSERT INTO order_items
   (order_id, menu_item_id, name_snapshot, price_paise_snapshot, tax_percent_snapshot, tax_paise_snapshot, quantity)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

function saveOrder(o, priced) {
  return db.transaction(() => {
    const info = insertOrder.run(
      o.location_id, o.table_id, o.customer_name, o.customer_phone, o.note,
      priced.subtotal, priced.tax, priced.total,
      o.status || 'pending', o.payment_status || 'unpaid', o.payment_method || '',
    );
    for (const r of priced.itemRows) {
      insertItem.run(
        info.lastInsertRowid, r.menu_item_id, r.name_snapshot, r.price_paise_snapshot,
        r.tax_percent_snapshot, r.tax_paise_snapshot, r.quantity,
      );
    }
    return info.lastInsertRowid;
  })();
}

// Place a new order.
// Body: { location_id, table_id, customer_name, customer_phone, note, items: [{menu_item_id, quantity}] }
publicRouter.post('/', (req, res) => {
  const { location_id, table_id = '', customer_name = '', customer_phone = '', note = '', items = [] } =
    req.body || {};
  if (!getLocation(location_id)) {
    return res.status(400).json({ error: 'location_id must be a known cafe id' });
  }
  const priced = priceItems(location_id, items);
  if (priced.error) return res.status(400).json({ error: priced.error });
  const orderId = saveOrder({ location_id, table_id, customer_name, customer_phone, note }, priced);
  res.status(201).json({ id: orderId, subtotal_paise: priced.subtotal, tax_paise: priced.tax, total_paise: priced.total });
});

function loadOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  return { ...order, items };
}

publicRouter.get('/:id', (req, res) => {
  const order = loadOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});

// Admin: list orders (most recent first). ?location=<id> limits to one cafe; omit for all.
adminRouter.get('/', adminLocationOptional, (req, res) => {
  const where = req.location ? 'WHERE location_id = ?' : '';
  const args = req.location ? [req.location.id] : [];
  const orders = db
    .prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT 200`)
    .all(...args)
    .map((o) => ({
      ...o,
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id),
    }));
  res.json(orders);
});

adminRouter.get('/analytics', adminLocationOptional, (req, res) => {
  const locationId = req.location ? req.location.id : null;
  const orders = db
    .prepare('SELECT * FROM orders WHERE (? IS NULL OR location_id = ?) ORDER BY id DESC')
    .all(locationId, locationId);
  const billableOrders = orders.filter((o) => o.status !== 'cancelled');
  const paidOrders = orders.filter((o) => o.payment_status === 'paid' && o.status !== 'cancelled');
  const activeOrders = orders.filter((o) => !CLOSED_STATUSES.has(o.status));
  const closedOrders = orders.filter((o) => CLOSED_STATUSES.has(o.status));

  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const grossSalesPaise = sum(billableOrders, 'total_paise');
  const paidSalesPaise = sum(paidOrders, 'total_paise');

  const topItems = db
    .prepare(
      `SELECT oi.name_snapshot AS name,
              SUM(oi.quantity) AS quantity,
              SUM(oi.price_paise_snapshot * oi.quantity) AS subtotal_paise,
              SUM(oi.tax_paise_snapshot) AS tax_paise
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status != 'cancelled' AND (? IS NULL OR o.location_id = ?)
        GROUP BY oi.name_snapshot
        ORDER BY quantity DESC, subtotal_paise DESC
        LIMIT 8`,
    )
    .all(locationId, locationId)
    .map((row) => ({
      ...row,
      total_paise: Number(row.subtotal_paise || 0) + Number(row.tax_paise || 0),
    }));

  const dailySales = db
    .prepare(
      `SELECT date(created_at) AS day,
              COUNT(*) AS orders,
              SUM(total_paise) AS total_paise
         FROM orders
        WHERE status != 'cancelled' AND (? IS NULL OR location_id = ?)
        GROUP BY date(created_at)
        ORDER BY day DESC
        LIMIT 7`,
    )
    .all(locationId, locationId);

  const byLocation = db
    .prepare(
      `SELECT l.id AS location_id, l.name,
              COUNT(o.id) AS orders,
              COALESCE(SUM(o.total_paise), 0) AS total_paise
         FROM locations l
         LEFT JOIN orders o ON o.location_id = l.id AND o.status != 'cancelled'
        WHERE (? IS NULL OR l.id = ?)
        GROUP BY l.id
        ORDER BY l.sort_order, l.name`,
    )
    .all(locationId, locationId);

  res.json({
    summary: {
      totalOrders: orders.length,
      activeOrders: activeOrders.length,
      closedOrders: closedOrders.length,
      paidOrders: paidOrders.length,
      grossSalesPaise,
      paidSalesPaise,
      subtotalPaise: sum(billableOrders, 'subtotal_paise'),
      taxPaise: sum(billableOrders, 'tax_paise'),
      averageOrderPaise: billableOrders.length ? Math.round(grossSalesPaise / billableOrders.length) : 0,
    },
    topItems,
    dailySales,
    byLocation,
  });
});

// Counter sale: paid at the counter in cash/UPI/card, not through the QR menu.
// Recorded as a served, paid order so it counts in sales and top items.
// Body: { location_id, items: [{menu_item_id, quantity}], payment_method, customer_name?, note? }
const COUNTER_METHODS = ['cash', 'upi', 'card'];
adminRouter.post('/counter', (req, res) => {
  const b = req.body || {};
  const location_id = targetLocationId(req, b);
  if (!getLocation(location_id)) return res.status(400).json({ error: 'location_id must be a known cafe id' });
  if (!canAccess(req, location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  if (!COUNTER_METHODS.includes(b.payment_method)) return res.status(400).json({ error: 'Choose how the guest paid' });
  const priced = priceItems(location_id, b.items);
  if (priced.error) return res.status(400).json({ error: priced.error });
  const id = saveOrder(
    {
      location_id,
      table_id: 'Counter',
      customer_name: String(b.customer_name || '').trim(),
      customer_phone: '',
      note: String(b.note || '').trim(),
      status: 'served',
      payment_status: 'paid',
      payment_method: b.payment_method,
    },
    priced,
  );
  res.status(201).json({ id, total_paise: priced.total });
});

adminRouter.put('/:id/status', (req, res) => {
  const { status } = req.body || {};
  const allowed = ['pending', 'paid', 'preparing', 'served', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
  const order = db.prepare('SELECT location_id FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, order.location_id)) return res.status(403).json({ error: 'You can only manage your own property' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

module.exports = { public: publicRouter, admin: adminRouter };
