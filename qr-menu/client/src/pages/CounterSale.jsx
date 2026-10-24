import { useEffect, useMemo, useState } from 'react';
import { api, adminApi, formatRupees } from '../api.js';
import { useAdminLocation, useLocations } from '../locations.jsx';
import Chips from '../components/Chips.jsx';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
];

export default function CounterSale() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const [menu, setMenu] = useState(null);
  const [qty, setQty] = useState({}); // menu item id -> quantity
  const [method, setMethod] = useState('cash');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (location === 'all') return;
    setMenu(null);
    setQty({});
    api.getMenu(location).then(setMenu).catch((e) => setErr(e.message));
  }, [location]);

  const lines = useMemo(() => (menu || []).filter((m) => qty[m.id] > 0).map((m) => ({ ...m, quantity: qty[m.id] })), [menu, qty]);
  // Same arithmetic as the server; the server's figure is what gets recorded.
  const total = lines.reduce(
    (s, l) => s + l.price_paise * l.quantity + Math.round(l.price_paise * l.quantity * (Number(l.tax_percent ?? 0) / 100)),
    0,
  );
  const grouped = useMemo(() => {
    const g = new Map();
    for (const m of menu || []) {
      const k = m.category_name || 'Other';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(m);
    }
    return [...g.entries()];
  }, [menu]);

  if (location === 'all') {
    return (
      <div>
        <h1>Counter sale</h1>
        <div className="card"><p style={{ margin: 0 }}>Pick a property at the top first.</p></div>
      </div>
    );
  }

  const change = (id, d) => {
    setMsg('');
    setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] || 0) + d) }));
  };

  const record = async () => {
    setErr('');
    setBusy(true);
    try {
      const res = await adminApi.counterSale({
        location_id: location,
        payment_method: method,
        customer_name: name,
        note,
        items: lines.map((l) => ({ menu_item_id: l.id, quantity: l.quantity })),
      });
      setMsg(`Recorded ${formatRupees(res.total_paise)} (${METHODS.find((m) => m.value === method).label}).`);
      setQty({});
      setName('');
      setNote('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>{byId[location]?.name || location} counter sale</h1>
      <p style={{ color: 'var(--muted)', marginTop: -6 }}>For cafe orders paid at the counter instead of through the QR menu.</p>

      {!menu ? (
        <p>{err || 'Loading menu…'}</p>
      ) : menu.length === 0 ? (
        <div className="card"><p style={{ margin: 0 }}>This cafe’s menu is empty. Add items under Menu first.</p></div>
      ) : (
        <div className="card">
          {grouped.map(([cat, items]) => (
            <div key={cat} className="counter-group">
              <h3>{cat}</h3>
              {items.map((m) => (
                <div className="counter-row" key={m.id}>
                  <span className="counter-name">
                    {m.name}
                    <small>{formatRupees(m.price_paise)}</small>
                  </span>
                  <div className="stepper">
                    <button type="button" className="bed" aria-label={`One less ${m.name}`} disabled={!qty[m.id]} onClick={() => change(m.id, -1)}>−</button>
                    <span className="counter-qty" aria-label={`${m.name} quantity`}>{qty[m.id] || 0}</span>
                    <button type="button" className="bed" aria-label={`Add ${m.name}`} onClick={() => change(m.id, 1)}>+</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {menu?.length > 0 && (
        <div className="card counter-total">
          <div className="section-title-row">
            <h3 style={{ margin: 0 }}>Total {formatRupees(total)}</h3>
            <span className="pill">{lines.reduce((s, l) => s + l.quantity, 0)} items</span>
          </div>
          <label><span>Paid with</span></label>
          <Chips label="Paid with" options={METHODS} value={method} onChange={setMethod} />
          <div className="row">
            <label><span>Guest (optional)</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label><span>Note (optional)</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
          {msg && <p className="notice ok">{msg}</p>}
          <button className="btn" type="button" disabled={busy || lines.length === 0} onClick={record} style={{ marginTop: '0.5rem' }}>
            {busy ? 'Recording…' : `Record ${formatRupees(total)} sale`}
          </button>
        </div>
      )}
    </div>
  );
}
