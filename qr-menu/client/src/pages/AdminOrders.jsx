import { useEffect, useRef, useState } from 'react';
import { adminApi, formatRupees } from '../api.js';
import { useAdminLocation, useLocations } from '../locations.jsx';

const STATUSES = ['pending', 'paid', 'preparing', 'served', 'cancelled'];
const CLOSED_STATUSES = new Set(['served', 'cancelled']);

function OrdersList({ orders, onSetStatus, cafeNames, closed = false }) {
  if (orders.length === 0) {
    return (
      <div className="card">
        <p style={{ color: 'var(--muted)' }}>
          {closed ? 'No closed orders yet.' : 'No active orders yet.'}
        </p>
      </div>
    );
  }

  return orders.map((o) => (
    <div className={`card order-card ${closed ? 'closed' : ''}`} key={o.id}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <strong>Order #{o.id}</strong>
          {cafeNames ? <> <span className="pill">{cafeNames[o.location_id] || o.location_id}</span></> : null}
          {o.table_id ? <> - Table {o.table_id}</> : null}
          {o.customer_name ? <> - {o.customer_name}</> : null}
          {o.customer_phone ? <> ({o.customer_phone})</> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {closed && <span className="pill closed">Closed</span>}
          <span className={`pill ${o.payment_status}`}>{o.payment_status}</span>
          <span className={`pill ${o.status}`}>{o.status}</span>
        </div>
      </div>
      <div style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
        {new Date(o.created_at + 'Z').toLocaleString()}
        {o.payment_method ? <> - Paid via {o.payment_method}</> : null}
        {o.razorpay_payment_id ? <> - {o.razorpay_payment_id}</> : null}
      </div>

      <table className="table" style={{ marginTop: '0.6rem' }}>
        <thead>
          <tr><th>Item</th><th>Qty</th><th style={{ textAlign: 'right' }}>Line total</th></tr>
        </thead>
        <tbody>
          {o.items.map((it) => (
            <tr key={it.id}>
              <td>{it.name_snapshot}</td>
              <td>{it.quantity}</td>
              <td style={{ textAlign: 'right' }}>
                {formatRupees(it.price_paise_snapshot * it.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {o.note && (
        <p style={{ background: '#fff8e1', padding: '0.5rem 0.75rem', borderRadius: 6, marginTop: '0.5rem' }}>
          <strong>Note:</strong> {o.note}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', gap: 12 }}>
        <strong>Total: {formatRupees(o.total_paise)}</strong>
        {closed ? (
          <span style={{ color: 'var(--muted)', fontSize: '0.86rem', fontWeight: 700 }}>
            This order is closed.
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`btn ${s === o.status ? '' : 'secondary'}`}
                style={{ padding: '0.35rem 0.7rem', fontSize: '0.85rem', minHeight: 34 }}
                onClick={() => onSetStatus(o, s)}
                disabled={s === o.status}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  ));
}

export default function AdminOrders() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const allCafes = location === 'all';
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // Ignore responses for a cafe the admin has already switched away from.
  const currentLocation = useRef(location);
  currentLocation.current = location;

  const refresh = async () => {
    const requested = location;
    try {
      const data = await adminApi.listOrders(requested === 'all' ? '' : requested);
      if (currentLocation.current !== requested) return;
      setOrders(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOrders([]);
    setLoading(true);
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const cafeNames = allCafes ? Object.fromEntries(Object.values(byId).map((l) => [l.id, l.name])) : null;

  const setStatus = async (order, status) => {
    const closesOrder = CLOSED_STATUSES.has(status);
    const msg = closesOrder
      ? `Update order #${order.id} to "${status}" and move it to Closed orders?`
      : `Update order #${order.id} from "${order.status}" to "${status}"?`;

    if (!confirm(msg)) return;

    try {
      await adminApi.setOrderStatus(order.id, status);
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const activeOrders = orders.filter((o) => !CLOSED_STATUSES.has(o.status));
  const closedOrders = orders.filter((o) => CLOSED_STATUSES.has(o.status));

  return (
    <div>
      <h1>{allCafes ? 'Orders — all cafes' : `${byId[location]?.name || location} cafe orders`}</h1>
      <p style={{ color: 'var(--muted)' }}>Auto-refreshes every 5 seconds.</p>
      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {loading && <p>Loading...</p>}

      {!loading && (
        <>
          <section className="orders-section">
            <div className="section-title-row">
              <h2>Active orders</h2>
              <span className="pill">{activeOrders.length}</span>
            </div>
            <OrdersList orders={activeOrders} onSetStatus={setStatus} cafeNames={cafeNames} />
          </section>

          <section className="orders-section closed-list">
            <div className="section-title-row">
              <h2>Closed orders</h2>
              <span className="pill closed">{closedOrders.length}</span>
            </div>
            <OrdersList orders={closedOrders} onSetStatus={setStatus} cafeNames={cafeNames} closed />
          </section>
        </>
      )}
    </div>
  );
}
