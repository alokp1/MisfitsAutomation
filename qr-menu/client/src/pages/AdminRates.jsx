import { useEffect, useRef, useState } from 'react';
import { adminApi, formatRupees } from '../api.js';
import { useAdminLocation, useLocations } from '../locations.jsx';

const when = (sqlUtc) =>
  new Date(sqlUtc.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function AdminRates() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const [data, setData] = useState(null);
  const [values, setValues] = useState({}); // rate_key -> rupees string
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const current = useRef('');
  current.current = location;

  const load = () => {
    if (location === 'all') return;
    const requested = location;
    adminApi
      .getRates(requested)
      .then((d) => {
        if (current.current !== requested) return;
        setData(d);
        setValues(Object.fromEntries(d.rates.map((r) => [r.rate_key, r.amount_paise == null ? '' : String(r.amount_paise / 100)])));
      })
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    setData(null);
    setErr('');
    setMsg('');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  if (location === 'all') {
    return (
      <div>
        <h1>Room rates</h1>
        <div className="card"><p style={{ margin: 0 }}>Rates are set per property. Pick a property at the top.</p></div>
      </div>
    );
  }

  const label = (key) => data?.rates.find((r) => r.rate_key === key)?.label || key;

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    const rates = data.rates.map((r) => ({ rate_key: r.rate_key, amount_paise: Math.round(Number(values[r.rate_key]) * 100) }));
    const bad = rates.find((r) => !(r.amount_paise > 0));
    if (bad) return setErr(`${label(bad.rate_key)}: enter a price above ₹0.`);
    setBusy(true);
    try {
      const res = await adminApi.saveRates({ location_id: location, rates });
      setMsg(res.changed ? `Saved ${res.changed} price${res.changed === 1 ? '' : 's'}.` : 'No prices changed.');
      load();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>{byId[location]?.name || location} room rates</h1>
      <p style={{ color: 'var(--muted)', marginTop: -6 }}>
        Nightly prices filled in on bookings you enter here (walk-ins, phone). Changing a price doesn’t change bookings already made.
        Website and OTA prices are set in AsiaTech; the website’s Book buttons open the AsiaTech booking page.
      </p>

      {!data ? (
        <p>{err || 'Loading…'}</p>
      ) : (
        <form className="card" onSubmit={save}>
          <div className="rate-list">
            {data.rates.map((r) => (
              <label className="rate-row" key={r.rate_key}>
                <span className="rate-name">
                  <strong>{r.label}</strong>
                  <small>
                    per {r.unit}, per night
                    {r.updated_at ? ` · last changed ${when(r.updated_at)}${r.updated_by_name ? ` by ${r.updated_by_name}` : ''}` : ''}
                  </small>
                </span>
                <span className="rate-input">
                  <span aria-hidden="true">₹</span>
                  <input
                    className="input"
                    name={`rate-${r.rate_key}`}
                    inputMode="decimal"
                    aria-label={`${r.label} price in rupees`}
                    value={values[r.rate_key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [r.rate_key]: e.target.value.replace(/[^\d.]/g, '') }))}
                  />
                </span>
              </label>
            ))}
          </div>
          {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
          {msg && <p className="notice ok">{msg}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: '0.75rem' }}>
            {busy ? 'Saving…' : 'Save prices'}
          </button>
        </form>
      )}

      {data?.changes.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Recent changes</h3>
          <table className="table num-table">
            <thead><tr><th>When</th><th>Room type</th><th>Change</th><th>By</th></tr></thead>
            <tbody>
              {data.changes.map((c, i) => (
                <tr key={i}>
                  <td>{when(c.changed_at)}</td>
                  <td>{label(c.rate_key)}</td>
                  <td>{c.old_paise == null ? 'set to' : `${formatRupees(c.old_paise)} →`} {formatRupees(c.new_paise)}</td>
                  <td>{c.changed_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
