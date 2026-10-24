const express = require('express');
const QRCode = require('qrcode');
const { requireLocation } = require('../locations');

const router = express.Router();

function menuUrl(location, table) {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';
  return `${base}/${location.id}/menu${table ? `?table=${encodeURIComponent(table)}` : ''}`;
}

// GET /api/qr?location=shoja&table=T1 → PNG QR pointing at <PUBLIC_BASE_URL>/shoja/menu?table=T1
router.get('/', requireLocation, async (req, res, next) => {
  try {
    const table = String(req.query.table || '').trim();
    const png = await QRCode.toBuffer(menuUrl(req.location, table), { width: 512, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `inline; filename="qr-${req.location.id}-${table || 'menu'}.png"`);
    res.send(png);
  } catch (e) {
    next(e);
  }
});

// JSON variant: returns dataURL + URL (handy for the admin UI)
router.get('/data', requireLocation, async (req, res, next) => {
  try {
    const table = String(req.query.table || '').trim();
    const url = menuUrl(req.location, table);
    const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 2 });
    res.json({ url, dataUrl, location: req.location });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
