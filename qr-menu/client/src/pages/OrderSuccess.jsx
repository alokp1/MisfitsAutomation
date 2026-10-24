import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { api, formatRupees } from '../api.js';
import { useCafe } from '../locations.jsx';

export default function OrderSuccess() {
  const { orderId } = useParams();
  const cafe = useCafe();
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getOrder(orderId).then(setOrder).catch((e) => setErr(e.message));
  }, [orderId]);

  if (err) return <main className="page"><p style={{ color: '#c92a2a' }}>{err}</p></main>;
  if (!order) return <main className="page"><p>Loading…</p></main>;
  if (order.location_id !== cafe.id) return <Navigate to={`/${order.location_id}/order/${order.id}`} replace />;

  const paid = order.payment_status === 'paid';

  return (
    <main className="page">
      <div className="success-card">
        <div className="checkmark">{paid ? '✓' : '…'}</div>
        <h2 style={{ margin: '0.25rem 0' }}>
          {paid ? 'Order placed!' : 'Order received'}
        </h2>
        <p style={{ color: 'var(--muted)' }}>
          {paid
            ? 'Your payment was successful and the kitchen has been notified.'
            : 'Awaiting payment confirmation.'}
        </p>
        <p style={{ fontSize: '1.1rem' }}>
          <strong>Order #{order.id}</strong> • {cafe.name}
          {order.table_id ? <> • Table {order.table_id}</> : null}
        </p>

        <div style={{ textAlign: 'left', marginTop: '1rem' }}>
          {order.items.map((it) => (
            <div className="cart-row" key={it.id}>
              <div className="name">
                <div>{it.name_snapshot}</div>
                <small style={{ color: 'var(--muted)' }}>
                  {formatRupees(it.price_paise_snapshot)} × {it.quantity}
                </small>
              </div>
              <div className="price">{formatRupees(it.price_paise_snapshot * it.quantity)}</div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
            <span>Subtotal</span><span>{formatRupees(order.subtotal_paise)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tax</span><span>{formatRupees(order.tax_paise)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.1rem' }}>
            <span>Total {paid ? 'paid' : 'due'}</span>
            <span>{formatRupees(order.total_paise)}</span>
          </div>
        </div>

        <Link to={`/${cafe.id}/menu`} className="btn full" style={{ marginTop: '1.25rem', display: 'inline-block' }}>
          Order more
        </Link>
      </div>
    </main>
  );
}
