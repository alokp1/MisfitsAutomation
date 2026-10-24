import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api.js';
import { addDays, shortDate, todayISO } from '../dates.js';
import { useAdminLocation, useLocations } from '../locations.jsx';
import BookingCard from '../components/BookingCard.jsx';

function Section({ title, bookings, empty }) {
  return (
    <section className="orders-section">
      <div className="section-title-row">
        <h2>{title}</h2>
        <span className="pill">{bookings.length}</span>
      </div>
      {bookings.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>{empty}</p>
      ) : (
        bookings.map((b) => <BookingCard key={b.id} booking={b} />)
      )}
    </section>
  );
}

export default function AdminBookings() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : todayISO();
  const [day, setDay] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [err, setErr] = useState('');

  // Ignore responses for a property or date the screen has already moved away from.
  const current = useRef('');
  current.current = `${location}|${date}`;

  useEffect(() => {
    if (location === 'all') return;
    const key = `${location}|${date}`;
    setDay(null);
    setErr('');
    Promise.all([adminApi.getDay(location, date), adminApi.listRooms(location)])
      .then(([d, r]) => {
        if (current.current !== key) return;
        setDay(d);
        setRooms(r);
      })
      .catch((e) => setErr(e.message));
  }, [location, date]);

  useEffect(() => {
    if (location === 'all' || !q.trim()) {
      setResults(null);
      return undefined;
    }
    const t = setTimeout(() => {
      adminApi.searchBookings(location, q.trim()).then(setResults).catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [location, q]);

  if (location === 'all') {
    return (
      <div>
        <h1>Bookings</h1>
        <div className="card">
          <p style={{ margin: 0 }}>Bookings are kept per property. Pick a property at the top.</p>
        </div>
      </div>
    );
  }

  const go = (d) => setParams(d === todayISO() ? {} : { date: d });

  // Tonight = everyone whose stay covers this date's night: arrivals + those staying on.
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  let bedsTaken = 0;
  let privateTaken = 0;
  for (const b of day ? [...day.arriving, ...day.staying] : []) {
    for (const u of b.units) {
      const room = roomById.get(u.room_id);
      if (!room) continue;
      if (room.kind === 'private') privateTaken += 1;
      else bedsTaken += u.bed == null ? room.beds : 1;
    }
  }

  return (
    <div>
      <div className="section-title-row">
        <h1>{byId[location]?.name || location} bookings</h1>
        <Link to={`/admin/bookings/new?date=${date}`} className="btn">+ New booking</Link>
      </div>

      <div className="card day-bar">
        <button type="button" className="btn secondary" onClick={() => go(addDays(date, -1))} aria-label="Previous day">‹</button>
        <input className="input" type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} />
        <button type="button" className="btn secondary" onClick={() => go(addDays(date, 1))} aria-label="Next day">›</button>
        {date !== todayISO() && (
          <button type="button" className="link-btn" onClick={() => go(todayISO())}>Today</button>
        )}
      </div>

      {day && (
        <div className="metrics-grid">
          <div className="metric-card">
            <span>Dorm beds taken tonight</span>
            <strong>{bedsTaken} / {day.capacity.dorm_beds}</strong>
          </div>
          <div className="metric-card">
            <span>Private rooms taken tonight</span>
            <strong>{privateTaken} / {day.capacity.private_rooms}</strong>
          </div>
        </div>
      )}

      <input
        className="input"
        type="search"
        placeholder="Search by guest name or phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ margin: '0.25rem 0 1rem' }}
      />

      {err && <p style={{ color: '#c92a2a' }}>{err}</p>}

      {results ? (
        <Section title={`Results for “${q.trim()}”`} bookings={results} empty="No bookings match." />
      ) : !day ? (
        <p>Loading…</p>
      ) : (
        <>
          <Section title={`Arriving ${shortDate(date)}`} bookings={day.arriving} empty="No arrivals." />
          <Section title="Staying" bookings={day.staying} empty="Nobody staying on." />
          <Section title="Leaving" bookings={day.leaving} empty="No departures." />
        </>
      )}
    </div>
  );
}
