import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../api.js';
import { addDays, shortDate, todayISO } from '../dates.js';
import { useAdminLocation, useLocations } from '../locations.jsx';
import { parseTSV } from '../sheetPaste.js';

// Grams and millilitres move in bigger steps than trays and packets.
const stepFor = (unit) => (/^(gram|g|ml)$/i.test(unit) ? 50 : 1);
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export default function AdminStock() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState(null);
  const [values, setValues] = useState({}); // item id -> string in the input
  const [newItem, setNewItem] = useState({ name: '', unit: '', low_at: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const current = useRef('');
  current.current = `${location}|${date}`;

  const load = () => {
    if (location === 'all') return;
    const key = `${location}|${date}`;
    adminApi
      .getStock(location, date)
      .then((d) => {
        if (current.current !== key) return;
        setItems(d.items);
        // Start from today's count if there is one, else the last count.
        setValues(Object.fromEntries(d.items.map((i) => [i.id, fmt(i.quantity ?? i.previous_quantity ?? 0)])));
      })
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    setItems(null);
    setMsg('');
    setErr('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, date]);

  if (location === 'all') {
    return (
      <div>
        <h1>Stock</h1>
        <div className="card"><p style={{ margin: 0 }}>Stock is counted per property. Pick a property at the top.</p></div>
      </div>
    );
  }

  const bump = (item, dir) => {
    const next = Math.max(0, (Number(values[item.id]) || 0) + dir * stepFor(item.unit));
    setValues((v) => ({ ...v, [item.id]: fmt(next) }));
  };

  const save = async () => {
    setErr('');
    setMsg('');
    const counts = items.map((i) => ({ item_id: i.id, quantity: Number(values[i.id]) }));
    if (counts.some((c) => !(c.quantity >= 0))) return setErr('Every count must be a number, zero or more.');
    setBusy(true);
    try {
      await adminApi.saveStockCounts({ location_id: location, date, counts });
      setMsg(`Saved the count for ${shortDate(date)}.`);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addItem = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await adminApi.createStockItem({ location_id: location, ...newItem });
      setNewItem({ name: '', unit: '', low_at: '' });
      load();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const removeItem = async (item) => {
    if (!confirm(`Stop counting ${item.name}? Its past counts are kept.`)) return;
    try {
      await adminApi.updateStockItem(item.id, { active: false });
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const counted = items?.some((i) => i.quantity != null);
  const hasPrevious = items?.some((i) => i.previous_quantity != null);
  // Counts that differ from what's saved for this day (or, before saving, from the last count).
  const unsaved = (items || []).filter((i) => {
    const base = i.quantity ?? i.previous_quantity ?? 0;
    return values[i.id] !== '' && Number(values[i.id]) !== base;
  }).length;

  const sameAsLast = () => {
    setMsg('');
    setValues(Object.fromEntries(items.map((i) => [i.id, fmt(i.previous_quantity ?? (Number(values[i.id]) || 0))])));
  };

  const focusCount = (index) => {
    const el = document.querySelector(`[data-count-index="${index}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  // ↑/↓ and Enter walk down the list like a spreadsheet column; Enter on the last item saves.
  const onCountKey = (e, index) => {
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.ctrlKey)) {
      e.preventDefault();
      if (index < items.length - 1) focusCount(index + 1);
      else if (e.key === 'Enter') save();
    } else if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      focusCount(index - 1);
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      save();
    }
  };

  // Paste from a spreadsheet: a column of numbers fills from this item down; two columns
  // ("Eggs <tab> 4") are matched to items by name.
  const onCountPaste = (e, index) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const rows = parseTSV(text);
    const num = (c) => (/^\d+(\.\d+)?$/.test(String(c).replace(/,/g, '')) ? String(Number(String(c).replace(/,/g, ''))) : null);
    const next = { ...values };
    let filled = 0;
    const unmatched = [];
    const byName = rows.every((r) => r.length >= 2 && !num(r[0]));
    rows.forEach((r, k) => {
      if (byName) {
        const qty = r.slice(1).map(num).find((x) => x != null);
        const item = items.find((it) => it.name.toLowerCase() === r[0].toLowerCase());
        if (!item || qty == null) return unmatched.push(r[0]);
        next[item.id] = qty;
        filled += 1;
      } else {
        const qty = r.map(num).find((x) => x != null);
        const item = items[index + k];
        if (!item || qty == null) return;
        next[item.id] = qty;
        filled += 1;
      }
    });
    setValues(next);
    setMsg(`Pasted ${filled} count${filled === 1 ? '' : 's'}${unmatched.length ? `; not on the list: ${unmatched.join(', ')}` : ''}. Check and save.`);
  };

  return (
    <div>
      <h1>{byId[location]?.name || location} stock</h1>

      <div className="card day-bar">
        <button type="button" className="btn secondary" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
        <input className="input" type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button type="button" className="btn secondary" disabled={date >= todayISO()} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
      </div>

      {!items ? (
        <p>{err || 'Loading…'}</p>
      ) : (
        <div className="card">
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>
            {counted ? `Counted for ${shortDate(date)}. Change anything and save again.` : `Not counted yet for ${shortDate(date)}. Numbers start from the last count.`}
          </p>
          {items.length === 0 && <p>No items yet. Add what you want to count below.</p>}
          {items.length > 0 && (
            <div className="stock-tools">
              {hasPrevious && (
                <button type="button" className="btn secondary" onClick={sameAsLast}>Same as last count</button>
              )}
              <span className="xsheet-tip">↑ ↓ / Enter to move · paste a column of numbers or “item ⇥ count” from Excel</span>
            </div>
          )}
          <div className="stock-list">
            {items.map((i, index) => {
              const v = Number(values[i.id]);
              const low = i.low_at != null && v <= i.low_at;
              const change = i.previous_quantity != null && Number.isFinite(v) ? v - i.previous_quantity : null;
              return (
                <div className={`stock-row ${low ? 'is-low' : ''}`} key={i.id}>
                  <div className="stock-name">
                    <strong>{i.name}</strong>
                    <small>
                      {i.unit}
                      {i.previous_on ? ` · last ${fmt(i.previous_quantity)} on ${shortDate(i.previous_on)}` : ''}
                      {change ? ` · ${change > 0 ? '+' : ''}${fmt(change)}` : ''}
                    </small>
                    {low && <span className="pill pending">Low (at or below {fmt(i.low_at)})</span>}
                  </div>
                  <div className="stepper">
                    <button type="button" className="bed" aria-label={`Less ${i.name}`} onClick={() => bump(i, -1)}>−</button>
                    <input
                      className="input"
                      inputMode="decimal"
                      aria-label={`${i.name} (${i.unit})`}
                      name={`stock-${i.id}`}
                      data-count-index={index}
                      onKeyDown={(e) => onCountKey(e, index)}
                      onPaste={(e) => onCountPaste(e, index)}
                      onFocus={(e) => e.target.select()}
                      value={values[i.id] ?? ''}
                      onChange={(e) => setValues((vals) => ({ ...vals, [i.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                    />
                    <button type="button" className="bed" aria-label={`More ${i.name}`} onClick={() => bump(i, 1)}>+</button>
                  </div>
                  <button type="button" className="link-btn stock-remove" onClick={() => removeItem(i)} aria-label={`Stop counting ${i.name}`}>×</button>
                </div>
              );
            })}
          </div>
          {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
          {msg && <p className="notice ok">{msg}</p>}
          {items.length > 0 && (
            <button className="btn" type="button" disabled={busy} onClick={save} style={{ marginTop: '0.75rem' }}>
              {busy ? 'Saving…' : unsaved ? `Save count (${unsaved} changed)` : 'Save count'}
            </button>
          )}
        </div>
      )}

      <form className="card" onSubmit={addItem}>
        <h3 style={{ marginTop: 0 }}>Add an item to count</h3>
        <div className="row">
          <label><span>Item</span>
            <input className="input" name="item_name" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="e.g. Maggi" required />
          </label>
          <label><span>Counted in</span>
            <input className="input" name="item_unit" value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} placeholder="packet, litre, tray, gram" required />
          </label>
          <label><span>Low when at or below (optional)</span>
            <input className="input" name="item_low" inputMode="decimal" value={newItem.low_at} onChange={(e) => setNewItem({ ...newItem, low_at: e.target.value.replace(/[^\d.]/g, '') })} />
          </label>
          <button className="btn secondary" type="submit" style={{ flex: '0 0 auto' }}>Add</button>
        </div>
      </form>
    </div>
  );
}
