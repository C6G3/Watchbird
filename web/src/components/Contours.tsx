// Topographic contour lines, generated once on the server. Each hill is a set
// of closed, gently wobbling rings; a dashed GPS track crosses the terrain and
// ends in a fix and one anomaly ring.

type Hill = { x: number; y: number; rings: number; step: number; seed: number };

const hills: Hill[] = [
  { x: 330, y: 300, rings: 11, step: 26, seed: 1 },
  { x: 900, y: 610, rings: 9, step: 30, seed: 2 },
  { x: 1050, y: 140, rings: 6, step: 28, seed: 3 },
];

function ring(h: Hill, r: number) {
  const pts: [number, number][] = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble =
      1 + 0.13 * Math.sin(3 * a + h.seed) + 0.07 * Math.sin(5 * a + h.seed * 2.3 + r / 40) + 0.04 * Math.cos(7 * a - h.seed);
    pts.push([h.x + Math.cos(a) * r * wobble * 1.25, h.y + Math.sin(a) * r * wobble]);
  }
  // Closed Catmull-Rom → cubic Bézier.
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + "Z";
}

export default function Contours() {
  return (
    <svg className="contours" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="0.8">
        {hills.flatMap((h) =>
          Array.from({ length: h.rings }, (_, i) => (
            <path key={`${h.seed}-${i}`} d={ring(h, (i + 1) * h.step)} strokeOpacity={i % 5 === 4 ? 0.9 : 0.45} strokeWidth={i % 5 === 4 ? 1.3 : 0.8} />
          )),
        )}
      </g>
      <path
        d="M120 760 C 260 640, 300 520, 470 500 S 700 560, 760 430 S 860 260, 1010 300"
        fill="none"
        stroke="var(--leaf)"
        strokeWidth="2.4"
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      <rect x="1003" y="293" width="14" height="14" fill="var(--leaf)" />
      <circle cx="760" cy="430" r="15" fill="none" stroke="var(--rust)" strokeWidth="2" />
      <g fill="currentColor" fontFamily="var(--font-mono)" fontSize="11" letterSpacing="0.06em" opacity="0.7">
        <text x="1026" y="304">WB_3 · LAST FIX</text>
        <text x="782" y="434" fill="var(--rust)">ANOMALY</text>
        <text x="330" y="304" textAnchor="middle">1840</text>
        <text x="900" y="614" textAnchor="middle">1795</text>
      </g>
    </svg>
  );
}
