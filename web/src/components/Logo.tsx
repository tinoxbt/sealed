/// A wax seal, pressed: a scalloped disc with an impression struck across it.
///
/// The scallop coordinates are rounded to three decimals on purpose. Computing
/// them with trig at render time produced different final digits on the server
/// and in the browser, which React reports as a hydration mismatch and which
/// tore the page apart below the fold. Fixed precision makes both sides agree.
const SCALLOP = Array.from({ length: 16 }, (_, i) => {
  const a = (i * Math.PI * 2) / 16;
  return {
    x: Number((16 + Math.cos(a) * 13.9).toFixed(3)),
    y: Number((16 + Math.sin(a) * 13.9).toFixed(3)),
  };
});

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Sealed"
    >
      {SCALLOP.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.15" fill="var(--seal)" />
      ))}
      <circle cx="16" cy="16" r="13.4" fill="var(--seal)" />
      {/* The impression: a ring and a struck bar, darkened rather than a second
          colour so the mark survives being rendered in one ink. */}
      <circle cx="16" cy="16" r="9.4" fill="none" stroke="rgba(0,0,0,0.26)" strokeWidth="1.2" />
      <rect x="10.6" y="14.7" width="10.8" height="2.6" rx="1.3" fill="rgba(0,0,0,0.42)" />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Logo size={size} />
      <span className="text-[17px] font-semibold tracking-tight">Sealed</span>
    </span>
  );
}
