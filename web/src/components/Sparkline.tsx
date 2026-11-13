// Minimal line chart: one series, flagged indices drawn as rust ticks on the
// baseline. Server-rendered SVG, no chart library.

export default function Sparkline({
  values,
  flagged = [],
  label,
}: {
  values: number[];
  flagged?: boolean[];
  label: string;
}) {
  const W = 600;
  const H = 120;
  const pad = 6;
  if (values.length < 2) return <p className="panel__empty">Not enough fixes yet.</p>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - 10 - ((v - min) / span) * (H - pad * 2 - 10);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line className="axis" x1={pad} x2={W - pad} y1={H - 4} y2={H - 4} vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {flagged.map((f, i) => (f ? <rect key={i} className="anom" x={x(i) - 1.5} y={H - 10} width="3" height="6" /> : null))}
    </svg>
  );
}
