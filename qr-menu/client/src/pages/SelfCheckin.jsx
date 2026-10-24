import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { shortDate } from '../dates.js';
import { shrinkPhoto } from '../photos.js';
import BrandLogo from '../components/BrandLogo.jsx';

const blank = (info) => ({
  guest_name: '',
  coming_from: '',
  booked_through: info?.booked_through || '',
  check_out_date: info?.check_out || '',
  check_out_time: '',
  phone: '',
  email: '',
  vehicle: '',
});

function IdPhoto({ label, hint, value, onChange, required }) {
  const [err, setErr] = useState('');
  return (
    <div className="id-photo">
      <span className="id-photo-label">{label}{required && <span aria-hidden="true"> *</span>}</span>
      {value ? (
        <div className="id-photo-preview">
          <img src={value} alt={`${label} preview`} />
          <button type="button" className="link-btn" onClick={() => onChange('')}>Retake</button>
        </div>
      ) : (
        <label className="id-photo-pick">
          <input
            type="file"
            accept="image/*"
            aria-label={label}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setErr('');
              try {
                onChange(await shrinkPhoto(file));
              } catch (e2) {
                setErr(e2.message);
              }
            }}
          />
          <span>Take or choose a photo</span>
          <small>{hint}</small>
        </label>
      )}
      {err && <small style={{ color: '#c92a2a' }}>{err}</small>}
    </div>
  );
}

export default function SelfCheckin() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [form, setForm] = useState(blank());
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { name, room, checked_in, guests }

  useEffect(() => {
    api
      .getCheckin(token)
      .then((d) => {
        setInfo(d);
        setForm(blank(d));
      })
      .catch((e) => setLoadErr(e.message));
  }, [token]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!front) return setErr('Please add a photo of your ID.');
    setBusy(true);
    try {
      const r = await api.submitCheckin(token, { ...form, id_front: front, id_back: back || undefined });
      setDone({ name: form.guest_name, ...r });
      setInfo((i) => ({ ...i, checked_in: r.checked_in }));
      window.scrollTo(0, 0);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const nextGuest = () => {
    setDone(null);
    setForm(blank(info));
    setFront('');
    setBack('');
    window.scrollTo(0, 0);
  };

  if (loadErr) {
    return (
      <main className="page checkin-page">
        <BrandLogo />
        <div className="card"><p style={{ margin: 0 }}>{loadErr}</p></div>
      </main>
    );
  }
  if (!info) return <main className="page checkin-page"><p>Loading…</p></main>;

  const full = info.checked_in >= info.guests;

  if (done) {
    const left = done.guests - done.checked_in;
    return (
      <main className="page checkin-page">
        <BrandLogo />
        <div className="success-card" data-checkin-done="">
          <div className="checkmark">✓</div>
          <h2 style={{ margin: '0.25rem 0' }}>You’re checked in, {done.name.split(' ')[0]}!</h2>
          <p>Your room: <strong>{done.room}</strong></p>
          <p style={{ color: 'var(--muted)' }}>
            Say hi at reception to collect your key. The cafe’s open, so go grab a bite.
          </p>
          {left > 0 && (
            <div className="card" style={{ textAlign: 'left' }}>
              <p style={{ marginTop: 0 }}>
                {done.checked_in} of {done.guests} guests checked in. Each guest fills this in once, on their phone or this one.
              </p>
              <button type="button" className="btn" onClick={nextGuest}>Check in the next guest</button>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="page checkin-page">
      <BrandLogo />
      <h1 className="checkin-title">The “Skip the Line” Check-in</h1>
      <p className="checkin-intro">
        <strong>Welcome to the Misfits family!</strong> We know you’d rather be dropping your bags and grabbing a bite at the
        cafe or exploring the mountains than doing paperwork. Fill this out, and we’ll get you straight to the good stuff.
      </p>

      <div className="card checkin-stay">
        <div><small>Stay</small><strong>Misfits {info.property}</strong></div>
        <div><small>Room</small><strong data-checkin-room="">{info.room || 'Reception will assign it'}</strong></div>
        <div><small>Dates</small><strong>{shortDate(info.check_in)} → {shortDate(info.check_out)}</strong></div>
        {info.guests > 1 && (
          <div><small>Guests checked in</small><strong>{info.checked_in} of {info.guests}</strong></div>
        )}
      </div>

      {full ? (
        <div className="card"><p style={{ margin: 0 }}>Everyone on this booking has checked in. If someone’s missing, please ask at reception.</p></div>
      ) : (
        <form className="card checkin-form" onSubmit={submit}>
          {info.guests > 1 && (
            <p className="notice" style={{ marginTop: 0 }}>
              Guest {info.checked_in + 1} of {info.guests}: each guest fills this in for themselves.
            </p>
          )}
          <label><span>Name (as on your government ID) *</span>
            <input className="input" name="guest_name" autoComplete="name" value={form.guest_name} onChange={set('guest_name')} required />
          </label>
          <label><span>Coming from *</span>
            <input className="input" name="coming_from" placeholder="City, country" value={form.coming_from} onChange={set('coming_from')} required />
          </label>
          <label><span>Booked through *</span>
            <select className="select" name="booked_through" value={form.booked_through} onChange={set('booked_through')} required>
              <option value="">Choose…</option>
              {info.booked_through_options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <div className="row">
            <label><span>Check-out date *</span>
              <input className="input" type="date" name="check_out_date" min={info.check_in} value={form.check_out_date} onChange={set('check_out_date')} required />
            </label>
            <label><span>Check-out time *</span>
              <input className="input" type="time" name="check_out_time" value={form.check_out_time} onChange={set('check_out_time')} required />
            </label>
          </div>
          <label><span>Phone / WhatsApp number *</span>
            <input className="input" type="tel" inputMode="tel" name="phone" autoComplete="tel" value={form.phone} onChange={set('phone')} required />
          </label>
          <label><span>Email *</span>
            <input className="input" type="email" name="email" autoComplete="email" value={form.email} onChange={set('email')} required />
          </label>

          <div className="id-photos">
            <span className="id-photos-title">Government-approved ID (both sides)</span>
            <IdPhoto label="Front" hint="Aadhaar, passport, driving licence or voter ID" value={front} onChange={setFront} required />
            <IdPhoto label="Back" hint="Skip for a passport photo page" value={back} onChange={setBack} />
            <small style={{ color: 'var(--muted)' }}>
              Only Misfits staff can see your ID, and it’s deleted automatically a year after your stay.
            </small>
          </div>

          <label><span>Vehicle details (if any)</span>
            <input className="input" name="vehicle" placeholder="e.g. HP 01 AB 1234, scooter" value={form.vehicle} onChange={set('vehicle')} />
          </label>

          {err && <p style={{ color: '#c92a2a' }} role="alert">{err}</p>}
          <button className="btn checkin-submit" type="submit" disabled={busy}>{busy ? 'Checking you in…' : 'Check in'}</button>
        </form>
      )}
    </main>
  );
}
