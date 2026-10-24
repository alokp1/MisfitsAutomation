import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { adminApi, auth } from '../api.js';
import BrandLogo from '../components/BrandLogo.jsx';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [staff, setStaff] = useState(null); // null while loading
  const [ownerMode, setOwnerMode] = useState(false);
  const [staffId, setStaffId] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi
      .staffNames()
      .then((list) => {
        setStaff(list);
        if (list.length === 0) setOwnerMode(true);
        else setStaffId(String(list[0].id));
      })
      .catch(() => {
        setStaff([]);
        setOwnerMode(true);
      });
  }, []);

  const home = (who) => (who?.role === 'owner' ? '/admin/dashboard' : '/admin/bookings');
  if (auth.current()) return <Navigate to={home(auth.current())} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (ownerMode) {
        auth.setOwner(secret);
        try {
          await adminApi.ping();
        } catch {
          auth.clear();
          throw new Error('Incorrect password.');
        }
      } else {
        const { token, staff: who } = await adminApi.login(Number(staffId), secret);
        auth.setManager(token, who);
      }
      navigate(home(auth.current()), { replace: true });
    } catch (e2) {
      setErr(e2.message);
      setSecret('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" style={{ marginTop: '3rem' }}>
      <div className="card" style={{ maxWidth: 380, margin: '0 auto' }}>
        <BrandLogo subtitle="Staff sign-in" />
        <h2 style={{ marginTop: 0 }}>{ownerMode ? 'Owner sign-in' : 'Manager sign-in'}</h2>
        {staff === null ? (
          <p>Loading…</p>
        ) : (
          <form onSubmit={submit}>
            {ownerMode ? (
              <label><span>Owner password</span>
                <input
                  className="input"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoFocus
                />
              </label>
            ) : (
              <>
                <label><span>Your name</span>
                  <select className="select" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} — {s.location_name}</option>
                    ))}
                  </select>
                </label>
                <label><span>PIN</span>
                  <input
                    className="input pin-input"
                    type="password"
                    name="pin"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="current-password"
                    maxLength={8}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </label>
              </>
            )}
            {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
            <button className="btn full" type="submit" disabled={busy || !secret} style={{ marginTop: '0.75rem' }}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            {staff.length > 0 && (
              <button
                type="button"
                className="link-btn"
                style={{ marginTop: '0.75rem', width: '100%' }}
                onClick={() => {
                  setOwnerMode(!ownerMode);
                  setSecret('');
                  setErr('');
                }}
              >
                {ownerMode ? 'I’m a property manager' : 'Owner? Sign in with the password'}
              </button>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
