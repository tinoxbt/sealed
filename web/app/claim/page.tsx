"use client";

import Link from "next/link";
import { useState } from "react";
import {
  claimCall,
  readAuction,
  readEntryStatus,
  settleCall,
  type AuctionSummary,
  type EntryStatus,
} from "../../src/lib/auction";
import type { BidBackup } from "../../src/lib/backup";
import { useWallet } from "../../src/lib/useWallet";
import { BackupLoader } from "../../src/components/BackupLoader";
import { WalletBar } from "../../src/components/WalletBar";

export default function ClaimPage() {
  const w = useWallet();
  const [backup, setBackup] = useState<BidBackup | null>(null);
  const [status, setStatus] = useState<EntryStatus | null>(null);
  const [auction, setAuction] = useState<AuctionSummary | null>(null);
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadBackup(b: BidBackup) {
    setBackup(b);
    setError("");
    try {
      const [s, a] = await Promise.all([readEntryStatus(b.claimHandle), readAuction()]);
      setStatus(s);
      setAuction(a);
    } catch (e) {
      setError(`Could not read the entry: ${(e as Error).message}`);
    }
  }

  /// Settle is permissionless and moves no money, so a bidder waiting to be
  /// paid can do it themselves rather than waiting on the seller. Without this
  /// the flow dead-ends after the reveal deadline.
  async function settle() {
    if (!w.account || !backup) return;
    setError("");
    setBusy("Settling");
    try {
      const res = await w.account.execute([settleCall()]);
      setTxHash(res.transaction_hash);
      const [s, a] = await Promise.all([readEntryStatus(backup.claimHandle), readAuction()]);
      setStatus(s);
      setAuction(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function claim() {
    if (!w.account || !backup) return;
    setError("");
    setBusy("Waiting for the wallet");
    try {
      const res = await w.account.execute([claimCall(backup.claimSecret, backup.payoutAddress)]);
      setTxHash(res.transaction_hash);
      setStatus(await readEntryStatus(backup.claimHandle));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const claimable = status === "Won" || status === "Lost";

  return (
    <main className="mx-auto max-w-2xl p-8 space-y-8">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          Sealed
        </Link>
        <h1 className="text-2xl font-semibold">Claim</h1>
        <p className="text-sm text-neutral-400">
          Losers take back the full collateral. The winner takes back the collateral minus the
          clearing price, which is the second-highest bid.
        </p>
      </header>

      {error && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>
      )}

      {!backup ? (
        <BackupLoader onLoad={loadBackup} />
      ) : (
        <section className="space-y-5">
          <dl className="space-y-1 font-mono text-xs text-neutral-400 break-all">
            <Row label="claim handle" value={backup.claimHandle} />
            <Row label="pays to" value={backup.payoutAddress} />
            <Row label="status" value={status ?? "reading"} />
          </dl>

          {status === "Committed" && (
            <Note tone="amber">
              This bid has not been revealed yet, and an unrevealed bid cannot be claimed. Reveal
              it first, before the deadline, or the collateral goes to the seller.
            </Note>
          )}

          {status === "Revealed" && auction?.phase === "Revealing" && (
            <Note tone="neutral">
              Revealed, and the reveal window is still open. The auction can be settled once it
              closes, and then you can claim.
            </Note>
          )}

          {status === "Revealed" && auction?.phase === "AwaitingSettlement" && (
            <>
              <Note tone="neutral">
                The reveal window has closed and nobody has settled yet. Settling records the
                winner and the clearing price and moves no money, so anyone can do it, including
                you. Claiming becomes possible immediately afterwards.
              </Note>
              <WalletBar {...w} connect={w.connect} />
              {w.address && (
                <button
                  onClick={settle}
                  disabled={!!busy}
                  className="rounded bg-neutral-100 px-5 py-2 font-medium text-neutral-900 disabled:opacity-40"
                >
                  {busy || "Settle the auction"}
                </button>
              )}
            </>
          )}

          {status === "Forfeited" && (
            <Note tone="amber">
              Never revealed before the deadline, so this collateral belongs to the seller.
            </Note>
          )}

          {status === "Claimed" && <Note tone="neutral">Already paid out.</Note>}

          {claimable && (
            <>
              <Note tone="neutral">
                The payout address was fixed when you bid, and the contract recomputes the hash
                over your secret and that address. It pays there or it reverts, so it does not
                matter which account sends this transaction and a stranger copying it can only
                pay you.
              </Note>

              <WalletBar {...w} connect={w.connect} />

              {w.address && (
                <button
                  onClick={claim}
                  disabled={!!busy}
                  className="rounded bg-neutral-100 px-5 py-2 font-medium text-neutral-900 disabled:opacity-40"
                >
                  {busy || (status === "Won" ? "Claim as winner" : "Claim collateral back")}
                </button>
              )}
            </>
          )}

          {txHash && <p className="font-mono text-xs text-neutral-400 break-all">submitted {txHash}</p>}

          <button className="text-sm text-neutral-500 underline" onClick={() => setBackup(null)}>
            Load a different bid
          </button>
        </section>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-neutral-600">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Note({ tone, children }: { tone: "amber" | "neutral"; children: React.ReactNode }) {
  const cls =
    tone === "amber"
      ? "border-amber-900 bg-amber-950/30 text-amber-100/80"
      : "border-neutral-800 bg-neutral-900 text-neutral-400";
  return <div className={`rounded border p-3 text-sm ${cls}`}>{children}</div>;
}
