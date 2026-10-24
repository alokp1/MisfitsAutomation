import { useNavigate } from 'react-router-dom';
import { useCart } from '../store.jsx';
import { useCafe } from '../locations.jsx';
import { formatRupees } from '../api.js';

export default function CartDrawer({ open, onClose }) {
  const { items, setQty, remove, subtotal, tax, total, totalCount } = useCart();
  const cafe = useCafe();
  const navigate = useNavigate();

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <strong>Your Order ({totalCount})</strong>
          <button className="link-btn" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          {items.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>Your cart is empty. Tap “Add” on any item.</p>
          ) : (
            items.map((it) => (
              <div className="cart-row" key={it.menu_item_id}>
                <div className="name">
                  <div>{it.name}</div>
                  <small style={{ color: 'var(--muted)' }}>
                    {formatRupees(it.price_paise)} each
                  </small>
                </div>
                <div className="qty-pill">
                  <button onClick={() => setQty(it.menu_item_id, it.quantity - 1)}>−</button>
                  <span className="qty">{it.quantity}</span>
                  <button onClick={() => setQty(it.menu_item_id, it.quantity + 1)}>+</button>
                </div>
                <div className="price">{formatRupees(it.price_paise * it.quantity)}</div>
                <button
                  className="link-btn"
                  style={{ color: '#c92a2a' }}
                  onClick={() => remove(it.menu_item_id)}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
        <div className="drawer-foot">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span>Subtotal</span>
            <strong>{formatRupees(subtotal)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span>Tax</span>
            <strong>{formatRupees(tax)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span>Total</span>
            <strong>{formatRupees(total)}</strong>
          </div>
          <button
            className="btn full"
            disabled={items.length === 0}
            onClick={() => {
              onClose();
              navigate(`/${cafe.id}/checkout`);
            }}
          >
            Review & Checkout
          </button>
        </div>
      </div>
    </div>
  );
}
