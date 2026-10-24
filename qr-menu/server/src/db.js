const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DB_PATH lets containers point the SQLite file at a mounted volume (see docker-compose.yml).
// Falls back to data.sqlite in the server folder for local dev.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// better-sqlite3 defaults WAL databases to synchronous=NORMAL, which doesn't flush each
// commit to disk: a machine or VM crash can drop recent bookings and payments. FULL
// does, at a cost that doesn't matter at this volume.
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
    tax_percent REAL NOT NULL DEFAULT 5,
    is_veg INTEGER DEFAULT 1,
    image_url TEXT DEFAULT '',
    is_available INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id TEXT,
    customer_name TEXT DEFAULT '',
    customer_phone TEXT DEFAULT '',
    note TEXT DEFAULT '',
    subtotal_paise INTEGER NOT NULL,
    tax_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | preparing | served | cancelled
    payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid | failed
    payment_method TEXT DEFAULT '',
    razorpay_order_id TEXT DEFAULT '',
    razorpay_payment_id TEXT DEFAULT '',
    razorpay_signature TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
    name_snapshot TEXT NOT NULL,
    price_paise_snapshot INTEGER NOT NULL,
    tax_percent_snapshot REAL NOT NULL DEFAULT 5,
    tax_paise_snapshot INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
  );
`);

function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn('menu_items', 'tax_percent', 'REAL NOT NULL DEFAULT 5');
ensureColumn('order_items', 'tax_percent_snapshot', 'REAL NOT NULL DEFAULT 5');
ensureColumn('order_items', 'tax_paise_snapshot', 'INTEGER NOT NULL DEFAULT 0');

// Versioned migrations, tracked in PRAGMA user_version. Each runs once, in order.
const migrations = [
  // 1: each cafe (location) has its own categories, menu and orders.
  // Rows that existed before this migration belong to Shoja.
  `
  CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  );
  INSERT INTO locations (id, name, sort_order) VALUES ('shoja', 'Shoja', 0), ('kasol', 'Kasol', 1);

  -- Category names were globally unique; now they are unique per location.
  CREATE TABLE categories_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    UNIQUE (location_id, name)
  );
  INSERT INTO categories_new (id, location_id, name, sort_order)
    SELECT id, 'shoja', name, sort_order FROM categories;
  DROP TABLE categories;
  ALTER TABLE categories_new RENAME TO categories;

  -- SQLite can only add a NOT NULL column with a default; the app always sets it explicitly.
  ALTER TABLE menu_items ADD COLUMN location_id TEXT NOT NULL DEFAULT 'shoja' REFERENCES locations(id);
  ALTER TABLE orders ADD COLUMN location_id TEXT NOT NULL DEFAULT 'shoja' REFERENCES locations(id);
  CREATE INDEX idx_menu_items_location ON menu_items(location_id);
  CREATE INDEX idx_orders_location ON orders(location_id, id);
  `,

  // 2: hostel operations — rooms, property managers, bookings and expenses.
  `
  CREATE TABLE rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    code TEXT NOT NULL,                  -- what staff call it: '106', 'G1', 'Snape''s'
    kind TEXT NOT NULL CHECK (kind IN ('dorm', 'private')),
    room_type TEXT NOT NULL,
    beds INTEGER NOT NULL CHECK (beds > 0), -- dorm: sellable beds; private: max guests
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (location_id, code)
  );
  INSERT INTO rooms (location_id, code, kind, room_type, beds, sort_order) VALUES
    ('shoja', '101', 'private', 'Deluxe room', 3, 1),
    ('shoja', '102', 'dorm', '4-bed dorm', 4, 2),
    ('shoja', '103', 'dorm', '4-bed dorm', 4, 3),
    ('shoja', '104', 'dorm', '6-bed dorm', 6, 4),
    ('shoja', '105', 'dorm', '6-bed dorm', 6, 5),
    ('shoja', '106', 'dorm', '8-bed dorm', 8, 6),
    ('shoja', '201', 'private', 'Deluxe room', 3, 7),
    ('shoja', '202', 'private', 'Deluxe room', 3, 8),
    ('shoja', '203', 'private', 'Deluxe room', 3, 9),
    ('shoja', '204', 'private', 'Deluxe room', 3, 10),
    ('shoja', '205', 'private', 'Deluxe room', 3, 11),
    ('shoja', '206', 'private', 'Family room', 5, 12),
    ('kasol', 'G1', 'dorm', '4-bed dorm', 4, 1),
    ('kasol', 'R2', 'dorm', '4-bed dorm', 4, 2),
    ('kasol', 'S2', 'dorm', '6-bed dorm', 6, 3),
    ('kasol', 'H1', 'dorm', '6-bed dorm', 6, 4),
    ('kasol', 'H2', 'dorm', '6-bed dorm', 6, 5),
    ('kasol', 'R1', 'dorm', '6-bed dorm', 6, 6),
    ('kasol', 'G2', 'dorm', '6-bed dorm', 6, 7),
    ('kasol', 'Snape''s', 'private', 'Private room', 3, 8),
    ('kasol', 'Potter''s', 'private', 'Private room', 3, 9),
    ('kasol', 'Riddle''s', 'private', 'Private room', 3, 10),
    ('kasol', 'Weasley''s', 'private', 'Private room', 3, 11),
    ('kasol', 'Malfoy''s', 'private', 'Private room', 3, 12),
    ('kasol', 'Granger''s', 'private', 'Private room', 3, 13);

  -- One manager per property; the owner signs in with ADMIN_PASSWORD instead.
  CREATE TABLE staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location_id TEXT NOT NULL REFERENCES locations(id),
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL DEFAULT '',
    check_in TEXT NOT NULL,              -- YYYY-MM-DD
    check_out TEXT NOT NULL,             -- YYYY-MM-DD
    people INTEGER NOT NULL CHECK (people > 0),
    source TEXT NOT NULL,                -- walk_in | website | phone | instagram | ota | other
    ota TEXT NOT NULL DEFAULT '',        -- channel name when source = 'ota'
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    payment_mode TEXT NOT NULL,          -- upi | cash | card | prepaid | pending
    status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL, -- NULL: owner or import
    imported INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    CHECK (check_out > check_in)
  );
  CREATE INDEX idx_bookings_location_dates ON bookings(location_id, check_in, check_out);

  -- The beds or rooms a booking holds. bed NULL = the whole room.
  CREATE TABLE booking_units (
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    bed INTEGER,
    UNIQUE (booking_id, room_id, bed)
  );
  CREATE INDEX idx_booking_units_room ON booking_units(room_id);

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    spent_on TEXT NOT NULL,              -- YYYY-MM-DD
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    paid_by TEXT NOT NULL DEFAULT '',
    payment_mode TEXT NOT NULL,          -- cash | upi | card | bank
    receipt_file TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    imported INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_expenses_location_date ON expenses(location_id, spent_on);
  `,

  // 3: daily stock counts and a log of notifications already sent.
  `
  CREATE TABLE stock_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    low_at REAL,                         -- warn when a count is at or below this
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (location_id, name)
  );
  -- From the old inventory sheet. Kasol starts with the staples only.
  INSERT INTO stock_items (location_id, name, unit, low_at, sort_order) VALUES
    ('shoja', 'Eggs', 'tray', 1, 1),
    ('shoja', 'Milk', 'litre', 2, 2),
    ('shoja', 'Bread', 'packet', 2, 3),
    ('shoja', 'Burger buns', 'packet', 1, 4),
    ('shoja', 'Paneer', 'gram', 250, 5),
    ('shoja', 'Drinking water', 'bottle', 48, 6),
    ('shoja', 'Dal makhani base', 'gram', NULL, 7),
    ('shoja', 'Shahi paneer gravy', 'gram', NULL, 8),
    ('shoja', 'Paneer butter masala gravy', 'gram', NULL, 9),
    ('shoja', 'Kadhai paneer gravy', 'gram', NULL, 10),
    ('kasol', 'Eggs', 'tray', 1, 1),
    ('kasol', 'Milk', 'litre', 2, 2),
    ('kasol', 'Bread', 'packet', 2, 3),
    ('kasol', 'Burger buns', 'packet', 1, 4),
    ('kasol', 'Paneer', 'gram', 250, 5),
    ('kasol', 'Drinking water', 'bottle', 48, 6);

  CREATE TABLE stock_counts (
    item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
    counted_on TEXT NOT NULL,            -- YYYY-MM-DD
    quantity REAL NOT NULL CHECK (quantity >= 0),
    counted_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (item_id, counted_on)
  );

  CREATE TABLE notifications_sent (
    kind TEXT NOT NULL,                  -- reminder | summary
    location_id TEXT NOT NULL,           -- property, or 'all' for the owner's summary
    sent_on TEXT NOT NULL,               -- YYYY-MM-DD (India time)
    sent_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (kind, location_id, sent_on)
  );
  `,

  // 4: booking requests sent from the website, confirmed by the property's manager.
  `
  CREATE TABLE booking_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    guest_name TEXT NOT NULL,
    guest_phone TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    guests INTEGER NOT NULL CHECK (guests > 0),
    room_choice TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',  -- new | booked | declined
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    handled_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    handled_at TEXT
  );
  CREATE INDEX idx_booking_requests_location_status ON booking_requests(location_id, status);
  `,

  // 5: nightly room rates, set in the back office. One dorm bed price per property ('dorm',
  // per bed) and one price per private room type (rate_key = rooms.room_type, per room).
  // Starting prices are the ones the website showed.
  `
  CREATE TABLE room_rates (
    location_id TEXT NOT NULL REFERENCES locations(id),
    rate_key TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    updated_by INTEGER REFERENCES staff(id) ON DELETE SET NULL, -- NULL: owner or seed
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (location_id, rate_key)
  );
  INSERT INTO room_rates (location_id, rate_key, amount_paise) VALUES
    ('shoja', 'dorm', 69900),
    ('shoja', 'Deluxe room', 220000),
    ('shoja', 'Family room', 340000),
    ('kasol', 'dorm', 59900),
    ('kasol', 'Private room', 180000);

  CREATE TABLE room_rate_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    rate_key TEXT NOT NULL,
    old_paise INTEGER,
    new_paise INTEGER NOT NULL,
    changed_by INTEGER REFERENCES staff(id) ON DELETE SET NULL, -- NULL: owner
    changed_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_room_rate_changes_location ON room_rate_changes(location_id, id);
  `,

  // 6: guest self check-in. The manager assigns the room, then sends the booking's link;
  // each guest in the booking fills in the form once.
  `
  ALTER TABLE bookings ADD COLUMN checkin_token TEXT;
  CREATE UNIQUE INDEX idx_bookings_checkin_token ON bookings(checkin_token);

  CREATE TABLE checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    guest_name TEXT NOT NULL,            -- as on their ID
    coming_from TEXT NOT NULL,
    booked_through TEXT NOT NULL,
    room TEXT NOT NULL,                  -- the room assigned when they checked in, e.g. '104 · bed 3'
    check_out_date TEXT NOT NULL,        -- what the guest says; may differ from the booking
    check_out_time TEXT NOT NULL,        -- HH:MM
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    vehicle TEXT NOT NULL DEFAULT '',
    id_front_file TEXT NOT NULL DEFAULT '', -- '' once deleted after the retention period
    id_back_file TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_checkins_booking ON checkins(booking_id);
  `,
];

function migrate() {
  const current = db.pragma('user_version', { simple: true });
  if (current >= migrations.length) return;
  // Table rebuilds must not trigger ON DELETE actions on referencing rows, and
  // foreign_keys can only be toggled outside a transaction.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (let v = current; v < migrations.length; v++) {
        db.exec(migrations[v]);
        db.pragma(`user_version = ${v + 1}`);
      }
      const broken = db.pragma('foreign_key_check');
      if (broken.length) throw new Error(`Migration left broken foreign keys: ${JSON.stringify(broken)}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

migrate();

module.exports = db;
