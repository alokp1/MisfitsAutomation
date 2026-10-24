const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('../db');
const { getLocation, adminLocation, targetLocationId } = require('../locations');
const { canAccess, requireOwner } = require('../auth');

const router = express.Router();

const CATEGORIES = [
  'Groceries',
  'Vegetables',
  'Dairy & eggs',
  'Gas & fuel',
  'Cleaning & laundry',
  'Maintenance & repairs',
  'Utilities & internet',
  'Salaries & wages',
  'Transport',
  'Other',
];
const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
// Receipts live next to the SQLite file, on the same volume.
const receiptDir = path.join(path.dirname(db.name), 'receipts');
const forbidden = (res) => res.status(403).json({ error: 'You can only manage your own property' });
const MAX_BULK_ROWS = 100;
const indiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function parseExpense(body) {
  const b = body || {};
  if (!DATE.test(b.spent_on || '')) return { error: 'Date is required' };
  if (b.spent_on > indiaToday()) return { error: 'Date is in the future' };
  if (!CATEGORIES.includes(b.category)) return { error: 'Choose a category' };
  if (!PAYMENT_MODES.includes(b.payment_mode)) return { error: 'Choose how it was paid' };
  const amount = Math.round(Number(b.amount_paise));
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be more than zero' };
  return {
    value: {
      spent_on: b.spent_on,
      category: b.category,
      description: String(b.description || '').trim(),
      amount_paise: amount,
      paid_by: String(b.paid_by || '').trim(),
      payment_mode: b.payment_mode,
    },
  };
}

// Accepts a data: URL from the phone camera and stores it; returns the file name.
function saveReceipt(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) return { error: 'Bill photo must be a JPEG, PNG or WebP image' };
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_RECEIPT_BYTES) return { error: 'Bill photo is too large' };
  fs.mkdirSync(receiptDir, { recursive: true });
  const file = `${crypto.randomUUID()}.${RECEIPT_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(receiptDir, file), bytes);
  return { file };
}

function removeReceipt(file) {
  if (file) fs.rm(path.join(receiptDir, path.basename(file)), { force: true }, () => {});
}

router.get('/options', (req, res) => {
  res.json({ categories: CATEGORIES, payment_modes: PAYMENT_MODES });
});

// ?month=YYYY-MM (defaults to all recent). Also returns who has paid before, for suggestions.
router.get('/', adminLocation, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '';
  const rows = db
    .prepare(
      `SELECT id, location_id, spent_on, category, description, amount_paise, paid_by, payment_mode,
              receipt_file != '' AS has_receipt, created_at
         FROM expenses
        WHERE location_id = ? AND (? = '' OR substr(spent_on, 1, 7) = ?)
        ORDER BY spent_on DESC, id DESC
        LIMIT 500`,
    )
    .all(req.location.id, month, month);
  const payers = db
    .prepare(
      `SELECT paid_by FROM expenses WHERE location_id = ? AND paid_by != ''
        GROUP BY paid_by ORDER BY COUNT(*) DESC LIMIT 20`,
    )
    .all(req.location.id)
    .map((r) => r.paid_by);
  res.json({ expenses: rows, payers });
});

router.post('/', (req, res) => {
  const locationId = targetLocationId(req, req.body);
  if (!getLocation(locationId)) return res.status(400).json({ error: 'location_id must be a known property' });
  if (!canAccess(req, locationId)) return forbidden(res);
  const parsed = parseExpense(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  let receipt = '';
  if (req.body.receipt) {
    const saved = saveReceipt(req.body.receipt);
    if (saved.error) return res.status(400).json({ error: saved.error });
    receipt = saved.file;
  }
  const v = parsed.value;
  const info = db
    .prepare(
      `INSERT INTO expenses
       (location_id, spent_on, category, description, amount_paise, paid_by, payment_mode, receipt_file, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      locationId, v.spent_on, v.category, v.description, v.amount_paise, v.paid_by, v.payment_mode, receipt,
      req.auth.staff ? req.auth.staff.id : null,
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

// Many expenses at once. Body: { location_id, expenses: [{ ...same fields as POST /, receipt? }] }
// Every row is checked first; any problem → 400 with { errors: [{ row, error }] } and nothing is saved.
router.post('/bulk', (req, res) => {
  const b = req.body || {};
  const locationId = targetLocationId(req, b);
  if (!getLocation(locationId)) return res.status(400).json({ error: 'location_id must be a known property' });
  if (!canAccess(req, locationId)) return forbidden(res);
  if (!Array.isArray(b.expenses) || b.expenses.length === 0) return res.status(400).json({ error: 'Nothing to save' });
  if (b.expenses.length > MAX_BULK_ROWS) return res.status(400).json({ error: `Save at most ${MAX_BULK_ROWS} rows at a time` });

  const errors = [];
  const rows = b.expenses.map((x, i) => {
    const parsed = parseExpense(x);
    if (parsed.error) errors.push({ row: i, error: parsed.error });
    else if (x.receipt && !/^data:image\/(jpeg|png|webp);base64,/.test(String(x.receipt))) {
      errors.push({ row: i, error: 'Bill photo must be a JPEG, PNG or WebP image' });
    }
    return parsed.value;
  });
  if (errors.length) return res.status(400).json({ error: `${errors.length} row${errors.length === 1 ? ' needs' : 's need'} fixing`, errors });

  const saved = [];
  try {
    b.expenses.forEach((x, i) => {
      if (!x.receipt) return;
      const r = saveReceipt(x.receipt);
      if (r.error) throw Object.assign(new Error(r.error), { row: i });
      rows[i].receipt_file = r.file;
      saved.push(r.file);
    });
    const insert = db.prepare(
      `INSERT INTO expenses
       (location_id, spent_on, category, description, amount_paise, paid_by, payment_mode, receipt_file, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const by = req.auth.staff ? req.auth.staff.id : null;
    const ids = db.transaction(() =>
      rows.map((v) =>
        insert.run(locationId, v.spent_on, v.category, v.description, v.amount_paise, v.paid_by, v.payment_mode, v.receipt_file || '', by)
          .lastInsertRowid,
      ),
    )();
    res.status(201).json({ ok: true, saved: ids.length, ids, total_paise: rows.reduce((s, v) => s + v.amount_paise, 0) });
  } catch (e) {
    saved.forEach(removeReceipt);
    if (e.row != null) return res.status(400).json({ error: '1 row needs fixing', errors: [{ row: e.row, error: e.message }] });
    throw e;
  }
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, existing.location_id)) return forbidden(res);
  const parsed = parseExpense(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  let receipt = existing.receipt_file;
  if (req.body.receipt) {
    const saved = saveReceipt(req.body.receipt);
    if (saved.error) return res.status(400).json({ error: saved.error });
    receipt = saved.file;
  }
  const v = parsed.value;
  db.prepare(
    `UPDATE expenses SET spent_on = ?, category = ?, description = ?, amount_paise = ?, paid_by = ?,
            payment_mode = ?, receipt_file = ?
      WHERE id = ?`,
  ).run(v.spent_on, v.category, v.description, v.amount_paise, v.paid_by, v.payment_mode, receipt, existing.id);
  if (receipt !== existing.receipt_file) removeReceipt(existing.receipt_file);
  res.json({ ok: true });
});

router.get('/:id/receipt', (req, res) => {
  const existing = db.prepare('SELECT location_id, receipt_file FROM expenses WHERE id = ?').get(Number(req.params.id));
  if (!existing || !existing.receipt_file) return res.status(404).json({ error: 'No bill photo' });
  if (!canAccess(req, existing.location_id)) return forbidden(res);
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(receiptDir, path.basename(existing.receipt_file)));
});

router.delete('/:id', requireOwner, (req, res) => {
  const existing = db.prepare('SELECT receipt_file FROM expenses WHERE id = ?').get(Number(req.params.id));
  db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(req.params.id));
  if (existing) removeReceipt(existing.receipt_file);
  res.json({ ok: true });
});

module.exports = { router, CATEGORIES, PAYMENT_MODES };
