const LOGO_SRC = `${import.meta.env.BASE_URL}misfits-logo.jpeg`;
const LOGO_VIDEO_SRC = `${import.meta.env.BASE_URL}misfits-logo-animated.mp4`;

export default function BrandLogo({ subtitle = 'Hostel & Cafe', compact = false, admin = false }) {
  return (
    <div className={`brand-logo ${compact ? 'compact' : ''} ${admin ? 'admin-brand' : ''}`}>
      <div className="brand-logo-mark" aria-hidden="true">
        <video src={LOGO_VIDEO_SRC} poster={LOGO_SRC} autoPlay muted loop playsInline />
      </div>
      <div className="brand-logo-copy">
        <span>MISFITS</span>
        {subtitle && <small>{subtitle}</small>}
      </div>
    </div>
  );
}
