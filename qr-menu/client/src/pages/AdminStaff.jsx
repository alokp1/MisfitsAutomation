import { useEffect, useState } from 'react';
import { adminApi, auth } from '../api.js';
import { useLocations } from '../locations.jsx';

const PIN = /^\d{4,8}$/;

export default function AdminStaff() {
  const { locations } = useLocations();
  const [staff, setStaff] = useState([]);
  const [draft, setDraft] = useState({ name: '', location_id: '', pin: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const isOwner = auth.current()?.role === 'owner';
  const refresh = () => adminApi.listStaff().then(setStaff).catch((e) => setErr(e.message));

  useEffect(() => {
    if (isOwner) refresh();
  }, [isOwner]);

  if (!isOwner) {
    return (
      <div>
        <h1>Managers</h1>
        <div className="card"><p style={{ margin: 0 }}>Only the owner can manage sign-ins.</p></div>
      </div>
    );
  }

  const run = async (fn, done) => {
    setErr('');
    setMsg('');
    try {
      await fn();
      setMsg(done);
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const add = (e) => {
    e.preventDefault();
    const location_id = draft.location_id || locations[0]?.id;
    if (!PIN.test(draft.pin)) return setErr('PIN must be 4 to 8 digits.');
    run(async () => {
      await adminApi.createStaff({ ...draft, location_id });
      setDraft({ name: '', location_id: '', pin: '' });
    }, `${draft.name} can now sign in.`);
  };

  const resetPin = (s) => {
    const pin = prompt(`New PIN for ${s.name} (4 to 8 digits):`);
    if (pin == null) return;
    if (!PIN.test(pin)) return setErr('PIN must be 4 to 8 digits.');
    run(() => adminApi.updateStaff(s.id, { pin }), `${s.name}'s PIN changed. They need to sign in again.`);
  };

  const setActive = (s, active) =>
    run(() => adminApi.updateStaff(s.id, { active }), active ? `${s.name} can sign in again.` : `${s.name} is signed out and can no longer sign in.`);

  return (
    <div>
      <h1>Managers</h1>
      <p style={{ color: 'var(--muted)' }}>
        Each manager signs in with their name and PIN and only sees their own property. You sign in with the owner password and see everything.
      </p>

      <form className="card" onSubmit={add}>
        <h3 style={{ marginTop: 0 }}>Add a manager</h3>
        <div className="row">
          <label><span>Name</span>
            <input className="input" name="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </label>
          <label><span>Property</span>
            <select className="select" name="location_id" value={draft.location_id || locations[0]?.id || ''} onChange={(e) => setDraft({ ...draft, location_id: e.target.value })}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label><span>PIN (4–8 digits)</span>
            <input className="input" name="pin" inputMode="numeric" pattern="[0-9]*" maxLength={8} value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '') })} required />
          </label>
          <button className="btn" type="submit" style={{ flex: '0 0 auto' }}>Add</button>
        </div>
      </form>

      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {msg && <p className="notice ok">{msg}</p>}

      <div className="card">
        {staff.length === 0 ? (
          <p style={{ color: 'var(--muted)', margin: 0 }}>No managers yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Property</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {staff.map((s) => {
                const locked = s.locked_until && new Date(s.locked_until) > new Date();
                return (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{s.location_name}</td>
                    <td>
                      <span className={`pill ${s.active ? 'paid' : 'cancelled'}`}>{s.active ? 'Active' : 'Deactivated'}</span>{' '}
                      {locked && <span className="pill pending">Locked: too many wrong PINs</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="link-btn" onClick={() => resetPin(s)}>New PIN</button>{' '}
                      {s.active ? (
                        <button type="button" className="link-btn" style={{ color: '#c92a2a' }} onClick={() => setActive(s, false)}>Deactivate</button>
                      ) : (
                        <button type="button" className="link-btn" onClick={() => setActive(s, true)}>Reactivate</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
