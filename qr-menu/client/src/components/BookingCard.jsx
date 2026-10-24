import { Link } from 'react-router-dom';
import { formatRupees } from '../api.js';
import { nightsBetween, shortDate, todayISO } from '../dates.js';

export const SOURCES = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'website', label: 'Website' },
  { value: 'phone', label: 'Phone' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'ota', label: 'OTA' },
  { value: 'other', label: 'Other' },
];

export const PAYMENT_MODES = [
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'prepaid', label: 'Prepaid' },
  { value: 'pending', label: 'To collect' },
];

export const OTAS = ['Booking.com', 'MMT', 'GoIbibo', 'Agoda', 'Hostelworld', 'Airbnb'];

const labelOf = (list, value) => list.find((x) => x.value === value)?.label || value;

// "G1 · beds 1, 2 · Snape's"
export function unitSummary(units) {
  const byRoom = new Map();
  for (const u of units) {
    if (!byRoom.has(u.code)) byRoom.set(u.code, []);
    if (u.bed != null) byRoom.get(u.code).push(u.bed);
  }
  return [...byRoom.entries()]
    .map(([code, beds]) => (beds.length ? `${code} · bed${beds.length > 1 ? 's' : ''} ${beds.join(', ')}` : code))
    .join(' · ');
}

export default function BookingCard({ booking: b }) {
  const nights = nightsBetween(b.check_in, b.check_out);
  return (
    <Link to={`/admin/bookings/${b.id}`} className={`card booking-card ${b.status === 'cancelled' ? 'is-cancelled' : ''}`}>
      <div className="booking-card-top">
        <strong>{b.guest_name}</strong>
        <span className="booking-amount">{formatRupees(b.amount_paise)}</span>
      </div>
      <div className="booking-units">{unitSummary(b.units) || 'No room assigned'}</div>
      <div className="booking-meta">
        {shortDate(b.check_in)} → {shortDate(b.check_out)} · {nights} night{nights === 1 ? '' : 's'} · {b.people}{' '}
        guest{b.people === 1 ? '' : 's'}
      </div>
      <div className="booking-pills">
        {b.status === 'cancelled' && <span className="pill cancelled">Cancelled</span>}
        {b.status !== 'cancelled' && !b.imported && (b.checked_in > 0 || b.check_in <= todayISO()) && (
          <span className={`pill ${b.checked_in >= b.people ? 'paid' : 'pending'}`} data-checkin-pill="">
            {b.checked_in >= b.people ? 'Checked in' : b.checked_in ? `${b.checked_in}/${b.people} checked in` : 'Not checked in'}
          </span>
        )}
        <span className={`pill ${b.payment_mode === 'pending' ? 'pending' : 'paid'}`}>{labelOf(PAYMENT_MODES, b.payment_mode)}</span>
        <span className="pill">{b.source === 'ota' && b.ota ? b.ota : labelOf(SOURCES, b.source)}</span>
        {b.guest_phone && <span className="pill">{b.guest_phone}</span>}
      </div>
    </Link>
  );
}
