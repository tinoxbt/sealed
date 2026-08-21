"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUCTION_ADDRESS } from "../lib/config";
import { discoverAuctions, type DiscoveredAuction } from "../lib/discovery";
import { formatStrk } from "../lib/secrets";
import { Badge, Countdown } from "./ui";

type Phase = "bidding" | "revealing" | "ended";

function phaseOf(a: DiscoveredAuction, now: number): Phase {
  if (now < a.closeTime) return "bidding";
  if (now < a.revealDeadline) return "revealing";
  return "ended";
}

const short = (a: string) => (a.length <= 18 ? a : `${a.slice(0, 10)}…${a.slice(-6)}`);

export function LiveAuctions({ limit }: { limit?: number }) {
  const [auctions, setAuctions] = useState<DiscoveredAuction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    discoverAuctions()
      .then((found) => active && setAuctions(found))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="card p-6 text-sm text-[var(--seal)]">
        Could not read auctions from chain. {error}
      </div>
    );
  }
  if (!auctions) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-5 animate-pulse">
            <div className="h-3 w-20 rounded bg-[var(--surface-2)]" />
            <div className="mt-4 h-6 w-28 rounded bg-[var(--surface-2)]" />
            <div className="mt-4 h-3 w-full rounded bg-[var(--surface-2)]" />
          </div>
        ))}
      </div>
    );
  }
  if (auctions.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[var(--muted)]">No auctions on chain yet.</p>
        <Link href="/create" className="btn-ghost mt-4">Create the first one</Link>
      </div>
    );
  }

  const now = Date.now() / 1000;
  const shown = limit ? auctions.slice(0, limit) : auctions;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {shown.map((a) => {
        const phase = phaseOf(a, now);
        const current = a.address.toLowerCase() === AUCTION_ADDRESS.toLowerCase();
        return (
          <Link
            key={a.address}
            href={`/bid?a=${a.address}`}
            className="card p-5 transition-colors hover:border-[var(--line-bright)]"
          >
            <div className="flex items-center justify-between gap-2">
              {phase === "bidding" && <Badge tone="open">Bidding open</Badge>}
              {phase === "revealing" && <Badge tone="revealing">Revealing</Badge>}
              {phase === "ended" && <Badge>Closed</Badge>}
              {current && <span className="text-[10px] uppercase tracking-wider text-[var(--faint)]">featured</span>}
            </div>

            <p className="mt-4 text-xs text-[var(--faint)] uppercase tracking-wider">Collateral</p>
            <p className="text-2xl font-semibold mono">{formatStrk(a.collateral)}<span className="text-sm text-[var(--muted)] ml-1">STRK</span></p>

            <dl className="mt-4 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-[var(--faint)]">Reserve</dt>
                <dd className="mono">{formatStrk(a.reservePrice)} STRK</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--faint)]">
                  {phase === "bidding" ? "Closes in" : phase === "revealing" ? "Reveal ends" : "Ended"}
                </dt>
                <dd className="text-[var(--muted)]">
                  {phase === "bidding" && <Countdown to={a.closeTime} prefix="" />}
                  {phase === "revealing" && <Countdown to={a.revealDeadline} prefix="" />}
                  {phase === "ended" && "—"}
                </dd>
              </div>
            </dl>

            <p className="mt-4 mono text-[11px] text-[var(--faint)] break-all">{short(a.address)}</p>
          </Link>
        );
      })}
    </div>
  );
}
