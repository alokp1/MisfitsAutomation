const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const SESSION_DAYS = 30;
const MAX_FAILED_PINS = 5;
const LOCKOUT_MINUTES = 15;
const PIN_PATTERN = /^\d{4,8}$/;

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}

function pinMatches(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(pin), salt, 32), Buffer.from(hash, 'hex'));
}

function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function staffForToken(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT s.id, s.name, s.location_id
           FROM sessions x JOIN staff s ON s.id = x.staff_id
          WHERE x.token_hash = ? AND x.expires_at > datetime('now') AND s.active = 1`,
      )
      .get(tokenHash(token)) || null
  );
}

// Wrong owner passwords per visitor address (X-Real-IP from the website gateway).
// Too many in a row blocks that address for a while, so the password can't be guessed.
const MAX_FAILED_PASSWORDS = 10;
const ownerFailures = new Map(); // ip -> { count, until }

// Every /api/admin request is either the owner (x-admin-password) or a property
// manager (Authorization: Bearer <session token>). Sets req.auth.
function requireStaffOrOwner(req, res, next) {
  const ownerPassword = process.env.ADMIN_PASSWORD;
  const provided = req.header('x-admin-password');
  if (provided) {
    const ip = req.header('x-real-ip') || req.ip;
    const f = ownerFailures.get(ip);
    if (f && f.until > Date.now()) {
      const minutes = Math.ceil((f.until - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many wrong passwords. Try again in ${minutes} min.` });
    }
    if (ownerPassword && sameSecret(provided, ownerPassword)) {
      ownerFailures.delete(ip);
      req.auth = { owner: true, staff: null };
      return next();
    }
    const count = (f && f.until === 0 ? f.count : 0) + 1;
    ownerFailures.set(ip, count >= MAX_FAILED_PASSWORDS ? { count: 0, until: Date.now() + LOCKOUT_MINUTES * 60000 } : { count, until: 0 });
    if (ownerFailures.size > 5000) ownerFailures.clear();
  }
  const bearer = (req.header('authorization') || '').match(/^Bearer\s+(.+)$/i);
  const staff = bearer && staffForToken(bearer[1]);
  if (staff) {
    req.auth = { owner: false, staff };
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireOwner(req, res, next) {
  if (!req.auth?.owner) return res.status(403).json({ error: 'Only the owner can do this' });
  next();
}

// Owner: any cafe. Manager: only their own property.
function canAccess(req, locationId) {
  return !!req.auth && (req.auth.owner || req.auth.staff.location_id === locationId);
}

const router = express.Router();

// Names for the manager sign-in screen.
router.get('/staff', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT s.id, s.name, s.location_id, l.name AS location_name
           FROM staff s JOIN locations l ON l.id = s.location_id
          WHERE s.active = 1
          ORDER BY l.sort_order, s.name`,
      )
      .all(),
  );
});

router.post('/login', (req, res) => {
  const { staff_id, pin } = req.body || {};
  const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND active = 1').get(Number(staff_id));
  if (!staff) return res.status(401).json({ error: 'Incorrect name or PIN' });

  if (staff.locked_until && staff.locked_until > new Date().toISOString()) {
    const minutes = Math.ceil((new Date(staff.locked_until) - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many wrong PINs. Try again in ${minutes} min.` });
  }

  if (!pinMatches(pin, staff.pin_hash)) {
    const failed = staff.failed_attempts + 1;
    if (failed >= MAX_FAILED_PINS) {
      const until = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString();
      db.prepare('UPDATE staff SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(until, staff.id);
    } else {
      db.prepare('UPDATE staff SET failed_attempts = ? WHERE id = ?').run(failed, staff.id);
    }
    return res.status(401).json({ error: 'Incorrect name or PIN' });
  }

  db.prepare('UPDATE staff SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(staff.id);
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token_hash, staff_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(
    tokenHash(token),
    staff.id,
    `+${SESSION_DAYS} days`,
  );
  res.json({ token, staff: { id: staff.id, name: staff.name, location_id: staff.location_id } });
});

router.post('/logout', (req, res) => {
  const bearer = (req.header('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (bearer) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(bearer[1]));
  res.json({ ok: true });
});

module.exports = { router, requireStaffOrOwner, requireOwner, canAccess, hashPin, PIN_PATTERN };
