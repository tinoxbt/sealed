"use client";

/// Small shared primitives. Kept in one file because each is a handful of
/// lines and splitting them costs more to navigate than it saves.

export function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-4 py-1.5">
      <dt className="w-36 shrink-0 text-xs uppercase tracking-wider text-[var(--faint)] pt-0.5">
        {label}
      </dt>
      <dd className={`min-w-0 break-all text-sm ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="mt-1.5 text-xl font-semibold mono">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--faint)]">{sub}</p>}
    </div>
  );
}

const TONES = {
  open: "border-[var(--good)]/30 bg-[var(--good)]/10 text-[var(--good)]",
  revealing: "border-[var(--warn)]/30 bg-[var(--warn)]/10 text-[var(--warn)]",
  settled: "border-[var(--line-bright)] bg-[var(--surface-2)] text-[var(--muted)]",
  seal: "border-[var(--seal)]/40 bg-[var(--seal)]/10 text-[var(--seal)]",
} as const;

export function Badge({ tone = "settled", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`pill ${TONES[tone]}`}>{children}</span>;
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger";
  title?: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-[var(--line-bright)] bg-[var(--surface-2)]",
    warn: "border-[var(--warn)]/30 bg-[var(--warn)]/[0.07]",
    danger: "border-[var(--seal)]/40 bg-[var(--seal)]/[0.07]",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 text-sm leading-relaxed ${styles}`}>
      {title && <p className="font-medium mb-1">{title}</p>}
      <div className="text-[var(--muted)] space-y-2">{children}</div>
    </div>
  );
}

/// A countdown that degrades to a fixed string once the moment has passed,
/// rather than counting up into negative time.
export function Countdown({ to, prefix }: { to: number; prefix: string }) {
  const left = to - Math.floor(Date.now() / 1000);
  if (left <= 0) return <span className="text-[var(--faint)]">passed</span>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return (
    <span>
      {prefix} <span className="mono">{parts}</span>
    </span>
  );
}
