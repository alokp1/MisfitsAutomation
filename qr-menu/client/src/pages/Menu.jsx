import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatRupees } from '../api.js';
import { tableIdKey, useCart } from '../store.jsx';
import { useCafe } from '../locations.jsx';
import BrandLogo from '../components/BrandLogo.jsx';
import CartDrawer from '../components/CartDrawer.jsx';

export default function Menu() {
  const [params] = useSearchParams();
  const tableId = params.get('table') || '';
  const cafe = useCafe();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [activeCat, setActiveCat] = useState('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const cart = useCart();

  // Persist tableId so it travels through checkout
  useEffect(() => {
    if (tableId) localStorage.setItem(tableIdKey(cafe.id), tableId);
  }, [cafe.id, tableId]);

  useEffect(() => {
    api
      .getMenu(cafe.id)
      .then((data) => setItems(data))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [cafe.id]);

  const grouped = useMemo(() => {
    const g = {};
    for (const it of items) {
      const key = it.category_name || 'Other';
      (g[key] ||= []).push(it);
    }
    return g;
  }, [items]);

  const cats = ['all', ...Object.keys(grouped)];
  const visibleCats = activeCat === 'all' ? Object.keys(grouped) : [activeCat];
  const categoryCount = Object.keys(grouped).length;

  const findInCart = (id) => cart.items.find((c) => c.menu_item_id === id);

  return (
    <>
      <header className="app-header">
        <BrandLogo subtitle={tableId ? `${cafe.name} · Table ${tableId}` : `${cafe.name} cafe`} />
        <button className="cart-btn" onClick={() => setDrawerOpen(true)}>
          Cart
          {cart.totalCount > 0 && <span className="badge">{cart.totalCount}</span>}
        </button>
      </header>

      <main className="page">
        <section className="menu-hero">
          <div className="menu-hero-copy">
            <span className="hero-kicker">
              {tableId ? `${cafe.name} · Table ${tableId}` : `MISFITS ${cafe.name}`}
            </span>
            <h1>Order from the MISFITS {cafe.name} menu</h1>
            <div className="hero-stats">
              <span>{loading ? 'Loading menu' : `${items.length} items`}</span>
              <span>{loading ? 'Categories' : `${categoryCount} categories`}</span>
              <span>{cart.totalCount ? `${cart.totalCount} in cart` : 'Freshly prepared'}</span>
            </div>
          </div>
          <div className="menu-hero-video" aria-hidden="true">
            <video
              src={`${import.meta.env.BASE_URL}misfits-logo-animated.mp4`}
              poster={`${import.meta.env.BASE_URL}misfits-logo.jpeg`}
              autoPlay
              muted
              loop
              playsInline
            />
          </div>
        </section>
        {loading && <p>Loading menu…</p>}
        {err && <p style={{ color: '#c92a2a' }}>Couldn’t load menu: {err}</p>}

        {!loading && items.length === 0 && (
          <div className="card">
            <strong>No items on the menu yet.</strong>
            <p style={{ color: 'var(--muted)' }}>
              Ask the restaurant to add items via the admin panel at{' '}
              <a href={`${import.meta.env.BASE_URL}admin`}>{import.meta.env.BASE_URL}admin</a>.
            </p>
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="cat-tabs">
              {cats.map((c) => (
                <button
                  key={c}
                  className={c === activeCat ? 'active' : ''}
                  onClick={() => setActiveCat(c)}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>

            {visibleCats.map((catName) => (
              <section className="cat-section" key={catName}>
                <h2>{catName}</h2>
                {grouped[catName].map((it) => {
                  const inCart = findInCart(it.id);
                  return (
                    <div className="item-card" key={it.id}>
                      <div className="item-info">
                        <div className="item-name">
                          <span className={it.is_veg ? 'veg-dot' : 'nonveg-dot'} />
                          {it.name}
                        </div>
                        {it.description && <div className="item-desc">{it.description}</div>}
                        <div className="item-price">
                          {formatRupees(it.price_paise)}
                          {Number(it.tax_percent ?? 5) > 0 && (
                            <small className="item-tax">+ {Number(it.tax_percent ?? 5)}% tax</small>
                          )}
                        </div>
                      </div>
                      {it.image_url && (
                        <img className="item-photo" src={it.image_url} alt="" loading="lazy" />
                      )}
                      {inCart ? (
                        <div className="qty-pill">
                          <button onClick={() => cart.setQty(it.id, inCart.quantity - 1)}>−</button>
                          <span className="qty">{inCart.quantity}</span>
                          <button onClick={() => cart.setQty(it.id, inCart.quantity + 1)}>+</button>
                        </div>
                      ) : (
                        <button className="add-btn" onClick={() => cart.add(it)}>
                          Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </>
        )}
      </main>

      <CartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
