// Excel-like sheet for logging many expenses at once: Tab/Enter/arrow keys between cells,
// paste rows from Excel or Google Sheets, one Save for everything. On a phone each row
// becomes a card (see .xsheet styles).
import { useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, formatRupees } from '../api.js';
import { todayISO } from '../dates.js';
import { shrinkPhoto } from '../photos.js';
import { COLUMNS, cellPatch, looksLikeHeader, parseTSV } from '../sheetPaste.js';

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank' },
];
const HEADERS = { spent_on: 'Date', category: 'Category', description: 'What for', amount: 'Amount (₹)', paid_by: 'Paid by', payment_mode: 'Paid with' };
const MAX_ROWS = 100;

let nextKey = 1;
const newRow = (from) => ({
  key: nextKey++,
  spent_on: from?.spent_on || todayISO(),
  category: '',
  description: '',
  amount: '',
  paid_by: from?.paid_by || '',
  payment_mode: from?.payment_mode || 'cash',
  receipt: '',
});
// Nothing typed beyond the carried-over date / payer / payment mode.
const isBlank = (r) => !r.category && !r.description.trim() && !String(r.amount).trim() && !r.receipt;

function rowErrors(r, categories) {
  if (isBlank(r)) return {};
  const e = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.spent_on)) e.spent_on = r.spent_on ? `“${r.spent_on}” isn’t a date` : 'Date needed';
  else if (r.spent_on > todayISO()) e.spent_on = 'Date is in the future';
  if (!r.category) e.category = 'Choose a category';
  else if (!categories.includes(r.category)) e.category = `“${r.category}” isn’t a category`;
  if (!String(r.amount).trim()) e.amount = 'Amount needed';
  else if (!/^\d+(\.\d{1,2})?$/.test(String(r.amount).trim()) || !(Number(r.amount) > 0)) e.amount = `“${r.amount}” isn’t an amount`;
  if (!PAYMENT_MODES.some((m) => m.value === r.payment_mode)) e.payment_mode = `“${r.payment_mode}” isn’t a payment mode`;
  return e;
}

const draftKey = (location) => `qrmenu.expense-sheet.${location}`;

export default function ExpenseSheet({ location, categories, payers, onSaved }) {
  const [rows, setRows] = useState(() => {
    // Typed-but-unsaved rows survive a reload (photos aren't kept: too big for storage).
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey(location)) || 'null');
      if (Array.isArray(saved) && saved.length) return saved.map((r) => ({ ...newRow(), ...r, key: nextKey++, receipt: '' }));
    } catch { /* ignore */ }
    return [newRow(), newRow(), newRow()];
  });
  const [serverErrors, setServerErrors] = useState({}); // row key -> message
  const [showErrors, setShowErrors] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const table = useRef(null);
  const pendingFocus = useRef(null);

  useEffect(() => {
    try {
      const keep = rows.filter((r) => !isBlank(r)).map(({ key, receipt, ...r }) => r);
      if (keep.length) localStorage.setItem(draftKey(location), JSON.stringify(keep));
      else localStorage.removeItem(draftKey(location));
    } catch { /* storage full or blocked */ }
  }, [rows, location]);

  // Focus a cell after the render that created it (new row on Enter, paste).
  useEffect(() => {
    if (!pendingFocus.current) return;
    const { row, col } = pendingFocus.current;
    pendingFocus.current = null;
    table.current?.querySelector(`[data-cell="${row}:${col}"]`)?.focus();
  });

  const errors = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, rowErrors(r, categories)])), [rows, categories]);
  const filled = rows.filter((r) => !isBlank(r));
  const badRows = filled.filter((r) => Object.keys(errors[r.key]).length || serverErrors[r.key]).length;
  const total = filled.reduce((s, r) => s + (Number(r.amount) > 0 ? Math.round(Number(r.amount) * 100) : 0), 0);

  const update = (key, patch) => {
    setMsg('');
    setServerErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = (focusCol = 0) => {
    if (rows.length >= MAX_ROWS) return setErr(`At most ${MAX_ROWS} rows at a time — save these first.`);
    pendingFocus.current = { row: rows.length, col: focusCol };
    setRows((rs) => [...rs, newRow(rs[rs.length - 1])]);
  };

  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [newRow(rs[0])]));

  const focusCell = (row, col) => table.current?.querySelector(`[data-cell="${row}:${col}"]`)?.focus();

  // Enter → next row (adding one at the bottom); ↑/↓ in text cells move rows; Ctrl+Enter saves.
  const onKeyDown = (e, rowIndex, colIndex) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
      return;
    }
    const isSelect = e.target.tagName === 'SELECT';
    if (e.key === 'Enter' || (!isSelect && e.key === 'ArrowDown')) {
      e.preventDefault();
      if (rowIndex === rows.length - 1) {
        if (e.key === 'Enter') addRow(colIndex);
      } else focusCell(rowIndex + 1, colIndex);
    } else if (!isSelect && e.key === 'ArrowUp' && rowIndex > 0) {
      e.preventDefault();
      focusCell(rowIndex - 1, colIndex);
    }
  };

  // A block copied from a spreadsheet fills cells from here rightwards and downwards.
  const onPaste = (e, rowIndex, colIndex) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!/[\t\n]/.test(text.trim())) return; // single value: let the input handle it
    e.preventDefault();
    let grid = parseTSV(text);
    if (grid.length && looksLikeHeader(grid[0])) grid = grid.slice(1);
    if (!grid.length) return;
    setMsg('');
    setRows((rs) => {
      const next = [...rs];
      grid.forEach((cells, i) => {
        const at = rowIndex + i;
        if (at >= MAX_ROWS) return;
        if (!next[at]) next.push(newRow(next[next.length - 1]));
        let patch = {};
        cells.forEach((value, j) => {
          const field = COLUMNS[colIndex + j];
          if (field) patch = { ...patch, ...cellPatch(field, value, categories) };
        });
        next[at] = { ...next[at], ...patch };
      });
      return next;
    });
    const lost = Math.max(0, rowIndex + grid.length - MAX_ROWS);
    setMsg(`Pasted ${grid.length - lost} row${grid.length - lost === 1 ? '' : 's'}${lost ? ` (${lost} past the ${MAX_ROWS}-row limit left out)` : ''}. Check anything marked red, then save.`);
  };

  const pickPhoto = async (key, file) => {
    if (!file) return;
    try {
      update(key, { receipt: await shrinkPhoto(file) });
    } catch (e) {
      setErr(e.message);
    }
  };

  async function save() {
    setErr('');
    setMsg('');
    setShowErrors(true);
    if (!filled.length) return setErr('Nothing to save yet.');
    if (filled.some((r) => Object.keys(errors[r.key]).length)) return setErr('Fix the cells marked red first. Nothing has been saved.');
    setBusy(true);
    try {
      const res = await adminApi.createExpenses({
        location_id: location,
        expenses: filled.map((r) => ({
          spent_on: r.spent_on,
          category: r.category,
          description: r.description,
          amount_paise: Math.round(Number(r.amount) * 100),
          paid_by: r.paid_by,
          payment_mode: r.payment_mode,
          ...(r.receipt ? { receipt: r.receipt } : {}),
        })),
      });
      const last = filled[filled.length - 1];
      setRows([newRow({ paid_by: last.paid_by, payment_mode: last.payment_mode }), newRow({ paid_by: last.paid_by, payment_mode: last.payment_mode })]);
      setServerErrors({});
      setShowErrors(false);
      setMsg(`Saved ${res.saved} expense${res.saved === 1 ? '' : 's'} · ${formatRupees(res.total_paise)}`);
      onSaved?.(filled.map((r) => r.spent_on));
    } catch (e) {
      if (e.errors?.length) setServerErrors(Object.fromEntries(e.errors.map((x) => [filled[x.row]?.key, x.error])));
      setErr(`${e.message}. Nothing has been saved.`);
    } finally {
      setBusy(false);
    }
  }

  // Wrong values (an unknown category from a paste, a future date) show at once;
  // missing ones only after a save attempt, so a half-typed row isn't all red.
  const visible = (msg) => msg && (showErrors || !/needed|Choose/.test(msg));
  const cellClass = (r, field) => (visible(errors[r.key][field]) ? 'xcell bad' : 'xcell');

  return (
    <div className="card">
      <div className="section-title-row">
        <h3 style={{ margin: 0 }}>Log expenses</h3>
        <span className="xsheet-tip">Tab / Enter to move · paste rows from Excel · Ctrl+Enter to save</span>
      </div>

      <div className="xsheet-wrap">
        <table className="xsheet" ref={table}>
          <thead>
            <tr>
              <th className="xnum">#</th>
              {COLUMNS.map((c) => <th key={c} className={c === 'amount' ? 'xright' : ''}>{HEADERS[c]}</th>)}
              <th>Bill</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowErr = Object.values(errors[r.key]).find(visible) || serverErrors[r.key];
              const common = (col) => ({
                'data-cell': `${i}:${col}`,
                onKeyDown: (e) => onKeyDown(e, i, col),
                onPaste: (e) => onPaste(e, i, col),
              });
              return [
                <tr key={r.key} className={`xrow ${rowErr ? 'has-error' : ''} ${isBlank(r) ? 'is-blank' : ''}`}>
                  <td className="xnum">{i + 1}</td>
                  <td data-label="Date">
                    <input className={cellClass(r, 'spent_on')} type="date" max={todayISO()} aria-label={`Row ${i + 1} date`}
                      value={/^\d{4}-\d{2}-\d{2}$/.test(r.spent_on) ? r.spent_on : ''}
                      onChange={(e) => update(r.key, { spent_on: e.target.value })} {...common(0)} />
                  </td>
                  <td data-label="Category">
                    <select className={cellClass(r, 'category')} aria-label={`Row ${i + 1} category`} value={r.category}
                      onChange={(e) => update(r.key, { category: e.target.value })} {...common(1)}>
                      <option value="">Choose…</option>
                      {r.category && !categories.includes(r.category) && <option value={r.category}>{r.category} (unknown)</option>}
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td data-label="What for">
                    <input className="xcell" aria-label={`Row ${i + 1} what for`} value={r.description} placeholder="e.g. tomato, onion"
                      onChange={(e) => update(r.key, { description: e.target.value })} {...common(2)} />
                  </td>
                  <td data-label="Amount (₹)">
                    <input className={`${cellClass(r, 'amount')} xright`} inputMode="decimal" aria-label={`Row ${i + 1} amount`} value={r.amount}
                      onChange={(e) => update(r.key, { amount: e.target.value })} {...common(3)} />
                  </td>
                  <td data-label="Paid by">
                    <input className="xcell" list="xsheet-payers" aria-label={`Row ${i + 1} paid by`} value={r.paid_by}
                      onChange={(e) => update(r.key, { paid_by: e.target.value })} {...common(4)} />
                  </td>
                  <td data-label="Paid with">
                    <select className={cellClass(r, 'payment_mode')} aria-label={`Row ${i + 1} paid with`} value={r.payment_mode}
                      onChange={(e) => update(r.key, { payment_mode: e.target.value })} {...common(5)}>
                      {!PAYMENT_MODES.some((m) => m.value === r.payment_mode) && <option value={r.payment_mode}>{r.payment_mode} (unknown)</option>}
                      {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </td>
                  <td data-label="Bill">
                    <label className={`xbill ${r.receipt ? 'has-photo' : ''}`} title={r.receipt ? 'Bill photo added — tap to replace' : 'Add a bill photo'}>
                      <input type="file" accept="image/*" capture="environment" aria-label={`Row ${i + 1} bill photo`}
                        onChange={(e) => pickPhoto(r.key, e.target.files?.[0])} />
                      {r.receipt ? '✓ Photo' : '📷'}
                    </label>
                  </td>
                  <td>
                    <button type="button" className="link-btn xremove" aria-label={`Remove row ${i + 1}`} onClick={() => removeRow(r.key)}>×</button>
                  </td>
                </tr>,
                rowErr ? (
                  <tr key={`${r.key}-err`} className="xrow-error">
                    <td />
                    <td colSpan={8}>Row {i + 1}: {rowErr}</td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <datalist id="xsheet-payers">{payers.map((p) => <option key={p} value={p} />)}</datalist>

      <div className="xsheet-foot">
        <button type="button" className="btn secondary" onClick={() => addRow(0)}>+ Add row</button>
        <span className="xsheet-total">
          {filled.length} row{filled.length === 1 ? '' : 's'} · <strong>{formatRupees(total)}</strong>
          {showErrors && badRows > 0 && <span className="pill cancelled">{badRows} to fix</span>}
        </span>
        <button type="button" className="btn" disabled={busy || !filled.length} onClick={save}>
          {busy ? 'Saving…' : filled.length ? `Save ${filled.length} expense${filled.length === 1 ? '' : 's'}` : 'Save expenses'}
        </button>
      </div>
      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {msg && <p className="notice ok">{msg}</p>}
    </div>
  );
}
