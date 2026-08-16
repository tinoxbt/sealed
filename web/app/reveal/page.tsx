"use client";

import Link from "next/link";
import { useState } from "react";
import { readEntryStatus, revealCall, type EntryStatus } from "../../src/lib/auction";
import type { BidBackup } from "../../src/lib/backup";
import { parseStrk } from "../../src/lib/secrets";
import { useWallet } from "../../src/lib/useWallet";
import { BackupLoader } from "../../src/components/BackupLoader";
import { WalletBar } from "../../src/components/WalletBar";

export default function RevealPage() {
  const w = useWallet();
  const [backup, setBackup] = useState<BidBackup | null>(null);
  const [status, setStatus] = useState<EntryStatus | null>(null);
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadBackup(b: BidBackup) {
    setBackup(b);
    setError("");
    try {
      setStatus(await readEntryStatus(b.claimHandle));
    } catch (e) {
      setError(`Could not read the entry: ${(e as Error).message}`);
    }
  }

  async function reveal() {
    if (!w.account || !backup) return;
    setError("");
    setBusy("Waiting for the wallet");
    try {
      const res = await w.account.execute([
        revealCall(parseStrk(backup.bidAmountStrk), backup.bidSalt, backup.claimHandle),
      ]);
      setTxHash(res.transaction_hash);
      setStatus(await readEntryStatus(backup.claimHandle));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8 space-y-8">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          Sealed
        </Link>
        <h1 className="text-2xl font-semibold">Reveal your bid</h1>
        <p className="text-sm text-neutral-400">
          Opens your commitment so it can win. A bid that is never revealed forfeits its
          collateral to the seller, so this step is not optional if you want your money back.
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
            <Row label="bid" value={`${backup.bidAmountStrk} STRK`} />
            <Row label="claim handle" value={backup.claimHandle} />
            <Row label="status" value={status ?? "reading"} />
          </dl>

          {status === "Unknown" && (
            <Note tone="amber">
              The contract has no entry for this handle. Either the bid transaction never landed,
              or this backup belongs to a different auction.
            </Note>
          )}

          {(status === "Revealed" || status === "Won" || status === "Lost") && (
            <Note tone="neutral">
              Already revealed. Nothing more to do here. Once the auction settles, claim from the
              claim page.
            </Note>
          )}

          {status === "Forfeited" && (
            <Note tone="amber">
              The reveal window closed without this bid being revealed, so the collateral now
              belongs to the seller. Nothing can undo that.
            </Note>
          )}

          {status === "Committed" && (
            <>
              <Note tone="amber">
                The address that sends this transaction is public, and it will be permanently
                linked to this bid amount. Use an account that is not connected to you. Your main
                wallet undoes the unlinkability the bid was built to give you.
                <br />
                <br />
                Anyone can submit a reveal, because the contract checks the salt against the
                commitment rather than checking who sent it.
              </Note>

              <WalletBar {...w} connect={w.connect} />

              {w.address && (
                <button
                  onClick={reveal}
                  disabled={!!busy}
                  className="rounded bg-neutral-100 px-5 py-2 font-medium text-neutral-900 disabled:opacity-40"
                >
                  {busy || `Reveal ${backup.bidAmountStrk} STRK`}
                </button>
              )}
            </>
          )}

          {txHash && (
            <p className="font-mono text-xs text-neutral-400 break-all">
              submitted {txHash}
            </p>
          )}

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
