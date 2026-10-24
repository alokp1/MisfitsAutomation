// Turning text pasted from Excel / Google Sheets into expense-sheet values.
// Spreadsheets put tabs between cells and newlines between rows.

export const COLUMNS = ['spent_on', 'category', 'description', 'amount', 'paid_by', 'payment_mode'];

// Splits clipboard text into rows of cells, dropping the trailing empty line Excel adds.
// Quoted cells (Excel wraps cells containing newlines or tabs in "...") are handled.
export function parseTSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m, d) => {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

// 2026-10-17 · 17/10/2026 · 17-10-26 · 17 Oct 2026 · 17 Oct · Oct 17 · Excel serial 46312.
// Day comes first in d/m/y (India); the year defaults to the current one.
export function parseDate(raw, thisYear = new Date().getFullYear()) {
  const s = String(raw || '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/, '$1');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : thisYear;
    return valid(y, +m[2], +m[1]);
  }
  const mon = (w) => MONTHS.indexOf(w.slice(0, 3)) + 1;
  if ((m = s.match(/^(\d{1,2})[\s-]+([a-z]{3,})[\s,-]*(\d{2,4})?$/)) && mon(m[2])) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : thisYear;
    return valid(y, mon(m[2]), +m[1]);
  }
  if ((m = s.match(/^([a-z]{3,})[\s-]+(\d{1,2}),?[\s-]*(\d{2,4})?$/)) && mon(m[1])) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : thisYear;
    return valid(y, mon(m[1]), +m[2]);
  }
  if ((m = s.match(/^(\d{5})(?:\.0+)?$/)) && +m[1] > 30000 && +m[1] < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + +m[1] * 86400000);
    return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

// "₹1,250.50" · "1250" · "Rs 510/-" → "1250.50" / "1250" / "510"; anything else → raw text (flagged later).
export function parseAmount(raw) {
  const s = String(raw || '').replace(/rs\.?|inr|₹|\/-|,|\s/gi, '');
  return /^\d+(\.\d{1,2})?$/.test(s) ? s : String(raw || '').trim();
}

const PAYMENT_WORDS = [
  [/^(cash|c)$/, 'cash'],
  [/^(upi|gpay|google ?pay|phonepe|phone ?pe|paytm|bhim|online|qr)$/, 'upi'],
  [/^(card|debit|credit|debit card|credit card)$/, 'card'],
  [/^(bank|neft|imps|rtgs|transfer|bank transfer)$/, 'bank'],
];
export function parsePayment(raw) {
  const s = String(raw || '').trim().toLowerCase();
  for (const [re, v] of PAYMENT_WORDS) if (re.test(s)) return v;
  return null;
}

// Same keyword hints as the old-sheet importer, so "Vegitables" or "eggs" land in a category.
const CATEGORY_HINTS = [
  [/veg|sabzi|sabji/, 'Vegetables'],
  [/egg|milk|curd|paneer|dairy|butter|cheese/, 'Dairy & eggs'],
  [/wifi|internet|electric|bijli|water bill|utilit/, 'Utilities & internet'],
  [/gas|cylinder|diesel|petrol|fuel/, 'Gas & fuel'],
  [/repair|maint|plumb|electrician/, 'Maintenance & repairs'],
  [/laundry|clean|detergent|soap|phenyl/, 'Cleaning & laundry'],
  [/salary|wage/, 'Salaries & wages'],
  [/taxi|cab|bus|transport|auto/, 'Transport'],
  [/grocer|maggi|bread|bun|rice|atta|dal|oil|sugar|tea|coffee/, 'Groceries'],
];
export function parseCategory(raw, categories) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const exact = categories.find((c) => c.toLowerCase() === s);
  if (exact) return exact;
  const prefix = categories.find((c) => c.toLowerCase().startsWith(s) || s.startsWith(c.toLowerCase().split(/[ &]/)[0]));
  if (prefix) return prefix;
  for (const [re, c] of CATEGORY_HINTS) if (re.test(s) && categories.includes(c)) return c;
  return null;
}

// A pasted first row of column titles ("Date | Item | Amount") rather than data.
export function looksLikeHeader(cells) {
  return cells.some((c) => /^(date|category|item|amount|total|paid|description|what|pay|mode|method)/i.test(c)) &&
    !cells.some((c) => /^[₹\d]/.test(c));
}

// Puts one pasted cell into a row field. Returns the patch for that field.
// Unrecognised dates, categories and payment modes are kept as text so the row shows what's wrong.
export function cellPatch(field, raw, categories) {
  switch (field) {
    case 'spent_on': return { spent_on: parseDate(raw) || String(raw).trim() };
    case 'category': return { category: parseCategory(raw, categories) || String(raw).trim() };
    case 'amount': return { amount: parseAmount(raw) };
    case 'payment_mode': return { payment_mode: parsePayment(raw) || String(raw).trim() };
    default: return { [field]: String(raw).trim() };
  }
}
