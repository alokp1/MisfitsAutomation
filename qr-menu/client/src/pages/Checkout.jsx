import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { tableIdKey, useCart } from '../store.jsx';
import { useCafe } from '../locations.jsx';
import { api, formatRupees } from '../api.js';

export default function Checkout() {
  const navigate = useNavigate();
  const cart = useCart();
  const cafe = useCafe();
  const menuPath = `/${cafe.id}/menu`;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const tableId = localStorage.getItem(tableIdKey(cafe.id)) || '';

  if (cart.items.length === 0) {
    return (
      <main className="page">
        <h2>Your cart is empty</h2>
        <Link to={menuPath} className="btn secondary">Back to menu</Link>
      </main>
    );
  }

  const placeOrder = async () => {
    setErr('');
    setSubmitting(true);
    try {
      const order = await api.placeOrder({
        location_id: cafe.id,
        table_id: tableId,
        customer_name: name,
        customer_phone: phone,
        note,
        items: cart.items.map((c) => ({ menu_item_id: c.menu_item_id, quantity: c.quantity })),
      });
      navigate(`/${cafe.id}/pay/${order.id}`);
    } catch (e) {
      setErr(e.message);
      setSubmitting(false);
    }
  };

  return (
    <>
      <header className="app-header">
        <Link to={menuPath} className="link-btn">Back</Link>
        <div className="app-title">Review order · {cafe.name}</div>
        <span style={{ width: 60 }} />
      </header>

      <main className="page">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Items</h3>
          {cart.items.map((it) => (
            <div className="cart-row" key={it.menu_item_id}>
              <div className="name">
                <div>{it.name}</div>
                <small style={{ color: 'var(--muted)' }}>
                  {formatRupees(it.price_paise)} x {it.quantity}
                  {Number(it.tax_percent ?? 5) > 0 ? `, tax ${Number(it.tax_percent ?? 5)}%` : ', no tax'}
                </small>
              </div>
              <div className="qty-pill">
                <button onClick={() => cart.setQty(it.menu_item_id, it.quantity - 1)}>-</button>
                <span className="qty">{it.quantity}</span>
                <button onClick={() => cart.setQty(it.menu_item_id, it.quantity + 1)}>+</button>
              </div>
              <div className="price">{formatRupees(it.price_paise * it.quantity)}</div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem' }}>
            <span>Subtotal</span><span>{formatRupees(cart.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tax</span><span>{formatRupees(cart.tax)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: '0.5rem', fontSize: '1.1rem' }}>
            <span>Total</span><span>{formatRupees(cart.total)}</span>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your details</h3>
          <label><span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
          </label>
          <label><span>Phone</span>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" inputMode="tel" />
          </label>
          <label><span>Note for the kitchen</span>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. less spicy" />
          </label>
          {tableId && (
            <p style={{ color: 'var(--muted)', marginTop: '0.75rem' }}>
              Table: <strong>{tableId}</strong>
            </p>
          )}
        </div>

        {err && <p style={{ color: '#c92a2a' }}>{err}</p>}

        <button className="btn full" disabled={submitting} onClick={placeOrder}>
          {submitting ? 'Placing order...' : `Proceed to pay ${formatRupees(cart.total)}`}
        </button>
      </main>
    </>
  );
}
