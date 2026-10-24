import { useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, auth, formatRupees } from '../api.js';
import { monthISO, monthLabel, shortDate, todayISO } from '../dates.js';
import { useAdminLocation, useLocations } from '../locations.jsx';
import Chips from '../components/Chips.jsx';
import ExpenseSheet from '../components/ExpenseSheet.jsx';
import { shrinkPhoto } from '../photos.js';

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' },
];

const blank = () => ({
  id: null,
  spent_on: todayISO(),
  amount: '',
  category: '',
  description: '',
  paid_by: '',
  payment_mode: 'cash',
  receipt: '', // data URL of a new photo
});

export default function AdminExpenses() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const isOwner = auth.current()?.role === 'owner';
  const [categories, setCategories] = useState([]);
  const [month, setMonth] = useState(monthISO(todayISO()));
  const [data, setData] = useState({ expenses: [], payers: [] });
  const [draft, setDraft] = useState(blank);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null); // object URL of a bill photo
  const fileInput = useRef(null);

  const current = useRef('');
  current.current = `${location}|${month}`;

  const refresh = () => {
    if (location === 'all') return;
    const key = `${location}|${month}`;
    adminApi
      .listExpenses(location, month)
      .then((d) => current.current === key && setData(d))
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    adminApi.expenseOptions().then((o) => setCategories(o.categories)).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    setData({ expenses: [], payers: [] });
    setDraft(blank());
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, month]);

  const total = useMemo(() => data.expenses.reduce((s, x) => s + x.amount_paise, 0), [data]);
  const byCategory = useMemo(() => {
    const m = new Map();
    for (const x of data.expenses) m.set(x.category, (m.get(x.category) || 0) + x.amount_paise);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  if (location === 'all') {
    return (
      <div>
        <h1>Expenses</h1>
        <div className="card"><p style={{ margin: 0 }}>Expenses are kept per property. Pick a property at the top.</p></div>
      </div>
    );
  }

  const set = (field) => (value) => setDraft((d) => ({ ...d, [field]: value }));

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      set('receipt')(await shrinkPhoto(file));
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setSaved('');
    if (!draft.category) return setErr('Choose a category.');
    setBusy(true);
    const body = {
      location_id: location,
      spent_on: draft.spent_on,
      category: draft.category,
      description: draft.description,
      amount_paise: Math.round(Number(draft.amount || 0) * 100),
      paid_by: draft.paid_by,
      payment_mode: draft.payment_mode,
      ...(draft.receipt ? { receipt: draft.receipt } : {}),
    };
    try {
      if (draft.id) await adminApi.updateExpense(draft.id, body);
      else await adminApi.createExpense(body);
      setSaved(`Saved ${formatRupees(body.amount_paise)} · ${draft.category}`);
      setDraft(blank());
      if (fileInput.current) fileInput.current.value = '';
      if (monthISO(body.spent_on) !== month) setMonth(monthISO(body.spent_on));
      else refresh();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const edit = (x) => {
    setSaved('');
    setErr('');
    setDraft({
      id: x.id,
      spent_on: x.spent_on,
      amount: String(x.amount_paise / 100),
      category: x.category,
      description: x.description,
      paid_by: x.paid_by,
      payment_mode: x.payment_mode,
      receipt: '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const del = async (x) => {
    if (!confirm(`Delete ${formatRupees(x.amount_paise)} · ${x.category} on ${x.spent_on}?`)) return;
    try {
      await adminApi.deleteExpense(x.id);
      refresh();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const viewBill = async (x) => {
    try {
      setViewing(await adminApi.receiptUrl(x.id));
    } catch (e2) {
      setErr(e2.message);
    }
  };

  return (
    <div>
      <h1>{byId[location]?.name || location} expenses</h1>

      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {saved && <p className="notice ok">{saved}</p>}

      {!draft.id && (
        <ExpenseSheet
          key={location}
          location={location}
          categories={categories}
          payers={data.payers}
          onSaved={(dates) => {
            const latest = dates.slice().sort().pop();
            if (latest && monthISO(latest) !== month) setMonth(monthISO(latest));
            else refresh();
          }}
        />
      )}

      {draft.id && (
      <form className="card" onSubmit={save}>
        <h3 style={{ marginTop: 0 }}>Edit expense</h3>
        <div className="row">
          <label><span>Amount (₹)</span>
            <input className="input" name="amount" type="number" inputMode="decimal" min="1" step="any" value={draft.amount} onChange={(e) => set('amount')(e.target.value)} required />
          </label>
          <label><span>Date</span>
            <input className="input" type="date" name="spent_on" max={todayISO()} value={draft.spent_on} onChange={(e) => set('spent_on')(e.target.value)} required />
          </label>
        </div>
        <label><span>Category</span></label>
        <Chips label="Category" options={categories.map((c) => ({ value: c, label: c }))} value={draft.category} onChange={set('category')} />
        <div className="row">
          <label><span>What for</span>
            <input className="input" name="description" value={draft.description} onChange={(e) => set('description')(e.target.value)} placeholder="e.g. 10 pkt Maggi" />
          </label>
          <label><span>Paid by</span>
            <input className="input" name="paid_by" list="payers" value={draft.paid_by} onChange={(e) => set('paid_by')(e.target.value)} placeholder="Who paid" />
            <datalist id="payers">{data.payers.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
        </div>
        <label><span>Paid with</span></label>
        <Chips label="Paid with" options={PAYMENT_MODES} value={draft.payment_mode} onChange={set('payment_mode')} />
        <label><span>Bill photo</span>
          <input ref={fileInput} className="input" type="file" accept="image/*" capture="environment" onChange={pickPhoto} />
        </label>
        {draft.receipt && <img className="bill-preview" src={draft.receipt} alt="Bill preview" />}
        <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : draft.id ? 'Save changes' : 'Save expense'}</button>
          {draft.id && <button type="button" className="btn secondary" onClick={() => setDraft(blank())}>Cancel</button>}
        </div>
      </form>
      )}

      <div className="card">
        <div className="section-title-row">
          <h3 style={{ margin: 0 }}>{monthLabel(month)} · {formatRupees(total)}</h3>
          <input className="input" type="month" value={month} max={monthISO(todayISO())} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ maxWidth: 180 }} />
        </div>
        {byCategory.length > 0 && (
          <div className="booking-pills" style={{ margin: '0.5rem 0 0.75rem' }}>
            {byCategory.map(([c, amt]) => <span key={c} className="pill">{c} {formatRupees(amt)}</span>)}
          </div>
        )}
        {data.expenses.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>Nothing logged this month.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Date</th><th>What</th><th>Paid</th><th style={{ textAlign: 'right' }}>Amount</th><th></th></tr>
            </thead>
            <tbody>
              {data.expenses.map((x) => (
                <tr key={x.id}>
                  <td>{shortDate(x.spent_on)}</td>
                  <td>
                    <strong>{x.category}</strong>
                    {x.description && <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{x.description}</div>}
                  </td>
                  <td>{[x.paid_by, PAYMENT_MODES.find((m) => m.value === x.payment_mode)?.label].filter(Boolean).join(' · ')}</td>
                  <td style={{ textAlign: 'right' }}>{formatRupees(x.amount_paise)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {x.has_receipt ? <button type="button" className="link-btn" onClick={() => viewBill(x)}>Bill</button> : null}{' '}
                    <button type="button" className="link-btn" onClick={() => edit(x)}>Edit</button>{' '}
                    {isOwner && <button type="button" className="link-btn" style={{ color: '#c92a2a' }} onClick={() => del(x)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {viewing && (
        <div className="drawer-backdrop" onClick={() => { URL.revokeObjectURL(viewing); setViewing(null); }}>
          <img className="bill-full" src={viewing} alt="Bill" />
        </div>
      )}
    </div>
  );
}
