// Small hand-rolled SVG charts for the owner dashboard. Colours come from CSS
// custom properties (--series-1, --series-2) validated against the card surface.
import { useEffect, useRef, useState } from 'react';

export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)'];

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Rounded tick steps: 1, 2, 2.5, 5 × 10^n.
function niceMax(max, ticks = 4) {
  if (!(max > 0)) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { top: step * ticks, step };
}

// A column top with 4px rounded corners and a square base.
function topRoundedRect(x, y, w, h, r = 4) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function Legend({ series, kind = 'rect' }) {
  return (
    <div className="viz-legend">
      {series.map((s) => (
        <span key={s.key}>
          <i className={kind === 'line' ? 'key-line' : 'key-rect'} style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="viz-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="viz-tip-row">
          {r.color && <i className="key-line" style={{ background: r.color }} />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ columns, rows }) {
  return (
    <details className="viz-table">
      <summary>Show as table</summary>
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

// Stacked columns. data: [{ label, values: { [seriesKey]: number } }]
export function ColumnChart({ data, series, format, axisFormat, height = 220, title }) {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState(null);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] || 0), 0));
  const { top, step } = niceMax(Math.max(0, ...totals));
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band * 0.6));
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)));

  const show = (i, x) =>
    setTip({
      x: Math.min(x, width - 180),
      y: PAD.top,
      title: data[i].label,
      rows: [
        ...series.map((s) => ({ label: s.label, value: format(data[i].values[s.key] || 0), color: s.color })),
        ...(series.length > 1 ? [{ label: 'Total', value: format(totals[i]) }] : []),
      ],
    });

  return (
    <figure className="viz" aria-label={title}>
      {series.length > 1 && <Legend series={series} />}
      <div className="viz-plot" ref={ref} onPointerLeave={() => setTip(null)}>
        <svg width={width} height={height} role="img" aria-label={title}>
          {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-axis">{axisFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let acc = 0;
            const segs = series
              .map((s) => ({ s, v: d.values[s.key] || 0 }))
              .filter((x) => x.v > 0);
            return (
              <g
                key={d.label}
                tabIndex={0}
                className="viz-col"
                onPointerMove={() => show(i, cx + 12)}
                onFocus={() => show(i, cx + 12)}
                onBlur={() => setTip(null)}
                aria-label={`${d.label}: ${series.map((s) => `${s.label} ${format(d.values[s.key] || 0)}`).join(', ')}`}
              >
                {/* hit target: the whole band, taller than the mark */}
                <rect x={cx - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" />
                {segs.map(({ s, v }, j) => {
                  const y0 = y(acc);
                  acc += v;
                  const y1 = y(acc);
                  const isTop = j === segs.length - 1;
                  // 2px surface gap between stacked segments
                  const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
                  const yTop = y1;
                  return isTop ? (
                    <path key={s.key} d={topRoundedRect(cx - barW / 2, yTop, barW, h)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={cx - barW / 2} y={yTop} width={barW} height={h} fill={s.color} />
                  );
                })}
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} className="viz-baseline" />
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.label} x={PAD.left + band * i + band / 2} y={height - 8} textAnchor="middle" className="viz-axis">
                {d.short || d.label}
              </text>
            ) : null,
          )}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <TableView
        columns={['', ...series.map((s) => s.label), ...(series.length > 1 ? ['Total'] : [])]}
        rows={data.map((d, i) => [
          d.label,
          ...series.map((s) => format(d.values[s.key] || 0)),
          ...(series.length > 1 ? [format(totals[i])] : []),
        ])}
      />
    </figure>
  );
}

// Lines on one axis (0..yMax). data: [{ label, values: { [seriesKey]: number|null } }]
export function LineChart({ data, series, yMax = 100, format, axisFormat, height = 220, title }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (data.length <= 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
  const y = (v) => PAD.top + plotH - (Math.min(v, yMax) / yMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)));

  const nearest = (clientX, rect) => {
    const px = clientX - rect.left;
    const i = data.length <= 1 ? 0 : Math.round(((px - PAD.left) / plotW) * (data.length - 1));
    return Math.max(0, Math.min(data.length - 1, i));
  };

  const tip =
    hover == null
      ? null
      : {
          x: Math.min(x(hover) + 12, width - 180),
          y: PAD.top,
          title: data[hover].label,
          rows: series.map((s) => ({
            label: s.label,
            value: data[hover].values[s.key] == null ? '—' : format(data[hover].values[s.key]),
            color: s.color,
          })),
        };

  return (
    <figure className="viz" aria-label={title}>
      {series.length > 1 && <Legend series={series} kind="line" />}
      <div
        className="viz-plot"
        ref={ref}
        tabIndex={0}
        onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(data.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? 0) - 1));
          if (e.key === 'ArrowRight') setHover((h) => Math.min(data.length - 1, (h ?? 0) + 1));
        }}
      >
        <svg width={width} height={height} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-axis">{axisFormat(t)}</text>
            </g>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="viz-crosshair" />}
          {series.map((s) => {
            const pts = data.map((d, i) => (d.values[s.key] == null ? null : [x(i), y(d.values[s.key])]));
            const path = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]} ` : acc), '');
            const lastIdx = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).pop();
            return (
              <g key={s.key}>
                <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {lastIdx != null && <circle cx={pts[lastIdx][0]} cy={pts[lastIdx][1]} r="4" fill={s.color} className="viz-dot" />}
                {hover != null && pts[hover] && <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4" fill={s.color} className="viz-dot" />}
              </g>
            );
          })}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.label} x={x(i)} y={height - 8} textAnchor="middle" className="viz-axis">{d.short || d.label}</text>
            ) : null,
          )}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <TableView
        columns={['', ...series.map((s) => s.label)]}
        rows={data.map((d) => [d.label, ...series.map((s) => (d.values[s.key] == null ? '—' : format(d.values[s.key])))])}
      />
    </figure>
  );
}

// One series of horizontal bars, value at the tip. rows: [{ label, value, note? }]
export function BarList({ rows, format, title, color = 'var(--series-1)' }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <figure className="viz" aria-label={title}>
      {rows.length === 0 ? (
        <p className="viz-empty">Nothing in this period.</p>
      ) : (
        <div className="bar-list">
          {rows.map((r) => (
            <div className="bar-row" key={r.label} tabIndex={0} title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`}>
              <span className="bar-label">{r.label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${max ? Math.max(1, (r.value / max) * 100) : 0}%`, background: color }} />
              </span>
              <span className="bar-value">
                {format(r.value)}
                {r.note && <small>{r.note}</small>}
              </span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}
