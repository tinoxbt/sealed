"use client";

import { useEffect, useState } from "react";
import { AUCTION_ADDRESS } from "../lib/config";
import { discoverAuctions, type DiscoveredAuction } from "../lib/discovery";
import { formatStrk } from "../lib/secrets";

type Phase = "bidding" | "revealing" | "ended";

function phaseOf(auction: DiscoveredAuction, now: number): Phase {
  if (now < auction.closeTime) return "bidding";
  if (now < auction.revealDeadline) return "revealing";
  return "ended";
}

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function AuctionList() {
  const [auctions, setAuctions] = useState<DiscoveredAuction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    discoverAuctions()
      .then((found) => {
        if (active) setAuctions(found);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      active = false;
    };
  }, []);

  if (error !== null) {
    return <p className="text-sm text-red-300">{error}</p>;
  }

  if (auctions === null) {
    return <p className="text-sm text-neutral-500">Loading auctions...</p>;
  }

  if (auctions.length === 0) {
    return <p className="text-sm text-neutral-500">No auctions found.</p>;
  }

  const now = Date.now() / 1000;

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/50 divide-y divide-neutral-800">
      {auctions.map((auction) => {
        const current = auction.address.toLowerCase() === AUCTION_ADDRESS.toLowerCase();
        const content = (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-sm">{shortAddress(auction.address)}</span>
              <span className="text-xs text-neutral-500">{phaseOf(auction, now)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-neutral-500">collateral</span>
              <span className="font-mono">{formatStrk(auction.collateral)} STRK</span>
            </div>
          </>
        );

        if (current) {
          return (
            <div key={auction.address} className="p-4">
              <div className="mb-2 text-xs font-medium text-neutral-400">Current auction</div>
              {content}
            </div>
          );
        }

        return (
          // AUCTION_ADDRESS is captured at module load, so switching requires a full page load.
          <a
            key={auction.address}
            href={`?a=${auction.address}`}
            className="block p-4 hover:bg-neutral-800/50"
          >
            {content}
          </a>
        );
      })}
    </section>
  );
}
