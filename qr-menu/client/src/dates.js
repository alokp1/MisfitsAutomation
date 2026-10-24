// Calendar dates as 'YYYY-MM-DD' strings in the phone's local time, never UTC,
// so a booking made at 11pm doesn't land on the wrong day.

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayISO = () => toISO(new Date());

export function addDays(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export const nightsBetween = (checkIn, checkOut) => Math.round((fromISO(checkOut) - fromISO(checkIn)) / 86400000);

// 'Wed 15 Oct'
export const shortDate = (iso) =>
  fromISO(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export const monthISO = (iso) => iso.slice(0, 7);

// 'October 2026'
export const monthLabel = (yyyyMm) =>
  fromISO(`${yyyyMm}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
