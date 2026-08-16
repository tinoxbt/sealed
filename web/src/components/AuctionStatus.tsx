"use client";

import { useEffect, useState } from "react";
import type { AuctionSummary } from "../lib/auction";
import { formatStrk } from "../lib/secrets";

const PHASE_LABEL: Record<AuctionSummary["phase"], string> = {
  Bidding: "Bidding open",
  Revealing: "Revealing",
  AwaitingSettlement: "Waiting to settle",
  Settled: "Settled",
  Cancelled: "Cancelled",
};

/// Counts down to the next thing that changes what a user can do.
function countdown(target: number, now: number): string {
  const s = Math.max(0, target - now);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function AuctionStatus({ a }: { a: AuctionSummary }) {
  // Ticks locally rather than re-reading the chain every second.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const deadline =
    a.phase === "Bidding" ? a.closeTime : a.phase === "Revealing" ? a.revealDeadline : null;

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{PHASE_LABEL[a.phase]}</span>
        {deadline !== null && (
          <span className="font-mono text-sm text-neutral-400">
            {countdown(deadline, now)} left
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Cell label="collateral" value={`${formatStrk(a.collateral)} STRK`} />
        <Cell label="reserve" value={`${formatStrk(a.reserve)} STRK`} />
        <Cell label="commitments" value={String(a.commitments)} />
        <Cell label="escrowed" value={`${formatStrk(a.escrowed)} STRK`} />
        {a.phase !== "Bidding" && <Cell label="revealed" value={String(a.revealed)} />}
        {a.phase === "Settled" && (
          <Cell label="clearing price" value={`${formatStrk(a.clearingPrice)} STRK`} />
        )}
      </dl>

      {a.phase === "Bidding" && (
        <p className="text-xs text-neutral-500">
          Every bidder escrows the same {formatStrk(a.collateral)} STRK, so the funding
          transfer says nothing about anyone&apos;s bid. Bids are capped at that amount.
        </p>
      )}
      {a.phase === "Revealing" && (
        <p className="text-xs text-amber-200/70">
          Bidding is closed. Reveal before the deadline or the collateral is forfeited to the
          seller, whatever you bid.
        </p>
      )}
      {a.phase === "Settled" && a.commitments > a.revealed && (
        <p className="text-xs text-neutral-500">
          {a.commitments - a.revealed} of {a.commitments} never revealed and forfeited.
        </p>
      )}
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
