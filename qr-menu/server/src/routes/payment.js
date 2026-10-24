const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../db');

const router = express.Router();

function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) return null;
  return new Razorpay({ key_id, key_secret });
}

// Create a Razorpay order linked to a placed order in our DB.
// Body: { order_id }
router.post('/create-razorpay-order', async (req, res, next) => {
  try {
    const { order_id } = req.body || {};
    const dbOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(order_id));
    if (!dbOrder) return res.status(404).json({ error: 'Order not found' });
    if (dbOrder.payment_status === 'paid') {
      return res.status(400).json({ error: 'Order already paid' });
    }

    const rzp = getRazorpay();
    if (!rzp) {
      return res.status(500).json({
        error:
          'Razorpay not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env',
      });
    }

    const rzpOrder = await rzp.orders.create({
      amount: dbOrder.total_paise, // in paise
      currency: 'INR',
      receipt: `order_${dbOrder.id}`,
      notes: { db_order_id: String(dbOrder.id), location_id: dbOrder.location_id, table_id: dbOrder.table_id || '' },
    });

    db.prepare('UPDATE orders SET razorpay_order_id = ? WHERE id = ?').run(
      rzpOrder.id,
      dbOrder.id,
    );

    res.json({
      razorpay_order_id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (e) {
    next(e);
  }
});

// Verify the signature returned by Razorpay Checkout.
// Body: { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, method }
router.post('/verify', (req, res, next) => {
  try {
    const {
      order_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      method = '',
    } = req.body || {};
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return res.status(500).json({ error: 'Razorpay not configured' });

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      db.prepare(
        'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
      ).run('failed', 'cancelled', Number(order_id));
      return res.status(400).json({ ok: false, error: 'Signature mismatch' });
    }

    db.prepare(
      `UPDATE orders SET
         payment_status = 'paid',
         status = 'paid',
         payment_method = ?,
         razorpay_payment_id = ?,
         razorpay_signature = ?
       WHERE id = ?`,
    ).run(method, razorpay_payment_id, razorpay_signature, Number(order_id));

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
