// Loads historical bookings and expenses produced by tools/import-sheets/sheets_to_json.py.
//
//   docker compose exec -T server node src/scripts/import-history.js < shoja-history.json
//
// Runs once per property: it refuses if that property already has imported bookings.
// Imported bookings skip the double-booking check (the old sheet has overlaps) and
// carry a note for anything that had to be fixed or couldn't be matched.
const db = require('../db');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = new Set(['walk_in', 'website', 'phone', 'instagram', 'ota', 'other']);
const PAYMENT_MODES = new Set(['upi', 'cash', 'card', 'prepaid', 'pending']);
const EXPENSE_MODES = new Set(['cash', 'upi', 'card', 'bank']);

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (text += chunk));
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const data = JSON.parse(await readStdin());
  const location = db.prepare('SELECT id, name FROM locations WHERE id = ?').get(data.location_id);
  if (!location) throw new Error(`Unknown property '${data.location_id}'`);
  if (db.prepare('SELECT 1 FROM bookings WHERE location_id = ? AND imported = 1 LIMIT 1').get(location.id)) {
    throw new Error(`${location.name} already has imported bookings; not importing twice`);
  }

  const rooms = new Map(
    db.prepare('SELECT * FROM rooms WHERE location_id = ?').all(location.id).map((r) => [r.code, r]),
  );
  const insertBooking = db.prepare(
    `INSERT INTO bookings
     (location_id, guest_name, guest_phone, check_in, check_out, people, source, ota,
      amount_paise, payment_mode, notes, imported)
     VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const insertUnit = db.prepare('INSERT OR IGNORE INTO booking_units (booking_id, room_id, bed) VALUES (?, ?, ?)');
  const insertExpense = db.prepare(
    `INSERT INTO expenses
     (location_id, spent_on, category, description, amount_paise, paid_by, payment_mode, imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  );

  const report = { bookings: 0, withNotes: 0, unmatchedRooms: new Map(), expenses: 0 };

  db.transaction(() => {
    for (const b of data.bookings || []) {
      if (!DATE.test(b.check_in) || !DATE.test(b.check_out) || b.check_out <= b.check_in) {
        throw new Error(`Sheet row ${b.sheet_row}: bad dates ${b.check_in}..${b.check_out}`);
      }
      const notes = [...(b.problems || [])];
      const units = [];
      for (const u of b.units || []) {
        const room = rooms.get(u.code);
        if (!room) {
          notes.push(`room '${u.code}' doesn't exist`);
          report.unmatchedRooms.set(u.code, (report.unmatchedRooms.get(u.code) || 0) + 1);
          continue;
        }
        if (room.kind === 'private' || u.bed == null) {
          units.push([room.id, null]);
        } else if (u.bed >= 1 && u.bed <= room.beds) {
          units.push([room.id, u.bed]);
        } else {
          notes.push(`room ${room.code} has no bed ${u.bed}`);
        }
      }
      // A whole-room unit makes bed units of the same room redundant.
      const whole = new Set(units.filter(([, bed]) => bed == null).map(([id]) => id));
      const finalUnits = units.filter(([id, bed]) => bed == null || !whole.has(id));
      if (notes.length) notes.push(`sheet room: "${b.room_text}"`);

      const info = insertBooking.run(
        location.id,
        String(b.guest_name).trim(),
        b.check_in,
        b.check_out,
        Math.max(1, Math.floor(Number(b.people) || 1)),
        SOURCES.has(b.source) ? b.source : 'other',
        b.ota || '',
        Math.max(0, Math.round(Number(b.amount_paise) || 0)),
        PAYMENT_MODES.has(b.payment_mode) ? b.payment_mode : 'pending',
        [`Imported from ${data.source_file || 'the old sheet'}, row ${b.sheet_row}`, ...notes].join('. '),
      );
      for (const [roomId, bed] of finalUnits) insertUnit.run(info.lastInsertRowid, roomId, bed);
      report.bookings += 1;
      if (notes.length) report.withNotes += 1;
    }

    for (const e of data.expenses || []) {
      if (!DATE.test(e.spent_on) || !(e.amount_paise > 0)) continue;
      insertExpense.run(
        location.id,
        e.spent_on,
        e.category,
        e.description || '',
        Math.round(e.amount_paise),
        e.paid_by || '',
        EXPENSE_MODES.has(e.payment_mode) ? e.payment_mode : 'cash',
      );
      report.expenses += 1;
    }
  })();

  console.log(`${location.name}: imported ${report.bookings} bookings (${report.withNotes} with notes) and ${report.expenses} expenses.`);
  for (const [code, n] of report.unmatchedRooms) console.log(`  room '${code}' not found: ${n} booking(s) imported without it`);
}

main().catch((e) => {
  console.error(`Import failed: ${e.message}`);
  process.exit(1);
});
