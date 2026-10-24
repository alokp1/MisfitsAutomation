// Telegram notifications: an evening reminder to each property's manager when
// something hasn't been logged, and a nightly summary to the owner.
//
// Config (all optional; with no bot token nothing is sent):
//   TELEGRAM_BOT_TOKEN       from @BotFather
//   TELEGRAM_OWNER_CHAT_ID   the owner's chat (or a group) for the nightly summary
//   TELEGRAM_CHAT_SHOJA      a property manager's chat, one per property id
//   REMINDER_AT / SUMMARY_AT India time, HH:MM (default 21:00 / 22:30)
const express = require('express');
const db = require('./db');
const { requireOwner } = require('./auth');
const { propertyReport, missingEntries, lowStock, addDays } = require('./reports');

const TZ = 'Asia/Kolkata';

function config() {
  const env = process.env;
  return {
    token: env.TELEGRAM_BOT_TOKEN || '',
    apiBase: (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, ''),
    ownerChat: env.TELEGRAM_OWNER_CHAT_ID || '',
    chatFor: (locationId) => env[`TELEGRAM_CHAT_${locationId.toUpperCase()}`] || '',
    reminderAt: /^\d{2}:\d{2}$/.test(env.REMINDER_AT || '') ? env.REMINDER_AT : '21:00',
    summaryAt: /^\d{2}:\d{2}$/.test(env.SUMMARY_AT || '') ? env.SUMMARY_AT : '22:30',
    appUrl: (env.PUBLIC_BASE_URL || '').replace(/\/cafe\/?$/, ''),
  };
}

// Current date and time in India, as 'YYYY-MM-DD' and 'HH:MM'.
function indiaNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const rupees = (paise) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
const dayLabel = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const locations = () => db.prepare('SELECT id, name FROM locations ORDER BY sort_order, name').all();

function reminderText(location, date, cfg = config()) {
  const missing = missingEntries(location.id, date);
  if (!missing.length) return null;
  return [
    `Misfits ${location.name}: ${dayLabel(date)}`,
    `Not logged yet today: ${missing.join(' and ')}.`,
    cfg.appUrl ? `Open ${cfg.appUrl}/manage` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function summaryText(date) {
  const lines = [`Misfits daily summary: ${dayLabel(date)}`];
  let rooms = 0;
  let cafe = 0;
  let expenses = 0;
  for (const l of locations()) {
    const r = propertyReport(l.id, date, date);
    const t = r.totals;
    rooms += t.rooms_paise;
    cafe += t.cafe_paise;
    expenses += t.expenses_paise;
    const tomorrow = db
      .prepare("SELECT COUNT(*) AS n FROM bookings WHERE location_id = ? AND status != 'cancelled' AND check_in = ?")
      .get(l.id, addDays(date, 1)).n;
    const missing = missingEntries(l.id, date);
    const low = lowStock(l.id, date);
    lines.push(
      '',
      `${l.name}`,
      `Rooms ${rupees(t.rooms_paise)} · beds ${t.bed_nights_sold}/${r.capacity.dorm_beds} · private ${t.private_nights_sold}/${r.capacity.private_rooms}`,
      `Cafe ${rupees(t.cafe_paise)} (${t.cafe_orders} orders) · Expenses ${rupees(t.expenses_paise)}`,
      `Arrivals today ${t.arrivals} · tomorrow ${tomorrow}`,
    );
    if (low.length) lines.push(`Low stock: ${low.map((s) => `${s.name} ${s.quantity} ${s.unit}`).join(', ')}`);
    if (missing.length) lines.push(`Not logged: ${missing.join(', ')}`);
  }
  lines.push('', `Total: rooms ${rupees(rooms)} + cafe ${rupees(cafe)} − expenses ${rupees(expenses)} = ${rupees(rooms + cafe - expenses)}`);
  return lines.join('\n');
}

async function send(chatId, text, cfg = config()) {
  if (!cfg.token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  if (!chatId) throw new Error('No chat id configured for this recipient');
  const res = await fetch(`${cfg.apiBase}/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(`Telegram: ${body.description || res.status}`);
}

const alreadySent = (kind, locationId, date) =>
  !!db.prepare('SELECT 1 FROM notifications_sent WHERE kind = ? AND location_id = ? AND sent_on = ?').get(kind, locationId, date);
const markSent = (kind, locationId, date) =>
  db.prepare('INSERT OR IGNORE INTO notifications_sent (kind, location_id, sent_on) VALUES (?, ?, ?)').run(kind, locationId, date);

// Runs every minute. Each message goes at most once per day, even across restarts;
// a failed send is retried on the next tick.
async function tick(now = new Date()) {
  const cfg = config();
  if (!cfg.token) return;
  const { date, time } = indiaNow(now);

  if (time >= cfg.reminderAt) {
    for (const l of locations()) {
      const chat = cfg.chatFor(l.id);
      if (!chat || alreadySent('reminder', l.id, date)) continue;
      const text = reminderText(l, date, cfg);
      try {
        if (text) await send(chat, text, cfg);
        markSent('reminder', l.id, date);
      } catch (e) {
        console.error(`Reminder for ${l.name} failed: ${e.message}`);
      }
    }
  }

  if (time >= cfg.summaryAt && cfg.ownerChat && !alreadySent('summary', 'all', date)) {
    try {
      await send(cfg.ownerChat, summaryText(date), cfg);
      markSent('summary', 'all', date);
    } catch (e) {
      console.error(`Nightly summary failed: ${e.message}`);
    }
  }
}

function start() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } finally {
      running = false;
    }
  }, 60 * 1000).unref();
}

// Owner-only: see the setup, preview today's messages, send a test.
const router = express.Router();
router.use(requireOwner);

router.get('/', (req, res) => {
  const cfg = config();
  const today = indiaNow().date;
  res.json({
    bot_configured: !!cfg.token,
    owner_chat_configured: !!cfg.ownerChat,
    reminder_at: cfg.reminderAt,
    summary_at: cfg.summaryAt,
    properties: locations().map((l) => ({ id: l.id, name: l.name, chat_configured: !!cfg.chatFor(l.id), env: `TELEGRAM_CHAT_${l.id.toUpperCase()}` })),
    sent_today: db.prepare('SELECT kind, location_id, sent_at FROM notifications_sent WHERE sent_on = ?').all(today),
  });
});

router.get('/preview', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : indiaNow().date;
  res.json({
    date,
    summary: summaryText(date),
    reminders: locations().map((l) => ({ location_id: l.id, name: l.name, text: reminderText(l, date) })),
  });
});

// Body: { to: 'owner' | <property id> }
router.post('/test', async (req, res) => {
  const cfg = config();
  const to = (req.body || {}).to;
  const location = locations().find((l) => l.id === to);
  const chat = to === 'owner' ? cfg.ownerChat : location ? cfg.chatFor(location.id) : '';
  try {
    await send(chat, `Test message from the Misfits back office (${to === 'owner' ? 'owner' : location?.name}). Notifications are working.`, cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = { router, start, tick, indiaNow, summaryText, reminderText, send, config };
