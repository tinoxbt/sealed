"use client";

import { useEffect, useState } from "react";
import type { AuctionSummary } from "../lib/auction";
import { lookup, type Listing } from "../lib/listings";
import { formatStrk } from "../lib/secrets";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function useCountdown(target: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = target - now;
  if (left <= 0) return null;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

const when = (ts: number) =>
  new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const PHASE_COPY: Record<string, string> = {
  Bidding: "Bids are being committed. Nobody can read any of them, including the seller.",
  Revealing: "Bidding is closed. Bidders are opening their commitments, and each revealed amount becomes public as it lands.",
  AwaitingSettlement: "The reveal window has closed. Anyone can settle this auction; it takes no secrets and moves no money.",
  Settled: "Settled. Funds leave through individual claims, each paid only to an address committed before bidding.",
  Cancelled: "Cancelled by the seller before anyone committed.",
};

export function AuctionDetail({ address, a }: { address: string; a: AuctionSummary }) {
  const [listing, setListing] = useState<Listing | null>(null);
  useEffect(() => {
    void lookup(address, BASE).then(setListing);
  }, [address]);

  const target = a.phase === "Bidding" ? a.closeTime : a.phase === "Revealing" ? a.revealDeadline : 0;
  const countdown = useCountdown(target);
  const forfeited = a.state === "Settled" ? a.commitments - a.revealed : null;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-semibold">{listing?.title ?? "Untitled auction"}</h2>
          <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs">{a.phase}</span>
          <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs">
            {a.kind === "FirstPrice" ? "First-price" : "Second-price"}
          </span>
        </div>
        {listing?.description && (
          <p className="text-sm text-neutral-400">{listing.description}</p>
        )}
        <p className="font-mono text-xs text-neutral-600 break-all">{address}</p>
      </header>

      <p className="rounded border border-neutral-800 bg-neutral-900/60 p-3 text-sm text-neutral-300">
        {PHASE_COPY[a.phase]}
        {countdown && (
          <span className="mt-1 block text-neutral-400">
            {a.phase === "Bidding" ? "Bidding closes in " : "Reveal window closes in "}
            <span className="font-medium text-neutral-100">{countdown}</span>
          </span>
        )}
      </p>

      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <Row label="Collateral, per bidder" value={`${formatStrk(a.collateral)} STRK`}
          note="Identical for everyone. This is what stops the escrow leaking the bid." />
        <Row label="Reserve price" value={`${formatStrk(a.reserve)} STRK`}
          note="The lowest bid the seller will accept." />
        <Row label="Bids committed" value={String(a.commitments)}
          note="How many, not who or how much." />
        <Row label="Bids revealed" value={`${a.revealed} of ${a.commitments}`} />
        <Row label="Held in escrow" value={`${formatStrk(a.escrowed)} STRK`}
          note="Collateral times commitments, until claims begin." />
        <Row label="Bidding closes" value={when(a.closeTime)} />
        <Row label="Reveal deadline" value={when(a.revealDeadline)}
          note="Miss it and the collateral is forfeited to the seller." />
        {a.state === "Settled" && (
          <>
            <Row
              label="Clearing price"
              value={`${formatStrk(a.clearingPrice)} STRK`}
              note={
                a.kind === "FirstPrice"
                  ? "The winner's own bid."
                  : "The second-highest valid bid, which is what the winner pays rather than their own."
              }
            />
            <Row label="Forfeited entries" value={String(forfeited)}
              note="Committed but never revealed. The collateral goes to the seller." />
          </>
        )}
      </div>

      {a.state === "Settled" && BigInt(a.winnerHandle) !== 0n && (
        <div className="space-y-1">
          <p className="text-sm text-neutral-400">Winning entry</p>
          <p className="font-mono text-xs break-all">{a.winnerHandle}</p>
          <p className="text-xs text-neutral-500">
            A hash, not a person. The contract stores no bidder address at any point, so this
            identifies the entry and nothing else.
          </p>
        </div>
      )}

      <Visibility settled={a.state === "Settled"} />
    </section>
  );
}

/// Everything above is read from the chain, so everything above is public. Saying
/// so explicitly is more useful than implying privacy the design does not claim.
function Visibility({ settled }: { settled: boolean }) {
  return (
    <details className="rounded border border-neutral-800 bg-neutral-900/40 p-3">
      <summary className="cursor-pointer text-sm text-neutral-300">
        What anyone can see on chain
      </summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 text-xs">
        <div>
          <p className="mb-1 font-medium text-neutral-200">Visible</p>
          <ul className="space-y-1 text-neutral-400">
            <li>That this auction exists, and its terms</li>
            <li>How many bids were committed, and when</li>
            <li>That the pool funded each one</li>
            <li>Every revealed amount, once revealed</li>
            {settled && <li>The clearing price and the winning handle</li>}
            {settled && <li>Each claim amount and payout address</li>}
          </ul>
        </div>
        <div>
          <p className="mb-1 font-medium text-neutral-200">Hidden</p>
          <ul className="space-y-1 text-neutral-400">
            <li>Which person is behind any bid</li>
            <li>Every bid amount, until its owner reveals it</li>
            <li>Bid amounts that are never revealed, permanently</li>
            <li>Which shielded balance paid for any entry</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Everything on this page is read from the contract, so everything on this page is
        public. The privacy is in what the contract was never told, not in what this page
        chooses to show.
      </p>
    </details>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-b border-neutral-900 py-2">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-sm">{value}</dd>
      {note && <p className="mt-0.5 text-xs text-neutral-600">{note}</p>}
    </div>
  );
}
