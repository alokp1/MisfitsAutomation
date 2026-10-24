import { useEffect, useRef, useState } from 'react';
import { adminApi, formatRupees } from '../api.js';
import { useAdminLocation, useLocations } from '../locations.jsx';

const empty = {
  id: null,
  category_id: '',
  name: '',
  description: '',
  price_rupees: '',
  tax_percent: '5',
  is_veg: 1,
  is_available: 1,
  image_url: '',
};

export default function AdminMenu() {
  const { location } = useAdminLocation();
  const { locations, byId } = useLocations();
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState(empty);
  const [newCat, setNewCat] = useState('');
  const [err, setErr] = useState('');

  // Ignore responses for a cafe the admin has already switched away from.
  const currentLocation = useRef(location);
  currentLocation.current = location;

  const refresh = async () => {
    if (location === 'all') return;
    const requested = location;
    setErr('');
    try {
      const [m, c] = await Promise.all([adminApi.listMenu(requested), adminApi.listCategories(requested)]);
      if (currentLocation.current !== requested) return;
      setItems(m);
      setCats(c);
      setLoaded(true);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    setItems([]);
    setCats([]);
    setLoaded(false);
    setDraft(empty);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const copyFrom = async (from) => {
    if (!confirm(`Copy every category and item from ${byId[from].name} into ${byId[location].name}?`)) return;
    setErr('');
    try {
      await adminApi.copyMenu(from, location);
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const save = async () => {
    setErr('');
    const body = {
      category_id: draft.category_id ? Number(draft.category_id) : null,
      name: draft.name,
      description: draft.description,
      price_paise: Math.round(Number(draft.price_rupees || 0) * 100),
      tax_percent: Number(draft.tax_percent || 0),
      is_veg: draft.is_veg ? 1 : 0,
      is_available: draft.is_available ? 1 : 0,
      image_url: draft.image_url,
    };
    try {
      if (draft.id) {
        await adminApi.updateMenuItem(draft.id, body);
      } else {
        await adminApi.createMenuItem({ ...body, location_id: location });
      }
      setDraft(empty);
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const edit = (it) =>
    setDraft({
      id: it.id,
      category_id: it.category_id || '',
      name: it.name,
      description: it.description,
      price_rupees: (it.price_paise / 100).toString(),
      tax_percent: (it.tax_percent ?? 5).toString(),
      is_veg: it.is_veg,
      is_available: it.is_available,
      image_url: it.image_url || '',
    });

  const del = async (id) => {
    if (!confirm('Delete this item?')) return;
    await adminApi.deleteMenuItem(id);
    refresh();
  };

  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCat.trim()) return;
    try {
      await adminApi.createCategory({ location_id: location, name: newCat.trim() });
      setNewCat('');
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const delCategory = async (id) => {
    if (!confirm('Delete this category? Items in it will become uncategorised.')) return;
    await adminApi.deleteCategory(id);
    refresh();
  };

  if (location === 'all') {
    return (
      <div>
        <h1>Menu management</h1>
        <div className="card">
          <p style={{ margin: 0 }}>Each cafe has its own menu. Pick a cafe at the top to edit its menu.</p>
        </div>
      </div>
    );
  }

  const cafeName = byId[location]?.name || location;
  const otherCafes = locations.filter((l) => l.id !== location);

  return (
    <div>
      <h1>{cafeName} cafe menu</h1>
      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}

      {loaded && items.length === 0 && cats.length === 0 && otherCafes.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{cafeName}’s menu is empty</h3>
          <p style={{ color: 'var(--muted)' }}>
            Start from another cafe’s menu, then change prices and items here. Changes only affect {cafeName}.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {otherCafes.map((l) => (
              <button key={l.id} className="btn secondary" onClick={() => copyFrom(l.id)}>
                Copy menu from {l.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Categories</h3>
        <form className="row" onSubmit={addCategory}>
          <input
            className="input"
            placeholder="e.g. Starters, Mains, Drinks…"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          />
          <button className="btn" type="submit">Add category</button>
        </form>
        <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {cats.map((c) => (
            <span key={c.id} className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {c.name}
              <button
                className="link-btn"
                style={{ color: '#c92a2a' }}
                onClick={() => delCategory(c.id)}
                title="Delete"
              >×</button>
            </span>
          ))}
          {cats.length === 0 && <span style={{ color: 'var(--muted)' }}>No categories yet.</span>}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{draft.id ? 'Edit item' : 'Add new item'}</h3>
        <div className="row">
          <label style={{ flex: 2 }}><span>Name</span>
            <input className="input" value={draft.name}
                   onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label><span>Price (₹)</span>
            <input className="input" type="number" min="0" step="0.01" value={draft.price_rupees}
                   onChange={(e) => setDraft({ ...draft, price_rupees: e.target.value })} />
          </label>
          <label><span>Tax (%)</span>
            <input className="input" type="number" min="0" step="0.01" value={draft.tax_percent}
                   onChange={(e) => setDraft({ ...draft, tax_percent: e.target.value })} />
          </label>
          <label><span>Category</span>
            <select className="select" value={draft.category_id}
                    onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
              <option value="">— Uncategorised —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label style={{ flex: 3 }}><span>Description</span>
            <input className="input" value={draft.description}
                   onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label style={{ flex: 2 }}><span>Image URL (optional)</span>
            <input className="input" value={draft.image_url}
                   onChange={(e) => setDraft({ ...draft, image_url: e.target.value })} />
          </label>
        </div>
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!draft.is_veg}
                   onChange={(e) => setDraft({ ...draft, is_veg: e.target.checked ? 1 : 0 })} />
            <span style={{ marginTop: 0 }}>Vegetarian</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!draft.is_available}
                   onChange={(e) => setDraft({ ...draft, is_available: e.target.checked ? 1 : 0 })} />
            <span style={{ marginTop: 0 }}>Available</span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
          <button className="btn" onClick={save}>{draft.id ? 'Save changes' : 'Add item'}</button>
          {draft.id && <button className="btn secondary" onClick={() => setDraft(empty)}>Cancel</button>}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>All items ({items.length})</h3>
        {items.length === 0 && <p style={{ color: 'var(--muted)' }}>No items yet — add one above.</p>}
        {items.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>Tax</th>
                <th>Type</th>
                <th>Status</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <strong>{it.name}</strong>
                    {it.description && <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{it.description}</div>}
                  </td>
                  <td>{it.category_name || '—'}</td>
                  <td>{formatRupees(it.price_paise)}</td>
                  <td>{Number(it.tax_percent ?? 5)}%</td>
                  <td>{it.is_veg ? 'Veg' : 'Non-veg'}</td>
                  <td>
                    <span className={`pill ${it.is_available ? 'paid' : 'cancelled'}`}>
                      {it.is_available ? 'Available' : 'Hidden'}
                    </span>
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => edit(it)}>Edit</button>{' '}
                    <button className="link-btn" style={{ color: '#c92a2a' }} onClick={() => del(it.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
