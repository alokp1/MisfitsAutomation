// Guest self check-in. The manager assigns the room on the booking and sends its link
// (<PUBLIC_BASE_URL>/checkin/<token>); each guest in the booking fills in the form once.
// The public side needs no sign-in: the token is the key, and it shows only the booking's
// property, lead name, room and dates — never the amount or other guests' details.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { getLocation } = require('../locations');
const { canAccess } = require('../auth');
const notify = require('../notify');

const BOOKED_THROUGH = ['Walk-in', 'Website', 'Phone', 'Instagram', 'Booking.com', 'Hostelworld', 'MakeMyTrip', 'Goibibo', 'Agoda', 'Airbnb', 'Other'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
// ID photos live next to the SQLite file, on the same volume, and are never served publicly.
const idDir = path.join(path.dirname(db.name), 'guest-ids');
const RETENTION_DAYS = Math.max(30, Number(process.env.ID_RETENTION_DAYS) || 365);
const forbidden = (res) => res.status(403).json({ error: 'You can only manage your own property' });

const publicRouter = express.Router();
const adminRouter = express.Router();

// Simple per-visitor limit; the server is only reachable through the website gateway,
// which sets X-Real-IP.
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.header('x-real-ip') || req.ip;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: 'Too many tries. Please wait a few minutes.' });
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

// "104 · bed 3", "G1 · beds 1, 2 · Snape's"
function roomLabel(bookingId) {
  const units = db
    .prepare(
      `SELECT r.code, u.bed FROM booking_units u JOIN rooms r ON r.id = u.room_id
        WHERE u.booking_id = ? ORDER BY r.sort_order, u.bed`,
    )
    .all(bookingId);
  const byRoom = new Map();
  for (const u of units) {
    if (!byRoom.has(u.code)) byRoom.set(u.code, []);
    if (u.bed != null) byRoom.get(u.code).push(u.bed);
  }
  return [...byRoom.entries()]
    .map(([code, beds]) => (beds.length ? `${code} · bed${beds.length > 1 ? 's' : ''} ${beds.join(', ')}` : code))
    .join(' · ');
}

// What the booking's source suggests for "Booked through".
function suggestedBookedThrough(b) {
  const bySource = { walk_in: 'Walk-in', website: 'Website', phone: 'Phone', instagram: 'Instagram', other: 'Other' };
  if (b.source === 'ota') {
    const ota = { mmt: 'MakeMyTrip', goibibo: 'Goibibo' }[b.ota.toLowerCase()] || b.ota;
    return BOOKED_THROUGH.find((x) => x.toLowerCase() === ota.toLowerCase()) || '';
  }
  return bySource[b.source] || '';
}

const countFor = (bookingId) => db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE booking_id = ?').get(bookingId).n;

// The booking behind a link, or why the link can't be used.
function bookingForToken(token) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token || '')) return { status: 404, error: 'This check-in link isn’t valid. Ask at reception for a new one.' };
  const b = db.prepare('SELECT * FROM bookings WHERE checkin_token = ?').get(token);
  if (!b) return { status: 404, error: 'This check-in link isn’t valid. Ask at reception for a new one.' };
  if (b.status === 'cancelled') return { status: 410, error: 'This booking was cancelled. Please ask at reception.' };
  if (b.check_out < notify.indiaNow().date) return { status: 410, error: 'This stay has ended, so the check-in link is closed.' };
  return { booking: b };
}

function savePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) return { error: 'ID photos must be JPEG, PNG or WebP images' };
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_PHOTO_BYTES) return { error: 'An ID photo is too large' };
  fs.mkdirSync(idDir, { recursive: true });
  const file = `${crypto.randomUUID()}.${PHOTO_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(idDir, file), bytes);
  return { file };
}

function removePhoto(file) {
  if (file) fs.rm(path.join(idDir, path.basename(file)), { force: true }, () => {});
}

function parseCheckin(b, booking) {
  const clean = (v, max) => String(v ?? '').trim().slice(0, max);
  const v = {
    guest_name: clean(b.guest_name, 80),
    coming_from: clean(b.coming_from, 80),
    booked_through: clean(b.booked_through, 40),
    check_out_date: clean(b.check_out_date, 10),
    check_out_time: clean(b.check_out_time, 5),
    phone: clean(b.phone, 20),
    email: clean(b.email, 120),
    vehicle: clean(b.vehicle, 120),
  };
  if (!v.guest_name) return { error: 'Please add your name as it appears on your ID' };
  if (!v.coming_from) return { error: 'Please tell us where you’re coming from' };
  if (!BOOKED_THROUGH.includes(v.booked_through)) return { error: 'Please choose how you booked' };
  if (!DATE.test(v.check_out_date)) return { error: 'Please add your check-out date' };
  if (v.check_out_date <= booking.check_in) return { error: 'Check-out must be after your arrival date' };
  if (!TIME.test(v.check_out_time)) return { error: 'Please add your check-out time' };
  if ((v.phone.match(/\d/g) || []).length < 10) return { error: 'Please add a phone number with at least 10 digits' };
  if (!EMAIL.test(v.email)) return { error: 'Please add a valid email address' };
  if (!b.id_front) return { error: 'Please add a photo of your ID' };
  return { value: v };
}

// ---------- Guest side ----------

publicRouter.get('/:token', rateLimit(120, 10 * 60 * 1000), (req, res) => {
  const found = bookingForToken(req.params.token);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const b = found.booking;
  res.json({
    property: getLocation(b.location_id).name,
    guest_name: b.guest_name,
    room: roomLabel(b.id),
    check_in: b.check_in,
    check_out: b.check_out,
    guests: b.people,
    checked_in: countFor(b.id),
    booked_through: suggestedBookedThrough(b),
    booked_through_options: BOOKED_THROUGH,
  });
});

publicRouter.post('/:token', rateLimit(10, 10 * 60 * 1000), (req, res) => {
  const found = bookingForToken(req.params.token);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const b = found.booking;
  const parsed = parseCheckin(req.body || {}, b);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (countFor(b.id) >= b.people) {
    return res.status(409).json({ error: `All ${b.people} guest${b.people === 1 ? ' has' : 's have'} already checked in on this booking. Please ask at reception.` });
  }

  const files = [];
  for (const photo of [req.body.id_front, req.body.id_back]) {
    if (!photo) { files.push(''); continue; }
    const saved = savePhoto(photo);
    if (saved.error) {
      files.forEach(removePhoto);
      return res.status(400).json({ error: saved.error });
    }
    files.push(saved.file);
  }

  const v = parsed.value;
  const room = roomLabel(b.id);
  const result = db.transaction(() => {
    // Checked again inside the transaction so two guests submitting at once can't overfill it.
    if (countFor(b.id) >= b.people) return null;
    return db
      .prepare(
        `INSERT INTO checkins (booking_id, guest_name, coming_from, booked_through, room, check_out_date, check_out_time,
                               phone, email, vehicle, id_front_file, id_back_file)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(b.id, v.guest_name, v.coming_from, v.booked_through, room, v.check_out_date, v.check_out_time,
        v.phone, v.email, v.vehicle, files[0], files[1]).lastInsertRowid;
  })();
  if (result == null) {
    files.forEach(removePhoto);
    return res.status(409).json({ error: 'Everyone on this booking has already checked in. Please ask at reception.' });
  }
  const done = countFor(b.id);
  res.status(201).json({ ok: true, room, checked_in: done, guests: b.people });

  // Tell the property's manager (best effort; the check-in is saved either way).
  const location = getLocation(b.location_id);
  const cfg = notify.config();
  const chat = cfg.chatFor(location.id);
  if (cfg.token && chat) {
    const text = [
      `Misfits ${location.name}: ${v.guest_name} checked in (${done} of ${b.people} on the booking)`,
      `Room ${room} · from ${v.coming_from} · ${v.booked_through}`,
      v.check_out_date !== b.check_out ? `Says check-out ${v.check_out_date}; the booking says ${b.check_out}` : null,
      cfg.appUrl ? `${cfg.appUrl}/cafe/admin/bookings/${b.id}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    notify.send(chat, text, cfg).catch((e) => console.error(`Check-in alert failed: ${e.message}`));
  }
});

// ---------- Back office (mounted under /api/admin/bookings) ----------

function staffBooking(req, res) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!b) { res.status(404).json({ error: 'Not found' }); return null; }
  if (!canAccess(req, b.location_id)) { forbidden(res); return null; }
  return b;
}

const linkFor = (token) => `${(process.env.PUBLIC_BASE_URL || 'http://localhost:8080/cafe').replace(/\/$/, '')}/checkin/${token}`;

// The booking's check-in link (created the first time), with a QR code to show at the desk.
adminRouter.post('/:id/checkin-link', async (req, res, next) => {
  const b = staffBooking(req, res);
  if (!b) return;
  if (b.status === 'cancelled') return res.status(400).json({ error: 'This booking is cancelled' });
  try {
    let token = b.checkin_token;
    if (!token) {
      token = crypto.randomBytes(18).toString('base64url');
      db.prepare('UPDATE bookings SET checkin_token = ? WHERE id = ? AND checkin_token IS NULL').run(token, b.id);
      token = db.prepare('SELECT checkin_token FROM bookings WHERE id = ?').get(b.id).checkin_token;
    }
    const url = linkFor(token);
    res.json({ url, qr: await QRCode.toDataURL(url, { width: 360, margin: 1 }) });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/:id/checkins', (req, res) => {
  const b = staffBooking(req, res);
  if (!b) return;
  const rows = db
    .prepare(
      `SELECT id, guest_name, coming_from, booked_through, room, check_out_date, check_out_time, phone, email, vehicle,
              id_front_file != '' AS has_front, id_back_file != '' AS has_back, created_at
         FROM checkins WHERE booking_id = ? ORDER BY id`,
    )
    .all(b.id);
  res.json({ link: b.checkin_token ? linkFor(b.checkin_token) : null, checkins: rows });
});

adminRouter.get('/checkins/:cid/id/:side', (req, res) => {
  const side = { front: 'id_front_file', back: 'id_back_file' }[req.params.side];
  if (!side) return res.status(404).json({ error: 'Not found' });
  const c = db
    .prepare(`SELECT c.${side} AS file, b.location_id FROM checkins c JOIN bookings b ON b.id = c.booking_id WHERE c.id = ?`)
    .get(Number(req.params.cid));
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, c.location_id)) return forbidden(res);
  if (!c.file) return res.status(404).json({ error: 'No photo' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(idDir, path.basename(c.file)));
});

// A wrong or duplicate check-in can be removed (frees the slot for the right guest).
adminRouter.delete('/checkins/:cid', (req, res) => {
  const c = db
    .prepare('SELECT c.id_front_file, c.id_back_file, b.location_id FROM checkins c JOIN bookings b ON b.id = c.booking_id WHERE c.id = ?')
    .get(Number(req.params.cid));
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, c.location_id)) return forbidden(res);
  db.prepare('DELETE FROM checkins WHERE id = ?').run(Number(req.params.cid));
  removePhoto(c.id_front_file);
  removePhoto(c.id_back_file);
  res.json({ ok: true });
});

// ID photos are deleted RETENTION_DAYS after check-out; the rest of the record stays.
function purgeOldIds() {
  const old = db
    .prepare(
      `SELECT c.id, c.id_front_file, c.id_back_file FROM checkins c JOIN bookings b ON b.id = c.booking_id
        WHERE b.check_out < date('now', ?) AND (c.id_front_file != '' OR c.id_back_file != '')`,
    )
    .all(`-${RETENTION_DAYS} days`);
  for (const c of old) {
    db.prepare("UPDATE checkins SET id_front_file = '', id_back_file = '' WHERE id = ?").run(c.id);
    removePhoto(c.id_front_file);
    removePhoto(c.id_back_file);
  }
  return old.length;
}

function startPurge() {
  const run = () => {
    try {
      const n = purgeOldIds();
      if (n) console.log(`Deleted ID photos from ${n} check-in(s) older than ${RETENTION_DAYS} days`);
    } catch (e) {
      console.error(`ID photo clean-up failed: ${e.message}`);
    }
  };
  run();
  setInterval(run, 12 * 60 * 60 * 1000).unref();
}

module.exports = { publicRouter, adminRouter, startPurge, purgeOldIds, BOOKED_THROUGH, RETENTION_DAYS };
