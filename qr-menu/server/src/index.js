require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const menuRoutes = require('./routes/menu');
const categoryRoutes = require('./routes/categories');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payment');
const qrRoutes = require('./routes/qr');
const bookings = require('./routes/bookings');
const expenses = require('./routes/expenses');
const staffRoutes = require('./routes/staff');
const stockRoutes = require('./routes/stock');
const dashboardRoutes = require('./routes/dashboard');
const notify = require('./notify');
const rates = require('./routes/rates');
const checkin = require('./routes/checkin');
const locations = require('./locations');
const auth = require('./auth');

const app = express();
app.use(cors());
// Expense bodies can carry a bill photo and check-ins two ID photos; everything else stays small.
const smallJson = express.json({ limit: '1mb' });
const photoJson = express.json({ limit: '6mb' });
const bulkPhotoJson = express.json({ limit: '30mb' }); // up to 100 rows, photos shrunk on the phone
app.use((req, res, next) => {
  const parser =
    req.path === '/api/admin/expenses/bulk' ? bulkPhotoJson
      : req.path.startsWith('/api/admin/expenses') || req.path.startsWith('/api/checkin/') ? photoJson
        : smallJson;
  parser(req, res, next);
});
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Expose Razorpay public key id (safe — non-secret) so the client can open Checkout
app.get('/api/config', (req, res) => {
  res.json({
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  });
});

// Manager sign-in (name + PIN) and sign-out
app.use('/api/auth', auth.router);

// Guest self check-in (no sign-in: the link's token is the key)
app.use('/api/checkin', checkin.publicRouter);

// Admin: the owner (x-admin-password) or a signed-in property manager (Bearer token)
app.use('/api/admin', auth.requireStaffOrOwner);

// Credential check for the admin login screen: who am I?
app.get('/api/admin/ping', (req, res) =>
  res.json(req.auth.owner ? { role: 'owner' } : { role: 'manager', staff: req.auth.staff }),
);

// Public + admin route mounts
app.use('/api/locations', locations.router);
app.use('/api/menu', menuRoutes.public);
app.use('/api/admin/menu', menuRoutes.admin);
app.use('/api/categories', categoryRoutes.public);
app.use('/api/admin/categories', categoryRoutes.admin);
app.use('/api/orders', orderRoutes.public);
app.use('/api/admin/orders', orderRoutes.admin);
app.use('/api/admin/bookings', checkin.adminRouter);
app.use('/api/admin/bookings', bookings.router);
app.use('/api/admin/expenses', expenses.router);
app.use('/api/admin/staff', staffRoutes);
app.use('/api/admin/stock', stockRoutes);
app.use('/api/admin/dashboard', dashboardRoutes);
app.use('/api/admin/notifications', notify.router);
app.use('/api/admin/rates', rates.router);
app.use('/api/payment', paymentRoutes);
app.use('/api/qr', qrRoutes);

app.use((err, req, res, next) => {
  // Body-parser errors (malformed JSON, oversized body) carry their own 4xx status.
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Request is too large' : 'Malformed request' });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`QR-Menu server listening on http://localhost:${PORT}`);
});

// Evening reminders and the owner's nightly summary (no-op without TELEGRAM_BOT_TOKEN).
notify.start();
// Deletes guests' ID photos once they pass the retention period.
checkin.startPurge();
