import { useEffect, useRef, useState } from 'react';
import { adminApi, formatRupees } from '../api.js';
import { useAdminLocation, useLocations } from '../locations.jsx';

function MetricCard({ label, value, hint }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function AdminAnalytics() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const allCafes = location === 'all';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // Ignore responses for a cafe the admin has already switched away from.
  const currentLocation = useRef(location);
  currentLocation.current = location;

  const refresh = async () => {
    const requested = location;
    setErr('');
    try {
      const result = await adminApi.getAnalytics(requested === 'all' ? '' : requested);
      if (currentLocation.current !== requested) return;
      setData(result);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    setLoading(true);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const summary = data?.summary || {};

  return (
    <div>
      <div className="section-title-row">
        <div>
          <h1>{allCafes ? 'Analytics — all cafes' : `${byId[location]?.name || location} cafe analytics`}</h1>
          <p style={{ color: 'var(--muted)', marginTop: -6 }}>
            Sales totals exclude cancelled orders.
          </p>
        </div>
        <button className="btn secondary" onClick={refresh}>Refresh</button>
      </div>

      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {loading && <p>Loading...</p>}

      {data && (
        <>
          <div className="metrics-grid">
            <MetricCard label="Total order value" value={formatRupees(summary.grossSalesPaise)} />
            <MetricCard label="Paid revenue" value={formatRupees(summary.paidSalesPaise)} />
            <MetricCard label="Tax collected" value={formatRupees(summary.taxPaise)} />
            <MetricCard label="Average order" value={formatRupees(summary.averageOrderPaise)} />
            <MetricCard label="Total orders" value={summary.totalOrders} hint={`${summary.activeOrders} active`} />
            <MetricCard label="Closed orders" value={summary.closedOrders} hint={`${summary.paidOrders} paid`} />
          </div>

          {allCafes && data.byLocation?.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>By cafe</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Cafe</th>
                    <th>Orders</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byLocation.map((row) => (
                    <tr key={row.location_id}>
                      <td>{row.name}</td>
                      <td>{row.orders}</td>
                      <td style={{ textAlign: 'right' }}>{formatRupees(row.total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="analytics-grid">
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Top items</h3>
              {data.topItems.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No item sales yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topItems.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td>{item.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{formatRupees(item.total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Recent daily sales</h3>
              {data.dailySales.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No sales yet.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Orders</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailySales.map((day) => (
                      <tr key={day.day}>
                        <td>{day.day}</td>
                        <td>{day.orders}</td>
                        <td style={{ textAlign: 'right' }}>{formatRupees(day.total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
