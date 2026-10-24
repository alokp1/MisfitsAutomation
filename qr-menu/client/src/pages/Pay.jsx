import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { api, formatRupees } from '../api.js';
import { useCart } from '../store.jsx';
import { useCafe } from '../locations.jsx';

// Razorpay test mode supports UPI, Cards, Netbanking, Wallets — Checkout shows them all.
// `method` lets us bias the UI; the user can still pick another method inside Checkout.
const METHODS = [
  { key: 'upi',        label: 'UPI',         hint: 'GPay, PhonePe, Paytm, BHIM' },
  { key: 'card',       label: 'Card',        hint: 'Credit / Debit card' },
  { key: 'netbanking', label: 'Netbanking',  hint: 'All major banks' },
  { key: 'wallet',     label: 'Wallets',     hint: 'Paytm, Mobikwik, etc.' },
];

export default function Pay() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const cafe = useCafe();
  const [order, setOrder] = useState(null);
  const [chosen, setChosen] = useState('upi');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getOrder(orderId).then(setOrder).catch((e) => setErr(e.message));
  }, [orderId]);

  const startPayment = async () => {
    setErr('');
    setBusy(true);
    try {
      if (!window.Razorpay) {
        throw new Error('Razorpay script failed to load. Check your internet connection.');
      }
      const rzpOrder = await api.createRzpOrder(Number(orderId));

      const opts = {
        key: rzpOrder.key_id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        order_id: rzpOrder.razorpay_order_id,
        name: 'MISFITS Hostel & Cafe',
        description: `Order #${orderId} · ${cafe.name} cafe`,
        method: { [chosen]: true }, // Bias UI to chosen method; others remain available
        prefill: {
          name: order?.customer_name || '',
          contact: order?.customer_phone || '',
        },
        theme: { color: '#d9480f' },
        handler: async (response) => {
          try {
            await api.verifyPayment({
              order_id: Number(orderId),
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              method: chosen,
            });
            cart.clear();
            navigate(`/${cafe.id}/order/${orderId}`);
          } catch (e) {
            setErr('Payment verification failed: ' + e.message);
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      };
      const rzp = new window.Razorpay(opts);
      rzp.on('payment.failed', (resp) => {
        setErr(resp.error?.description || 'Payment failed');
        setBusy(false);
      });
      rzp.open();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  if (err && !order) {
    return (
      <main className="page">
        <p style={{ color: '#c92a2a' }}>{err}</p>
        <Link to={`/${cafe.id}/menu`} className="btn secondary">Back to menu</Link>
      </main>
    );
  }
  if (!order) return <main className="page"><p>Loading…</p></main>;
  // Order opened under another cafe's URL: move there so the right cart gets cleared.
  if (order.location_id !== cafe.id) return <Navigate to={`/${order.location_id}/pay/${order.id}`} replace />;

  return (
    <>
      <header className="app-header">
        <Link to={`/${cafe.id}/checkout`} className="link-btn">← Back</Link>
        <div className="app-title">Payment</div>
        <span style={{ width: 60 }} />
      </header>
      <main className="page">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.2rem' }}>
            <span>Total payable</span>
            <span>{formatRupees(order.total_paise)}</span>
          </div>
          <small style={{ color: 'var(--muted)' }}>
            Order #{order.id} • {cafe.name}{order.table_id ? ` • Table ${order.table_id}` : ''}
          </small>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Choose a payment method</h3>
          {METHODS.map((m) => (
            <label
              key={m.key}
              style={{
                display: 'flex', gap: '0.6rem', alignItems: 'center',
                padding: '0.7rem 0.5rem', borderRadius: 8,
                border: '1px solid ' + (chosen === m.key ? 'var(--primary)' : 'var(--border)'),
                marginBottom: '0.4rem', background: chosen === m.key ? '#fff7f0' : '#fff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="paymethod"
                value={m.key}
                checked={chosen === m.key}
                onChange={() => setChosen(m.key)}
              />
              <span style={{ fontWeight: 600 }}>{m.label}</span>
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>— {m.hint}</span>
            </label>
          ))}
        </div>

        {err && <p style={{ color: '#c92a2a' }}>{err}</p>}

        <button className="btn full" disabled={busy} onClick={startPayment}>
          {busy ? 'Opening secure checkout…' : `Pay ${formatRupees(order.total_paise)}`}
        </button>
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'center' }}>
          Secured by Razorpay. In test mode, no real money will be charged.
        </p>
      </main>
    </>
  );
}
