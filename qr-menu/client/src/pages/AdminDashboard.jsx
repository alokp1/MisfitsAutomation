import { useEffect, useMemo, useRef, useState } from 'react';
import { adminApi, auth, formatRupees } from '../api.js';
import { addDays, monthISO, monthLabel, shortDate, todayISO } from '../dates.js';
import { useAdminLocation, useLocations } from '../locations.jsx';
import { BarList, ColumnChart, LineChart, SERIES_COLORS } from '../components/charts.jsx';

const rupees = (paise) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
// Axis ticks: ₹0 · ₹5K · ₹1.2L
const rupeesShort = (paise) => {
  const r = paise / 100;
  if (r >= 100000) return `₹${Math.round(r / 10000) / 10}L`;
  if (r >= 1000) return `₹${Math.round(r / 100) / 10}K`;
  return `₹${Math.round(r)}`;
};
const pctText = (v) => (v == null ? '—' : `${v}%`);

const PAYMENT_LABELS = { upi: 'UPI', cash: 'Cash', card: 'Card', prepaid: 'Prepaid (OTA)', pending: 'To collect', online: 'Online (QR)', bank: 'Bank' };

function presets(today) {
  const firstOfMonth = `${monthISO(today)}-01`;
  const lastMonthEnd = addDays(firstOfMonth, -1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: '30d', label: 'Last 30 days', from: addDays(today, -29), to: today },
    { key: 'month', label: 'This month', from: firstOfMonth, to: today },
    { key: 'lastmonth', label: 'Last month', from: `${monthISO(lastMonthEnd)}-01`, to: lastMonthEnd },
    { key: '90d', label: 'Last 90 days', from: addDays(today, -89), to: today },
  ];
}

// Daily rows, or monthly when the range is long enough that days become noise.
function bucket(report) {
  const monthly = report.days > 62;
  const out = new Map();
  for (const d of report.daily) {
    const key = monthly ? monthISO(d.date) : d.date;
    const row = out.get(key) || { key, days: 0, rooms_paise: 0, cafe_paise: 0, expenses_paise: 0, beds_sold: 0, private_sold: 0 };
    row.days += 1;
    for (const k of ['rooms_paise', 'cafe_paise', 'expenses_paise', 'beds_sold', 'private_sold']) row[k] += d[k];
    out.set(key, row);
  }
  const pct = (sold, cap, days) => (cap > 0 ? Math.round((sold / (cap * days)) * 1000) / 10 : null);
  return [...out.values()].map((r) => ({
    label: monthly ? monthLabel(r.key) : shortDate(r.key),
    short: monthly ? monthLabel(r.key).slice(0, 3) : String(Number(r.key.slice(8))),
    rooms: r.rooms_paise,
    cafe: r.cafe_paise,
    expenses: r.expenses_paise,
    dorm: pct(r.beds_sold, report.capacity.dorm_beds, r.days),
    private: pct(r.private_sold, report.capacity.private_rooms, r.days),
  }));
}

function Tile({ label, value, sub }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export default function AdminDashboard() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const isOwner = auth.current()?.role === 'owner';
  const today = todayISO();
  const options = presets(today);
  const [preset, setPreset] = useState('30d');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range = preset === 'custom' ? custom : options.find((p) => p.key === preset);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const current = useRef('');
  const key = `${location}|${range.from}|${range.to}`;
  current.current = key;

  useEffect(() => {
    if (!isOwner || !range.from || !range.to || range.to < range.from) return;
    setLoading(true);
    setErr('');
    adminApi
      .getDashboard(location, range.from, range.to)
      .then((d) => current.current === key && setData(d))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isOwner]);

  const report = data ? data.combined || data.properties[0].report : null;
  const rows = useMemo(() => (report ? bucket(report) : []), [report]);

  if (!isOwner) {
    return (
      <div>
        <h1>Dashboard</h1>
        <div className="card"><p style={{ margin: 0 }}>The dashboard is for the owner.</p></div>
      </div>
    );
  }

  const t = report?.totals;
  const scope = location === 'all' ? 'All properties' : byId[location]?.name || location;
  const incomeSeries = [
    { key: 'rooms', label: 'Rooms', color: SERIES_COLORS[0] },
    { key: 'cafe', label: 'Cafe', color: SERIES_COLORS[1] },
  ];
  const occupancySeries = [
    { key: 'dorm', label: 'Dorm beds', color: SERIES_COLORS[0] },
    { key: 'private', label: 'Private rooms', color: SERIES_COLORS[1] },
  ];
  const cashPaise = report
    ? (report.rooms_by_payment.find((r) => r.key === 'cash')?.amount_paise || 0) + (report.cafe_by_method.find((r) => r.key === 'cash')?.amount_paise || 0)
    : 0;

  return (
    <div className="viz-root">
      <h1>Dashboard · {scope}</h1>

      <div className="filter-row">
        <div className="chips" role="radiogroup" aria-label="Period">
          {options.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={preset === p.key} className={preset === p.key ? 'active' : ''} onClick={() => setPreset(p.key)}>
              {p.label}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={preset === 'custom'} className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>
            Custom
          </button>
        </div>
        {preset === 'custom' && (
          <div className="row" style={{ maxWidth: 420 }}>
            <label><span>From</span>
              <input className="input" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label><span>To</span>
              <input className="input" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </div>
        )}
      </div>

      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {!report ? (
        <p>{loading ? 'Loading…' : ''}</p>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          <div className="card hero-card">
            <span>Net for {range.from === range.to ? shortDate(range.from) : `${shortDate(range.from)} – ${shortDate(range.to)}`}</span>
            <strong className="hero-figure">{rupees(t.net_paise)}</strong>
            <small>Rooms {rupees(t.rooms_paise)} + cafe {rupees(t.cafe_paise)} − expenses {rupees(t.expenses_paise)}</small>
          </div>

          <div className="metrics-grid">
            <Tile label="Rooms" value={rupees(t.rooms_paise)} sub={`${t.arrivals} arrivals`} />
            <Tile label="Cafe" value={rupees(t.cafe_paise)} sub={`${t.cafe_orders} orders · ${t.counter_sales} at the counter`} />
            <Tile label="Expenses" value={rupees(t.expenses_paise)} sub={`${t.expense_entries} entries`} />
            <Tile label="Dorm occupancy" value={pctText(t.dorm_occupancy_pct)} sub={`${t.bed_nights_sold} bed-nights of ${report.capacity.dorm_beds * report.days}`} />
            <Tile label="Private room occupancy" value={pctText(t.private_occupancy_pct)} sub={`${t.private_nights_sold} room-nights of ${report.capacity.private_rooms * report.days}`} />
            <Tile label="Cash taken" value={rupees(cashPaise)} sub="Rooms and cafe, to match against the cash box" />
          </div>

          {data.properties.length > 1 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>By property</h3>
              <table className="table num-table">
                <thead>
                  <tr><th>Property</th><th>Rooms</th><th>Cafe</th><th>Expenses</th><th>Net</th><th>Dorm</th><th>Private</th></tr>
                </thead>
                <tbody>
                  {data.properties.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td>{rupees(p.report.totals.rooms_paise)}</td>
                      <td>{rupees(p.report.totals.cafe_paise)}</td>
                      <td>{rupees(p.report.totals.expenses_paise)}</td>
                      <td><strong>{rupees(p.report.totals.net_paise)}</strong></td>
                      <td>{pctText(p.report.totals.dorm_occupancy_pct)}</td>
                      <td>{pctText(p.report.totals.private_occupancy_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Income by {report.days > 62 ? 'month' : 'day'}</h3>
            <ColumnChart
              title="Rooms and cafe income"
              data={rows.map((r) => ({ label: r.label, short: r.short, values: { rooms: r.rooms, cafe: r.cafe } }))}
              series={incomeSeries}
              format={rupees}
              axisFormat={rupeesShort}
            />
          </div>

          <div className="analytics-grid">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Occupancy by {report.days > 62 ? 'month' : 'night'}</h3>
              <LineChart
                title="Dorm bed and private room occupancy"
                data={rows.map((r) => ({ label: r.label, short: r.short, values: { dorm: r.dorm, private: r.private } }))}
                series={occupancySeries}
                yMax={100}
                format={pctText}
                axisFormat={(v) => `${v}%`}
              />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Expenses by {report.days > 62 ? 'month' : 'day'}</h3>
              <ColumnChart
                title="Expenses"
                data={rows.map((r) => ({ label: r.label, short: r.short, values: { expenses: r.expenses } }))}
                series={[{ key: 'expenses', label: 'Expenses', color: SERIES_COLORS[0] }]}
                format={rupees}
                axisFormat={rupeesShort}
              />
            </div>
          </div>

          <div className="analytics-grid">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Where bookings came from</h3>
              <p className="viz-note">Stays starting in this period, at their full booked amount.</p>
              <BarList
                title="Bookings by source"
                rows={report.by_source.map((r) => ({ label: r.key, value: r.amount_paise, note: `${r.count} booking${r.count === 1 ? '' : 's'}` }))}
                format={rupees}
              />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Expenses by category</h3>
              <BarList
                title="Expenses by category"
                rows={report.expenses_by_category.map((r) => ({ label: r.key, value: r.amount_paise, note: `${r.count} entr${r.count === 1 ? 'y' : 'ies'}` }))}
                format={rupees}
              />
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>How guests paid</h3>
            <table className="table num-table">
              <thead><tr><th>Method</th><th>Rooms (stays starting)</th><th>Cafe</th></tr></thead>
              <tbody>
                {[...new Set([...report.rooms_by_payment, ...report.cafe_by_method].map((r) => r.key))].map((k) => (
                  <tr key={k}>
                    <td>{PAYMENT_LABELS[k] || k}</td>
                    <td>{formatRupees(report.rooms_by_payment.find((r) => r.key === k)?.amount_paise || 0)}</td>
                    <td>{formatRupees(report.cafe_by_method.find((r) => r.key === k)?.amount_paise || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="viz-note">
              Room income in the charts is spread over each stay’s nights, so a 3-night stay counts a third on each night. Cafe orders paid by QR show
              the Razorpay method.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
