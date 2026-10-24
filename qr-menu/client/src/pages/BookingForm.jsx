import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { adminApi, formatRupees } from '../api.js';
import { addDays, nightsBetween, todayISO } from '../dates.js';
import { useAdminLocation, useLocations } from '../locations.jsx';
import Chips from '../components/Chips.jsx';
import CheckinPanel from '../components/CheckinPanel.jsx';
import { OTAS, PAYMENT_MODES, SOURCES } from '../components/BookingCard.jsx';

// A selected unit is "roomId:bed", or "roomId:" for the whole room.
const unitKey = (roomId, bed) => `${roomId}:${bed ?? ''}`;
const parseKey = (key) => {
  const [room, bed] = key.split(':');
  return { room_id: Number(room), bed: bed === '' ? null : Number(bed) };
};

const OFFLINE_SOURCES = new Set(['walk_in', 'website', 'phone', 'instagram', 'other']);

export default function BookingForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { location } = useAdminLocation();
  const { byId } = useLocations();

  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : todayISO();
  const [form, setForm] = useState({
    guest_name: '',
    guest_phone: '',
    check_in: startDate,
    check_out: addDays(startDate, 1),
    source: 'walk_in',
    ota: '',
    payment_mode: 'upi',
    amount: '',
    notes: '',
  });
  const [people, setPeople] = useState(1);
  const [peopleTouched, setPeopleTouched] = useState(false);
  const [rates, setRates] = useState(null); // rate_key -> paise per night
  // The amount follows the room rates until someone types their own (or an existing booking's).
  const [amountTouched, setAmountTouched] = useState(editing);
  const [selected, setSelected] = useState(new Set());
  const [booking, setBooking] = useState(null); // when editing
  const [bookingLocation, setBookingLocation] = useState(editing ? '' : location);
  const [rooms, setRooms] = useState([]);
  const [taken, setTaken] = useState([]);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const datesValid = form.check_in && form.check_out && form.check_out > form.check_in;
  const nights = datesValid ? nightsBetween(form.check_in, form.check_out) : 0;

  // Editing: load the booking; it decides which property's rooms to show.
  useEffect(() => {
    if (!editing) return;
    adminApi
      .getBooking(id)
      .then((b) => {
        setBooking(b);
        setBookingLocation(b.location_id);
        setForm({
          guest_name: b.guest_name,
          guest_phone: b.guest_phone,
          check_in: b.check_in,
          check_out: b.check_out,
          source: b.source,
          ota: b.ota,
          payment_mode: b.payment_mode,
          amount: String(b.amount_paise / 100),
          notes: b.notes,
        });
        setPeople(b.people);
        setPeopleTouched(true);
        setSelected(new Set(b.units.map((u) => unitKey(u.room_id, u.bed))));
      })
      .catch((e) => setErr(e.message));
  }, [editing, id]);

  // New booking: follow the owner's property switcher, starting the bed picks over.
  useEffect(() => {
    if (editing) return;
    setBookingLocation(location);
    setSelected(new Set());
  }, [editing, location]);

  useEffect(() => {
    if (!bookingLocation || bookingLocation === 'all') return;
    adminApi.listRooms(bookingLocation).then(setRooms).catch((e) => setErr(e.message));
    adminApi
      .getRates(bookingLocation)
      .then((d) => setRates(Object.fromEntries(d.rates.filter((r) => r.amount_paise != null).map((r) => [r.rate_key, r.amount_paise]))))
      .catch(() => setRates({}));
  }, [bookingLocation]);

  // What's already taken on these dates (excluding this booking when editing).
  useEffect(() => {
    if (!bookingLocation || bookingLocation === 'all' || !datesValid) return;
    adminApi
      .getOccupancy(bookingLocation, form.check_in, form.check_out, editing ? id : undefined)
      .then(setTaken)
      .catch((e) => setErr(e.message));
  }, [bookingLocation, form.check_in, form.check_out, datesValid, editing, id]);

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  // Who holds a unit on these dates: the whole room's holder, or the bed's.
  const holderOf = (room, bed) => {
    const hits = taken.filter((t) => t.room_id === room.id && (t.bed == null || bed == null || t.bed === bed));
    return hits.length ? hits[0].guest_name : null;
  };

  // Changing dates can make a picked bed unavailable: drop it and say so.
  useEffect(() => {
    if (!rooms.length) return;
    const dropped = [];
    const next = new Set();
    for (const key of selected) {
      const { room_id, bed } = parseKey(key);
      const room = roomById.get(room_id);
      if (room && holderOf(room, bed)) dropped.push(bed == null ? room.code : `${room.code} bed ${bed}`);
      else next.add(key);
    }
    if (dropped.length) {
      setSelected(next);
      setNotice(`Removed ${dropped.join(', ')} — already booked on the new dates.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taken, rooms]);

  // Guests follow the picked beds until someone types a number.
  const suggestedPeople = useMemo(() => {
    let n = 0;
    for (const key of selected) {
      const { room_id, bed } = parseKey(key);
      const room = roomById.get(room_id);
      if (!room) continue;
      n += room.kind === 'private' ? 2 : bed == null ? room.beds : 1;
    }
    return Math.max(1, n);
  }, [selected, roomById]);
  const guests = peopleTouched ? people : suggestedPeople;

  // Price from Room rates: dorm beds at the dorm rate, private rooms at their type's rate.
  const suggestion = useMemo(() => {
    if (!rates || !nights || selected.size === 0) return null;
    let beds = 0;
    const privates = new Map(); // room type -> count
    for (const key of selected) {
      const { room_id, bed } = parseKey(key);
      const room = roomById.get(room_id);
      if (!room) return null;
      if (room.kind === 'dorm') beds += bed == null ? room.beds : 1;
      else privates.set(room.room_type, (privates.get(room.room_type) || 0) + 1);
    }
    if (beds && rates.dorm == null) return null;
    for (const type of privates.keys()) if (rates[type] == null) return null;
    const parts = [];
    let perNight = 0;
    if (beds) {
      perNight += beds * rates.dorm;
      parts.push(`${beds} dorm bed${beds === 1 ? '' : 's'} × ${formatRupees(rates.dorm)}`);
    }
    for (const [type, n] of privates) {
      perNight += n * rates[type];
      parts.push(`${n > 1 ? `${n} × ` : ''}${type} ${formatRupees(rates[type])}`);
    }
    return { total: perNight * nights, text: `${parts.join(' + ')}, × ${nights} night${nights === 1 ? '' : 's'}` };
  }, [rates, selected, roomById, nights]);

  useEffect(() => {
    if (amountTouched) return;
    setForm((f) => ({ ...f, amount: suggestion ? String(suggestion.total / 100) : '' }));
  }, [suggestion, amountTouched]);

  const toggle = (room, bed) => {
    setNotice('');
    setSelected((prev) => {
      const next = new Set(prev);
      const key = unitKey(room.id, bed);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Whole room and individual beds of the same room are mutually exclusive.
        for (const k of [...next]) {
          const u = parseKey(k);
          if (u.room_id === room.id && (bed == null || u.bed == null)) next.delete(k);
        }
        next.add(key);
      }
      return next;
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    if (!datesValid) return setErr('Check-out must be after check-in.');
    if (selected.size === 0) return setErr('Pick at least one bed or room.');
    setBusy(true);
    const body = {
      location_id: bookingLocation,
      guest_name: form.guest_name,
      guest_phone: form.guest_phone,
      check_in: form.check_in,
      check_out: form.check_out,
      people: guests,
      source: form.source,
      ota: form.ota,
      payment_mode: form.payment_mode,
      amount_paise: Math.round(Number(form.amount || 0) * 100),
      notes: form.notes,
      units: [...selected].map(parseKey),
    };
    try {
      if (editing) await adminApi.updateBooking(id, body);
      else await adminApi.createBooking(body);
      navigate(`/admin/bookings?date=${form.check_in}`);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };

  const cancelBooking = async () => {
    if (!confirm(`Cancel ${form.guest_name}'s booking? The beds become free again.`)) return;
    try {
      await adminApi.cancelBooking(id);
      navigate(`/admin/bookings?date=${form.check_in}`);
    } catch (e2) {
      setErr(e2.message);
    }
  };

  if (bookingLocation === 'all') {
    return (
      <div>
        <h1>New booking</h1>
        <div className="card"><p style={{ margin: 0 }}>Pick a property at the top first.</p></div>
      </div>
    );
  }
  if (editing && !booking) return <p>{err || 'Loading…'}</p>;

  const cancelled = booking?.status === 'cancelled';
  const propertyName = byId[bookingLocation]?.name || bookingLocation;

  return (
    <form onSubmit={save} className="booking-form">
      <div className="section-title-row">
        <h1>{editing ? `Booking #${id}` : 'New booking'} · {propertyName}</h1>
        <Link to={`/admin/bookings?date=${form.check_in}`} className="link-btn">Back</Link>
      </div>
      {cancelled && <p className="pill cancelled" style={{ marginBottom: '0.75rem' }}>This booking is cancelled</p>}
      {booking?.imported ? (
        <p style={{ color: 'var(--muted)' }}>Imported from the old bookings sheet.</p>
      ) : null}
      {editing && !booking.imported && (
        <CheckinPanel booking={booking} propertyName={propertyName} roomsAssigned={booking.units.length > 0} />
      )}

      <fieldset disabled={cancelled} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="card">
          <div className="row">
            <label><span>Guest name</span>
              <input className="input" name="guest_name" value={form.guest_name} onChange={(e) => set('guest_name')(e.target.value)} required />
            </label>
            <label><span>Phone</span>
              <input className="input" name="guest_phone" type="tel" inputMode="tel" value={form.guest_phone} onChange={(e) => set('guest_phone')(e.target.value)} />
            </label>
          </div>
          <div className="row">
            <label><span>Check-in</span>
              <input
                className="input"
                type="date"
                name="check_in"
                value={form.check_in}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({ ...f, check_in: v, check_out: f.check_out > v ? f.check_out : addDays(v, 1) }));
                }}
                required
              />
            </label>
            <label><span>Check-out</span>
              <input className="input" type="date" name="check_out" min={addDays(form.check_in, 1)} value={form.check_out} onChange={(e) => set('check_out')(e.target.value)} required />
            </label>
            <div className="nights">{nights ? `${nights} night${nights === 1 ? '' : 's'}` : '—'}</div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Beds and rooms</h3>
          {notice && <p className="notice">{notice}</p>}
          {!datesValid ? (
            <p style={{ color: 'var(--muted)' }}>Pick valid dates to see what’s free.</p>
          ) : (
            <div className="room-list">
              {rooms.map((room) => {
                const wholeHolder = holderOf(room, null);
                if (room.kind === 'private') {
                  const on = selected.has(unitKey(room.id, null));
                  return (
                    <div className="room-row" key={room.id}>
                      <div className="room-name">{room.code}<small>{room.room_type}</small></div>
                      <button
                        type="button"
                        className={`bed wide ${on ? 'selected' : ''} ${wholeHolder ? 'taken' : ''}`}
                        disabled={!!wholeHolder && !on}
                        title={wholeHolder ? `Booked by ${wholeHolder}` : ''}
                        onClick={() => toggle(room, null)}
                      >
                        {wholeHolder ? wholeHolder : on ? 'Selected' : 'Free'}
                      </button>
                    </div>
                  );
                }
                const wholeOn = selected.has(unitKey(room.id, null));
                const anyBedTaken = taken.some((t) => t.room_id === room.id);
                return (
                  <div className="room-row" key={room.id}>
                    <div className="room-name">{room.code}<small>{room.room_type}</small></div>
                    <div className="bed-grid">
                      {Array.from({ length: room.beds }, (_, i) => i + 1).map((bed) => {
                        const holder = holderOf(room, bed);
                        const on = wholeOn || selected.has(unitKey(room.id, bed));
                        return (
                          <button
                            key={bed}
                            type="button"
                            className={`bed ${on ? 'selected' : ''} ${holder ? 'taken' : ''}`}
                            disabled={!!holder}
                            title={holder ? `Booked by ${holder}` : `Bed ${bed}`}
                            aria-label={`${room.code} bed ${bed}${holder ? `, booked by ${holder}` : ''}`}
                            aria-pressed={on}
                            onClick={() => toggle(room, bed)}
                          >
                            {bed}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={`bed wide ${wholeOn ? 'selected' : ''}`}
                        disabled={anyBedTaken}
                        title={anyBedTaken ? 'Some beds are already booked' : 'Book the whole room'}
                        onClick={() => toggle(room, null)}
                      >
                        Whole room
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <label><span>Booked via</span></label>
          <Chips label="Booked via" options={SOURCES} value={form.source} onChange={set('source')} />
          {form.source === 'ota' && (
            <label><span>Which OTA</span>
              <select className="select" value={form.ota} onChange={(e) => set('ota')(e.target.value)}>
                <option value="">Choose…</option>
                {OTAS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )}
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <label><span>Amount (₹)</span>
              <input className="input" name="amount" type="number" inputMode="decimal" min="0" step="1" value={form.amount} onChange={(e) => { setAmountTouched(true); set('amount')(e.target.value); }} required />
            </label>
            <label><span>Guests</span>
              <input
                className="input"
                name="people"
                type="number"
                inputMode="numeric"
                min="1"
                value={guests}
                onChange={(e) => {
                  setPeopleTouched(true);
                  setPeople(Math.max(1, Number(e.target.value) || 1));
                }}
              />
            </label>
          </div>
          {suggestion && (
            <p className="price-hint" data-price-hint="">
              Room rates: {formatRupees(suggestion.total)} ({suggestion.text}).
              {amountTouched && Math.round(Number(form.amount || 0) * 100) !== suggestion.total && (
                <>
                  {' '}
                  <button type="button" className="link-btn" onClick={() => { setAmountTouched(false); }}>
                    Use {formatRupees(suggestion.total)}
                  </button>
                </>
              )}
            </p>
          )}
          <label><span>Paid by</span></label>
          <Chips label="Paid by" options={PAYMENT_MODES} value={form.payment_mode} onChange={set('payment_mode')} />
          <label><span>Notes</span>
            <input className="input" value={form.notes} onChange={(e) => set('notes')(e.target.value)} placeholder="Optional" />
          </label>
        </div>

        {OFFLINE_SOURCES.has(form.source) && (
          <p className="notice">
            Block {selected.size > 1 ? 'these beds' : 'this bed'} in AsiaTech too, so the OTAs don’t sell {selected.size > 1 ? 'them' : 'it'}.
          </p>
        )}
        {err && <p style={{ color: '#c92a2a' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Save booking'}
          </button>
          {editing && !cancelled && (
            <button type="button" className="btn secondary danger" onClick={cancelBooking}>Cancel booking</button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
