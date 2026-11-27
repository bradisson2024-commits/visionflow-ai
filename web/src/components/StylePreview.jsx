// Vista previa ilustrativa (SVG propio) de cada estilo mientras no exista una vista previa
// generada con IA. Usa la paleta del estilo y un motivo representativo.
// No reutiliza ninguna imagen de la herramienta original.

function Stick({ x, y, s = 1, c = '#1b1b1b', mood = 'happy', w = 2.2 }) {
  const mouth = mood === 'sad' ? `M${-3 * s} ${3.5 * s} q${3 * s} ${-2.5 * s} ${6 * s} 0` : `M${-3 * s} ${2 * s} q${3 * s} ${2.5 * s} ${6 * s} 0`;
  return (
    <g transform={`translate(${x} ${y})`} stroke={c} strokeWidth={w} fill="none" strokeLinecap="round">
      <circle cx="0" cy="0" r={8 * s} fill="#fff" />
      <circle cx={-2.8 * s} cy={-1.5 * s} r={0.9 * s} fill={c} stroke="none" />
      <circle cx={2.8 * s} cy={-1.5 * s} r={0.9 * s} fill={c} stroke="none" />
      <path d={mouth} strokeWidth={w * 0.7} />
      <path d={`M0 ${8 * s} v${18 * s} M0 ${13 * s} l${-9 * s} ${7 * s} M0 ${13 * s} l${9 * s} ${-4 * s} M0 ${26 * s} l${-7 * s} ${12 * s} M0 ${26 * s} l${7 * s} ${12 * s}`} />
    </g>
  );
}

const MOTIFS = {
  stickman: p => (
    <>
      <rect x="0" y="64" width="160" height="36" fill={p[2]} opacity=".55" />
      <rect x="10" y="22" width="26" height="42" fill={p[3]} opacity=".55" /><rect x="40" y="32" width="20" height="32" fill={p[3]} opacity=".4" />
      <rect x="118" y="18" width="30" height="46" fill={p[3]} opacity=".5" />
      <circle cx="132" cy="14" r="7" fill={p[2]} />
      <Stick x={82} y={34} s={1.05} />
    </>
  ),
  'stickman-cine': p => (
    <>
      <circle cx="120" cy="40" r="26" fill={p[2]} opacity=".85" />
      <rect x="0" y="70" width="160" height="30" fill={p[0]} />
      <path d="M0 70 L40 52 L70 70 Z" fill={p[1]} />
      <Stick x={70} y={38} s={0.95} c="#0b0b0b" w={2.4} />
      <rect x="0" y="0" width="160" height="10" fill="#000" /><rect x="0" y="90" width="160" height="10" fill="#000" />
    </>
  ),
  castle: p => (
    <>
      {[...Array(14)].map((_, i) => <circle key={i} cx={(i * 37) % 160} cy={(i * 23) % 50 + 6} r="1.2" fill={p[3]} />)}
      <path d="M50 80 V44 h8 v-6 h6 v6 h8 v-14 l6 -10 l6 10 v14 h8 v-6 h6 v6 h8 V80 Z" fill={p[1]} />
      <rect x="0" y="78" width="160" height="22" fill={p[2]} opacity=".7" />
      <circle cx="78" cy="58" r="4" fill={p[3]} />
    </>
  ),
  moon: p => (
    <>
      <circle cx="118" cy="28" r="14" fill="#d9e0d8" opacity=".85" />
      <path d="M30 84 V48 l20 -16 l20 16 V84 Z" fill={p[1]} /><rect x="44" y="60" width="9" height="12" fill={p[3]} opacity=".9" />
      {[...Array(6)].map((_, i) => <path key={i} d={`M${92 + i * 11} 84 l4 -30 l4 30 Z`} fill="#000" opacity=".7" />)}
      <rect x="0" y="82" width="160" height="18" fill={p[2]} opacity=".5" />
    </>
  ),
  chart: p => (
    <>
      {[28, 46, 36, 62].map((h, i) => <rect key={i} x={24 + i * 18} y={82 - h} width="12" height={h} rx="2" fill={[p[1], p[2], p[3], p[1]][i]} />)}
      <circle cx="122" cy="46" r="20" fill={p[2]} /><path d="M122 46 V26 A20 20 0 0 1 141 52 Z" fill={p[3]} />
      <path d="M20 84 H142" stroke="#c9ced6" strokeWidth="2" />
    </>
  ),
  person: p => (
    <>
      <rect x="0" y="70" width="160" height="30" fill={p[2]} opacity=".35" />
      <circle cx="80" cy="34" r="13" fill="#f2c29b" stroke={p[3]} strokeWidth="2" />
      <path d="M67 30 q13 -16 26 0 q-4 -10 -13 -10 q-9 0 -13 10Z" fill={p[3]} />
      <path d="M62 80 q0 -26 18 -26 q18 0 18 26 Z" fill={p[1]} stroke={p[3]} strokeWidth="2" />
    </>
  ),
  blob3d: p => (
    <>
      <ellipse cx="80" cy="84" rx="56" ry="9" fill="#000" opacity=".08" />
      <circle cx="62" cy="58" r="22" fill={p[1]} /><circle cx="56" cy="50" r="7" fill="#fff" opacity=".5" />
      <rect x="92" y="48" width="34" height="34" rx="10" fill={p[2]} /><circle cx="118" cy="30" r="10" fill={p[3]} />
    </>
  ),
  sketch: p => (
    <g stroke={p[1]} fill="none" strokeLinecap="round">
      <path d="M20 80 C 50 76, 110 84, 140 78" strokeWidth="1.2" />
      <path d="M40 78 V44 L60 30 L80 44 V78" strokeWidth="1.4" /><path d="M43 46 L60 33 L77 46" strokeWidth=".8" opacity=".6" />
      {[...Array(8)].map((_, i) => <path key={i} d={`M${44 + i * 4} 76 l6 -12`} strokeWidth=".6" opacity=".6" />)}
      <circle cx="112" cy="40" r="12" strokeWidth="1.2" /><path d="M100 70 q12 -20 24 0" strokeWidth="1.2" />
      <circle cx="112" cy="40" r="16" fill={p[3]} opacity=".18" stroke="none" />
    </g>
  ),
  cube: p => (
    <>
      <path d="M80 26 L112 42 L80 58 L48 42 Z" fill="#fff" /><path d="M48 42 L80 58 V86 L48 70 Z" fill={p[1]} /><path d="M112 42 L80 58 V86 L112 70 Z" fill={p[2]} />
      <circle cx="122" cy="76" r="7" fill={p[3]} />
    </>
  ),
  pixel: p => (
    <>
      {[...Array(10)].map((_, i) => <rect key={i} x={i * 16} y={80} width="16" height="20" fill={i % 2 ? p[1] : p[2]} />)}
      {[[70, 50], [78, 50], [86, 50], [70, 58], [78, 58], [86, 58], [74, 66], [82, 66], [74, 42], [82, 42]].map(([x, y], i) => <rect key={i} x={x} y={y} width="8" height="8" fill={i > 7 ? p[3] : p[2]} />)}
      <rect x="118" y="22" width="16" height="16" fill={p[3]} /><rect x="20" y="30" width="24" height="8" fill="#fff" opacity=".6" />
    </>
  ),
  hat: p => (
    <>
      {[...Array(7)].map((_, i) => <rect key={i} x="0" y={10 + i * 12} width="160" height="5" fill="#fff" opacity=".12" />)}
      <path d="M58 46 h44 l-6 -18 h-32 Z" fill="#111" /><rect x="46" y="44" width="68" height="5" rx="2" fill="#111" />
      <path d="M60 88 q0 -32 20 -36 q20 4 20 36 Z" fill="#1c1c1c" /><path d="M80 52 L72 88 M80 52 L88 88" stroke="#6a6a6a" strokeWidth="1.4" />
    </>
  ),
  paper: p => (
    <>
      <path d="M0 62 Q40 44 80 60 T160 56 V100 H0 Z" fill={p[2]} style={{ filter: 'drop-shadow(0 -2px 2px rgba(0,0,0,.15))' }} />
      <path d="M0 76 Q50 60 100 76 T160 72 V100 H0 Z" fill={p[1]} style={{ filter: 'drop-shadow(0 -2px 2px rgba(0,0,0,.15))' }} />
      <path d="M0 88 Q60 78 160 88 V100 H0 Z" fill={p[3]} />
      <circle cx="120" cy="26" r="11" fill={p[1]} />
    </>
  ),
  city: p => (
    <>
      {[[10, 30], [30, 46], [48, 20], [70, 38], [92, 14], [114, 34], [134, 24]].map(([x, h], i) => (
        <g key={i}><rect x={x} y={h + 10} width="18" height={90 - h} fill="#130a2e" stroke={i % 2 ? p[1] : p[2]} strokeWidth="1" />
          {[...Array(4)].map((_, j) => <rect key={j} x={x + 4} y={h + 18 + j * 12} width="4" height="3" fill={j % 2 ? p[2] : p[1]} />)}</g>
      ))}
      <rect x="0" y="92" width="160" height="8" fill={p[3]} opacity=".6" />
    </>
  ),
  film: p => (
    <>
      <rect x="18" y="24" width="124" height="52" fill="#000" opacity=".55" />
      {[...Array(9)].map((_, i) => <g key={i}><rect x={22 + i * 14} y="27" width="7" height="5" fill={p[3]} opacity=".7" /><rect x={22 + i * 14} y="68" width="7" height="5" fill={p[3]} opacity=".7" /></g>)}
      <rect x="30" y="36" width="44" height="28" fill={p[2]} /><rect x="86" y="36" width="44" height="28" fill={p[1]} />
      <path d="M0 96 L160 96" stroke={p[3]} strokeWidth="2" opacity=".3" />
    </>
  ),
  planet: p => (
    <>
      {[...Array(22)].map((_, i) => <circle key={i} cx={(i * 53) % 160} cy={(i * 31) % 100} r={i % 4 ? 0.8 : 1.5} fill="#fff" />)}
      <ellipse cx="40" cy="30" rx="34" ry="16" fill={p[2]} opacity=".35" />
      <circle cx="96" cy="56" r="24" fill={p[3]} /><ellipse cx="96" cy="56" rx="40" ry="8" fill="none" stroke="#fff" strokeWidth="2" opacity=".8" transform="rotate(-16 96 56)" />
    </>
  ),
  pending: () => (
    <g fill="none" stroke="#bdb9ae" strokeWidth="2" strokeDasharray="5 4"><rect x="52" y="26" width="56" height="48" rx="8" /></g>
  ),
};

export default function StylePreview({ style }) {
  const p = style.paletteHex || ['#eee', '#ccc', '#aaa', '#888'];
  const draw = MOTIFS[style.motif] || MOTIFS.pending;
  const dark = ['#0', '#1', '#2'].some(h => p[0].startsWith(h));
  return (
    <svg className="thumb" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Vista previa ilustrativa: ${style.name || 'pendiente'}`}>
      <defs>
        <linearGradient id={`g-${style.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p[0]} />
          <stop offset="1" stopColor={dark ? p[1] : '#ffffff'} stopOpacity={dark ? 1 : 0.6} />
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill={`url(#g-${style.id})`} />
      {draw(p)}
    </svg>
  );
}
