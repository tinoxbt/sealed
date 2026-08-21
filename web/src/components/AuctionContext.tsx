"use client";

import { useEffect, useState } from "react";
import { readAuction, type AuctionSummary } from "../lib/auction";
import { AUCTION_ADDRESS } from "../lib/config";
import { formatStrk } from "../lib/secrets";
import { Badge, Countdown } from "./ui";

/// A compact, always-public summary of the auction a page is acting on.
///
/// Reveal and claim both operate on secrets the user supplies, and without
/// this the pages give no indication of which auction they are talking to or
/// what phase it is in. All of it is public data, so none of it waits on a
/// wallet.
export function AuctionContext() {
  const [a, setA] = useState<AuctionSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    readAuction()
      .then((s) => live && setA(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return null;
  if (!a) {
    return <div className="card h-[74px] animate-pulse" />;
  }

  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="card px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        {a.phase === "Bidding" && <Badge tone="open">Bidding</Badge>}
        {a.phase === "Revealing" && <Badge tone="revealing">Revealing</Badge>}
        {a.phase === "AwaitingSettlement" && <Badge tone="revealing">Awaiting settlement</Badge>}
        {a.phase === "Settled" && <Badge>Settled</Badge>}
        {a.phase === "Cancelled" && <Badge>Cancelled</Badge>}
        <Badge tone="seal">{a.kind === "FirstPrice" ? "First-price" : "Second-price"}</Badge>
      </div>

      <div className="text-sm">
        <span className="label inline">collateral</span>{" "}
        <span className="mono">{formatStrk(a.collateral)} STRK</span>
      </div>

      {a.phase === "Settled" && (
        <div className="text-sm">
          <span className="label inline">clearing price</span>{" "}
          <span className="mono">{formatStrk(a.clearingPrice)} STRK</span>
        </div>
      )}

      <div className="text-sm text-[var(--muted)] ml-auto">
        {a.phase === "Bidding" && <Countdown to={a.closeTime} prefix="closes in" />}
        {a.phase === "Revealing" && <Countdown to={a.revealDeadline} prefix="reveal ends in" />}
        {a.phase === "AwaitingSettlement" && "anyone can settle it now"}
      </div>

      <p className="mono text-[11px] text-[var(--faint)] break-all w-full">{AUCTION_ADDRESS}</p>
    </div>
  );
}
