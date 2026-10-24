const express = require('express');
const db = require('../db');
const { getLocation, adminLocation, targetLocationId } = require('../locations');
const { canAccess } = require('../auth');

const router = express.Router();

const SOURCES = ['walk_in', 'website', 'phone', 'instagram', 'ota', 'other'];
const PAYMENT_MODES = ['upi', 'cash', 'card', 'prepaid', 'pending'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const forbidden = (res) => res.status(403).json({ error: 'You can only manage your own property' });

function unitsFor(bookingIds) {
  if (!bookingIds.length) return new Map();
  const rows = db
    .prepare(
      `SELECT u.booking_id, u.room_id, u.bed, r.code, r.kind
         FROM booking_units u JOIN rooms r ON r.id = u.room_id
        WHERE u.booking_id IN (${bookingIds.map(() => '?').join(',')})
        ORDER BY r.sort_order, u.bed`,
    )
    .all(...bookingIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.booking_id)) map.set(r.booking_id, []);
    map.get(r.booking_id).push({ room_id: r.room_id, bed: r.bed, code: r.code, kind: r.kind });
  }
  return map;
}

// Adds each booking's beds and how many of its guests have done self check-in.
function withUnits(bookings) {
  const ids = bookings.map((b) => b.id);
  const units = unitsFor(ids);
  const checkins = new Map(
    ids.length
      ? db
          .prepare(`SELECT booking_id, COUNT(*) AS n FROM checkins WHERE booking_id IN (${ids.map(() => '?').join(',')}) GROUP BY booking_id`)
          .all(...ids)
          .map((r) => [r.booking_id, r.n])
      : [],
  );
  return bookings.map(({ checkin_token, ...b }) => ({ ...b, units: units.get(b.id) || [], checked_in: checkins.get(b.id) || 0 }));
}

// Units already taken by other bookings that overlap [checkIn, checkOut).
function occupied(locationId, checkIn, checkOut, excludeBookingId = 0) {
  return db
    .prepare(
      `SELECT u.room_id, u.bed, b.id AS booking_id, b.guest_name, b.check_in, b.check_out
         FROM booking_units u JOIN bookings b ON b.id = u.booking_id
        WHERE b.location_id = ? AND b.status != 'cancelled' AND b.id != ?
          AND b.check_in < ? AND b.check_out > ?`,
    )
    .all(locationId, excludeBookingId, checkOut, checkIn);
}

// Validates a booking body; returns { error } or { value }.
function parseBooking(body, locationId) {
  const b = body || {};
  const guest_name = String(b.guest_name || '').trim();
  if (!guest_name) return { error: 'Guest name is required' };
  if (!DATE.test(b.check_in || '') || !DATE.test(b.check_out || '')) return { error: 'Check-in and check-out dates are required' };
  if (b.check_out <= b.check_in) return { error: 'Check-out must be after check-in' };
  if (!SOURCES.includes(b.source)) return { error: 'Choose where the booking came from' };
  if (!PAYMENT_MODES.includes(b.payment_mode)) return { error: 'Choose how the guest paid' };
  const amount = Math.round(Number(b.amount_paise));
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Amount must be zero or more' };
  const people = Math.floor(Number(b.people));
  if (!(people > 0)) return { error: 'Number of guests must be at least 1' };
  if (!Array.isArray(b.units) || b.units.length === 0) return { error: 'Pick at least one bed or room' };

  const rooms = new Map(
    db.prepare('SELECT * FROM rooms WHERE location_id = ? AND active = 1').all(locationId).map((r) => [r.id, r]),
  );
  const units = [];
  const seen = new Set();
  for (const u of b.units) {
    const room = rooms.get(Number(u.room_id));
    if (!room) return { error: 'One of the rooms is not at this property' };
    // Private rooms are always booked whole; a dorm can be booked whole or by bed.
    let bed = u.bed == null || room.kind === 'private' ? null : Math.floor(Number(u.bed));
    if (bed != null && !(bed >= 1 && bed <= room.beds)) return { error: `Room ${room.code} has no bed ${u.bed}` };
    const key = `${room.id}:${bed}`;
    if (!seen.has(key)) units.push({ room_id: room.id, bed, code: room.code });
    seen.add(key);
  }
  for (const u of units) {
    if (u.bed == null && units.some((o) => o.room_id === u.room_id && o.bed != null)) {
      return { error: `Room ${u.code} is picked both whole and by bed` };
    }
  }

  return {
    value: {
      guest_name,
      guest_phone: String(b.guest_phone || '').trim(),
      check_in: b.check_in,
      check_out: b.check_out,
      people,
      source: b.source,
      ota: b.source === 'ota' ? String(b.ota || '').trim() : '',
      amount_paise: amount,
      payment_mode: b.payment_mode,
      notes: String(b.notes || '').trim(),
      units,
    },
  };
}

// A unit clashes with a taken one when it's the same room and either side is the whole room or the same bed.
function firstClash(units, taken) {
  for (const u of units) {
    const hit = taken.find((t) => t.room_id === u.room_id && (u.bed == null || t.bed == null || t.bed === u.bed));
    if (hit) {
      const what = u.bed == null ? `Room ${u.code}` : `Room ${u.code} bed ${u.bed}`;
      return `${what} is already booked by ${hit.guest_name} (${hit.check_in} to ${hit.check_out})`;
    }
  }
  return null;
}

const insertUnit = db.prepare('INSERT INTO booking_units (booking_id, room_id, bed) VALUES (?, ?, ?)');

router.get('/rooms', adminLocation, (req, res) => {
  res.json(
    db
      .prepare('SELECT id, code, kind, room_type, beds FROM rooms WHERE location_id = ? AND active = 1 ORDER BY sort_order')
      .all(req.location.id),
  );
});

// What is taken between two dates, for the bed picker. ?exclude=<booking id> when editing.
router.get('/occupancy', adminLocation, (req, res) => {
  const { check_in, check_out } = req.query;
  if (!DATE.test(check_in || '') || !DATE.test(check_out || '') || check_out <= check_in) {
    return res.status(400).json({ error: 'check_in and check_out must be dates, check_out after check_in' });
  }
  res.json(occupied(req.location.id, check_in, check_out, Number(req.query.exclude) || 0));
});

// One day at the property: who arrives, who is staying the night, who leaves.
router.get('/day', adminLocation, (req, res) => {
  const date = req.query.date;
  if (!DATE.test(date || '')) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const rows = withUnits(
    db
      .prepare(
        `SELECT * FROM bookings
          WHERE location_id = ? AND status != 'cancelled' AND check_in <= ? AND check_out >= ?
          ORDER BY check_in, id`,
      )
      .all(req.location.id, date, date),
  );
  const beds = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'dorm' THEN beds ELSE 0 END), 0) AS dorm_beds,
              COALESCE(SUM(CASE WHEN kind = 'private' THEN 1 ELSE 0 END), 0) AS private_rooms
         FROM rooms WHERE location_id = ? AND active = 1`,
    )
    .get(req.location.id);
  res.json({
    date,
    arriving: rows.filter((b) => b.check_in === date),
    staying: rows.filter((b) => b.check_in < date && b.check_out > date),
    leaving: rows.filter((b) => b.check_out === date),
    capacity: beds,
  });
});

// Recent bookings, newest stay first. ?q= searches guest name or phone.
router.get('/', adminLocation, (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;
  const rows = db
    .prepare(
      `SELECT * FROM bookings
        WHERE location_id = ? AND (? = '' OR guest_name LIKE ? ESCAPE '\\' OR guest_phone LIKE ? ESCAPE '\\')
        ORDER BY check_in DESC, id DESC
        LIMIT 100`,
    )
    .all(req.location.id, q, like, like);
  res.json(withUnits(rows));
});

router.get('/:id', (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!booking) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, booking.location_id)) return forbidden(res);
  res.json(withUnits([booking])[0]);
});

router.post('/', (req, res) => {
  const locationId = targetLocationId(req, req.body);
  if (!getLocation(locationId)) return res.status(400).json({ error: 'location_id must be a known property' });
  if (!canAccess(req, locationId)) return forbidden(res);
  const parsed = parseBooking(req.body, locationId);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const id = db.transaction(() => {
    const clash = firstClash(v.units, occupied(locationId, v.check_in, v.check_out));
    if (clash) return { clash };
    const info = db
      .prepare(
        `INSERT INTO bookings
         (location_id, guest_name, guest_phone, check_in, check_out, people, source, ota,
          amount_paise, payment_mode, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        locationId, v.guest_name, v.guest_phone, v.check_in, v.check_out, v.people, v.source, v.ota,
        v.amount_paise, v.payment_mode, v.notes, req.auth.staff ? req.auth.staff.id : null,
      );
    for (const u of v.units) insertUnit.run(info.lastInsertRowid, u.room_id, u.bed);
    return { id: info.lastInsertRowid };
  })();
  if (id.clash) return res.status(409).json({ error: id.clash });
  res.status(201).json({ id: id.id });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, existing.location_id)) return forbidden(res);
  const parsed = parseBooking(req.body, existing.location_id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;

  const result = db.transaction(() => {
    if (existing.status !== 'cancelled') {
      const clash = firstClash(v.units, occupied(existing.location_id, v.check_in, v.check_out, existing.id));
      if (clash) return { clash };
    }
    db.prepare(
      `UPDATE bookings SET guest_name = ?, guest_phone = ?, check_in = ?, check_out = ?, people = ?,
              source = ?, ota = ?, amount_paise = ?, payment_mode = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      v.guest_name, v.guest_phone, v.check_in, v.check_out, v.people, v.source, v.ota,
      v.amount_paise, v.payment_mode, v.notes, existing.id,
    );
    db.prepare('DELETE FROM booking_units WHERE booking_id = ?').run(existing.id);
    for (const u of v.units) insertUnit.run(existing.id, u.room_id, u.bed);
    return {};
  })();
  if (result.clash) return res.status(409).json({ error: result.clash });
  res.json({ ok: true });
});

// Cancelling keeps the record but frees its beds.
router.post('/:id/cancel', (req, res) => {
  const existing = db.prepare('SELECT location_id FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canAccess(req, existing.location_id)) return forbidden(res);
  db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(
    Number(req.params.id),
  );
  res.json({ ok: true });
});

module.exports = { router, occupied, SOURCES, PAYMENT_MODES };
