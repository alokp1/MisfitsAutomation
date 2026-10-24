import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo.jsx';
import { useLocations } from '../locations.jsx';

export default function CafePicker() {
  const { locations, loading, error } = useLocations();

  return (
    <>
      <header className="app-header">
        <BrandLogo subtitle="Hostel & Cafe Menu" />
      </header>
      <main className="page">
        <section className="menu-hero">
          <div className="menu-hero-copy">
            <span className="hero-kicker">MISFITS Hostel & Cafe</span>
            <h1>Which cafe are you at?</h1>
          </div>
        </section>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: '#c92a2a' }}>Couldn’t load cafes: {error}</p>}
        <div className="cafe-picker">
          {locations.map((l) => (
            <Link key={l.id} to={`/${l.id}/menu`} className="btn full">
              {l.name} cafe
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
