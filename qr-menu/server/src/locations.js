const express = require('express');
const db = require('./db');

function getLocation(id) {
  return db.prepare('SELECT id, name FROM locations WHERE id = ?').get(String(id || '')) || null;
}

// Resolves ?location=<id> onto req.location, or responds 400 when it is missing or unknown.
function requireLocation(req, res, next) {
  const location = getLocation(req.query.location);
  if (!location) {
    return res.status(400).json({ error: 'location query parameter must be a known cafe id' });
  }
  req.location = location;
  next();
}

// Like requireLocation, but a missing ?location= means "all cafes" (req.location = null).
function optionalLocation(req, res, next) {
  if (req.query.location == null || req.query.location === '') {
    req.location = null;
    return next();
  }
  return requireLocation(req, res, next);
}

// Admin variants. A property manager is always scoped to their own property: asking
// for another one is 403, and omitting ?location= means theirs. The owner gets the
// public behaviour above.
function scopedFor(fallback) {
  return (req, res, next) => {
    const staff = req.auth?.staff;
    if (!staff) return fallback(req, res, next);
    const asked = req.query.location;
    if (asked && asked !== staff.location_id) {
      return res.status(403).json({ error: 'You can only see your own property' });
    }
    req.location = getLocation(staff.location_id);
    next();
  };
}
const adminLocation = scopedFor(requireLocation);

// The property a write is for: as asked in the body, or a manager's own when not given.
// Callers then check canAccess(), which refuses a manager asking for another property
// (rather than quietly applying the change to their own).
function targetLocationId(req, body) {
  return (body || {}).location_id || req.auth?.staff?.location_id;
}
const adminLocationOptional = scopedFor(optionalLocation);

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, name FROM locations ORDER BY sort_order, name').all());
});

module.exports = {
  getLocation,
  requireLocation,
  optionalLocation,
  adminLocation,
  adminLocationOptional,
  targetLocationId,
  router,
};
