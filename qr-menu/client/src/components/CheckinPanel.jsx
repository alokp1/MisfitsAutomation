import { useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { shortDate } from '../dates.js';

const when = (sqlUtc) =>
  new Date(sqlUtc.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// wa.me wants the number with its country code; 10-digit numbers are Indian.
const waNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
};

// Self check-in for one booking: the guest's link (WhatsApp, copy, QR at the desk) and what guests sent.
export default function CheckinPanel({ booking, propertyName, roomsAssigned }) {
  const [data, setData] = useState(null); // { link, checkins }
  const [link, setLink] = useState(null); // { url, qr }
  const [copied, setCopied] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [err, setErr] = useState('');

  const load = () => adminApi.listCheckins(booking.id).then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  const getLink = async () => {
    setErr('');
    try {
      setLink(await adminApi.checkinLink(booking.id));
    } catch (e) {
      setErr(e.message);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Couldn’t copy. Press and hold the link to copy it.');
    }
  };

  const view = async (c, side) => {
    try {
      setViewing(await adminApi.checkinPhotoUrl(c.id, side));
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (c) => {
    if (!confirm(`Remove ${c.guest_name}'s check-in? Their ID photos are deleted too.`)) return;
    try {
      await adminApi.deleteCheckin(c.id);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  if (!data) return err ? <p style={{ color: '#c92a2a' }}>{err}</p> : null;
  const done = data.checkins.length;
  const cancelled = booking.status === 'cancelled';
  const message = link
    ? `Hi ${booking.guest_name.split(' ')[0]}, welcome to Misfits ${propertyName}! Skip the line at reception: check in here before you arrive ${link.url}`
    : '';

  return (
    <div className="card checkin-panel" data-checkin-panel="">
      <div className="section-title-row">
        <h3 style={{ margin: 0 }}>Self check-in</h3>
        <span className={`pill ${done >= booking.people ? 'paid' : done ? 'pending' : ''}`}>
          {done} of {booking.people} checked in
        </span>
      </div>

      {!cancelled && done < booking.people && (
        !link ? (
          <>
            <p style={{ color: 'var(--muted)' }}>
              {roomsAssigned
                ? 'Send the guest their check-in link. Each guest on the booking fills it in once.'
                : 'Assign the room first and save; the guest sees it on the form.'}
            </p>
            <button type="button" className="btn" onClick={getLink} disabled={!roomsAssigned}>Get check-in link</button>
          </>
        ) : (
          <div className="checkin-link">
            <img src={link.qr} alt="Check-in QR code" width="180" height="180" />
            <div className="checkin-link-actions">
              <code data-checkin-url="">{link.url}</code>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {booking.guest_phone && (
                  <a className="btn" href={`https://wa.me/${waNumber(booking.guest_phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                    Send on WhatsApp
                  </a>
                )}
                <button type="button" className="btn secondary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
              </div>
              <small style={{ color: 'var(--muted)' }}>At the desk, the guest can scan the QR code with their phone camera.</small>
            </div>
          </div>
        )
      )}

      {data.checkins.map((c) => (
        <div className="checkin-entry" key={c.id} data-checkin-entry="">
          <div className="booking-card-top">
            <strong>{c.guest_name}</strong>
            <small style={{ color: 'var(--muted)' }}>{when(c.created_at)}</small>
          </div>
          <dl className="checkin-details">
            <dt>Room</dt><dd>{c.room}</dd>
            <dt>Coming from</dt><dd>{c.coming_from}</dd>
            <dt>Booked through</dt><dd>{c.booked_through}</dd>
            <dt>Check-out</dt>
            <dd>
              {shortDate(c.check_out_date)} · {c.check_out_time}
              {c.check_out_date !== booking.check_out && (
                <span className="pill pending" style={{ marginLeft: 6 }}>Booking says {shortDate(booking.check_out)}</span>
              )}
            </dd>
            <dt>Phone</dt><dd><a href={`tel:${c.phone}`}>{c.phone}</a></dd>
            <dt>Email</dt><dd>{c.email}</dd>
            {c.vehicle && (<><dt>Vehicle</dt><dd>{c.vehicle}</dd></>)}
          </dl>
          <div style={{ display: 'flex', gap: '0.5rem 0.9rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {c.has_front ? <button type="button" className="link-btn" onClick={() => view(c, 'front')}>ID front</button> : <small>ID photos deleted</small>}
            {c.has_back ? <button type="button" className="link-btn" onClick={() => view(c, 'back')}>ID back</button> : null}
            <button type="button" className="link-btn danger" onClick={() => remove(c)}>Remove</button>
          </div>
        </div>
      ))}

      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
      {viewing && (
        <div className="drawer-backdrop" onClick={() => { URL.revokeObjectURL(viewing); setViewing(null); }}>
          <img className="bill-full" src={viewing} alt="Guest ID" />
        </div>
      )}
    </div>
  );
}
