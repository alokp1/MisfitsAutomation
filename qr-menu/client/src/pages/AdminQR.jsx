import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAdminLocation, useLocations } from '../locations.jsx';

export default function AdminQR() {
  const { location } = useAdminLocation();
  const { byId } = useLocations();
  const [table, setTable] = useState('T1');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const cafeName = byId[location]?.name || location;

  const generate = async () => {
    if (location === 'all') return;
    setErr('');
    try {
      setData(await api.getQrData(location, table.trim()));
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    setData(null);
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const print = () => {
    const w = window.open('', '_blank');
    if (!w || !data) return;
    w.document.write(`
      <html><head><title>QR — ${data.location.name} ${table}</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 40px; }
        h1 { font-size: 24px; }
        .cafe { font-size: 20px; letter-spacing: .08em; text-transform: uppercase; color: #555; }
        .num { font-size: 48px; font-weight: 700; }
        img { width: 360px; height: 360px; margin: 20px 0; }
        p { color: #555; }
      </style></head><body>
        <h1>Scan to view menu & order</h1>
        <div class="cafe">Misfits ${data.location.name} cafe</div>
        <div class="num">Table ${table}</div>
        <img src="${data.dataUrl}" />
        <p>${data.url}</p>
      </body></html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  if (location === 'all') {
    return (
      <div>
        <h1>QR code generator</h1>
        <div className="card" style={{ maxWidth: 520 }}>
          <p style={{ margin: 0 }}>QR codes open one cafe’s menu. Pick a cafe at the top to generate codes for its tables.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>{cafeName} cafe QR codes</h1>
      <p style={{ color: 'var(--muted)' }}>
        Generate a printable QR code for each table. The QR opens the {cafeName} menu with the table
        identifier filled in.
      </p>

      <div className="card" style={{ maxWidth: 520 }}>
        <div className="row">
          <label style={{ flex: 2 }}>
            <span>Table identifier</span>
            <input
              className="input"
              placeholder="e.g. T1, T2, Patio-3, Bar-1…"
              value={table}
              onChange={(e) => setTable(e.target.value)}
            />
          </label>
          <button className="btn" onClick={generate} style={{ height: 40 }}>Generate</button>
        </div>
        {err && <p style={{ color: '#c92a2a' }}>{err}</p>}
        {data && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="qr-preview">
              <img src={data.dataUrl} alt="QR" />
              <div style={{ wordBreak: 'break-all', fontSize: '0.8rem', color: 'var(--muted)' }}>
                {data.url}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
              <a className="btn" href={data.dataUrl} download={`qr-${data.location.id}-${table || 'menu'}.png`}>
                Download PNG
              </a>
              <button className="btn secondary" onClick={print}>Print</button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: '1rem', maxWidth: 520 }}>
        <strong>Tip:</strong> Each cafe’s codes point at its own menu (<code>/{location}/menu?table=…</code>), so
        orders land on the right cafe’s order board. Codes printed before menus were split open the Shoja menu.
      </div>
    </div>
  );
}
