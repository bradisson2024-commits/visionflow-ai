/** `gid` debe ser único por instancia: un <defs> dentro de un elemento oculto rompe url(#id). */
export function LogoMark({ size = 32, gid = "cf-g" }: { size?: number; gid?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff6b1a" />
          <stop offset="1" stopColor="#ffaa2b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="#1a1a22" />
      <rect x="17" y="10" width="30" height="44" rx="6" fill="none" stroke={`url(#${gid})`} strokeWidth="4" />
      <path d="M27 24.5v15l12-7.5z" fill={`url(#${gid})`} />
      <path d="M8 32h8M48 32h8" stroke="#45d3f0" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ gid }: { gid?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark gid={gid} />
      <span className="font-display text-lg font-semibold">
        Clip<span className="forge-text">Forge</span>
      </span>
    </span>
  );
}
